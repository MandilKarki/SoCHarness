"""Google sign-in via Firebase. No service-account private key is needed.

Google's verifier checks signatures, expiry, issued-at and audience. Relay also
checks issuer, recent authentication, verified email, Google provider and an
explicit single-operator allowlist. No ID token is logged or persisted.
"""
import json
import os
import re
import time
from store import Problem


class FirebaseLogin:
    def __init__(self):
        self.config = None
        self.email = os.getenv('RELAY_GOOGLE_EMAIL', '').strip().lower()
        raw = os.getenv('RELAY_FIREBASE_CONFIG', '')
        if not raw:
            return
        try:
            cfg = json.loads(raw)
            project = cfg['projectId']
            if not isinstance(project, str) or not re.fullmatch(r'[a-z][a-z0-9-]{4,28}[a-z0-9]', project):
                raise ValueError()
            if cfg['authDomain'] != project+'.firebaseapp.com':
                raise ValueError()
            if not re.fullmatch(r'AIza[\w-]{30,50}', cfg['apiKey']):
                raise ValueError()
            if not isinstance(cfg['appId'], str) or not re.fullmatch(r'1:\d+:web:[a-f0-9]+', cfg['appId']):
                raise ValueError()
            if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', self.email):
                raise ValueError()
            self.config = {k:cfg[k] for k in ('projectId','authDomain','apiKey','appId')}
        except (ValueError, KeyError, TypeError):
            raise ValueError('Invalid Firebase web configuration or operator email; refusing to start.') from None

    def login(self, access, token):
        if access.mode != 'pilot' or not self.config:
            raise Problem('Google sign-in is not configured.', 409)
        access.throttle_passkey()
        if not isinstance(token, str) or not 20 <= len(token) <= 16000:
            raise Problem('Invalid Google sign-in token.', 401)
        from google.oauth2 import id_token
        from google.auth.transport.requests import Request
        import requests

        class BoundedRequest(Request):
            def __call__(self, *args, **kwargs):
                kwargs['timeout'] = 8
                return super().__call__(*args, **kwargs)

        try:
            from google.auth import jwt
            header = jwt.decode_header(token)
            if header.get('alg') != 'RS256' or not isinstance(header.get('kid'), str) or not header['kid']:
                raise ValueError('Invalid signing algorithm')
            with requests.Session() as transport:
                claims = id_token.verify_firebase_token(token, BoundedRequest(session=transport),
                                                       audience=self.config['projectId'])
            self.validate_claims(claims)
        except Exception:
            # Provider/library errors may contain token fragments; never propagate them.
            raise Problem('Google sign-in could not be verified. Use the approved account and try again.', 401) from None
        return access.issue_session()

    def validate_claims(self, claims):
        current = time.time()
        if (claims.get('iss') != 'https://securetoken.google.com/'+self.config['projectId'] or
                claims.get('aud') != self.config['projectId'] or
                not isinstance(claims.get('sub'), str) or not 1 <= len(claims['sub']) <= 128 or
                claims.get('email_verified') is not True or
                not isinstance(claims.get('email'), str) or claims['email'].lower() != self.email or
                claims.get('firebase', {}).get('sign_in_provider') != 'google.com'):
            raise ValueError('Unapproved identity')
        for field in ('exp','iat','auth_time'):
            if type(claims.get(field)) not in (int, float):
                raise ValueError('Missing token time')
        if not (claims['iat'] <= current < claims['exp'] and current-300 <= claims['auth_time'] <= current):
            raise ValueError('Fresh Google sign-in required')
