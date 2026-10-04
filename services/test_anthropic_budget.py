import asyncio
import json
import os
from unittest.mock import patch

from test_lab import LabFixture
from engine import Engine
from store import Problem
import anthropic_budget as ab
from anthropic_budget import AnthropicBudget, MeterProxy, cost_micros, prepare

ENV = {'RELAY_ANTHROPIC_TRIAL_ENABLED': '1', 'RELAY_TRIAL_UNTIL': '2026-10-20T00:00:00Z'}


def sse(usage_start, usage_end, text='Hi'):
    events = [
        {'type': 'message_start', 'message': {'id': 'msg_1', 'type': 'message', 'role': 'assistant', 'content': [],
                                              'model': ab.MODEL, 'usage': usage_start}},
        {'type': 'content_block_start', 'index': 0, 'content_block': {'type': 'text', 'text': ''}},
        {'type': 'content_block_delta', 'index': 0, 'delta': {'type': 'text_delta', 'text': text}},
        {'type': 'content_block_stop', 'index': 0},
        {'type': 'message_delta', 'delta': {'stop_reason': 'end_turn'}, 'usage': usage_end},
        {'type': 'message_stop'},
    ]
    return ''.join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in events).encode()


class FakeAnthropic:
    """Loopback stand-in for api.anthropic.com that records what it receives."""

    def __init__(self, status=200, body=b'', content_type='text/event-stream', chunked=True, truncate=False):
        self.status, self.body, self.content_type, self.chunked, self.truncate = status, body, content_type, chunked, truncate
        self.requests = []

    async def __aenter__(self):
        self.server = await asyncio.start_server(self.handle, '127.0.0.1', 0)
        self.url = 'http://127.0.0.1:%d' % self.server.sockets[0].getsockname()[1]
        return self

    async def __aexit__(self, *exc):
        self.server.close()
        await self.server.wait_closed()

    async def handle(self, reader, writer):
        head = (await reader.readuntil(b'\r\n\r\n')).decode()
        headers = {l.split(':', 1)[0].lower(): l.split(':', 1)[1].strip() for l in head.split('\r\n')[1:] if ':' in l}
        body = await reader.readexactly(int(headers['content-length']))
        self.requests.append((head.split('\r\n')[0], headers, json.loads(body)))
        writer.write(f'HTTP/1.1 {self.status} X\r\ncontent-type: {self.content_type}\r\nrequest-id: req_1\r\n'.encode())
        if self.chunked:
            writer.write(b'transfer-encoding: chunked\r\n\r\n')
            payload = self.body[:len(self.body)//2] if self.truncate else self.body
            for i in range(0, len(payload), 97):
                part = payload[i:i+97]
                writer.write(b'%x\r\n' % len(part) + part + b'\r\n')
            if not self.truncate:
                writer.write(b'0\r\n\r\n')
        else:
            writer.write(b'content-length: %d\r\n\r\n' % len(self.body) + self.body)
        await writer.drain()
        writer.close()


async def post(base, token, payload, path='/v1/messages?beta=true'):
    host, port = base.removeprefix('http://').split(':')
    reader, writer = await asyncio.open_connection(host, int(port))
    data = json.dumps(payload).encode()
    writer.write((f'POST {path} HTTP/1.1\r\nHost: x\r\nx-api-key: {token}\r\nanthropic-version: 2023-06-01\r\n'
                  f'content-type: application/json\r\ncontent-length: {len(data)}\r\n\r\n').encode() + data)
    await writer.drain()
    raw = await reader.read()
    writer.close()
    head, _, body = raw.partition(b'\r\n\r\n')
    return int(head.split(b' ')[1]), body


REQUEST = {'model': 'claude-haiku-4-5', 'max_tokens': 32000, 'stream': True,
           'messages': [{'role': 'user', 'content': 'Summarise alert 4812'}]}


class AnthropicAllowanceTests(LabFixture):
    def setUp(self):
        super().setUp()
        self.env = patch.dict(os.environ, ENV)
        self.env.start()
        self.addCleanup(self.env.stop)
        clock = patch.object(ab, '_now', return_value=ab._ts('2026-10-10T00:00:00Z'))  # inside the allowance window
        clock.start()
        self.addCleanup(clock.stop)
        self.sid = self.session()
        self.budget = AnthropicBudget(self.store)

    # ---- pricing and policy

    def test_cost_uses_haiku_rates_and_rounds_up(self):
        cost, _ = cost_micros({'input_tokens': 1000, 'output_tokens': 100, 'cache_read_input_tokens': 10,
                               'cache_creation_input_tokens': 300,
                               'cache_creation': {'ephemeral_5m_input_tokens': 100, 'ephemeral_1h_input_tokens': 200}})
        # 1000*$1 + 100*$1.25 + 200*$2 + 10*$0.10 + 100*$5 per million = 2026 microdollars
        self.assertEqual(cost, 2026)
        unknown_split, _ = cost_micros({'input_tokens': 0, 'output_tokens': 0, 'cache_creation_input_tokens': 3})
        self.assertEqual(unknown_split, 6)  # charged at the 1-hour rate
        with self.assertRaises(ValueError):
            cost_micros({'input_tokens': -1, 'output_tokens': 0})

    def test_policy_pins_model_clamps_output_and_reserves_worst_case(self):
        data, max_tokens, reserve = prepare(json.dumps(REQUEST).encode())
        body = json.loads(data)
        self.assertEqual((body['model'], body['service_tier']), (ab.MODEL, 'standard_only'))
        self.assertEqual(max_tokens, ab.MAX_OUTPUT)
        # Whole context window as 1-hour cache writes plus the output cap: $0.41.
        self.assertEqual(reserve, (ab.CONTEXT*200 + ab.MAX_OUTPUT*500 + 99)//100)
        for bad in [{'model': 'claude-sonnet-4-5'}, {'thinking': {'type': 'enabled', 'budget_tokens': 1024}},
                    {'tools': [{'type': 'web_search_20250305', 'name': 'web_search'}]},
                    {'tools': [{'type': 'bash_20250124', 'name': 'bash'}]},
                    {'mcp_servers': [{'url': 'https://x'}]}, {'inference_geo': 'us'}, {'speed': 'fast'},
                    {'service_tier': 'priority'}, {'output_config': {'effort': 'high'}}, {'max_tokens': 0},
                    {'messages': [{'role': 'user', 'content': [{'type': 'document', 'source': {}}]}]}]:
            with self.subTest(bad=bad), self.assertRaises(Problem):
                prepare(json.dumps({**REQUEST, **bad}).encode())
        custom = {'name': 'query_case_evidence', 'description': 'd', 'input_schema': {'type': 'object'}}
        prepare(json.dumps({**REQUEST, 'tools': [custom, {**custom, 'type': 'custom'}]}).encode())

    def test_usage_receipts_that_change_price_are_unusable(self):
        base = {'input_tokens': 10, 'output_tokens': 2}
        for bad in [{'input_tokens': None}, {'output_tokens': None}, {'server_tool_use': {'web_search_requests': 1}},
                    {'iterations': [{'input_tokens': 5}]}, {'service_tier': 'priority'}]:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                cost_micros({**base, **bad})
        self.assertEqual(cost_micros({**base, 'server_tool_use': {'web_search_requests': 0}, 'service_tier': 'standard'})[0], 20)

    def test_headers_are_forwarded_only_when_clean_and_price_neutral(self):
        out = dict(ab.upstream_headers({'anthropic-version': '2023-06-01',
                                        'anthropic-beta': 'claude-code-20250219, interleaved-thinking-2025-05-14',
                                        'x-session-affinity': 'abc', 'authorization': 'Bearer sk-x'}))
        self.assertEqual(set(out), {'anthropic-version', 'anthropic-beta'})
        for bad in [{'anthropic-beta': 'context-1m-2025-08-07'}, {'anthropic-beta': 'a b'}, {'anthropic-version': 'latest'}]:
            with self.subTest(bad=bad), self.assertRaises(Problem):
                ab.upstream_headers(bad)

    # ---- ledger

    def test_reserve_settle_release_and_exhaustion(self):
        rid = self.budget.reserve(self.sid, 50_000)
        self.assertEqual(self.budget.snapshot()['unsettled_requests'], 1)
        self.assertAlmostEqual(self.budget.settle(rid, {'input_tokens': 1000, 'output_tokens': 10}, 2048), 0.00105)
        with self.assertRaises(Problem):
            self.budget.settle(rid, {'input_tokens': 1, 'output_tokens': 1}, 2048)
        rid2 = self.budget.reserve(self.sid, 10_000)
        self.budget.release(rid2, 'HTTP 529')
        snap = self.budget.snapshot()
        self.assertEqual(snap['accounted_usd'], 0.00105)
        self.assertAlmostEqual(self.store.session(self.sid)['cost_usd'], 0.00105)
        with self.assertRaises(Problem) as err:
            self.budget.reserve(self.sid, ab.SPENDABLE)
        self.assertEqual(err.exception.status, 402)

    def test_implausible_usage_halts_and_keeps_hold(self):
        rid = self.budget.reserve(self.sid, 50_000)
        with self.assertRaises(Problem):
            self.budget.settle(rid, {'input_tokens': 10, 'output_tokens': 5000}, 2048)
        snap = self.budget.snapshot()
        self.assertTrue(snap['halted'])
        self.assertEqual(snap['accounted_usd'], 0.05)
        self.assertEqual(self.store.db.execute('SELECT state FROM relay_anthropic_calls').fetchone()[0], 'retained')
        with self.assertRaises(Problem):
            self.budget.reserve(self.sid, 1000)

    def test_expiry_is_capped_at_november_first(self):
        with patch.dict(os.environ, {'RELAY_TRIAL_UNTIL': '2027-06-01T00:00:00Z'}):
            self.assertEqual(ab.deadline(), ab._ts(ab.HARD_EXPIRY))
        with patch.dict(os.environ, {'RELAY_TRIAL_UNTIL': '2020-01-01T00:00:00Z'}), self.assertRaises(Problem):
            ab.check(ab.MODEL)

    def test_guarded_runtimes_and_registry(self):
        from trial_budget import check_runtime
        from adapters.registry import catalog, validate
        from store import DEFAULT_CONFIG
        for runtime in ab.RUNTIMES:
            check_runtime(runtime, ab.MODEL)
            with self.assertRaises(Problem):
                check_runtime(runtime, 'claude-sonnet-4-5')
        items = {i['id']: i for i in catalog(self.store)}
        for runtime in ab.RUNTIMES:
            self.assertTrue(items[runtime]['trial_guard'])
            self.assertEqual(items[runtime]['default_model'], ab.MODEL)
        self.assertFalse(items['vercel']['trial_guard'])
        validate({**DEFAULT_CONFIG, 'runtime': 'pydantic', 'model': ab.MODEL})  # no USD-cap waiver needed
        with self.assertRaises(Problem):
            validate({**DEFAULT_CONFIG, 'runtime': 'claude', 'model': ab.MODEL, 'thinking': 'low'})

    # ---- the metering proxy end to end

    def run_proxy(self, upstream_kwargs, payload=REQUEST, token=None, path='/v1/messages?beta=true'):
        async def go():
            async with FakeAnthropic(**upstream_kwargs) as up:
                async with MeterProxy(Engine(self.store, self.sid), upstream=up.url, api_key='sk-real') as meter:
                    status, body = await post(meter.base_url, token or meter.token, payload, path)
                return status, body, up.requests, meter.token
        return asyncio.run(go())

    def test_streamed_call_is_reserved_forwarded_and_settled(self):
        stream = sse({'input_tokens': 900, 'output_tokens': 1, 'cache_read_input_tokens': 100}, {'output_tokens': 40})
        status, body, requests, token = self.run_proxy({'body': stream})
        self.assertEqual(status, 200)
        self.assertEqual(body, stream)  # bytes reach the framework unchanged
        line, headers, sent = requests[0]
        self.assertEqual(line, 'POST /v1/messages?beta=true HTTP/1.1')
        self.assertEqual(headers['x-api-key'], 'sk-real')  # the real key only travels upstream
        self.assertNotIn(token, json.dumps(headers))
        self.assertEqual((sent['model'], sent['max_tokens']), (ab.MODEL, ab.MAX_OUTPUT))
        row = self.store.db.execute('SELECT * FROM relay_anthropic_calls').fetchone()
        self.assertEqual((row['state'], row['charged_micros'], row['output_tokens']), ('settled', (900*100+100*10+40*500+99)//100, 40))
        kinds = [t['kind'] for t in self.store.traces(self.sid)]
        self.assertLess(kinds.index('budget.reserved'), kinds.index('budget.settled'))

    def test_non_streamed_json_is_settled(self):
        body = json.dumps({'id': 'm', 'type': 'message', 'content': [], 'usage': {'input_tokens': 10, 'output_tokens': 2}}).encode()
        status, _, _, _ = self.run_proxy({'body': body, 'content_type': 'application/json', 'chunked': False},
                                         {**REQUEST, 'stream': False})
        self.assertEqual(status, 200)
        self.assertEqual(self.budget.snapshot()['accounted_usd'], 0.00002)

    def test_bad_token_wrong_path_and_policy_never_reach_anthropic(self):
        status, _, requests, _ = self.run_proxy({'body': b''}, token='sk-guess')
        self.assertEqual((status, requests), (401, []))
        status, _, requests, _ = self.run_proxy({'body': b''}, path='/v1/models')
        self.assertEqual((status, requests), (404, []))
        status, body, requests, _ = self.run_proxy({'body': b''}, {**REQUEST, 'model': 'claude-opus-4-1'})
        self.assertEqual((status, requests), (400, []))
        self.assertIn(b'permits only', body)
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM relay_anthropic_calls').fetchone()[0], 0)

    def test_provider_error_is_released_and_dropped_stream_is_retained(self):
        error = json.dumps({'type': 'error', 'error': {'type': 'overloaded_error', 'message': 'Overloaded'}}).encode()
        status, _, _, _ = self.run_proxy({'status': 529, 'body': error, 'content_type': 'application/json', 'chunked': False})
        self.assertEqual(status, 529)
        self.assertEqual(self.store.db.execute('SELECT state,charged_micros FROM relay_anthropic_calls').fetchone()[:], ('rejected', 0))
        stream = sse({'input_tokens': 900, 'output_tokens': 1}, {'output_tokens': 40})
        self.run_proxy({'body': stream, 'truncate': True})
        row = self.store.db.execute("SELECT * FROM relay_anthropic_calls WHERE state!='rejected'").fetchone()
        self.assertEqual(row['state'], 'retained')
        self.assertEqual(row['charged_micros'], row['reserved_micros'])

    def test_exhausted_allowance_blocks_before_anthropic(self):
        self.store.db.execute("INSERT INTO relay_anthropic_calls(id,session_id,model,reserved_micros,charged_micros,state,created_at) "
                              "VALUES('x',?,?,?,?, 'settled','now')", (self.sid, ab.MODEL, ab.SPENDABLE-100, ab.SPENDABLE-100))
        self.store.db.commit()
        status, body, requests, _ = self.run_proxy({'body': b''})
        self.assertEqual((status, requests), (403, []))
        self.assertIn(b'allowance reached', body)

    def test_null_delta_usage_cannot_erase_input_billing(self):
        stream = sse({'input_tokens': 150000, 'output_tokens': 1}, {'input_tokens': None, 'output_tokens': 10})
        self.run_proxy({'body': stream})
        row = self.store.db.execute('SELECT * FROM relay_anthropic_calls').fetchone()
        self.assertEqual((row['state'], row['input_tokens'], row['charged_micros']),
                         ('settled', 150000, (150000*100 + 10*500 + 99)//100))

    def test_missing_usage_halts_and_keeps_the_hold(self):
        body = json.dumps({'id': 'm', 'type': 'message', 'content': [], 'usage': {'input_tokens': 10}}).encode()
        self.run_proxy({'body': body, 'content_type': 'application/json', 'chunked': False}, {**REQUEST, 'stream': False})
        snap = self.budget.snapshot()
        self.assertTrue(snap['halted'])
        self.assertEqual(snap['accounted_usd'], ab.RESERVATION/1e6)

    def test_smuggling_and_unframed_bodies_never_reach_anthropic(self):
        async def go(build):
            async with FakeAnthropic(body=b'') as up:
                async with MeterProxy(Engine(self.store, self.sid), upstream=up.url, api_key='sk-real') as meter:
                    host, port = meter.base_url.removeprefix('http://').split(':')
                    reader, writer = await asyncio.open_connection(host, int(port))
                    writer.write(build(meter.token))
                    await writer.drain()
                    raw = await reader.read()
                    writer.close()
                return int(raw.split(b' ')[1]), up.requests
        body = json.dumps(REQUEST).encode()
        n = len(body)
        cases = {
            'bare LF in target': lambda t: f'POST /v1/messages?a\nX:1 HTTP/1.1\r\nx-api-key: {t}\r\ncontent-length: {n}\r\n\r\n'.encode() + body,
            'bare LF in header': lambda t: f'POST /v1/messages HTTP/1.1\r\nx-api-key: {t}\r\nanthropic-beta: a\nx-evil: 1\r\ncontent-length: {n}\r\n\r\n'.encode() + body,
            'chunked body': lambda t: f'POST /v1/messages HTTP/1.1\r\nx-api-key: {t}\r\ntransfer-encoding: chunked\r\n\r\n0\r\n\r\n'.encode(),
            'negative length': lambda t: f'POST /v1/messages HTTP/1.1\r\nx-api-key: {t}\r\ncontent-length: -1\r\n\r\n'.encode(),
            'oversized length': lambda t: f'POST /v1/messages HTTP/1.1\r\nx-api-key: {t}\r\ncontent-length: {ab.MAX_BODY+1}\r\n\r\n'.encode(),
        }
        for name, build in cases.items():
            with self.subTest(name):
                status, requests = asyncio.run(go(build))
                self.assertIn(status, (400, 411, 413))
                self.assertEqual(requests, [])
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM relay_anthropic_calls').fetchone()[0], 0)

    def test_count_tokens_is_free_but_policed(self):
        count = {'model': 'claude-haiku-4-5', 'messages': REQUEST['messages']}
        status, _, requests, _ = self.run_proxy({'body': b'{"input_tokens":12}', 'content_type': 'application/json', 'chunked': False},
                                                count, path='/v1/messages/count_tokens')
        self.assertEqual((status, requests[0][0], requests[0][2]['model']),
                         (200, 'POST /v1/messages/count_tokens HTTP/1.1', ab.MODEL))
        self.assertNotIn('service_tier', requests[0][2])
        status, _, requests, _ = self.run_proxy({'body': b''}, {**count, 'tools': [{'type': 'web_search_20250305', 'name': 'w'}]},
                                                path='/v1/messages/count_tokens')
        self.assertEqual((status, requests), (400, []))
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM relay_anthropic_calls').fetchone()[0], 0)

    def test_unreachable_upstream_releases_and_https_is_required(self):
        async def go():
            async with MeterProxy(Engine(self.store, self.sid), upstream='http://127.0.0.1:9', api_key='sk-real') as meter:
                return await post(meter.base_url, meter.token, REQUEST)
        status, _ = asyncio.run(go())
        self.assertEqual(status, 502)
        self.assertEqual(tuple(self.store.db.execute('SELECT state,charged_micros FROM relay_anthropic_calls').fetchone()), ('rejected', 0))
        with self.assertRaises(Problem):
            MeterProxy(Engine(self.store, self.sid), upstream='http://api.example.com', api_key='sk-real')

    def test_child_environment_carries_only_the_token(self):
        meter = MeterProxy(Engine(self.store, self.sid), api_key='sk-real')
        meter.base_url = 'http://127.0.0.1:1'
        env = ab.claude_env(meter)
        self.assertNotIn('sk-real', json.dumps(env))
        self.assertEqual((env['ANTHROPIC_API_KEY'], env['ANTHROPIC_BASE_URL']), (meter.token, meter.base_url))
        for key in ('ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL'):
            self.assertEqual(env[key], ab.MODEL)

    def test_locked_allowance_reports_instead_of_failing(self):
        with patch.dict(os.environ, {'RELAY_TRIAL_UNTIL': ''}):
            snap = self.budget.snapshot()
        self.assertTrue(snap['blocked'])
        self.assertIn('locked', snap['locked'])
