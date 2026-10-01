"""Subprocess transport contracts through the real parent policy gateway."""
import asyncio
import json
import sys
from unittest.mock import patch
from test_lab import LabFixture
from engine import Engine
from store import Problem
from adapters.python_runtime import run_python
from adapters.state import load, save


class PythonBridgeTest(LabFixture):
    def execute(self,engine,script):
        launch=asyncio.create_subprocess_exec
        async def fake_worker(*args,**kwargs):
            return await launch(sys.executable,'-I','-c',script,**kwargs)
        with patch('adapters.python_runtime.interpreter',return_value=sys.executable),patch('asyncio.create_subprocess_exec',fake_worker):
            asyncio.run(run_python(engine,'Review case'))

    def test_tool_receipt_and_success_anchor(self):
        engine=Engine(self.store,self.session(runtime='google_adk',accept_no_usd_cap=True))
        self.execute(engine,"""import sys,json,os
r=json.loads(sys.stdin.readline())
assert 'RELAY_OPERATOR_TOKEN' not in os.environ
assert 'ANTHROPIC_API_KEY' not in os.environ
assert os.environ['HOME'].startswith(r['cwd'])
print(json.dumps({'type':'tool','id':'1','name':'query_case_evidence','arguments':{'limit':1,'search':''}}),flush=True)
receipt=json.loads(sys.stdin.readline())
assert receipt['result']['items']
print(json.dumps({'type':'final','text':'Reviewed','native_state':{'receipt':receipt}}),flush=True)
""")
        self.assertEqual(load(engine)['receipt']['id'],'1')
        self.assertTrue(any(t['kind']=='tool.result' for t in self.store.traces(engine.sid)))

    def test_disabled_tool_rejected_and_failure_preserves_anchor(self):
        engine=Engine(self.store,self.session(runtime='microsoft',disabled_tools=['query_case_evidence'],accept_no_usd_cap=True))
        save(engine,{'old':True})
        with self.assertRaises(Problem): self.execute(engine,"""import sys,json
json.loads(sys.stdin.readline())
print(json.dumps({'type':'tool','id':'1','name':'query_case_evidence','arguments':{'limit':1,'search':''}}),flush=True)
receipt=json.loads(sys.stdin.readline()); assert 'error' in receipt
print(json.dumps({'type':'error','message':'deliberate fixture failure'}),flush=True)
""")
        self.assertEqual(load(engine),{'old':True})
        self.assertFalse(any(t['kind']=='tool.started' for t in self.store.traces(engine.sid)))

    def test_write_needs_exact_approval(self):
        engine=Engine(self.store,self.session(runtime='hermes',permission='ask_all',await_approvals=False,accept_no_usd_cap=True))
        self.execute(engine,"""import sys,json
json.loads(sys.stdin.readline())
print(json.dumps({'type':'tool','id':'1','name':'save_case_note','arguments':{'content':'Needs approval'}}),flush=True)
reply=json.loads(sys.stdin.readline()); assert 'pending_approval' in reply['result']
print(json.dumps({'type':'final','text':'Awaiting approval'}),flush=True)
""")
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM relay_notes').fetchone()[0],0)

    def test_worker_cancel_does_not_commit(self):
        import threading
        engine=Engine(self.store,self.session(runtime='openhands',accept_no_usd_cap=True))
        timer=threading.Timer(.4,engine.cancelled.set);timer.start()
        try:
            with self.assertRaisesRegex(Problem,'cancelled'):self.execute(engine,'import time;time.sleep(20)')
        finally:timer.cancel()
        self.assertIsNone(load(engine))
