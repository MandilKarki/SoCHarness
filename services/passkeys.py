"""Single-operator WebAuthn. No biometric/private-key material enters the server."""
import json
import secrets
import time
from http.cookies import SimpleCookie
from urllib.parse import urlsplit
from webauthn import (generate_registration_options, generate_authentication_options,
                     verify_registration_response, verify_authentication_response, options_to_json)
from webauthn.helpers import bytes_to_base64url, base64url_to_bytes
from webauthn.helpers.structs import (AuthenticatorSelectionCriteria, ResidentKeyRequirement,
                                     UserVerificationRequirement, PublicKeyCredentialDescriptor)
from store import Problem, now


class Passkeys:
    TTL = 300
    MAX_KEYS = 8

    def __init__(self, access):
        self.access = access
        self.rp_id = urlsplit(access.origin).hostname
        self.pending = {}

    def enabled(self):
        if self.access.mode != 'pilot':raise Problem('Passkeys require the HTTPS pilot. Local mode has no login.',409)

    def owner(self, store):
        store.db.execute('INSERT OR IGNORE INTO relay_auth_meta VALUES(?,?)',('operator_handle',secrets.token_hex(32)))
        store.db.commit()
        return bytes.fromhex(store.db.execute('SELECT value FROM relay_auth_meta WHERE key=?',('operator_handle',)).fetchone()[0])

    def begin(self, kind, binding, label=''):
        with self.access.lock:
            stamp=time.monotonic()
            self.pending={k:v for k,v in self.pending.items() if v['expires']>stamp}
            # One active ceremony of each kind per browser/session.
            self.pending={k:v for k,v in self.pending.items() if (v['kind'],v['binding'])!=(kind,binding)}
            if len(self.pending)>=64:raise Problem('Too many pending passkey requests. Try again shortly.',429)
            cid=secrets.token_urlsafe(32)
            self.pending[cid]={'kind':kind,'binding':binding,'label':label,'challenge':secrets.token_bytes(32),'expires':stamp+self.TTL}
            return cid,self.pending[cid]

    def consume(self, body, kind, binding):
        cid=body.get('ceremony_id')
        if not isinstance(cid,str) or len(cid)>100:raise Problem('Invalid or expired passkey request.',401)
        with self.access.lock:
            item=self.pending.pop(cid,None)
        if not item or item['expires']<=time.monotonic() or item['kind']!=kind or not binding or not secrets.compare_digest(item['binding'],binding):
            raise Problem('Invalid or expired passkey request. Start again.',401)
        return item

    @staticmethod
    def top_level_credential(credential):
        # This pilot does not support cross-origin embedded enrollment or sign-in.
        client=json.loads(base64url_to_bytes(credential['response']['clientDataJSON']))
        if client.get('crossOrigin',False) is not False or client.get('topOrigin'):
            raise ValueError('Embedded WebAuthn is not supported')

    @staticmethod
    def browser_binding(headers):
        try:
            cookies=SimpleCookie();cookies.load(headers.get('Cookie',''))
            return cookies['__Host-relay-flow'].value if '__Host-relay-flow' in cookies else ''
        except Exception:return ''

    def list(self, store, headers):
        self.enabled()
        if not self.access.authenticated(headers):raise Problem('Sign in required',401)
        rows=store.db.execute('SELECT id,label,created_at,last_used_at,device_type,backed_up FROM relay_passkeys ORDER BY created_at').fetchall()
        return {'passkeys':[dict(r) for r in rows],'recent_auth':time.monotonic()-self.access.recent.get(self.access.session_id(headers),-10**12)<=300,'max_keys':self.MAX_KEYS}

    def registration_options(self, store, headers, body):
        self.enabled()
        with self.access.lock:
            sid=self.access.require_recent(headers)
            label=body.get('label','My passkey')
            if not isinstance(label,str) or not 1<=len(label.strip())<=60:raise Problem('Passkey name must contain 1–60 characters')
            rows=store.db.execute('SELECT id FROM relay_passkeys').fetchall()
            if len(rows)>=self.MAX_KEYS:raise Problem('Passkey limit reached. Remove an old key first.',409)
            owner=self.owner(store)
            cid,item=self.begin('register',sid,label.strip())
            options=generate_registration_options(rp_id=self.rp_id,rp_name='Relay SoCHarness',user_name='relay-operator',user_display_name='Relay operator',user_id=owner,challenge=item['challenge'],timeout=300000,
                authenticator_selection=AuthenticatorSelectionCriteria(resident_key=ResidentKeyRequirement.REQUIRED,user_verification=UserVerificationRequirement.REQUIRED),
                exclude_credentials=[PublicKeyCredentialDescriptor(id=base64url_to_bytes(r['id'])) for r in rows])
            return {'ceremony_id':cid,'publicKey':json.loads(options_to_json(options))}

    def register(self, store, headers, body):
        self.enabled()
        with self.access.lock:
            sid=self.access.require_recent(headers)
            item=self.consume(body,'register',sid)
            try:
                self.top_level_credential(body.get('credential'))
                result=verify_registration_response(credential=body.get('credential'),expected_challenge=item['challenge'],expected_rp_id=self.rp_id,expected_origin=self.access.origin,require_user_verification=True,require_user_presence=True)
            except Exception:raise Problem('Passkey registration could not be verified. Start again.',400) from None
            if store.db.execute('SELECT count(*) FROM relay_passkeys').fetchone()[0]>=self.MAX_KEYS:raise Problem('Passkey limit reached',409)
            key_id=bytes_to_base64url(result.credential_id)
            if store.db.execute('SELECT 1 FROM relay_passkeys WHERE id=?',(key_id,)).fetchone():raise Problem('This passkey is already registered.',409)
            with store.db:
                store.db.execute('INSERT INTO relay_passkeys VALUES(?,?,?,?,?,?,?,?)',(key_id,result.credential_public_key,result.sign_count,item['label'],now(),None,result.credential_device_type.value,int(result.credential_backed_up)))
                store.db.execute('INSERT INTO relay_auth_audit(kind,credential_id,created_at) VALUES(?,?,?)',('passkey.registered',key_id,now()))
            return {'ok':True}

    def authentication_options(self, headers):
        self.enabled();self.access.throttle_passkey()
        binding=self.browser_binding(headers)
        if not binding or len(binding)>100:binding=secrets.token_urlsafe(32)
        cid,item=self.begin('authenticate',binding)
        options=generate_authentication_options(rp_id=self.rp_id,challenge=item['challenge'],timeout=300000,user_verification=UserVerificationRequirement.REQUIRED)
        # Discoverable credentials: no public key IDs / account-enumeration list.
        return {'ceremony_id':cid,'publicKey':json.loads(options_to_json(options))},'__Host-relay-flow='+binding+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=300'

    def authenticate(self, store, headers, body):
        self.enabled()
        with self.access.lock:
            item=self.consume(body,'authenticate',self.browser_binding(headers))
            credential=body.get('credential')
            try:
                self.top_level_credential(credential)
                key_id=credential['id']
                if not isinstance(key_id,str) or len(key_id)>2048:raise ValueError()
                row=store.db.execute('SELECT * FROM relay_passkeys WHERE id=?',(key_id,)).fetchone()
                if not row:raise ValueError()
                handle=credential['response'].get('userHandle')
                if not handle or not secrets.compare_digest(base64url_to_bytes(handle),self.owner(store)):raise ValueError()
                result=verify_authentication_response(credential=credential,expected_challenge=item['challenge'],expected_rp_id=self.rp_id,expected_origin=self.access.origin,credential_public_key=bytes(row['public_key']),credential_current_sign_count=row['sign_count'],require_user_verification=True)
                if bytes_to_base64url(result.credential_id)!=key_id:raise ValueError()
            except Exception:raise Problem('Passkey sign-in could not be verified. Try again or use the recovery token.',401) from None
            with store.db:
                store.db.execute('UPDATE relay_passkeys SET sign_count=?,last_used_at=?,device_type=?,backed_up=? WHERE id=?',(result.new_sign_count,now(),result.credential_device_type.value,int(result.credential_backed_up),key_id))
                store.db.execute('INSERT INTO relay_auth_audit(kind,credential_id,created_at) VALUES(?,?,?)',('passkey.login',key_id,now()))
            return self.access.issue_session()

    def remove(self, store, headers, body):
        self.enabled()
        with self.access.lock:
            self.access.require_recent(headers)
            key_id=body.get('id')
            if not isinstance(key_id,str) or len(key_id)>2048:raise Problem('Invalid passkey ID')
            with store.db:
                changed=store.db.execute('DELETE FROM relay_passkeys WHERE id=?',(key_id,)).rowcount
                if not changed:raise Problem('Passkey not found',404)
                store.db.execute('INSERT INTO relay_auth_audit(kind,credential_id,created_at) VALUES(?,?,?)',('passkey.removed',key_id,now()))
            # A removed credential cannot retain a previously issued browser session.
            self.access.sessions.clear();self.access.recent.clear();self.pending.clear()
            return {'ok':True,'signed_out_all':True,'recovery':'Operator token remains valid.'}
