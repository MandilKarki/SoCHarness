import json
import os
import time
import unittest
from unittest.mock import patch
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization
from firebase_login import FirebaseLogin
from access import Access
from store import Problem

CONFIG = {'projectId':'relay-test','authDomain':'relay-test.firebaseapp.com',
          'apiKey':'AIza'+'x'*35,'appId':'1:123456:web:abcdef'}


class FirebaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.key = rsa.generate_private_key(public_exponent=65537,key_size=2048)
        cls.public = cls.key.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo).decode()

    def setUp(self):
        env = patch.dict(os.environ,{'RELAY_FIREBASE_CONFIG':json.dumps(CONFIG),'RELAY_GOOGLE_EMAIL':'owner@example.com'})
        env.start(); self.addCleanup(env.stop)
        self.login = FirebaseLogin()
        self.access = Access('pilot','https://relay.example','x'*40)
        current = int(time.time())
        self.claims = {'iss':'https://securetoken.google.com/relay-test','aud':'relay-test','sub':'uid-123',
                       'email':'owner@example.com','email_verified':True,'firebase':{'sign_in_provider':'google.com'},
                       'iat':current-1,'auth_time':current-1,'exp':current+3600}

    def token(self, **changes):
        return jwt.encode({**self.claims,**changes},self.key,algorithm='RS256',headers={'kid':'test-key'})

    def verify(self, token):
        # Only Google's certificate download is mocked. Real RSA signature and
        # Firebase JWT verification still execute, with generated test keys.
        with patch('google.oauth2.id_token._fetch_certs',return_value={'test-key':self.public}):
            return self.login.login(self.access,token)

    def test_verified_google_owner_gets_secure_cookie(self):
        cookie = self.verify(self.token())
        for flag in ('__Host-relay=','Secure','HttpOnly','SameSite=Strict'): self.assertIn(flag,cookie)
        self.assertTrue(self.access.authenticated({'Cookie':cookie.split(';')[0]}))

    def test_invalid_identity_claims_are_rejected(self):
        cases = ({'iss':'https://evil.example'}, {'aud':'another-project'}, {'sub':''},
                 {'email':'other@example.com'}, {'email_verified':False},
                 {'firebase':{'sign_in_provider':'password'}}, {'firebase':{}},
                 {'auth_time':time.time()-3600}, {'auth_time':time.time()+600})
        for changes in cases:
            with self.subTest(changes=changes), self.assertRaises(Problem): self.verify(self.token(**changes))
        self.assertFalse(self.access.sessions)

    def test_expired_future_and_missing_times_rejected(self):
        for changes in ({'exp':int(time.time())-60},{'iat':int(time.time())+600},{'auth_time':None},{'auth_time':True}):
            with self.assertRaises(Problem): self.verify(self.token(**changes))

    def test_forgery_wrong_key_and_algorithm_rejected(self):
        wrong_key = rsa.generate_private_key(public_exponent=65537,key_size=2048)
        tokens = [jwt.encode(self.claims,wrong_key,algorithm='RS256',headers={'kid':'test-key'}),
                  jwt.encode(self.claims,'x'*40,algorithm='HS256',headers={'kid':'test-key'}),
                  jwt.encode(self.claims,'',algorithm='none'), 'not.a.token']
        for token in tokens:
            with self.assertRaises(Problem): self.verify(token)
        self.assertFalse(self.access.sessions)

    def test_provider_error_sanitized_and_no_cookie_issued(self):
        with patch('google.oauth2.id_token._fetch_certs',side_effect=RuntimeError('private-token-fragment')):
            with self.assertRaises(Problem) as caught: self.login.login(self.access,self.token())
        self.assertNotIn('private-token-fragment',str(caught.exception))
        self.assertFalse(self.access.sessions)

    def test_public_config_is_strict_and_excludes_extras(self):
        with patch.dict(os.environ,{'RELAY_FIREBASE_CONFIG':json.dumps({**CONFIG,'extra':'ignored'})}):
            self.assertEqual(FirebaseLogin().config,CONFIG)
        for changes in ({'authDomain':'evil.example'},{'projectId':'bad/path'},{'appId':'bad'},{'apiKey':None}):
            with patch.dict(os.environ,{'RELAY_FIREBASE_CONFIG':json.dumps({**CONFIG,**changes})}):
                with self.assertRaises(ValueError): FirebaseLogin()

    def test_disabled_local_and_throttled_logins(self):
        with patch.dict(os.environ,{'RELAY_FIREBASE_CONFIG':''}):
            with self.assertRaises(Problem): FirebaseLogin().login(self.access,self.token())
        with self.assertRaises(Problem): self.login.login(Access('local'),self.token())
        for _ in range(10):
            with self.assertRaises(Problem): self.login.login(self.access,'bad')
        with self.assertRaises(Problem) as caught: self.login.login(self.access,self.token())
        self.assertEqual(caught.exception.status,429)

    def test_http_exchange_origin_guard_and_login_only_csp(self):
        import threading
        import urllib.request
        import urllib.error
        from app import Server
        server = Server(('127.0.0.1',0),self.access)
        thread = threading.Thread(target=server.serve_forever,daemon=True); thread.start()
        def request(path, body=None, origin='https://relay.example'):
            headers = {'Host':'relay.example','Origin':origin}
            data = None
            if body is not None:
                data = json.dumps(body).encode();headers['Content-Type']='application/json'
            try:
                return urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:'+str(server.server_port)+path,data=data,headers=headers))
            except urllib.error.HTTPError as error: return error
        try:
            with request('/api/auth') as response:
                self.assertEqual(json.load(response)['firebase'],CONFIG)
                self.assertNotIn('apis.google.com',response.headers['Content-Security-Policy'])
            with request('/login') as response:
                self.assertIn('frame-src https://relay-test.firebaseapp.com',response.headers['Content-Security-Policy'])
                self.assertNotIn("'unsafe-inline'",response.headers['Content-Security-Policy'])
            with request('/api/login/google',{'id_token':self.token()},'https://evil.example') as response:
                self.assertEqual(response.status,403)
                self.assertIsNone(response.headers.get('Set-Cookie'))
            with patch('google.oauth2.id_token._fetch_certs',return_value={'test-key':self.public}):
                with request('/api/login/google',{'id_token':self.token()}) as response:
                    self.assertEqual(response.status,200)
                    self.assertIn('HttpOnly',response.headers['Set-Cookie'])
        finally:
            server.shutdown();server.server_close();thread.join()
