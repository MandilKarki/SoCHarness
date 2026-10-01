import json
import threading
import unittest
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer
from http.cookies import SimpleCookie
from pathlib import Path
from unittest.mock import patch
from test_lab import LabFixture
from store import Store, Problem, TOOLS
from inventory import inventory, ROWS
from access import Access, deployment_status
from app import Handler
from backup import backup


class InventoryTest(LabFixture):
    def test_inventory_matches_registry_and_database(self):
        value=inventory(self.store)
        self.assertEqual(len(value['rows']),27)
        self.assertEqual(len(value['frameworks']),11)
        self.assertEqual(value['metrics']['records'],8)
        self.assertEqual(value['metrics']['tools'],len(TOOLS))
        self.assertEqual({t['name'] for t in value['tools']},{t['name'] for t in TOOLS})
        self.assertEqual(len({r[0] for r in ROWS}),len(ROWS))

    def test_not_integrated_frameworks_never_claim_coverage(self):
        value=inventory(self.store)
        for id in ('hermes','openhands','google_adk','microsoft'):
            self.assertEqual(next(r for r in value['rows'] if r['id']=='tools')['cells'][id]['status'],'native')
            self.assertEqual(next(r for r in value['rows'] if r['id']=='mcp')['cells'][id]['status'],'gap')
        self.assertEqual(next(r for r in value['rows'] if r['id']=='tools')['cells']['opencode']['status'],'gap')
        self.assertEqual(next(r for r in value['rows'] if r['id']=='native_resume')['cells']['pi']['status'],'native')

    def test_backup_does_not_overwrite_and_includes_committed_wal(self):
        self.session()
        target=Path(self.temp.name)/'backup.sqlite3'
        backup(self.path,target)
        with Store(target) as other:
            self.assertEqual(len(other.sessions()),1)
        with self.assertRaises(FileExistsError):backup(self.path,target)

    def test_claude_child_secret_isolation(self):
        from child_env import claude_environment
        with patch('child_env.DATA',Path(self.temp.name)),patch.dict('os.environ',{'RELAY_OPERATOR_TOKEN':'private-login','AI_GATEWAY_API_KEY':'private-other-provider','ANTHROPIC_API_KEY':'allowed-provider','UNEXPECTED_SECRET':'private-unknown'}):
            result=claude_environment()
            self.assertEqual(result['ANTHROPIC_API_KEY'],'allowed-provider')
            for key in ('RELAY_OPERATOR_TOKEN','AI_GATEWAY_API_KEY','UNEXPECTED_SECRET'):self.assertEqual(result[key],'')
            self.assertTrue(result['HOME'].startswith(self.temp.name))


class AccessTest(unittest.TestCase):
    def setUp(self):
        self.access=Access('pilot','https://relay.example','x'*40)
        self.headers={'Host':'relay.example','Origin':'https://relay.example','Content-Type':'application/json'}

    def test_fail_closed_configuration(self):
        for origin,token in [('http://relay.example','x'*40),('https://relay.example/path','x'*40),('https://relay.example','short')]:
            with self.assertRaises(ValueError):Access('pilot',origin,token)

    def test_login_cookie_expiry_logout(self):
        cookie=self.access.login('x'*40)
        for flag in ('Secure','HttpOnly','SameSite=Strict','Path=/','Max-Age=28800'):self.assertIn(flag,cookie)
        self.headers['Cookie']=cookie.split(';')[0]
        self.access.guard(self.headers,8787,True)
        with patch('access.time.monotonic',return_value=10**12):self.assertFalse(self.access.authenticated(self.headers))
        self.access.logout(self.headers)
        with self.assertRaises(Problem):self.access.guard(self.headers,8787)

    def test_auth_and_csrf_cannot_be_bypassed(self):
        with self.assertRaises(Problem):self.access.guard(self.headers,8787)
        self.headers['Cookie']=self.access.login('x'*40).split(';')[0]
        for origin in ('https://evil.example',None):
            with self.assertRaises(Problem):self.access.guard({**self.headers,'Origin':origin},8787,True)
        with self.assertRaises(Problem):self.access.guard({**self.headers,'Host':'evil.example'},8787)
        with self.assertRaises(Problem):self.access.guard({**self.headers,'Cookie':'__Host-relay=forged'},8787)

    def test_login_throttle(self):
        for i in range(10):
            with self.assertRaises(Problem) as exc:self.access.login('wrong')
            self.assertEqual(exc.exception.status,401)
        with self.assertRaises(Problem) as exc:self.access.login('x'*40)
        self.assertEqual(exc.exception.status,429)

    def test_production_readiness_not_inferred_from_auth(self):
        status=deployment_status(self.access)
        self.assertFalse(status['production_ready'])
        self.assertEqual(next(g for g in status['gates'] if g['name']=='Horizontal scaling')['status'],'blocked')


class PilotHTTPTest(LabFixture):
    def test_protected_http_login_logout_and_public_assets(self):
        with patch('app.Store',lambda:Store(self.path)):
            server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
            server.access=Access('pilot','https://relay.example','x'*40)
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            def request(path,body=None,cookie=None,origin='https://relay.example'):
                headers={'Host':'relay.example','Origin':origin,'Content-Type':'application/json'}
                if cookie:headers['Cookie']=cookie
                req=urllib.request.Request('http://127.0.0.1:'+str(server.server_port)+path,headers=headers,data=json.dumps(body).encode() if body is not None else None)
                try:
                    with urllib.request.urlopen(req) as r:return r.status,dict(r.headers),r.read()
                except urllib.error.HTTPError as r:return r.code,dict(r.headers),r.read()
            try:
                for path in ('/api/incidents','/api/inventory','/api/sessions','/api/deployment','/app.js'):
                    self.assertEqual(request(path)[0],401,path)
                self.assertEqual(request('/api/health')[0],200)
                self.assertEqual(request('/login')[0],200)
                self.assertEqual(request('/refinement.css')[0],200)
                self.assertEqual(request('/api/login',{'token':'x'*40},origin='https://evil.example')[0],403)
                status,headers,_=request('/api/login',{'token':'x'*40});self.assertEqual(status,200)
                cookie=headers['Set-Cookie'].split(';')[0]
                self.assertEqual(request('/api/inventory',cookie=cookie)[0],200)
                sid=self.session()
                server.run_slots=threading.BoundedSemaphore(0)
                self.assertEqual(request('/api/sessions/'+sid+'/messages',{'message':'bounded run'},cookie=cookie)[0],429)
                self.assertEqual(self.store.session(sid)['status'],'idle')
                self.assertEqual(request('/api/logout',{},cookie=cookie)[0],200)
                self.assertEqual(request('/api/inventory',cookie=cookie)[0],401)
            finally:server.shutdown();server.server_close();thread.join()
