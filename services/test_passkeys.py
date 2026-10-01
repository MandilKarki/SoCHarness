"""Real ES256/CBOR WebAuthn verification fixtures; not physical-device acceptance."""
import hashlib
import json
import secrets
import threading
import urllib.request
import urllib.error
from unittest.mock import patch
import cbor2
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from webauthn.helpers import bytes_to_base64url as b64
from test_lab import LabFixture
from store import Store, Problem
from access import Access
from passkeys import Passkeys
from app import Server


class PasskeyTest(LabFixture):
    def setUp(self):
        super().setUp()
        self.access=Access('pilot','https://relay.example','x'*40)
        self.keys=Passkeys(self.access)
        self.headers={'Cookie':self.access.login('x'*40).split(';')[0]}
        self.private=ec.generate_private_key(ec.SECP256R1())
        self.key_id=secrets.token_bytes(32)

    def credential(self,start,register=True,origin='https://relay.example',rp='relay.example',uv=True,challenge=None,count=1,handle=None,cross_origin=False,present=True):
        client=json.dumps({'type':'webauthn.create' if register else 'webauthn.get','challenge':challenge or start['publicKey']['challenge'],'origin':origin,'crossOrigin':cross_origin}).encode()
        flags=int(present)+(4 if uv else 0)+(64 if register else 0)
        data=hashlib.sha256(rp.encode()).digest()+bytes([flags])+count.to_bytes(4,'big')
        response={'clientDataJSON':b64(client)}
        if register:
            public=self.private.public_key().public_numbers()
            cose=cbor2.dumps({1:2,3:-7,-1:1,-2:public.x.to_bytes(32,'big'),-3:public.y.to_bytes(32,'big')})
            data+=bytes(16)+len(self.key_id).to_bytes(2,'big')+self.key_id+cose
            response['attestationObject']=b64(cbor2.dumps({'fmt':'none','attStmt':{},'authData':data}))
        else:
            response.update(authenticatorData=b64(data),signature=b64(self.private.sign(data+hashlib.sha256(client).digest(),ec.ECDSA(hashes.SHA256()))),userHandle=handle or b64(self.keys.owner(self.store)))
        return {'ceremony_id':start['ceremony_id'],'credential':{'id':b64(self.key_id),'rawId':b64(self.key_id),'type':'public-key','response':response}}

    def enroll(self):
        start=self.keys.registration_options(self.store,self.headers,{'label':'Test key'})
        self.keys.register(self.store,self.headers,self.credential(start))

    def auth_start(self):
        start,cookie=self.keys.authentication_options({})
        return start,{'Cookie':cookie.split(';')[0]}

    def test_real_registration_authentication_persistence_and_single_use(self):
        self.enroll()
        self.keys=Passkeys(self.access)
        start,headers=self.auth_start()
        self.assertFalse(start['publicKey'].get('allowCredentials'))
        body=self.credential(start,False,count=2)
        cookie=self.keys.authenticate(self.store,headers,body)
        self.assertTrue(self.access.authenticated({'Cookie':cookie.split(';')[0]}))
        self.assertEqual(self.store.db.execute('SELECT sign_count FROM relay_passkeys').fetchone()[0],2)
        with self.assertRaises(Problem):self.keys.authenticate(self.store,headers,body)
        with Store(self.path) as other:self.assertEqual(len(self.keys.list(other,self.headers)['passkeys']),1)
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM relay_auth_audit').fetchone()[0],2)

    def test_registration_rejects_origin_rp_challenge_and_missing_uv(self):
        for changes in ({'origin':'https://evil.example'},{'rp':'evil.example'},{'challenge':b64(b'wrong')},{'uv':False},{'cross_origin':True},{'present':False}):
            with self.subTest(changes=changes):
                start=self.keys.registration_options(self.store,self.headers,{})
                with self.assertRaises(Problem):self.keys.register(self.store,self.headers,self.credential(start,**changes))
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM relay_passkeys').fetchone()[0],0)

    def test_authentication_rejects_bad_signature_origin_rp_uv_handle_counter(self):
        self.enroll()
        for changes in ({'origin':'https://evil.example'},{'rp':'evil.example'},{'uv':False},{'handle':b64(b'wrong')},{'count':1},{'challenge':b64(b'wrong')},{'cross_origin':True},{'present':False}):
            with self.subTest(changes=changes):
                start,headers=self.auth_start()
                with self.assertRaises(Problem):self.keys.authenticate(self.store,headers,self.credential(start,False,**changes))
        start,headers=self.auth_start();body=self.credential(start,False,count=2);body['credential']['response']['signature']=b64(b'bad')
        with self.assertRaises(Problem):self.keys.authenticate(self.store,headers,body)

    def test_ceremony_expiry_binding_and_registration_replay(self):
        start=self.keys.registration_options(self.store,self.headers,{})
        body=self.credential(start)
        self.keys.register(self.store,self.headers,body)
        with self.assertRaises(Problem):self.keys.register(self.store,self.headers,body)
        start,headers=self.auth_start()
        with self.assertRaises(Problem):self.keys.authenticate(self.store,{'Cookie':'__Host-relay-flow=wrong'},self.credential(start,False,count=2))
        start,headers=self.auth_start();self.keys.pending[start['ceremony_id']]['expires']=0
        with self.assertRaises(Problem):self.keys.authenticate(self.store,headers,self.credential(start,False,count=2))

    def test_synced_credentials_with_zero_counter(self):
        start=self.keys.registration_options(self.store,self.headers,{})
        self.keys.register(self.store,self.headers,self.credential(start,count=0))
        start,headers=self.auth_start()
        self.assertTrue(self.keys.authenticate(self.store,headers,self.credential(start,False,count=0)))

    def test_unknown_key_and_mismatched_raw_id(self):
        self.enroll()
        start,headers=self.auth_start();body=self.credential(start,False,count=2)
        body['credential']['id']=b64(b'unknown')
        with self.assertRaises(Problem):self.keys.authenticate(self.store,headers,body)
        start,headers=self.auth_start();body=self.credential(start,False,count=2)
        body['credential']['rawId']=b64(b'wrong')
        with self.assertRaises(Problem):self.keys.authenticate(self.store,headers,body)

    def test_logout_invalidates_pending_enrollment(self):
        start=self.keys.registration_options(self.store,self.headers,{})
        self.access.logout(self.headers)
        with self.assertRaises(Problem):self.keys.register(self.store,self.headers,self.credential(start))
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM relay_passkeys').fetchone()[0],0)

    def test_registration_and_removal_require_recent_login(self):
        with self.assertRaises(Problem):self.keys.registration_options(self.store,{}, {})
        self.enroll()
        self.access.recent[self.access.session_id(self.headers)]=0
        with self.assertRaises(Problem):self.keys.registration_options(self.store,self.headers,{})
        with self.assertRaises(Problem):self.keys.remove(self.store,self.headers,{'id':b64(self.key_id)})
        self.assertFalse(self.keys.list(self.store,self.headers)['recent_auth'])

    def test_removal_revokes_all_sessions_and_pending_ceremonies(self):
        self.enroll();self.access.login('x'*40);self.auth_start()
        result=self.keys.remove(self.store,self.headers,{'id':b64(self.key_id)})
        self.assertTrue(result['signed_out_all']);self.assertFalse(self.access.sessions);self.assertFalse(self.keys.pending)
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM relay_passkeys').fetchone()[0],0)
        self.assertTrue(self.access.login('x'*40))

    def test_limits_and_local_mode(self):
        self.keys.MAX_KEYS=1;self.enroll()
        with self.assertRaises(Problem):self.keys.registration_options(self.store,self.headers,{})
        for _ in range(9):self.keys.authentication_options({})
        with self.assertRaises(Problem) as exc:self.keys.authentication_options({})
        self.assertEqual(exc.exception.status,429)
        with self.assertRaises(Problem):Passkeys(Access('local')).registration_options(self.store,{}, {})

    def test_http_routes_enforce_auth_origin_and_preserve_csp(self):
        with patch('app.Store',lambda:Store(self.path)):
            server=Server(('127.0.0.1',0),self.access)
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            def request(path,body=None,cookie='',origin='https://relay.example'):
                req=urllib.request.Request('http://127.0.0.1:'+str(server.server_port)+path,headers={'Host':'relay.example','Origin':origin,'Content-Type':'application/json','Cookie':cookie},data=json.dumps(body).encode() if body is not None else None)
                try:r=urllib.request.urlopen(req)
                except urllib.error.HTTPError as error:r=error
                with r:return r.status,dict(r.headers),r.read()
            try:
                for path in ('/api/passkeys','/security.js','/experience.js'):self.assertEqual(request(path)[0],401)
                self.assertEqual(request('/api/passkeys/registration/options',{})[0],401)
                self.assertEqual(request('/api/passkeys/authentication/options',{},origin='https://evil.example')[0],403)
                status,headers,body=request('/api/passkeys/authentication/options',{})
                self.assertEqual(status,200);self.assertIn('HttpOnly',headers['Set-Cookie'])
                self.assertEqual(request('/api/passkeys/authentication/verify',{})[0],401)
                for path in ('/login','/passkeys.js','/identity.css'):
                    status,headers,body=request(path);self.assertEqual(status,200);self.assertNotIn("'unsafe-inline'",headers['Content-Security-Policy'])
                self.assertEqual(request('/security',cookie=self.headers['Cookie'])[0],200)
            finally:server.shutdown();server.server_close();thread.join()
