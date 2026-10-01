"""Real SDK loops with synthetic model transports; never provider-paid tests."""
import asyncio
import copy
import json
import os
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch

os.environ.update(OTEL_SDK_DISABLED='true',LITELLM_LOCAL_MODEL_COST_MAP='True',OPENHANDS_SUPPRESS_BANNER='1')
FINDINGS = {'observations':['Record #1'],'evidence_ids':[1],'hypotheses':[],'next_steps':[],'limitations':'Fixture only'}
TOOL = {'name':'query_case_evidence','description':'Read scoped evidence',
        'schema':{'type':'object','properties':{'limit':{'type':'integer'},'search':{'type':'string'}},
                  'required':['limit','search'],'additionalProperties':False}}


class FakeBridge:
    def __init__(self): self.calls=[]; self.events=[]
    def emit(self,event): self.events.append(event)
    def call_sync(self,name,args):
        self.calls.append((name,args)); return {'records':[{'id':1,'host':'fixture'}]}
    async def call(self,name,args): return self.call_sync(name,args)


class Fixture(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.environment=patch.dict(os.environ,{'HOME':self.temp.name,'USERPROFILE':self.temp.name,
            'HERMES_HOME':self.temp.name,'XDG_CONFIG_HOME':self.temp.name})
        self.environment.start(); self.addCleanup(self.environment.stop)
        self.bridge=FakeBridge()
        self.req={'runtime':'test','sid':'test-session','cwd':self.temp.name,'system':'Review case evidence. Finish with findings.',
                  'prompt':'Inspect the case','tools':[copy.deepcopy(TOOL)],'native_state':None,
                  'config':{'model':'gpt-4.1-mini','max_turns':4,'max_output_tokens':256,'structured_output':False}}
        original_connect=socket.socket.connect
        def guarded_connect(sock,address):
            if isinstance(address,tuple) and address[0] in ('127.0.0.1','::1'): return original_connect(sock,address)
            raise AssertionError('Unexpected network in SDK contract')
        self.guard=patch.object(socket.socket,'connect',guarded_connect)
        self.guard.start(); self.addCleanup(self.guard.stop)


class GoogleTest(Fixture):
    def model(self,responses):
        from google.adk.models.base_llm import BaseLlm
        from google.adk.models._capabilities import LlmCapabilities
        from pydantic import PrivateAttr
        class Fake(BaseLlm):
            _seen: list = PrivateAttr(default_factory=list)
            @property
            def capabilities(self): return LlmCapabilities(output_schema_and_tools=True)
            async def generate_content_async(self,llm_request,stream=False):
                self._seen.append(llm_request.model_copy(deep=True))
                yield responses[min(len(self._seen)-1,len(responses)-1)]
        return Fake(model='gemini-2.5-flash')

    def response(self,text=None,tool=False):
        from google.genai import types
        from google.adk.models.llm_response import LlmResponse
        part=types.Part(function_call=types.FunctionCall(name=TOOL['name'],args={'limit':1,'search':''})) if tool else types.Part(text=text)
        return LlmResponse(content=types.Content(role='model',parts=[part]),
            usage_metadata=types.GenerateContentResponseUsageMetadata(prompt_token_count=12,candidates_token_count=3))

    def test_tools_and_native_resume(self):
        from google_runtime import run
        model=self.model([self.response(tool=True),self.response('Reviewed #1')])
        result=asyncio.run(run(self.req,self.bridge,model)); self.assertEqual(len(self.bridge.calls),1)
        self.req['native_state']=result['native_state']; self.req['prompt']='Continue'
        continued=self.model([self.response('Continued')]); asyncio.run(run(self.req,self.bridge,continued))
        history=str(continued._seen[0].contents)
        self.assertIn('function_response',history); self.assertIn('Reviewed #1',history)
        self.assertEqual(result['usage']['input_tokens'],24)

    def test_structured_and_budget(self):
        from google_runtime import run
        self.req['config']['structured_output']=True
        self.assertEqual(asyncio.run(run(self.req,self.bridge,self.model([self.response(json.dumps(FINDINGS))])))['structured'],FINDINGS)
        self.req['config'].update(structured_output=False,max_turns=1)
        with self.assertRaises(Exception): asyncio.run(run(self.req,self.bridge,self.model([self.response(tool=True)])))


class MicrosoftTest(Fixture):
    def transport(self,structured=False,forever=False):
        import httpx
        seen=[]
        def handle(request):
            body=json.loads(request.content); seen.append(body)
            tool=not structured and (forever or len(seen)==1)
            delta={'role':'assistant','tool_calls':[{'index':0,'id':'q'+str(len(seen)),'type':'function','function':{'name':TOOL['name'],'arguments':'{"limit":1,"search":""}'}}]} if tool else {'role':'assistant','content':json.dumps(FINDINGS) if structured else 'Reviewed #1'}
            base={'id':'chat-'+str(len(seen)),'object':'chat.completion.chunk','created':1,'model':'gpt-4.1-mini'}
            chunks=[{**base,'choices':[{'index':0,'delta':delta,'finish_reason':None}]},
                    {**base,'choices':[{'index':0,'delta':{},'finish_reason':'tool_calls' if tool else 'stop'}]},
                    {**base,'choices':[],'usage':{'prompt_tokens':12,'completion_tokens':3,'total_tokens':15}}]
            return httpx.Response(200,headers={'content-type':'text/event-stream'},content=''.join('data: '+json.dumps(c)+'\n\n' for c in chunks)+'data: [DONE]\n\n')
        return httpx.MockTransport(handle),seen

    def test_tools_and_native_resume(self):
        from microsoft_runtime import run
        transport,seen=self.transport()
        result=asyncio.run(run(self.req,self.bridge,transport)); self.assertEqual(len(self.bridge.calls),1)
        self.req['native_state']=result['native_state']; self.req['prompt']='Continue'
        asyncio.run(run(self.req,self.bridge,transport))
        self.assertTrue(any(m['role']=='tool' for m in seen[-1]['messages']))
        self.assertEqual(result['usage']['input_tokens'],24)

    def test_structured_and_budget(self):
        from microsoft_runtime import run
        self.req['config']['structured_output']=True
        self.assertEqual(asyncio.run(run(self.req,self.bridge,self.transport(structured=True)[0]))['structured'],FINDINGS)
        self.req['config'].update(structured_output=False,max_turns=1)
        transport,seen=self.transport(forever=True)
        with self.assertRaises(Exception): asyncio.run(run(self.req,self.bridge,transport))
        self.assertEqual(len(seen),1)


class OpenHandsTest(Fixture):
    def completion(self,forever=False):
        from openhands.sdk.llm import Message
        from openhands.sdk.llm.llm_response import LLMResponse
        from openhands.sdk.llm.utils.metrics import MetricsSnapshot
        from litellm import ModelResponse
        seen=[]
        def complete(_llm,*args,**kwargs):
            seen.append(kwargs.get('messages',args[0] if args else []))
            is_tool=forever or len(seen)==1
            name='relay_case' if is_tool else 'finish'
            arguments={'tool_name':TOOL['name'],'arguments':{'limit':1,'search':''}} if is_tool else {'message':'Reviewed #1'}
            raw=ModelResponse(id='response-'+str(len(seen)),choices=[{'index':0,'message':{'role':'assistant','content':'',
                'tool_calls':[{'id':'t'+str(len(seen)),'type':'function','function':{'name':name,'arguments':json.dumps(arguments)}}]},'finish_reason':'tool_calls'}])
            return LLMResponse(message=Message.from_llm_chat_message(raw.choices[0].message),metrics=MetricsSnapshot(),raw_response=raw)
        return complete,seen

    def test_tools_and_native_resume(self):
        from openhands.sdk import LLM
        from openhands_runtime import run
        complete,seen=self.completion()
        llm=LLM(model='openai/gpt-4.1-mini',usage_id='test',num_retries=0)
        with patch.object(LLM,'generate',complete):
            result=asyncio.run(run(self.req,self.bridge,llm))
            self.assertEqual(len(self.bridge.calls),1)
            self.req['native_state']=result['native_state'];self.req['prompt']='Continue'
            asyncio.run(run(self.req,self.bridge,llm))
        self.assertIn('fixture',str(seen[-1]));self.assertIn('Reviewed #1',str(seen[-1]))

    def test_iteration_limit(self):
        from openhands.sdk import LLM
        from openhands_runtime import run
        complete,seen=self.completion(forever=True); self.req['config']['max_turns']=1
        with patch.object(LLM,'generate',complete),self.assertRaisesRegex(RuntimeError,'OpenHands did not complete'):
            asyncio.run(run(self.req,self.bridge,LLM(model='openai/gpt-4.1-mini',usage_id='test')))
        self.assertEqual(len(seen),1)


if __name__=='__main__': unittest.main()
