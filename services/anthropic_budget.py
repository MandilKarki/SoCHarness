"""Fail-closed Anthropic allowance, enforced by a per-run loopback metering proxy.

Every Anthropic-key framework (Claude Agent SDK, PydanticAI, Deep Agents, Pi) is
pointed at a proxy on 127.0.0.1 that holds the real API key; the framework only
receives a random per-run token (child processes never see the real key). For each
Messages API request the proxy:

1. enforces policy on an allowlist: one pinned model, a hard output cap, no extended
   thinking, only custom (client) tools, standard service tier, known top-level fields,
   clean request line and headers;
2. reserves the worst case in SQLite *before* contacting Anthropic: the whole 200k
   context window priced as 1-hour cache writes, plus the output cap ($0.41);
3. forwards the request (pinned model, clamped max_tokens, fixed path) and streams the
   response back byte for byte;
4. settles the exact cost from Anthropic's usage receipt (streamed or not), releasing
   the rest of the hold.

Unknown outcomes (dropped streams, missing, null or implausible usage, unexpected
billable usage fields) keep the full reservation; implausible usage also halts the
ledger. Requests that never reached Anthropic, and HTTP error responses before any
output (not billed), are released at $0. This is NOT an account-wide billing limit.
"""
import asyncio
import hmac
import json
import os
import re
import secrets
import ssl
from datetime import datetime, timezone
from urllib.parse import urlsplit

from store import Problem, now, uid

MODEL = 'claude-haiku-4-5-20251001'
ALIASES = {MODEL, 'claude-haiku-4-5'}
RUNTIMES = ('claude', 'pydantic', 'deepagents', 'pi')
LIMIT = 5_000_000          # $5.00 in microdollars
SPENDABLE = 4_500_000      # $0.50 stays unused as a billing buffer
HARD_EXPIRY = '2026-11-01T06:59:59Z'   # same end as the October OpenAI allowance
MAX_OUTPUT = 2048
CONTEXT = 200_000          # Haiku 4.5 context window; the API rejects longer prompts
MAX_BODY = 2_000_000
# Rates in microdollars per 100 tokens (Haiku 4.5: $1 in, $5 out, $1.25 / $2 cache
# writes for 5m / 1h, $0.10 cache reads per million tokens; reviewed 2026-10-04).
RATE = {'input': 100, 'cache_5m': 125, 'cache_1h': 200, 'cache_read': 10, 'output': 500}
# Worst case for any accepted request: every context token as a 1-hour cache write.
RESERVATION = (CONTEXT*RATE['cache_1h'] + MAX_OUTPUT*RATE['output'] + 99)//100
UPSTREAM = 'https://api.anthropic.com'
TOP_LEVEL = {'model', 'messages', 'max_tokens', 'system', 'metadata', 'stop_sequences', 'stream',
             'temperature', 'top_p', 'top_k', 'tools', 'tool_choice', 'thinking', 'service_tier',
             'context_management', 'output_config'}
OUTPUT_CONFIG = {'format'}
PRICED_BETAS = ('context-1m', 'mcp-client', 'code-execution', 'web-fetch', 'web-search', 'skills',
                'files-api', 'compact', 'fast-mode', 'priority')
SAFE_VALUE = re.compile(r'^[\x20-\x7e]*$')
BETA_LIST = re.compile(r'^[a-z0-9.-]+(\s*,\s*[a-z0-9.-]+)*$')
VERSION = re.compile(r'^\d{4}-\d{2}-\d{2}$')
READ_TIMEOUT = 30          # client request head/body
IDLE_TIMEOUT = 300         # gap between upstream bytes


def _now():
    return datetime.now(timezone.utc).timestamp()


def enabled():
    return os.getenv('RELAY_ANTHROPIC_TRIAL_ENABLED', '0') == '1'


def _ts(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()


def deadline():
    """The OpenAI allowance deadline, never later than the hard-coded November 1 end."""
    try:
        value = datetime.fromisoformat(os.environ['RELAY_TRIAL_UNTIL'].replace('Z', '+00:00'))
        if value.tzinfo is None:
            raise ValueError()
    except (KeyError, ValueError):
        raise Problem('Anthropic allowance is locked: configure an explicit RELAY_TRIAL_UNTIL deadline.', 409)
    return min(value.timestamp(), _ts(HARD_EXPIRY))


def check(model=None):
    if not enabled():
        raise Problem('The Anthropic allowance is not enabled.', 409)
    if _now() >= deadline():
        raise Problem('The Anthropic testing allowance has expired. No new paid requests are allowed.', 409)
    if model is not None and model not in ALIASES:
        raise Problem('The Anthropic allowance permits only '+MODEL+'.', 409)


def cost_micros(usage):
    """Exact cost of one Messages API usage receipt, rounded up to the next microdollar.

    `input_tokens` and `output_tokens` must be present integers; anything that would
    change the price beyond these fields makes the receipt unusable (ValueError).
    """
    if not isinstance(usage, dict):
        raise ValueError('usage is not an object')
    for key in ('input_tokens', 'output_tokens'):
        if type(usage.get(key)) is not int or usage[key] < 0:
            raise ValueError('missing ' + key)
    vals = {'input_tokens': usage['input_tokens'], 'output_tokens': usage['output_tokens']}
    for key in ('cache_creation_input_tokens', 'cache_read_input_tokens'):
        value = usage.get(key)
        if value is None:
            value = 0
        if type(value) is not int or value < 0:
            raise ValueError('bad ' + key)
        vals[key] = value
    server = usage.get('server_tool_use') or {}
    if not isinstance(server, dict) or any(v for v in server.values() if v not in (0, None)):
        raise ValueError('server tool usage')
    if usage.get('iterations'):
        raise ValueError('multi-iteration usage')
    if usage.get('service_tier') not in (None, 'standard'):
        raise ValueError('non-standard service tier')
    created = vals['cache_creation_input_tokens']
    split = usage.get('cache_creation') or {}
    w5, w1 = split.get('ephemeral_5m_input_tokens'), split.get('ephemeral_1h_input_tokens')
    if not (type(w5) is int and type(w1) is int and w5 >= 0 and w1 >= 0 and w5 + w1 == created):
        w5, w1 = 0, created  # unknown split: charge every cache write at the 1-hour rate
    total = (vals['input_tokens']*RATE['input'] + w5*RATE['cache_5m'] + w1*RATE['cache_1h'] +
             vals['cache_read_input_tokens']*RATE['cache_read'] + vals['output_tokens']*RATE['output'])
    return (total + 99)//100, vals


class AnthropicBudget:
    def __init__(self, store):
        self.db = store.db

    def configure(self):
        expires = deadline()
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            self.db.execute('INSERT OR IGNORE INTO relay_anthropic_trial(id,expires_at,halted) VALUES(1,?,0)', (expires,))
            # Restarts or environment changes can only shorten the allowance.
            self.db.execute('UPDATE relay_anthropic_trial SET expires_at=min(expires_at,?) WHERE id=1', (expires,))

    def used(self):
        return self.db.execute('SELECT coalesce(sum(charged_micros),0) FROM relay_anthropic_calls').fetchone()[0]

    def snapshot(self):
        if not enabled():
            return {'enabled': False}
        try:
            self.configure()
        except Problem as exc:
            return {'enabled': True, 'provider': 'anthropic', 'blocked': True, 'locked': str(exc),
                    'model': MODEL, 'runtimes': list(RUNTIMES)}
        row = self.db.execute('SELECT * FROM relay_anthropic_trial WHERE id=1').fetchone()
        used = self.used()
        counts = self.db.execute("SELECT count(*),coalesce(sum(state='reserved'),0) FROM relay_anthropic_calls").fetchone()
        expired = _now() >= row['expires_at']
        return {'enabled': True, 'provider': 'anthropic', 'limit_usd': LIMIT/1e6, 'spendable_usd': SPENDABLE/1e6,
                'accounted_usd': used/1e6, 'remaining_usd': max(0, SPENDABLE-used)/1e6,
                'buffer_usd': (LIMIT-SPENDABLE)/1e6, 'requests': counts[0], 'unsettled_requests': counts[1],
                'reservation_usd': RESERVATION/1e6,
                'expires_at': datetime.fromtimestamp(row['expires_at'], timezone.utc).isoformat(),
                'blocked': bool(expired or row['halted'] or used + RESERVATION > SPENDABLE), 'halted': bool(row['halted']),
                'model': MODEL, 'runtimes': list(RUNTIMES),
                'scope': 'This Relay database only; not an account-wide billing cap.'}

    def reserve(self, sid, micros=RESERVATION):
        check(MODEL)
        if type(micros) is not int or micros <= 0:
            raise Problem('Invalid reservation', 500)
        self.configure()
        rid = uid('acost')
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            row = self.db.execute('SELECT * FROM relay_anthropic_trial WHERE id=1').fetchone()
            if row['halted'] or _now() >= row['expires_at']:
                raise Problem('Anthropic allowance is stopped or expired.', 409)
            if self.used() + micros > SPENDABLE:
                raise Problem('Anthropic allowance reached: not enough left for another request\'s worst-case cost.', 402)
            self.db.execute('INSERT INTO relay_anthropic_calls(id,session_id,model,reserved_micros,charged_micros,state,created_at) '
                            'VALUES(?,?,?,?,?,?,?)', (rid, sid, MODEL, micros, micros, 'reserved', now()))
        return rid

    def _row(self, rid):
        row = self.db.execute('SELECT * FROM relay_anthropic_calls WHERE id=?', (rid,)).fetchone()
        if not row or row['state'] != 'reserved':
            raise Problem('Anthropic receipt is missing or already settled.', 409)
        return row

    def settle(self, rid, usage, max_tokens):
        try:
            cost, vals = cost_micros(usage)
            plausible = (vals['input_tokens'] + vals['cache_creation_input_tokens'] + vals['cache_read_input_tokens'] <= CONTEXT
                         and vals['output_tokens'] <= max_tokens)
        except (ValueError, AttributeError, TypeError):
            plausible = False
        if not plausible:
            self.retain(rid, 'unusable usage receipt')
            self.halt()
            raise Problem('Unexpected Anthropic usage; allowance halted and reservation retained.', 502)
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            row = self._row(rid)
            if cost > row['reserved_micros']:
                # Impossible for plausible usage; keep the larger amount and stop spending.
                self.db.execute('UPDATE relay_anthropic_trial SET halted=1 WHERE id=1')
            self.db.execute("UPDATE relay_anthropic_calls SET charged_micros=?,state='settled',input_tokens=?,output_tokens=?,"
                            "cache_write_tokens=?,cache_read_tokens=?,settled_at=? WHERE id=?",
                            (cost, vals['input_tokens'], vals['output_tokens'], vals['cache_creation_input_tokens'],
                             vals['cache_read_input_tokens'], now(), rid))
            self.db.execute('UPDATE relay_sessions SET cost_usd=cost_usd+? WHERE id=?', (cost/1e6, row['session_id']))
        return cost/1e6

    def release(self, rid, detail):
        """Never sent, or Anthropic returned an HTTP error before any output: not billed."""
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            self._row(rid)
            self.db.execute("UPDATE relay_anthropic_calls SET charged_micros=0,state='rejected',detail=?,settled_at=? WHERE id=?",
                            (detail[:300], now(), rid))

    def retain(self, rid, detail):
        """Unknown outcome: keep the whole reservation."""
        with self.db:
            self.db.execute("UPDATE relay_anthropic_calls SET state='retained',detail=?,settled_at=? WHERE id=? AND state='reserved'",
                            (detail[:300], now(), rid))

    def halt(self):
        with self.db:
            self.db.execute('UPDATE relay_anthropic_trial SET halted=1 WHERE id=1')


# ---------------------------------------------------------------- request policy

def _policy(body):
    if not isinstance(body, dict):
        raise Problem('Request body must be an object.', 400)
    unknown = set(body) - TOP_LEVEL
    if unknown:
        raise Problem('Fields not allowed under the Anthropic allowance: '+', '.join(sorted(unknown))+'.', 400)
    if body.get('model') not in ALIASES:
        raise Problem('The Anthropic allowance permits only '+MODEL+'.', 400)
    body['model'] = MODEL
    thinking = body.get('thinking')
    if thinking not in (None, {}) and (not isinstance(thinking, dict) or thinking.get('type') != 'disabled'):
        raise Problem('Extended thinking is disabled under the Anthropic allowance.', 400)
    if body.get('service_tier') not in (None, 'auto', 'standard_only'):
        raise Problem('Only the standard service tier is allowed.', 400)
    body['service_tier'] = 'standard_only'
    config = body.get('output_config')
    if config is not None and (not isinstance(config, dict) or set(config) - OUTPUT_CONFIG):
        raise Problem('Only output_config.format is allowed under the Anthropic allowance.', 400)
    tools = body.get('tools')
    if tools is not None and not isinstance(tools, list):
        raise Problem('tools must be a list.', 400)
    for tool in tools or []:
        if not isinstance(tool, dict) or tool.get('type', 'custom') != 'custom':
            raise Problem('Only custom tools are allowed under the Anthropic allowance.', 400)
    for message in body.get('messages') or []:
        content = message.get('content') if isinstance(message, dict) else None
        for block in content if isinstance(content, list) else []:
            if isinstance(block, dict) and block.get('type') in ('document', 'container_upload'):
                raise Problem('Document and file inputs are not allowed under the Anthropic allowance.', 400)
    return body


def prepare(raw):
    """Validate and rewrite one Messages request. Returns (body_bytes, max_tokens, reservation_micros)."""
    try:
        body = json.loads(raw)
    except ValueError:
        raise Problem('Request body is not JSON.', 400)
    body = _policy(body)
    requested = body.get('max_tokens')
    if type(requested) is not int or requested <= 0:
        raise Problem('max_tokens must be a positive integer.', 400)
    body['max_tokens'] = min(requested, MAX_OUTPUT)
    data = json.dumps(body, ensure_ascii=False, separators=(',', ':')).encode()
    if len(data) > MAX_BODY:
        raise Problem('Request is too large for the Anthropic allowance.', 400)
    return data, body['max_tokens'], RESERVATION


def prepare_count(raw):
    """count_tokens is free, but gets the same body policy so it cannot widen the surface."""
    try:
        body = json.loads(raw)
    except ValueError:
        raise Problem('Request body is not JSON.', 400)
    body.pop('max_tokens', None)
    body = _policy(body)
    body.pop('service_tier', None)  # not a count_tokens parameter
    return json.dumps(body, ensure_ascii=False, separators=(',', ':')).encode()


def upstream_headers(headers):
    """Only well-formed, price-neutral headers are forwarded to Anthropic."""
    out = []
    version = headers.get('anthropic-version', '2023-06-01')
    if not VERSION.match(version):
        raise Problem('Invalid anthropic-version header.', 400)
    out.append(('anthropic-version', version))
    beta = headers.get('anthropic-beta')
    if beta:
        if not BETA_LIST.match(beta):
            raise Problem('Invalid anthropic-beta header.', 400)
        names = [b.strip() for b in beta.split(',')]
        priced = [b for b in names if b.startswith(PRICED_BETAS)]
        if priced:
            raise Problem('Beta features with separate pricing are not allowed: '+', '.join(priced)+'.', 400)
        out.append(('anthropic-beta', ','.join(names)))
    for name in ('accept', 'user-agent', 'anthropic-dangerous-direct-browser-access'):
        if name in headers:
            out.append((name, headers[name][:200]))
    return out


# ---------------------------------------------------------------- HTTP plumbing

async def _read_head(reader, timeout):
    head = await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'), timeout)
    if len(head) > 65536:
        raise Problem('Headers too large', 431)
    lines = head[:-4].decode('latin-1').split('\r\n')
    for line in lines:
        if not SAFE_VALUE.match(line.replace('\t', ' ')) or '\n' in line or '\r' in line:
            raise Problem('Control characters in the request', 400)
    headers = {}
    for line in lines[1:]:
        if ':' not in line:
            raise Problem('Malformed header', 400)
        k, v = line.split(':', 1)
        headers[k.strip().lower()] = v.strip()
    return lines[0], headers


async def _body_chunks(reader, headers):
    """Upstream response body, de-chunked, with an idle timeout between reads."""
    read = lambda coro: asyncio.wait_for(coro, IDLE_TIMEOUT)
    if headers.get('transfer-encoding', '').lower() == 'chunked':
        while True:
            line = await read(reader.readline())
            size = int(line.split(b';')[0].strip() or b'0', 16)
            if size == 0:
                while (await read(reader.readline())) not in (b'\r\n', b''):
                    pass
                return
            yield await read(reader.readexactly(size))
            await read(reader.readexactly(2))
    elif 'content-length' in headers:
        left = int(headers['content-length'])
        if left < 0:
            raise ValueError('negative length')
        while left:
            part = await read(reader.read(min(left, 65536)))
            if not part:
                raise asyncio.IncompleteReadError(b'', left)
            left -= len(part)
            yield part
    else:
        while True:
            part = await read(reader.read(65536))
            if not part:
                return
            yield part


class UsageTracker:
    """Reads usage from a non-streamed JSON body or a server-sent-event stream."""

    def __init__(self):
        self.buffer = b''
        self.usage = None
        self.completed = False
        self.error = None
        self.streaming = None

    def feed(self, chunk, content_type):
        if self.streaming is None:
            self.streaming = 'text/event-stream' in content_type
        self.buffer += chunk
        if not self.streaming:
            return
        while b'\n' in self.buffer:
            line, self.buffer = self.buffer.split(b'\n', 1)
            line = line.strip()
            if not line.startswith(b'data:'):
                continue
            try:
                event = json.loads(line[5:].strip())
            except ValueError:
                continue
            kind = event.get('type') if isinstance(event, dict) else None
            if kind == 'message_start':
                self.usage = dict((event.get('message') or {}).get('usage') or {})
            elif kind == 'message_delta' and isinstance(event.get('usage'), dict) and self.usage is not None:
                for key, value in event['usage'].items():
                    if type(value) is int:  # cumulative counts; never let null erase a start value
                        self.usage[key] = max(value, self.usage.get(key) if type(self.usage.get(key)) is int else 0)
                    elif value is not None and key not in self.usage:
                        self.usage[key] = value
            elif kind == 'message_stop':
                self.completed = True
            elif kind == 'error':
                self.error = json.dumps(event.get('error'))[:300]

    def finish(self):
        if not self.streaming:
            try:
                body = json.loads(self.buffer or b'{}')
                self.usage = body.get('usage')
                self.completed = isinstance(self.usage, dict)
            except ValueError:
                pass


def _error(status, message, kind='invalid_request_error'):
    body = json.dumps({'type': 'error', 'error': {'type': kind, 'message': message}}).encode()
    reason = {400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 411: 'Length Required',
              413: 'Payload Too Large', 502: 'Bad Gateway'}.get(status, 'Error')
    return (f'HTTP/1.1 {status} {reason}\r\ncontent-type: application/json\r\ncontent-length: {len(body)}\r\n'
            'connection: close\r\n\r\n').encode() + body


class _NotSent(Exception):
    """The request never reached Anthropic."""


class MeterProxy:
    """Loopback proxy for one run. Use as `async with MeterProxy(engine) as meter:`."""

    def __init__(self, engine, upstream=None, api_key=None):
        self.engine = engine
        self.upstream = urlsplit(upstream or os.getenv('RELAY_ANTHROPIC_UPSTREAM') or UPSTREAM)
        if self.upstream.scheme != 'https' and self.upstream.hostname not in ('127.0.0.1', 'localhost', '::1'):
            raise Problem('The Anthropic upstream must use HTTPS.', 500)
        self.api_key = api_key if api_key is not None else os.getenv('ANTHROPIC_API_KEY', '')
        self.token = 'relay-meter-' + secrets.token_hex(24)
        self.base_url = None
        self.server = None
        self.tasks = set()
        self.budget = AnthropicBudget(engine.store)

    async def __aenter__(self):
        if not self.api_key:
            raise Problem('Set server-side ANTHROPIC_API_KEY', 409)
        check(MODEL)
        # In-process HTTP clients must not route loopback traffic through an HTTP proxy.
        no_proxy = os.environ.get('NO_PROXY', '')
        if '127.0.0.1' not in no_proxy:
            os.environ['NO_PROXY'] = ','.join(filter(None, [no_proxy, '127.0.0.1', 'localhost']))
        self.server = await asyncio.start_server(self._accept, '127.0.0.1', 0, limit=65536)
        port = self.server.sockets[0].getsockname()[1]
        self.base_url = f'http://127.0.0.1:{port}'
        self.engine.record('budget.meter', {'provider': 'anthropic', 'model': MODEL, 'max_output_tokens': MAX_OUTPUT,
                                            'reservation_usd': RESERVATION/1e6,
                                            'note': 'Framework talks to a local metering proxy with a one-run token.'})
        return self

    async def __aexit__(self, *exc):
        self.server.close()
        # Give in-flight requests a moment to settle, then stop the rest (their holds stay).
        if self.tasks:
            await asyncio.wait(list(self.tasks), timeout=5)
        for task in list(self.tasks):
            task.cancel()
        try:
            await asyncio.wait_for(self.server.wait_closed(), 5)
        except (asyncio.TimeoutError, Exception):
            pass

    def env(self):
        """Environment for a child process: the per-run token instead of the real key."""
        return {'ANTHROPIC_API_KEY': self.token, 'ANTHROPIC_BASE_URL': self.base_url,
                'NO_PROXY': '127.0.0.1,localhost', 'no_proxy': '127.0.0.1,localhost'}

    def _authorized(self, headers):
        key = headers.get('x-api-key') or headers.get('authorization', '').removeprefix('Bearer ').strip()
        return hmac.compare_digest(key.encode(), self.token.encode())

    async def _accept(self, reader, writer):
        task = asyncio.current_task()
        self.tasks.add(task)
        try:
            await self._handle(reader, writer)
        finally:
            self.tasks.discard(task)

    async def _handle(self, reader, writer):
        try:
            try:
                start, headers = await _read_head(reader, READ_TIMEOUT)
                method, target, version = start.split(' ')
                if not version.startswith('HTTP/1.'):
                    raise ValueError('version')
            except Problem as exc:
                writer.write(_error(exc.status, str(exc)))
                return
            except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, asyncio.TimeoutError, ValueError):
                writer.write(_error(400, 'Malformed request'))
                return
            if not self._authorized(headers):
                writer.write(_error(401, 'Invalid metering token', 'authentication_error'))
                return
            path, _, query = target.partition('?')
            if method != 'POST' or path not in ('/v1/messages', '/v1/messages/count_tokens'):
                writer.write(_error(404, 'Only the Messages API is available through the Relay meter', 'not_found_error'))
                return
            if 'transfer-encoding' in headers:
                writer.write(_error(411, 'Send a Content-Length body'))
                return
            try:
                length = int(headers.get('content-length', ''))
                if not 0 <= length <= MAX_BODY:
                    raise ValueError()
                raw = await asyncio.wait_for(reader.readexactly(length), READ_TIMEOUT)
            except (ValueError, asyncio.IncompleteReadError, asyncio.TimeoutError):
                writer.write(_error(413 if headers.get('content-length', '').isdigit() else 411, 'Invalid or oversized body'))
                return
            # Fixed upstream target: only the documented beta query is carried over.
            target = path + ('?beta=true' if query == 'beta=true' else '')
            try:
                self.engine.check()
                check(MODEL)
                forward = upstream_headers(headers)
                if path.endswith('count_tokens'):
                    data = prepare_count(raw)
                else:
                    data, max_tokens, reserve = prepare(raw)
                    rid = self.budget.reserve(self.engine.sid, reserve)
            except Problem as exc:
                self.engine.record('budget.blocked', {'provider': 'anthropic', 'reason': str(exc)})
                denied = exc.status in (402, 409)
                writer.write(_error(403 if denied else 400, str(exc), 'permission_error' if denied else 'invalid_request_error'))
                return
            if path.endswith('count_tokens'):
                await self._forward(writer, target, forward, data)
                return
            self.engine.record('budget.reserved', {'provider': 'anthropic', 'receipt': rid, 'reserved_usd': reserve/1e6,
                                                   'max_output_tokens': max_tokens})
            await self._metered(writer, target, forward, data, rid, max_tokens)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # never leak details or the key
            try:
                writer.write(_error(502, 'Relay meter error: '+type(exc).__name__, 'api_error'))
            except Exception:
                pass
        finally:
            try:
                await asyncio.wait_for(writer.drain(), 5)
            except Exception:
                pass
            writer.close()

    async def _open_upstream(self, target, forward, data):
        host = self.upstream.hostname
        tls = self.upstream.scheme == 'https'
        port = self.upstream.port or (443 if tls else 80)
        try:
            reader, writer = await asyncio.wait_for(asyncio.open_connection(
                host, port, ssl=ssl.create_default_context() if tls else None, server_hostname=host if tls else None), 30)
        except (OSError, asyncio.TimeoutError, ssl.SSLError) as exc:
            raise _NotSent(type(exc).__name__)
        lines = [f'POST {target} HTTP/1.1', f'Host: {host}', f'x-api-key: {self.api_key}',
                 'content-type: application/json', f'content-length: {len(data)}',
                 'accept-encoding: identity', 'connection: close'] + [f'{k}: {v}' for k, v in forward]
        writer.write(('\r\n'.join(lines) + '\r\n\r\n').encode('latin-1') + data)
        await writer.drain()
        status_line, response_headers = await _read_head(reader, 600)
        return reader, writer, int(status_line.split(' ')[1]), status_line, response_headers

    def _head(self, status_line, headers):
        keep = ('content-type', 'request-id', 'retry-after')
        out = [status_line] + [f'{k}: {v}' for k, v in headers.items() if k in keep or k.startswith('anthropic-ratelimit')]
        return ('\r\n'.join(out + ['connection: close']) + '\r\n\r\n').encode('latin-1')

    async def _forward(self, writer, target, forward, data):
        try:
            up_reader, up_writer, _, status_line, up_headers = await self._open_upstream(target, forward, data)
        except _NotSent:
            writer.write(_error(502, 'Could not reach Anthropic through the Relay meter', 'api_error'))
            return
        try:
            writer.write(self._head(status_line, up_headers))
            async for chunk in _body_chunks(up_reader, up_headers):
                writer.write(chunk)
                await writer.drain()
        finally:
            up_writer.close()

    async def _metered(self, writer, target, forward, data, rid, max_tokens):
        tracker = UsageTracker()
        try:
            up_reader, up_writer, status, status_line, up_headers = await self._open_upstream(target, forward, data)
        except _NotSent as exc:
            self.budget.release(rid, 'never sent: ' + str(exc))
            self.engine.record('budget.released', {'provider': 'anthropic', 'receipt': rid, 'reason': 'connection failed before sending'})
            writer.write(_error(502, 'Could not reach Anthropic through the Relay meter', 'api_error'))
            return
        except (OSError, asyncio.TimeoutError, ValueError, Problem, asyncio.IncompleteReadError) as exc:
            # Sent, but no readable answer: it may have been processed. Keep the hold.
            self.budget.retain(rid, 'no response: ' + type(exc).__name__)
            self.engine.record('budget.retained', {'provider': 'anthropic', 'receipt': rid, 'reason': 'no response'})
            writer.write(_error(502, 'No response from Anthropic through the Relay meter', 'api_error'))
            return
        content_type = up_headers.get('content-type', '')
        try:
            writer.write(self._head(status_line, up_headers))
            async for chunk in _body_chunks(up_reader, up_headers):
                tracker.feed(chunk, content_type)
                writer.write(chunk)
                await writer.drain()
            tracker.finish()
        except (OSError, asyncio.IncompleteReadError, asyncio.TimeoutError, ValueError) as exc:
            self.budget.retain(rid, 'stream interrupted: '+type(exc).__name__)
            self.engine.record('budget.retained', {'provider': 'anthropic', 'receipt': rid, 'reason': 'stream interrupted'})
            return
        finally:
            up_writer.close()
        if status != 200:
            self.budget.release(rid, f'HTTP {status} from Anthropic')
            self.engine.record('budget.released', {'provider': 'anthropic', 'receipt': rid, 'status': status,
                                                   'reason': 'provider error response; not billed'})
            return
        if not tracker.completed or tracker.usage is None or tracker.error:
            self.budget.retain(rid, tracker.error or 'no final usage receipt')
            self.engine.record('budget.retained', {'provider': 'anthropic', 'receipt': rid,
                                                   'reason': 'stream error' if tracker.error else 'missing usage'})
            return
        try:
            cost = self.budget.settle(rid, tracker.usage, max_tokens)
        except Problem as exc:
            self.engine.record('budget.halted', {'provider': 'anthropic', 'receipt': rid, 'reason': str(exc)})
            return
        self.engine.record('budget.settled', {'provider': 'anthropic', 'receipt': rid, 'cost_usd': cost,
                                              'usage': {k: tracker.usage.get(k) for k in (
                                                  'input_tokens', 'output_tokens', 'cache_creation_input_tokens',
                                                  'cache_read_input_tokens')}})


def guarded(runtime):
    """True when this runtime's model calls must go through the metering proxy."""
    return enabled() and runtime in RUNTIMES


def claude_env(meter):
    """Claude Code CLI settings that keep every internal call on the pinned model and output cap."""
    return {**meter.env(), 'ANTHROPIC_AUTH_TOKEN': '', 'ANTHROPIC_SMALL_FAST_MODEL': MODEL,
            'ANTHROPIC_DEFAULT_HAIKU_MODEL': MODEL, 'ANTHROPIC_DEFAULT_SONNET_MODEL': MODEL,
            'ANTHROPIC_DEFAULT_OPUS_MODEL': MODEL, 'CLAUDE_CODE_SUBAGENT_MODEL': MODEL,
            'CLAUDE_CODE_MAX_OUTPUT_TOKENS': str(MAX_OUTPUT), 'MAX_THINKING_TOKENS': '0',
            'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC': '1', 'DISABLE_TELEMETRY': '1', 'DISABLE_ERROR_REPORTING': '1'}
