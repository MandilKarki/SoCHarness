"""No network. Public trace fidelity and secret/reasoning exclusion."""
import asyncio
import json
from unittest.mock import patch
from test_native_state import OpenAITest
from test_lab import LabFixture
from adapters.openai_observation import snapshot, tool_specs
from adapters.openai_runtime import run_openai
from adapters.state import load, save
from engine import Engine
from store import DEFAULT_CONFIG

class ObservationTest(LabFixture):
    def test_snapshot_excludes_private_fields_and_reasoning(self):
        value=snapshot([{'type':'reasoning','content':'private','summary':'private'},
            {'role':'user','content':'sk-abcdefghijk and Bearer abcdefgh','authorization':'private'}])
        encoded=json.dumps(value)
        self.assertNotIn('private',encoded)
        self.assertNotIn('abcdefgh',encoded)
        self.assertTrue(value[0]['omitted'])

    def test_snapshot_bounded(self):
        value=snapshot([{'role':'user','content':'x'*10000} for _ in range(100)])
        self.assertTrue(value['truncated'])
        self.assertLess(len(json.dumps(value)),25000)

    def test_read_schema_bounds_match_execution(self):
        specs=tool_specs(DEFAULT_CONFIG)
        limit=next(s for s in specs if s['name']=='query_case_evidence')['schema']['properties']['limit']
        self.assertEqual((limit['minimum'],limit['maximum']),(1,25))

    def test_real_runner_records_two_calls_and_returned_tool_context(self):
        engine=Engine(self.store,self.session(runtime='openai',accept_no_usd_cap=True))
        model=OpenAITest().model(tool_first=True)
        asyncio.run(run_openai(engine,'Review',model))
        trace=self.store.traces(engine.sid)
        requests=[t['payload'] for t in trace if t['kind']=='model.request']
        self.assertEqual([r['call'] for r in requests],[1,2])
        self.assertTrue(any(i.get('type')=='function_call_output' for i in requests[1]['input']))
        self.assertEqual(sum(t['kind']=='model.response' for t in trace),2)
        self.assertTrue(any(t['kind']=='harness.configured' for t in trace))

    def test_observation_receipts_do_not_trigger_compaction(self):
        sid=self.session(runtime='openai',accept_no_usd_cap=True)
        engine=Engine(self.store,sid)
        save(engine,{'messages':[{'role':'user','content':'keep me'}]})
        engine.record('model.request',{'input':'x'*120000})
        async def no_model(*args):pass
        with patch('adapters.registry.run',no_model):engine.run('Continue')
        self.assertIsNotNone(load(engine))
