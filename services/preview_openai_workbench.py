"""Explicit localhost-only, zero-network browser QA using the REAL SDK Runner.

Run this module directly. Uses a temporary DB and fake model, never API keys.
No production modules select this fixture automatically.
"""
import asyncio
import json
import os
import tempfile
from pathlib import Path

def main():
    with tempfile.TemporaryDirectory(prefix='relay-workbench-qa-') as directory:
        os.environ.update(RELAY_MODE='local',RELAY_DB=str(Path(directory)/'qa.sqlite'),
            RELAY_TRIAL_ENABLED='1',RELAY_TRIAL_UNTIL='2026-11-01T06:59:59Z')
        os.environ.pop('OPENAI_API_KEY',None)
        from agents import Model
        from openai.types.responses import Response,ResponseCompletedEvent,ResponseOutputMessage,ResponseOutputText,ResponseFunctionToolCall
        from store import Store,TOOLS
        from app import Server,Access
        from adapters import registry
        from adapters.openai_runtime import run_openai
        from trial_budget import MODEL
        class FixtureModel(Model):
            async def get_response(self,*a,**kw):raise AssertionError('Streaming only')
            async def stream_response(self,system_instructions,input,model_settings,tools,output_schema,handoffs,tracing,**kwargs):
                await asyncio.sleep(.35)
                if not any(i.get('type')=='function_call_output' for i in input):
                    output=[ResponseFunctionToolCall(type='function_call',id='fc1',call_id='q1',name='query_case_evidence',arguments='{"limit":3,"search":""}')]
                else:
                    findings={'observations':['OFFLINE QA: three synthetic authentication records on FINANCE-07.'],
                        'evidence_ids':[1,2,3],'hypotheses':['A failed sign-in followed by success warrants review, not an automatic attack verdict.'],
                        'next_steps':['Compare account owner activity with the recorded timestamps.'],'limitations':'Offline fake-model fixture. No external model request or charge.'}
                    text=json.dumps(findings) if output_schema else findings['observations'][0]
                    output=[ResponseOutputMessage(type='message',id='m1',role='assistant',status='completed',content=[ResponseOutputText(type='output_text',text=text,annotations=[])])]
                from openai.types.responses.response_usage import ResponseUsage,InputTokensDetails,OutputTokensDetails
                usage=ResponseUsage(input_tokens=100,output_tokens=70,total_tokens=170,input_tokens_details=InputTokensDetails(cached_tokens=0,cache_write_tokens=0),output_tokens_details=OutputTokensDetails(reasoning_tokens=0))
                yield ResponseCompletedEvent(type='response.completed',sequence_number=1,response=Response.model_construct(id='offline-qa',output=output,status='completed',usage=usage))
        with Store() as store:
            store.db.execute('CREATE TABLE events(id INTEGER PRIMARY KEY,occurred_at TEXT,event_id TEXT,host TEXT,user_name TEXT,source TEXT,raw_json TEXT)')
            for i,event in enumerate(['4625','4625','4624','4688','13','10','5156','4673','11'],1):
                store.db.execute('INSERT INTO events VALUES(?,?,?,?,?,?,?)',(i,f'2026-10-01T08:0{i}:00Z',event,'FINANCE-07','lab.analyst','Windows Security',json.dumps({'fixture':True,'event_id':event,'message':'Synthetic authentication event for browser QA only.'})))
            store.db.commit();store.initialize()
        def fixture_catalog(store=None):
            return [dict(id='openai',name='OpenAI · OFFLINE QA',available=True,enabled=True,version='offline fixture',detail='OFFLINE QA — fake model, no provider traffic.',default_model=MODEL,features=['structured_output'],budget='Isolated fixture ledger',trial_guard=True,deferred=[],docs='https://openai.github.io/openai-agents-python/')]
        registry.catalog=fixture_catalog
        async def fixture_run(engine,prompt):
            if engine.store.session(engine.sid)['config']['runtime']!='openai':raise RuntimeError('Fixture only supports OpenAI')
            return await run_openai(engine,prompt,FixtureModel())
        registry.run=fixture_run
        print('OFFLINE QA: http://127.0.0.1:8794 — temporary data, real Runner, fake model, no API key.',flush=True)
        Server(('127.0.0.1',8794),Access(mode='local')).serve_forever()

if __name__=='__main__':main()
