import json
from test_lab import LabFixture
from store import Problem
import aisec
from aisec import bom, threatmodel


def accept_all(db, ws, app_id, reject=()):
    m = threatmodel.generate(db, {'workspace': ws, 'app': app_id})
    for p in m['proposals']:
        threatmodel.decide(db, {'workspace': ws, 'app': app_id, 'key': p['key'],
                                'decision': 'rejected' if p['technique'] in reject else 'accepted', 'note': 'reviewed'})
    return threatmodel.accept(db, {'workspace': ws, 'app': app_id})


class InventoryTests(LabFixture):
    def test_socharness_describes_itself(self):
        r = bom.import_socharness(self.store.db, 'socharness')
        inv = bom.inventory(self.store.db, 'socharness')
        c = inv['counts']
        self.assertEqual(c['framework'], 11)
        self.assertGreaterEqual(c['model'], 4)
        self.assertGreaterEqual(c['tool'], 10)
        self.assertEqual({a['name'] for a in inv['assets'] if a['type'] == 'vendor'} >= {'OpenAI', 'Anthropic', 'Google'}, True)
        self.assertEqual([a['id'] for a in inv['applications']], ['app-socharness'])
        app = inv['applications'][0]
        evidence = next(i for i in app['inputs'] if i['id'] == 'in-evidence')
        self.assertFalse(evidence['trusted'])
        self.assertTrue(all(a['approval'] for a in app['actions'] if a['effect'] == 'write'))
        again = bom.import_socharness(self.store.db, 'socharness')  # idempotent
        self.assertEqual(again['assets_added'], 0)
        self.assertEqual(len(bom.assets(self.store.db, 'socharness')), r['assets_added'])

    def test_sample_imports_into_its_own_workspace(self):
        r = bom.import_sample(self.store.db)
        ws = r['workspace']
        self.assertTrue(ws.startswith('ridgeway-savings-bank'))
        inv = bom.inventory(self.store.db, ws)
        self.assertEqual(len(inv['applications']), 3)
        self.assertEqual(inv['profile']['risk_appetite'], 'low')
        self.assertIn('Brightline CRM (fictional)', {a['name'] for a in inv['assets'] if a['type'] == 'vendor'})
        self.assertEqual(bom.inventory(self.store.db, 'socharness')['assets'], [])  # scoped

    def test_cyclonedx_export_round_trips(self):
        ws = bom.import_sample(self.store.db)['workspace']
        doc = bom.export_cyclonedx(self.store.db, ws)
        self.assertEqual((doc['bomFormat'], doc['specVersion']), ('CycloneDX', '1.6'))
        types = {c['type'] for c in doc['components']}
        self.assertTrue({'machine-learning-model', 'library', 'data', 'application'} <= types)
        self.assertTrue(any(s['bom-ref'] == 'mcp-crm' for s in doc['services']))
        aisec.create_workspace(self.store.db, {'name': 'Copy'})
        bom.import_file(self.store.db, {'workspace': 'copy', 'text': json.dumps(doc)})
        strip = lambda items: sorted((a['id'], a['type'], a['name'], a['vendor'], a.get('classification'), a.get('hosting'), tuple(a['uses'])) for a in items)
        self.assertEqual(strip(bom.assets(self.store.db, 'copy')), strip(bom.assets(self.store.db, ws)))
        drop = lambda apps: sorted(json.dumps({k: v for k, v in a.items() if k != 'threat_model'}, sort_keys=True) for a in apps)
        self.assertEqual(drop(bom.applications(self.store.db, 'copy')), drop(bom.applications(self.store.db, ws)))

    def test_spdx_and_bad_files(self):
        spdx = {'spdxVersion': 'SPDX-2.3', 'packages': [
            {'SPDXID': 'SPDXRef-app', 'name': 'chat-app', 'primaryPackagePurpose': 'APPLICATION', 'supplier': 'Organization: Acme'},
            {'SPDXID': 'SPDXRef-lc', 'name': 'langchain', 'versionInfo': '0.3.0', 'supplier': 'NOASSERTION',
             'externalRefs': [{'referenceType': 'purl', 'referenceLocator': 'pkg:pypi/langchain@0.3.0'}]}],
            'relationships': [{'spdxElementId': 'SPDXRef-app', 'relationshipType': 'DEPENDS_ON', 'relatedSpdxElement': 'SPDXRef-lc'}]}
        r = bom.import_file(self.store.db, {'workspace': 'socharness', 'text': json.dumps(spdx)})
        self.assertEqual((r['source'], r['assets_added']), ('spdx', 2))
        app = next(a for a in bom.assets(self.store.db, 'socharness') if a['id'] == 'SPDXRef-app')
        self.assertEqual((app['type'], app['vendor'], app['uses']), ('agent', 'Acme', ['SPDXRef-lc']))
        for text in ('', 'not json', '[1]', '{"hello": 1}', '{"spdxVersion": "SPDX-3.0"}'):
            with self.assertRaises(Problem):
                bom.import_file(self.store.db, {'workspace': 'socharness', 'text': text})

    def test_profile_and_validation(self):
        p = bom.set_profile(self.store.db, {'workspace': 'socharness', 'profile': {
            'sector': 'technology', 'regulators': ['ISO/IEC 42001'], 'risk_appetite': 'moderate',
            'tiers': {'1': 'a', '2': 'b', '3': 'c'}, 'retest_days': {'critical': 5, 'high': 20, 'medium': 60, 'low': 90}}})
        self.assertEqual(p['retest_days']['critical'], 5)
        for bad in ({'risk_appetite': 'yolo'}, {'retest_days': {'critical': 0, 'high': 1, 'medium': 1, 'low': 1}},
                    {'tiers': {'1': 'x'}}, {'sector': 'mars'}):
            with self.assertRaises(Problem):
                bom.set_profile(self.store.db, {'workspace': 'socharness', 'profile': bad})
        with self.assertRaises(Problem):
            bom.save_application(self.store.db, {'workspace': 'socharness', 'application': {'name': 'x', 'autonomy': 9}})
        with self.assertRaises(Problem):
            bom.save_asset(self.store.db, {'workspace': 'socharness', 'asset': {'name': 'x', 'type': 'spaceship'}})

    def test_deleting_an_asset_unlinks_it(self):
        bom.import_sample(self.store.db)
        ws = 'ridgeway-savings-bank-sample'
        bom.delete_asset(self.store.db, {'workspace': ws, 'id': 'mcp-crm'})
        app = next(a for a in bom.applications(self.store.db, ws) if a['id'] == 'app-support')
        self.assertNotIn('mcp-crm', app['assets'])
        self.assertNotIn('mcp-crm', next(a for a in bom.assets(self.store.db, ws) if a['id'] == 'agent-support')['uses'])


class ThreatModelTests(LabFixture):
    def test_every_proposal_names_a_real_technique(self):
        ws = bom.import_sample(self.store.db)['workspace']
        bom.import_socharness(self.store.db, 'socharness')
        for w in (ws, 'socharness'):
            for app in bom.applications(self.store.db, w):
                m = threatmodel.generate(self.store.db, {'workspace': w, 'app': app['id']})
                self.assertTrue(m['proposals'], app['id'])
                for p in m['proposals']:
                    aisec.record(p['technique'])
                    self.assertTrue(p['rationale'])

    def test_rules_follow_the_profile(self):
        ws = bom.import_sample(self.store.db)['workspace']
        m = threatmodel.generate(self.store.db, {'workspace': ws, 'app': 'app-support'})
        got = {(p['technique'], p['surface']['id']) for p in m['proposals']}
        for want in [('AML.T0051.001', 'in-email'), ('ASI01', 'in-email'), ('AML.T0070', 'in-retrieval'), ('AML.T0086', 'act-email'),
                     ('LLM06', 'act-email'), ('ASI09', 'act-refund'), ('AML.T0110', 'mcp-crm'), ('AML.T0056', 'prompt-support'),
                     ('AML.T0057', 'app-support'), ('AML.T0034', 'in-chat')]:
            self.assertIn(want, got)
        self.assertIn(('AML.T0053', 'act-lookup'), got)  # reads through a tool still count
        fraud = {p['technique'] for p in threatmodel.generate(self.store.db, {'workspace': ws, 'app': 'app-fraud'})['proposals']}
        self.assertTrue({'AML.T0015', 'AML.T0020', 'AML.T0024.002'} <= fraud)
        self.assertFalse(any(t.startswith('AML.T0051') for t in fraud))  # no prompt injection for a predictive model

    def test_accept_lifecycle_and_staleness(self):
        ws = bom.import_sample(self.store.db)['workspace']
        m = threatmodel.generate(self.store.db, {'workspace': ws, 'app': 'app-code'})
        with self.assertRaises(Problem):
            threatmodel.accept(self.store.db, {'workspace': ws, 'app': 'app-code'})
        m = accept_all(self.store.db, ws, 'app-code', reject={'LLM09'})
        self.assertEqual(m['summary']['status'], 'accepted')
        self.assertEqual(m['summary']['undecided'], 0)
        regen = threatmodel.generate(self.store.db, {'workspace': ws, 'app': 'app-code'})
        self.assertEqual(regen['summary']['status'], 'accepted')  # nothing changed, decisions kept
        app = next(a for a in bom.applications(self.store.db, ws) if a['id'] == 'app-code')
        app = {k: v for k, v in app.items() if k != 'threat_model'}
        app['autonomy'] = 4
        bom.save_application(self.store.db, {'workspace': ws, 'application': app})
        self.assertEqual(threatmodel.get(self.store.db, ws, 'app-code')['summary']['status'], 'stale')
        with self.assertRaises(Problem):
            threatmodel.accept(self.store.db, {'workspace': ws, 'app': 'app-code'})
        regen = threatmodel.generate(self.store.db, {'workspace': ws, 'app': 'app-code'})
        self.assertEqual(regen['summary']['status'], 'draft')
        self.assertEqual([p['technique'] for p in regen['proposals'] if p['decision'] is None], ['ASI10'])
        self.assertIn('AML.T0050', threatmodel.techniques_in_models(self.store.db, ws))

    def test_phase1_gate_two_enterprises_with_accepted_models(self):
        bom.import_socharness(self.store.db, 'socharness')
        ws = bom.import_sample(self.store.db)['workspace']
        self.assertEqual(accept_all(self.store.db, 'socharness', 'app-socharness')['summary']['status'], 'accepted')
        for app in bom.applications(self.store.db, ws):
            self.assertEqual(accept_all(self.store.db, ws, app['id'])['summary']['status'], 'accepted')
        for w in ('socharness', ws):
            self.assertTrue(all(a['threat_model']['status'] == 'accepted' for a in bom.applications(self.store.db, w)))


class InventoryHttpTests(LabFixture):
    def test_import_route_accepts_large_files_only_there(self):
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

            def request(path, data=None):
                req = urllib.request.Request(base + path, data=None if data is None else json.dumps(data).encode(),
                                             headers={'Content-Type': 'application/json'})
                with urllib.request.urlopen(req) as r:
                    return json.load(r)
            try:
                big = bom.SAMPLE.read_text(encoding='utf-8') + ' ' * 40000
                r = request('/api/aisec/import', {'workspace': 'socharness', 'text': big})
                self.assertEqual(r['applications'], 3)
                inv = request('/api/aisec/inventory?workspace=socharness')
                self.assertIn('enums', inv)
                m = request('/api/aisec/threat-model', {'workspace': 'socharness', 'app': 'app-fraud', 'action': 'generate'})
                self.assertTrue(m['proposals'])
                self.assertEqual(request('/api/aisec/threat-model?workspace=socharness&app=app-fraud')['summary']['status'], 'draft')
                self.assertEqual(request('/api/aisec/export?workspace=socharness')['bomFormat'], 'CycloneDX')
                with self.assertRaises(urllib.error.HTTPError) as cm:
                    request('/api/aisec/profile', {'workspace': 'socharness', 'profile': {'appetite_note': 'x' * 40000}})
                self.assertEqual(cm.exception.code, 413)
                with self.assertRaises(urllib.error.HTTPError) as cm:
                    request('/api/aisec/nope', {'workspace': 'socharness'})
                self.assertEqual(cm.exception.code, 404)
            finally:
                server.shutdown(); server.server_close()
