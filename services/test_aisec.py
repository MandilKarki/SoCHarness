import json
from test_lab import LabFixture
from store import Problem
import aisec


class AiSecTaxonomyTests(LabFixture):
    def test_atlas_pin_is_complete_and_versioned(self):
        src = aisec.ATLAS['source']
        self.assertEqual(src['license'], 'Apache-2.0')
        self.assertRegex(src['release'], r'^\d{4}\.\d{2}$')
        c = aisec.catalog()['counts']
        self.assertEqual(c['tactics'], 16)
        self.assertEqual(c['techniques'] + c['subtechniques'], len(aisec.ATLAS['techniques']))
        self.assertEqual(c['owasp_items'], 20)
        ids = {t['id'] for t in aisec.ATLAS['tactics']}
        for tid, t in aisec.ATLAS['techniques'].items():
            self.assertTrue(t['tactics'], tid)
            self.assertTrue(set(t['tactics']) <= ids, tid)
            if t['parent']:
                self.assertIn(t['parent'], aisec.ATLAS['techniques'])

    def test_every_technique_opens_a_sourced_detail(self):
        # Phase 0 gate: every tile in the map opens a detail with sources.
        cat = aisec.catalog()
        tiles = [t['id'] for t in cat['techniques']] + [i['id'] for l in cat['owasp'] for i in l['items']]
        self.assertEqual(len(tiles), len(set(tiles)))
        for tid in tiles:
            d = aisec.record(tid, full=True)
            self.assertTrue(d['sources'], tid)
            self.assertTrue(all(s['url'].startswith('https://') for s in d['sources']), tid)
            self.assertTrue(d['url'].startswith('https://'), tid)
            self.assertTrue(d['summary'], tid)

    def test_crosswalk_points_at_real_techniques_both_ways(self):
        for item in aisec.OWASP_ITEMS.values():
            for tid in item['atlas']:
                self.assertIn(tid, aisec.ATLAS['techniques'])
                self.assertIn(item['id'], aisec.record(tid)['refs'])
        self.assertIn('LLM01', aisec.record('AML.T0051.001')['refs'])  # inherited from the parent technique
        self.assertEqual(aisec.record('ASI01')['framework'], 'owasp-agentic')

    def test_unknown_technique_is_404(self):
        with self.assertRaises(Problem) as e:
            aisec.record('AML.T9999', full=True)
        self.assertEqual(e.exception.status, 404)

    def test_versions_report_every_taxonomy(self):
        v = {x['id']: x for x in aisec.versions()}
        self.assertEqual(set(v), {'atlas', 'owasp-llm', 'owasp-agentic'})
        self.assertEqual(v['owasp-llm']['version'], '2025')


class AiSecWorkspaceTests(LabFixture):
    def test_socharness_is_workspace_one_with_operator_as_lead(self):
        ws = aisec.workspaces(self.store.db)['workspaces']
        self.assertEqual(ws[0]['id'], 'socharness')
        self.assertEqual(ws[0]['members'], [{'member': 'operator', 'role': 'lead_researcher', 'added_at': ws[0]['members'][0]['added_at']}])
        aisec.install(self.store.db)  # idempotent
        self.assertEqual(len(aisec.workspaces(self.store.db)['workspaces']), 1)

    def test_create_workspace_and_assign_roles(self):
        w = aisec.create_workspace(self.store.db, {'name': 'Acme Bank', 'kind': 'client', 'sector': 'financial_services'})
        self.assertEqual((w['id'], w['kind'], w['sector']), ('acme-bank', 'client', 'financial_services'))
        w2 = aisec.create_workspace(self.store.db, {'name': 'Acme Bank'})
        self.assertNotEqual(w2['id'], w['id'])
        w = aisec.set_member(self.store.db, {'workspace': 'acme-bank', 'member': 'vendor@example.com', 'role': 'vendor_guest'})
        self.assertIn({'member': 'vendor@example.com', 'role': 'vendor_guest'}, [{k: m[k] for k in ('member', 'role')} for m in w['members']])
        w = aisec.set_member(self.store.db, {'workspace': 'acme-bank', 'member': 'vendor@example.com', 'role': None})
        self.assertEqual([m['member'] for m in w['members']], ['operator'])
        for bad in ({'name': ''}, {'name': 'x', 'kind': 'lab'}, {'name': 'x', 'sector': 'mars'}, {'name': 'a\nb'}):
            with self.assertRaises(Problem):
                aisec.create_workspace(self.store.db, bad)
        with self.assertRaises(Problem):
            aisec.set_member(self.store.db, {'workspace': 'acme-bank', 'member': 'operator', 'role': 'executive'})
        with self.assertRaises(Problem):
            aisec.set_member(self.store.db, {'workspace': 'acme-bank', 'member': 'x', 'role': 'admin'})

    def test_tracked_techniques_are_scoped_to_a_workspace(self):
        aisec.create_workspace(self.store.db, {'name': 'Other Co'})
        aisec.track(self.store.db, {'workspace': 'socharness', 'technique': 'AML.T0051', 'note': 'TG-10 covers this'})
        aisec.track(self.store.db, {'workspace': 'socharness', 'technique': 'ASI02'})
        aisec.track(self.store.db, {'workspace': 'socharness', 'technique': 'AML.T0051', 'note': 'updated'})
        mine = aisec.tracked(self.store.db, 'socharness')['tracked']
        self.assertEqual({t['id']: t['note'] for t in mine}, {'AML.T0051': 'updated', 'ASI02': ''})
        self.assertEqual(aisec.tracked(self.store.db, 'other-co')['tracked'], [])
        aisec.track(self.store.db, {'workspace': 'socharness', 'technique': 'ASI02', 'tracked': False})
        self.assertEqual([t['id'] for t in aisec.tracked(self.store.db, 'socharness')['tracked']], ['AML.T0051'])
        with self.assertRaises(Problem):
            aisec.track(self.store.db, {'workspace': 'socharness', 'technique': 'NOPE'})
        with self.assertRaises(Problem):
            aisec.track(self.store.db, {'workspace': 'missing', 'technique': 'ASI02'})

    def test_role_permissions(self):
        self.assertTrue(aisec.can('lead_researcher', 'manage_workspace'))
        self.assertFalse(aisec.can('vendor_guest', 'view_threats'))
        self.assertFalse(aisec.can('executive', 'run_tests'))
        self.assertFalse(aisec.can('nobody', 'view_threats'))
        for role in aisec.ROLES.values():
            self.assertTrue(set(role['can']) <= set(aisec.ACTIONS))


class AiSecHttpTests(LabFixture):
    def test_routes_and_origin_guard(self):
        import threading, urllib.request, urllib.error
        from http.server import ThreadingHTTPServer
        from unittest.mock import patch
        from store import Store
        from app import Handler
        dbpath = self.path
        with patch('app.Store', lambda: Store(dbpath)):
            server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            threading.Thread(target=server.serve_forever, daemon=True).start()
            base = 'http://127.0.0.1:' + str(server.server_port)

            def request(path, data=None, headers=None):
                req = urllib.request.Request(base + path, data=None if data is None else json.dumps(data).encode(),
                                             headers=headers or {'Content-Type': 'application/json'})
                with urllib.request.urlopen(req) as r:
                    return r.status, json.load(r)
            try:
                status, cat = request('/api/aisec')
                self.assertEqual(cat['counts']['tactics'], 16)
                status, d = request('/api/aisec/technique?id=LLM01')
                self.assertEqual(d['name'], 'Prompt Injection')
                status, w = request('/api/aisec/workspaces', {'name': 'Acme Health', 'sector': 'healthcare'})
                self.assertEqual((status, w['id']), (201, 'acme-health'))
                status, t = request('/api/aisec/track', {'workspace': 'acme-health', 'technique': 'AML.T0051'})
                self.assertEqual([x['id'] for x in t['tracked']], ['AML.T0051'])
                status, t = request('/api/aisec/tracked?workspace=socharness')
                self.assertEqual(t['tracked'], [])
                for path, body, headers, code in [
                        ('/api/aisec/technique?id=nope', None, None, 404),
                        ('/api/aisec/tracked?workspace=nope', None, None, 404),
                        ('/api/aisec/workspaces', {'name': 'X'}, {'Content-Type': 'application/json', 'Origin': 'https://evil.example'}, 403)]:
                    with self.assertRaises(urllib.error.HTTPError) as cm:
                        request(path, body, headers)
                    self.assertEqual(cm.exception.code, code, path)
            finally:
                server.shutdown(); server.server_close()
