"""The frontend migration exposes only executable assets, never application data."""
import unittest
from types import SimpleNamespace
from access import Access
from app import Handler
from store import Problem, ROOT


class FrontendBoundaryTest(unittest.TestCase):
    def handler(self, path, origin=None):
        h = Handler.__new__(Handler)
        h.server = SimpleNamespace(access=Access('pilot', 'https://relay.example', 'x'*40), server_port=8787)
        h.path = path
        h.headers = {'Host': 'relay.example'}
        if origin: h.headers['Origin'] = origin
        return h

    def test_compiled_login_assets_public_but_data_protected(self):
        for path in ('/react-app.js', '/react-app.css'):
            self.handler(path).guard()
        for path in ('/api/incidents', '/api/sessions', '/api/passkeys', '/api/inventory', '/architecture.js'):
            with self.assertRaises(Problem) as caught: self.handler(path).guard()
            self.assertEqual(caught.exception.status, 401)

    def test_public_assets_do_not_relax_origin_validation(self):
        for path in ('/react-app.js', '/react-app.css'):
            with self.assertRaises(Problem) as caught:
                self.handler(path, 'https://untrusted.invalid').guard()
            self.assertEqual(caught.exception.status, 403)

    def test_entrypoints_use_only_compiled_frontend(self):
        for name in ('index.html', 'login.html', 'security.html'):
            source = (ROOT/'web'/name).read_text(encoding='utf-8')
            self.assertIn('src="/react-app.js"', source)
            self.assertIn('href="/react-app.css"', source)
            self.assertNotIn('<script>', source)
            for legacy in ('app.js', 'advanced.js', 'login.js', 'security.js', 'experience.js'):
                self.assertNotIn('src="/'+legacy+'"', source)
