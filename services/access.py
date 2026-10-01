"""Single-operator pilot access. Not multi-user identity, RBAC, or an OS sandbox."""
import hmac
import os
import secrets
import threading
import time
from http.cookies import SimpleCookie
from urllib.parse import urlsplit
from store import Problem


class Access:
    def __init__(self, mode=None, origin=None, token=None):
        self.mode = mode or os.getenv('RELAY_MODE', 'local')
        self.origin = (origin if origin is not None else os.getenv('RELAY_PUBLIC_ORIGIN', '')).rstrip('/')
        self.token = token if token is not None else os.getenv('RELAY_OPERATOR_TOKEN', '')
        self.sessions = {}
        self.attempts = []
        self.recent = {}
        self.lock = threading.RLock()
        if self.mode not in ('local', 'pilot'):
            raise ValueError('RELAY_MODE must be local or pilot')
        if self.mode == 'pilot':
            parsed = urlsplit(self.origin)
            if parsed.scheme != 'https' or not parsed.hostname or parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password:
                raise ValueError('Pilot requires one HTTPS RELAY_PUBLIC_ORIGIN without a path')
            if len(self.token) < 32 or len(self.token) > 512:
                raise ValueError('Pilot requires a random RELAY_OPERATOR_TOKEN of 32–512 characters')

    def guard(self, headers, port, write=False, public=False):
        allowed = {urlsplit(self.origin).netloc} if self.mode == 'pilot' else {'localhost:'+str(port), '127.0.0.1:'+str(port)}
        if headers.get('Host') not in allowed:
            raise Problem('Invalid host', 403)
        origin = headers.get('Origin')
        origins = {self.origin} if self.mode == 'pilot' else {'http://'+h for h in allowed}
        if (origin and origin not in origins) or (write and self.mode == 'pilot' and origin != self.origin):
            raise Problem('Cross-origin requests are not permitted', 403)
        if write and headers.get('Content-Type', '').split(';')[0] != 'application/json':
            raise Problem('Use application/json', 415)
        if self.mode == 'pilot' and not public and not self.authenticated(headers):
            raise Problem('Sign in required', 401)

    def session_id(self, headers):
        try:
            cookies = SimpleCookie(); cookies.load(headers.get('Cookie', ''))
            return cookies['__Host-relay'].value if '__Host-relay' in cookies else ''
        except Exception:
            return ''

    def authenticated(self, headers):
        with self.lock:
            return self.sessions.get(self.session_id(headers), 0) > time.monotonic()

    def login(self, value):
        if self.mode != 'pilot':
            raise Problem('Local mode does not require login', 409)
        # A bounded global throttle deliberately does not trust client-controlled forwarded IPs.
        with self.lock:
            now = time.monotonic()
            self.attempts = [t for t in self.attempts if t > now-60]
            if len(self.attempts) >= 10:
                raise Problem('Too many sign-in attempts. Wait one minute.', 429)
            self.attempts.append(now)
            if not isinstance(value, str) or not hmac.compare_digest(value.encode(), self.token.encode()):
                raise Problem('Invalid operator token', 401)
            return self.issue_session()

    def issue_session(self):
        """Only call after a verified token or WebAuthn authentication."""
        with self.lock:
            now = time.monotonic()
            self.sessions = {k: v for k, v in self.sessions.items() if v > now}
            self.recent = {k: v for k, v in self.recent.items() if k in self.sessions}
            if len(self.sessions) >= 32:
                raise Problem('Session limit reached. Sign out another browser or restart.', 429)
            sid = secrets.token_urlsafe(32)
            self.sessions[sid] = now+8*3600
            self.recent[sid] = now
        return '__Host-relay='+sid+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800'

    def require_recent(self, headers):
        with self.lock:
            sid = self.session_id(headers)
            if not self.authenticated(headers) or time.monotonic()-self.recent.get(sid, -10**12)>300:
                raise Problem('Sign in again before managing passkeys (five-minute limit).', 403)
            return sid

    def throttle_passkey(self):
        with self.lock:
            now=time.monotonic()
            self.attempts=[t for t in self.attempts if t>now-60]
            if len(self.attempts)>=10:raise Problem('Too many sign-in attempts. Wait one minute.',429)
            self.attempts.append(now)

    def logout(self, headers):
        with self.lock:
            self.sessions.pop(self.session_id(headers), None)
            self.recent.pop(self.session_id(headers), None)
        return '__Host-relay=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0'


def deployment_status(access):
    return {
        'mode': access.mode, 'target': 'Fly.io · single-machine, single-operator pilot',
        'production_ready': False,
        'gates': [
            {'name': 'Operator login', 'status': 'configured' if access.mode == 'pilot' else 'local only', 'detail': 'Single operator: verified WebAuthn passkeys with required user verification, or recovery token. Eight-hour HttpOnly sessions, exact-origin checks and throttling. Enrollment/removal requires a login within five minutes. Device enrollment acceptance is separate from automated tests. No team accounts or RBAC.'},
            {'name': 'HTTPS edge', 'status': 'template', 'detail': 'Fly force_https enabled in template. Validate certificate and proxy boundary after deployment.'},
            {'name': 'Persistent state', 'status': 'implemented', 'detail': 'SQLite + native workspaces on /data. One machine only. Do not attach independent database copies to replicas.'},
            {'name': 'Resource bounds', 'status': 'implemented', 'detail': 'Bounded HTTP workers and concurrent agent runs. No distributed scheduling or per-user quotas.'},
            {'name': 'Backup / restore', 'status': 'partial', 'detail': 'SQLite online backup utility. Off-machine encrypted retention and restore drill required before pilot acceptance.'},
            {'name': 'Cloud acceptance', 'status': 'pending', 'detail': 'Linux container and offline SDK contracts verified. Check the deployment checkpoint for HTTPS and volume/restart acceptance. Live model acceptance remains separate.'},
            {'name': 'Provider verification', 'status': 'pending', 'detail': 'Contract tests are not paid end-to-end model verification. Configure secrets and validate each enabled adapter.'},
            {'name': 'Supabase Auth + RBAC', 'status': 'planned', 'detail': 'Next phase: verified JWT issuer/audience/signature, membership roles, tenant-scoped records and RLS. Not implemented.'},
            {'name': 'Horizontal scaling', 'status': 'blocked', 'detail': 'Requires PostgreSQL migration, durable job queue, worker leases, shared artifacts and idempotent recovery. Do not scale this pilot beyond one machine.'},
            {'name': 'Runtime isolation', 'status': 'partial', 'detail': 'Non-root container and tool allowlists. SDK processes share a container; not per-run OS isolation.'},
        ]}
