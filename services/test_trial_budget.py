import asyncio
import concurrent.futures
import os
from types import SimpleNamespace
from unittest.mock import patch
from test_lab import LabFixture
from store import Store, Problem
from trial_budget import TrialBudget, MODEL, RESERVATION, SPENDABLE, guarded_model, check_runtime


class TrialTests(LabFixture):
    def setUp(self):
        super().setUp()
        self.env = patch.dict(os.environ, {'RELAY_TRIAL_ENABLED':'1','RELAY_TRIAL_UNTIL':'2099-01-01T00:00:00Z'})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.sid = self.session()
        self.budget = TrialBudget(self.store)

    def test_reserve_settle_round_up_and_session_cost(self):
        rid = self.budget.reserve(self.sid, MODEL)
        self.assertEqual(self.budget.snapshot()['accounted_usd'], .1)
        self.assertEqual(self.budget.settle(rid, 1001, 7), .000209)
        self.assertEqual(self.store.session(self.sid)['cost_usd'], .000209)
        self.assertEqual(self.budget.snapshot()['unsettled_requests'], 0)
        with self.assertRaises(Problem): self.budget.settle(rid, 0, 0)

    def test_crash_and_restart_retain_reservations(self):
        self.budget.reserve(self.sid, MODEL)
        with Store(self.path) as second:
            self.assertEqual(TrialBudget(second).snapshot()['accounted_usd'], .1)
        self.store.recover()
        self.assertEqual(self.budget.snapshot()['accounted_usd'], .1)

    def test_budget_refuses_next_reservation_at_ceiling(self):
        for _ in range(SPENDABLE//RESERVATION): self.budget.reserve(self.sid, MODEL)
        with self.assertRaises(Problem) as caught: self.budget.reserve(self.sid, MODEL)
        self.assertEqual(caught.exception.status, 402)
        self.assertEqual(self.budget.snapshot()['accounted_usd'], 4.5)
        self.assertTrue(self.budget.snapshot()['blocked'])

    def test_concurrent_connections_cannot_overspend(self):
        for _ in range(44): self.budget.reserve(self.sid, MODEL)
        def attempt(_):
            with Store(self.path) as store:
                try: TrialBudget(store).reserve(self.sid, MODEL); return True
                except Problem: return False
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            self.assertEqual(sum(pool.map(attempt, range(8))), 1)
        self.assertEqual(self.budget.snapshot()['accounted_usd'], 4.5)

    def test_restarts_cannot_extend_expiration(self):
        first = self.budget.snapshot()['expires_at']
        with patch.dict(os.environ, {'RELAY_TRIAL_UNTIL':'2100-01-01T00:00:00Z'}):
            self.assertEqual(self.budget.snapshot()['expires_at'], first)
        with patch.dict(os.environ, {'RELAY_TRIAL_UNTIL':'2000-01-01T00:00:00Z'}):
            self.assertTrue(self.budget.snapshot()['blocked'])
        with self.assertRaises(Problem): self.budget.reserve(self.sid, MODEL)

    def test_october_extension_preserves_costs_halt_and_is_one_time(self):
        from trial_budget import OCTOBER_EXTENSION
        from datetime import datetime
        old, new = OCTOBER_EXTENSION
        rid = self.budget.reserve(self.sid, MODEL)
        self.budget.settle(rid,1001,7)
        self.budget.reserve(self.sid, MODEL)
        self.store.db.execute('UPDATE relay_trial SET expires_at=?,halted=1',
                              (datetime.fromisoformat(old.replace('Z','+00:00')).timestamp(),))
        self.store.db.commit()
        with patch.dict(os.environ, {'RELAY_TRIAL_UNTIL':new}):
            status=self.budget.snapshot()
            self.assertEqual(status['expires_at'],new.replace('Z','+00:00'))
            self.assertEqual(status['accounted_usd'],.100209)
            self.assertEqual(status['requests'],2)
            self.assertEqual(status['unsettled_requests'],1)
            self.assertTrue(status['blocked'])
            self.budget.configure()
            self.assertEqual(self.store.db.execute('SELECT count(*) FROM relay_trial_amendments').fetchone()[0],1)
        # Shortening after approval cannot replay the extension migration.
        with patch.dict(os.environ, {'RELAY_TRIAL_UNTIL':old}): self.budget.configure()
        with patch.dict(os.environ, {'RELAY_TRIAL_UNTIL':new}):
            self.assertEqual(self.budget.snapshot()['expires_at'],old.replace('Z','+00:00'))

    def test_invalid_usage_locks_without_refund(self):
        rid = self.budget.reserve(self.sid, MODEL)
        for incoming, outgoing in ((-1,0),(0,2049),(400001,0),(False,1),(1.0,1),(0,None)):
            with self.subTest(incoming=incoming,outgoing=outgoing):
                with self.assertRaises(Problem): self.budget.settle(rid,incoming,outgoing)
        self.assertEqual(self.budget.snapshot()['accounted_usd'], .1)
        with self.assertRaises(Problem): self.budget.reserve(self.sid, MODEL)

    def test_models_and_other_runtimes_cannot_bypass(self):
        for runtime in ('claude','pi','pydantic','vercel','deepagents','google_adk','microsoft'):
            with self.assertRaises(Problem): check_runtime(runtime)
        with self.assertRaises(Problem): check_runtime('openai','gpt-5.4')
        check_runtime('simulator')
        with patch.dict(os.environ, {'RELAY_TRIAL_ENABLED':'0','RELAY_MODE':'pilot'}):
            with self.assertRaises(Problem): check_runtime('openai', MODEL)

    def test_missing_or_expired_deadline_blocks_dispatch(self):
        for value in ('', 'tomorrow', '2099-01-01', '2000-01-01T00:00:00Z'):
            with patch.dict(os.environ, {'RELAY_TRIAL_UNTIL':value}):
                with self.assertRaises(Problem): self.budget.reserve(self.sid, MODEL)

    def wrap(self, delegate):
        engine = SimpleNamespace(store=self.store,sid=self.sid,check=lambda:None,record=lambda *args:None)
        return guarded_model(delegate,engine)

    def test_stream_reserves_before_dispatch_and_settles(self):
        budget = self.budget
        class Delegate:
            async def stream_response(self):
                assert budget.snapshot()['accounted_usd'] == .1
                yield SimpleNamespace(type='response.completed',response=SimpleNamespace(usage=SimpleNamespace(input_tokens=1000,output_tokens=100)))
        async def run():
            async for _ in self.wrap(Delegate()).stream_response(): pass
        asyncio.run(run())
        self.assertEqual(self.budget.snapshot()['accounted_usd'], .000325)

    def test_stream_errors_missing_usage_and_cancellation_keep_holds(self):
        for kind in ('error','missing','cancel','no_terminal'):
            class Delegate:
                async def stream_response(self):
                    if kind=='error': raise RuntimeError('failed')
                    if kind=='cancel': raise asyncio.CancelledError()
                    if kind=='missing': yield SimpleNamespace(type='response.completed',response=SimpleNamespace(usage=None))
                    else: yield SimpleNamespace(type='response.created')
            async def run():
                async for _ in self.wrap(Delegate()).stream_response(): pass
            with self.assertRaises((Problem,RuntimeError,asyncio.CancelledError)): asyncio.run(run())
        self.assertEqual(self.budget.snapshot()['accounted_usd'], .4)
        self.assertEqual(self.budget.snapshot()['unsettled_requests'], 4)

    def test_non_streaming_fails_before_provider(self):
        with self.assertRaises(Problem): asyncio.run(self.wrap(None).get_response())
        self.assertEqual(self.budget.snapshot()['requests'], 0)

    def test_real_agents_runner_charges_every_tool_loop_call(self):
        from test_native_state import OpenAITest
        from adapters.openai_runtime import run_openai
        from engine import Engine
        from openai.types.responses import ResponseUsage
        model = OpenAITest.model(self,tool_first=True)
        original = model.stream_response
        async def stream(*args, **kwargs):
            settings = kwargs.get('model_settings') or args[2]
            self.assertLessEqual(settings.max_tokens,2048)
            self.assertEqual(settings.retry.max_retries,0)
            self.assertEqual(settings.extra_args,{'service_tier':'default'})
            async for event in original(*args,**kwargs):
                event.response.usage = ResponseUsage(input_tokens=1000,output_tokens=100,total_tokens=1100,
                    input_tokens_details={'cached_tokens':0,'cache_write_tokens':0},output_tokens_details={'reasoning_tokens':0})
                yield event
        model.stream_response = stream
        sid = self.session(runtime='openai',model=MODEL,max_output_tokens=8192)
        asyncio.run(run_openai(Engine(self.store,sid),'Review',model))
        self.assertEqual(self.budget.snapshot()['requests'],2)
        self.assertEqual(self.budget.snapshot()['accounted_usd'],.00065)
        self.assertTrue(any(t['kind']=='tool.result' for t in self.store.traces(sid)))

    def test_quota_failure_is_sanitized_and_never_retried(self):
        from agents import Model
        from adapters.openai_runtime import run_openai
        from engine import Engine
        from openai import APIStatusError
        import httpx
        class Failed(Model):
            async def get_response(self,*args,**kwargs): raise AssertionError()
            async def stream_response(self,*args,**kwargs):
                raise APIStatusError('private-key-fragment',response=httpx.Response(429,
                    request=httpx.Request('POST','https://api.openai.com/v1/responses')),body={'code':'insufficient_quota'})
                yield
        sid=self.session(runtime='openai',model=MODEL)
        with self.assertRaises(Problem) as caught: asyncio.run(run_openai(Engine(self.store,sid),'Review',Failed()))
        self.assertIn('credits',str(caught.exception))
        self.assertNotIn('private-key',str(caught.exception))
        self.assertEqual(self.budget.snapshot()['requests'],1)
        self.assertEqual(self.budget.snapshot()['accounted_usd'],.1)
