"""Real Python SDK loops + deterministic model doubles. No provider requests."""
import asyncio
import importlib.util
import unittest
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch
from test_lab import LabFixture
from store import Problem
from engine import Engine
from adapters.common import definitions, dispatch, context
from adapters.registry import catalog, set_enabled, ensure_ready

class RegistryTest(LabFixture):
    def test_all_requested_adapters_registered(self):
        self.assertEqual({r['id'] for r in catalog(self.store)}, {'simulator','claude','pi','pydantic','vercel','opencode','deepagents','openai'})
    def test_enable_disable_persists_and_blocks_runs(self):
        set_enabled(self.store,'pydantic',False)
        with self.assertRaises(Problem):ensure_ready(self.store,'pydantic')
        self.assertFalse(next(r for r in catalog(self.store) if r['id']=='pydantic')['enabled'])
        set_enabled(self.store,'pydantic',True)
    def test_unknown_and_replay_switch_rejected(self):
        for id in ('unknown','simulator'):
            with self.assertRaises(Problem):set_enabled(self.store,id,False)
    def test_busy_adapter_cannot_be_disabled(self):
        sid=self.session(runtime='pydantic',accept_no_usd_cap=True);self.store.begin(sid)
        with self.assertRaises(Problem):set_enabled(self.store,'pydantic',False)
    def test_features_cannot_silently_degrade(self):
        for runtime,feature in [('pi','file_workspace'),('pydantic','specialists'),('deepagents','file_workspace'),('opencode','memory'),('openai','file_workspace')]:
            with self.assertRaises(Problem):self.session(runtime=runtime,accept_no_usd_cap=True,**{feature:True})
    def test_budget_ack_required(self):
        with self.assertRaises(Problem):self.session(runtime='vercel')
    def test_no_readonly_write_tools_exposed(self):
        s=self.store.session(self.session(memory=True,artifacts=True))
        names={d['name'] for d in definitions(s['config'])}
        self.assertIn('query_case_evidence',names);self.assertNotIn('write_artifact',names)
    def test_dispatch_cannot_bypass_disabled_tools(self):
        sid=self.session(disabled_tools=['ask_human'])
        with self.assertRaises(Problem):asyncio.run(dispatch(Engine(self.store,sid),'ask_human',{'question':'no'}))
    def test_continuity_is_session_scoped(self):
        sid=self.session();other=self.session()
        self.store.trace(other,'message.user',{'text':'PRIVATE OTHER SESSION'})
        self.store.trace(sid,'message.user',{'text':'our prior turn'})
        prompt=context(Engine(self.store,sid),'new question')
        self.assertIn('our prior turn',prompt);self.assertNotIn('PRIVATE',prompt)
    def test_no_credential_values_in_catalog(self):
        with patch.dict('os.environ',{'ANTHROPIC_API_KEY':'secret-test-sentinel'}):
            self.assertNotIn('secret-test-sentinel',str(catalog(self.store)))

@unittest.skipUnless(importlib.util.find_spec('pydantic_ai'),'PydanticAI not installed')
class PydanticTest(LabFixture):
    def test_native_structured_output_is_validated(self):
        from pydantic_ai.models.function import FunctionModel,DeltaToolCall
        from adapters.pydantic_runtime import run_pydantic
        import json
        expected={'observations':['record #1'], 'evidence_ids':[1], 'hypotheses':[], 'next_steps':[], 'limitations':'Test only'}
        async def model(messages,info):
            yield {0:DeltaToolCall(name=info.output_tools[0].name,json_args=json.dumps(expected),tool_call_id='output1')}
        sid=self.session(runtime='pydantic',structured_output=True,accept_no_usd_cap=True)
        asyncio.run(run_pydantic(Engine(self.store,sid),'Review',FunctionModel(stream_function=model)))
        result=next(t for t in self.store.traces(sid) if t['kind']=='sdk.result')
        self.assertEqual(result['payload']['structured_output'],expected)

    def test_native_tool_loop_through_gateway(self):
        from pydantic_ai.models.function import FunctionModel,DeltaToolCall
        from adapters.pydantic_runtime import run_pydantic
        calls=[]
        async def model(messages,info):
            calls.append(info)
            if len(calls)==1:yield {0:DeltaToolCall(name='query_case_evidence',json_args='{"limit":1,"search":""}',tool_call_id='query1')}
            else:yield 'Reviewed evidence #1; not a confirmed incident.'
        sid=self.session(runtime='pydantic',model='test',accept_no_usd_cap=True)
        asyncio.run(run_pydantic(Engine(self.store,sid),'Review',FunctionModel(stream_function=model)))
        self.assertEqual(len(calls),2)
        trace=self.store.traces(sid)
        self.assertTrue(any(t['kind']=='tool.result' for t in trace))
        self.assertEqual(trace[-1]['kind'],'checkpoint')

@unittest.skipUnless(importlib.util.find_spec('deepagents'),'Deep Agents not installed')
class DeepTest(LabFixture):
    def test_native_graph_calls_relay_tool(self):
        from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
        from langchain_core.messages import AIMessage
        from adapters.deep_runtime import run_deep
        class Model(FakeMessagesListChatModel):
            def bind_tools(self,*args,**kwargs):return self
        model=Model(responses=[AIMessage(content='',tool_calls=[{'name':'query_case_evidence','args':{'limit':1,'search':''},'id':'q1','type':'tool_call'}]),AIMessage(content='Reviewed #1. No verdict.')])
        sid=self.session(runtime='deepagents',accept_no_usd_cap=True)
        asyncio.run(run_deep(Engine(self.store,sid),'Review',model))
        self.assertTrue(any(t['kind']=='tool.result' for t in self.store.traces(sid)))
        self.assertEqual(self.store.traces(sid)[-1]['kind'],'checkpoint')
    def test_native_host_tool_denied(self):
        from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
        from langchain_core.messages import AIMessage
        from adapters.deep_runtime import run_deep
        class Model(FakeMessagesListChatModel):
            def bind_tools(self,*args,**kwargs):return self
        model=Model(responses=[AIMessage(content='',tool_calls=[{'name':'write_file','args':{'file_path':'/secret.txt','content':'no'},'id':'w1','type':'tool_call'}]),AIMessage(content='Denied.')])
        sid=self.session(runtime='deepagents',accept_no_usd_cap=True)
        asyncio.run(run_deep(Engine(self.store,sid),'Review',model))
        self.assertTrue(any(t['kind']=='tool.denied' for t in self.store.traces(sid)))

class BridgeTest(LabFixture):
    def test_subprocess_protocol_routes_tools_and_filters_environment(self):
        from adapters.node_runtime import run_node
        script='''import sys,json
r=json.loads(sys.stdin.readline())
print(json.dumps({'type':'tool','id':'1','name':'query_case_evidence','arguments':{'limit':1,'search':''}}),flush=True)
receipt=json.loads(sys.stdin.readline())
assert receipt['result']['items'][0]['id']==1
print(json.dumps({'type':'final','text':'Bridge review #1','usage':{'input_tokens':10,'output_tokens':5}}),flush=True)
'''
        original=asyncio.create_subprocess_exec
        async def spawn(*args,**kwargs):
            self.assertNotIn('RELAY_TEST_SECRET',kwargs['env'])
            self.assertNotIn('ANTHROPIC_API_KEY',kwargs['env'])
            return await original(sys.executable,'-c',script,**kwargs)
        sid=self.session(runtime='vercel',accept_no_usd_cap=True)
        with patch('adapters.node_runtime.asyncio.create_subprocess_exec',spawn),patch('adapters.node_runtime.ROOT',Path(self.temp.name)),patch.dict('os.environ',{'RELAY_TEST_SECRET':'private','ANTHROPIC_API_KEY':'not-for-vercel'}):
            # Worker cwd must exist, even though this test swaps its process command.
            (Path(self.temp.name)/'workers/agent-bridge').mkdir(parents=True)
            asyncio.run(run_node(Engine(self.store,sid),'Review'))
        self.assertEqual(self.store.session(sid)['input_tokens'],10)
        self.assertTrue(any(t['kind']=='tool.result' for t in self.store.traces(sid)))

    def test_worker_exit_without_final_is_not_success(self):
        from adapters.node_runtime import run_node
        original=asyncio.create_subprocess_exec
        async def spawn(*args,**kwargs):return await original(sys.executable,'-c','import sys;sys.stdin.readline()',**kwargs)
        sid=self.session(runtime='vercel',accept_no_usd_cap=True)
        with patch('adapters.node_runtime.asyncio.create_subprocess_exec',spawn),patch('adapters.node_runtime.ROOT',Path(self.temp.name)):
            (Path(self.temp.name)/'workers/agent-bridge').mkdir(parents=True)
            with self.assertRaises(Problem):asyncio.run(run_node(Engine(self.store,sid),'Review'))
        self.assertFalse(any(t['kind']=='checkpoint' for t in self.store.traces(sid)))
