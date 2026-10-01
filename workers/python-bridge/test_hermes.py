"""Pinned Hermes loop with the real OpenAI client and an in-process fake transport."""
import asyncio
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from test_contracts import Fixture


class HermesTest(Fixture):
    def tearDown(self):
        import logging
        logging.shutdown()

    def execute(self,forever=False):
        import httpx
        from openai import OpenAI
        from hermes_runtime import run
        from run_agent import AIAgent
        seen=[]
        def handle(request):
            body=json.loads(request.content);seen.append(body)
            tool=forever or len(seen)==1
            message={'role':'assistant','content':None,'tool_calls':[{'id':'q'+str(len(seen)),'type':'function',
                'function':{'name':'relay_query_case_evidence','arguments':'{"limit":1,"search":""}'}}]} if tool else {'role':'assistant','content':'Reviewed #1'}
            base={'id':'chat-'+str(len(seen)),'created':1,'model':'gpt-4.1-mini'}
            if body.get('stream'):
                delta={'role':'assistant','tool_calls':[{'index':0,**message['tool_calls'][0]}]} if tool else message
                chunks=[{**base,'object':'chat.completion.chunk','choices':[{'index':0,'delta':delta,'finish_reason':None}]},
                        {**base,'object':'chat.completion.chunk','choices':[{'index':0,'delta':{},'finish_reason':'tool_calls' if tool else 'stop'}],
                         'usage':{'prompt_tokens':12,'completion_tokens':3,'total_tokens':15}}]
                return httpx.Response(200,headers={'content-type':'text/event-stream'},content=''.join('data: '+json.dumps(c)+'\n\n' for c in chunks)+'data: [DONE]\n\n')
            return httpx.Response(200,json={**base,'object':'chat.completion','choices':[{'index':0,'message':message,'finish_reason':'tool_calls' if tool else 'stop'}],
                                            'usage':{'prompt_tokens':12,'completion_tokens':3,'total_tokens':15}})
        client=OpenAI(api_key='contract-test',http_client=httpx.Client(transport=httpx.MockTransport(handle)),max_retries=0)
        # Set the profile before the first Hermes import. No personal config or keys.
        with patch.dict(os.environ,{'HERMES_HOME':self.temp.name,'HOME':self.temp.name,'USERPROFILE':self.temp.name,
                                     'DO_NOT_TRACK':'1','OTEL_SDK_DISABLED':'true'}), patch.object(AIAgent,'_create_request_openai_client',
                side_effect=lambda **kwargs:OpenAI(api_key='contract-test',http_client=httpx.Client(transport=httpx.MockTransport(handle)),max_retries=0)):
            result=asyncio.run(run(self.req,self.bridge,client))
            self.req['native_state']=result['native_state']; self.req['prompt']='Continue'
            # Agent.close closes its owned client; use another client for the second turn.
            client2=OpenAI(api_key='contract-test',http_client=httpx.Client(transport=httpx.MockTransport(handle)),max_retries=0)
            asyncio.run(run(self.req,self.bridge,client2))
        return result,seen

    def test_tools_and_native_resume(self):
        result,seen=self.execute()
        self.assertEqual(len(self.bridge.calls),1)
        self.assertEqual(result['text'],'Reviewed #1')
        self.assertTrue(any(m['role']=='tool' for m in seen[-1]['messages']))

    def test_iteration_budget(self):
        self.req['config']['max_turns']=1
        with self.assertRaisesRegex(RuntimeError,'Hermes did not complete'): self.execute(forever=True)
        self.assertEqual(len(self.bridge.calls),1)


if __name__=='__main__': unittest.main()
