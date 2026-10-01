"""Native SDK persistence, failure boundaries and real runners with fake models."""
import asyncio
import json
import unittest
from pathlib import Path
from test_lab import LabFixture
from engine import Engine
from store import Problem, Store
from adapters.state import load, save
from adapters.common import finish


class StateTest(LabFixture):
    def test_restart_isolation_and_compaction(self):
        sid=self.session(); engine=Engine(self.store,sid)
        save(engine,{'messages':['native']})
        with Store(self.path) as reopened:
            self.assertEqual(load(Engine(reopened,sid)),{'messages':['native']})
        self.assertIsNone(load(Engine(self.store,self.session())))
        point=self.store.trace(sid,'checkpoint',{'summary':'summary'})
        child=self.store.fork(sid,point['seq'])
        self.assertIsNone(load(Engine(self.store,child['id'])))
        self.store.compact(sid)
        self.assertIsNone(load(engine))

    def test_invalid_result_cannot_commit_state(self):
        sid=self.session(runtime='pydantic',structured_output=True,accept_no_usd_cap=True)
        engine=Engine(self.store,sid)
        with self.assertRaises(Problem):finish(engine,'not json','pydantic',native_state={'bad':True})
        self.assertIsNone(load(engine))
        self.assertFalse(any(t['kind']=='checkpoint' for t in self.store.traces(sid)))

    def test_state_size_limit_keeps_previous_snapshot(self):
        from unittest.mock import patch
        engine=Engine(self.store,self.session());save(engine,{'good':True})
        with patch('adapters.state.MAX_STATE_BYTES',20),self.assertRaises(Problem):save(engine,{'large':'x'*100})
        self.assertEqual(load(engine),{'good':True})


class PydanticPersistenceTest(LabFixture):
    def test_native_tool_receipts_survive_next_run(self):
        from pydantic_ai.models.function import FunctionModel,DeltaToolCall
        from adapters.pydantic_runtime import run_pydantic
        seen=[]
        async def model(messages,info):
            seen.append(messages)
            if len(seen)==1:yield {0:DeltaToolCall(name='query_case_evidence',json_args='{"limit":1,"search":""}',tool_call_id='q1')}
            else:yield 'Reviewed #1.'
        sid=self.session(runtime='pydantic',accept_no_usd_cap=True)
        for prompt in ('Inspect','Continue'):asyncio.run(run_pydantic(Engine(self.store,sid),prompt,FunctionModel(stream_function=model)))
        self.assertEqual(len(seen),3)
        self.assertTrue(any(getattr(p,'part_kind',None)=='tool-return' for m in seen[-1] for p in m.parts))
        self.assertEqual(sum(getattr(p,'content',None)=='Reviewed #1.' for m in seen[-1] for p in m.parts),1)


class DeepPersistenceTest(LabFixture):
    def model(self,responses):
        from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
        seen=[]
        class Model(FakeMessagesListChatModel):
            def bind_tools(self,*args,**kwargs):return self
            def _generate(self,messages,*args,**kwargs):
                seen.append(list(messages))
                return super()._generate(messages,*args,**kwargs)
        model=Model(responses=responses);model._relay_seen=seen
        return model

    def test_native_checkpoint_and_todos_resume(self):
        from langchain_core.messages import AIMessage
        from adapters.deep_runtime import run_deep
        from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
        from adapters.state import directory
        sid=self.session(runtime='deepagents',accept_no_usd_cap=True)
        model=self.model([AIMessage(content='',tool_calls=[{'name':'write_todos','args':{'todos':[{'content':'Verify #1','status':'in_progress'}]},'id':'plan','type':'tool_call'}]),AIMessage(content='Plan saved.')])
        engine=Engine(self.store,sid)
        asyncio.run(run_deep(engine,'Plan',model)); first=load(engine)
        continued=self.model([AIMessage(content='Continued.')])
        asyncio.run(run_deep(engine,'Continue',continued))
        second=load(engine)
        self.assertEqual(first['checkpoint']['thread_id'],second['checkpoint']['thread_id'])
        self.assertNotEqual(first['checkpoint']['checkpoint_id'],second['checkpoint']['checkpoint_id'])
        async def inspect():
            async with AsyncSqliteSaver.from_conn_string(str(directory(engine)/'deep-checkpoints.sqlite3')) as saver:
                checkpoint=await saver.aget_tuple({'configurable':second['checkpoint']})
                return checkpoint.checkpoint['channel_values']
        values=asyncio.run(inspect())
        self.assertEqual(values['todos'][0]['content'],'Verify #1')
        self.assertTrue(any(m.content=='Plan saved.' for m in continued._relay_seen[0]))

    def test_structured_findings(self):
        from langchain_core.messages import AIMessage
        from adapters.deep_runtime import run_deep
        expected={'observations':['#1'],'evidence_ids':[1],'hypotheses':[],'next_steps':[],'limitations':'test'}
        sid=self.session(runtime='deepagents',structured_output=True,accept_no_usd_cap=True)
        model=self.model([AIMessage(content='',tool_calls=[{'name':'Findings','args':expected,'id':'out','type':'tool_call'}])])
        asyncio.run(run_deep(Engine(self.store,sid),'Review',model))
        self.assertEqual(next(t for t in self.store.traces(sid) if t['kind']=='sdk.result')['payload']['structured_output'],expected)

    def test_named_specialist_and_shared_call_limit(self):
        from langchain_core.messages import AIMessage
        from adapters.deep_runtime import run_deep
        sid=self.session(runtime='deepagents',specialists=True,max_turns=3,accept_no_usd_cap=True)
        model=self.model([AIMessage(content='',tool_calls=[{'name':'task','args':{'subagent_type':'evidence-reviewer','description':'Inspect #1'},'id':'delegate','type':'tool_call'}]),
                         AIMessage(content='Specialist result.'),AIMessage(content='Parent result.')])
        asyncio.run(run_deep(Engine(self.store,sid),'Review',model))
        self.assertTrue(any(t['kind']=='agent.delegated' for t in self.store.traces(sid)))
        sid=self.session(runtime='deepagents',specialists=True,max_turns=1,accept_no_usd_cap=True)
        model.i=0
        with self.assertRaises(Problem):asyncio.run(run_deep(Engine(self.store,sid),'Review',model))
        self.assertIsNone(load(Engine(self.store,sid)))


class OpenAITest(LabFixture):
    def model(self,tool_first=False,text='Reviewed #1.'):
        from agents import Model
        from openai.types.responses import Response, ResponseCompletedEvent, ResponseOutputMessage, ResponseOutputText, ResponseFunctionToolCall
        owner=self
        class Fake(Model):
            def __init__(self):self.inputs=[]
            async def get_response(self,*a,**kw):raise AssertionError('Streaming required')
            async def stream_response(self,system_instructions,input,model_settings,tools,output_schema,handoffs,tracing,**kwargs):
                self.inputs.append(input)
                owner.assertTrue(tracing.is_disabled())
                owner.assertFalse(model_settings.parallel_tool_calls)
                owner.assertFalse(model_settings.store)
                if tool_first and len(self.inputs)==1:
                    output=[ResponseFunctionToolCall(type='function_call',id='fc1',call_id='q1',name='query_case_evidence',arguments='{"limit":1,"search":""}')]
                else:output=[ResponseOutputMessage(type='message',id='msg1',role='assistant',status='completed',content=[ResponseOutputText(type='output_text',text=text,annotations=[])])]
                response=Response.model_construct(id='response1',output=output,status='completed',usage=None)
                yield ResponseCompletedEvent(type='response.completed',sequence_number=1,response=response)
        return Fake()

    def test_real_runner_tool_loop_and_native_continuation(self):
        from adapters.openai_runtime import run_openai
        sid=self.session(runtime='openai',accept_no_usd_cap=True);model=self.model(tool_first=True)
        for prompt in ('Review','Continue'):asyncio.run(run_openai(Engine(self.store,sid),prompt,model))
        self.assertEqual(len(model.inputs),3)
        self.assertTrue(any(i.get('type')=='function_call_output' for i in model.inputs[-1]))
        self.assertTrue(any(t['kind']=='tool.result' for t in self.store.traces(sid)))

    def test_typed_output_and_request_bound(self):
        from adapters.openai_runtime import run_openai
        from agents import MaxTurnsExceeded
        expected={'observations':['#1'],'evidence_ids':[1],'hypotheses':[],'next_steps':[],'limitations':'test'}
        sid=self.session(runtime='openai',structured_output=True,accept_no_usd_cap=True)
        asyncio.run(run_openai(Engine(self.store,sid),'Review',self.model(text=json.dumps(expected))))
        result=next(t for t in self.store.traces(sid) if t['kind']=='sdk.result')
        self.assertEqual(result['payload']['structured_output'],expected)
        sid=self.session(runtime='openai',max_turns=1,accept_no_usd_cap=True)
        with self.assertRaises(MaxTurnsExceeded):asyncio.run(run_openai(Engine(self.store,sid),'Review',self.model(tool_first=True)))
        self.assertIsNone(load(Engine(self.store,sid)))
