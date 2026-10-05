import json
from datetime import date
from test_lab import LabFixture
from store import Problem
import aisec
from aisec import bom, threatmodel, intel


class IntelTests(LabFixture):
    def bank(self):
        return bom.import_sample(self.store.db)['workspace']

    def test_cards_are_scored_with_reasons(self):
        ws = self.bank()
        cards = {c['id']: c for c in intel.relevance(self.store.db, ws, date(2026, 10, 4))}
        self.assertEqual(len(cards), len(intel.CARDS))
        ind = cards['indirect-injection']
        self.assertEqual((ind['exposure'], ind['likelihood'], ind['band']), (6, 3, 'high'))
        self.assertTrue(ind['apps'][0]['direct'])
        self.assertEqual(cards['tool-supply-chain']['exposure'], 3)  # an asset-level surface is only indirect
        self.assertIn('Customer support assistant', [a['name'] for a in ind['apps']])
        self.assertTrue(all(isinstance(r, str) and r for r in ind['reasons']))
        self.assertEqual(cards['adversarial-evasion']['apps'][0]['name'], 'Card fraud scoring')
        self.assertEqual(cards['multi-agent']['band'], 'none')  # no agent-to-agent inputs at the bank
        empty = intel.relevance(self.store.db, 'socharness')
        self.assertTrue(all(c['band'] == 'none' for c in empty))

    def test_appetite_sector_and_rejections_move_the_score(self):
        ws = self.bank()
        base = {c['id']: c for c in intel.relevance(self.store.db, ws)}
        self.assertTrue(any('priority threat for financial services' in r for r in base['tool-exfiltration']['reasons']))
        p = bom.profile(self.store.db, ws)
        bom.set_profile(self.store.db, {'workspace': ws, 'profile': {**p, 'risk_appetite': 'high'}})
        loose = {c['id']: c for c in intel.relevance(self.store.db, ws)}
        self.assertLessEqual(sum(c['band'] == 'high' for c in loose.values()), sum(c['band'] == 'high' for c in base.values()))
        m = threatmodel.generate(self.store.db, {'workspace': ws, 'app': 'app-fraud'})
        for pr in m['proposals']:
            if pr['technique'] == 'AML.T0015':
                threatmodel.decide(self.store.db, {'workspace': ws, 'app': 'app-fraud', 'key': pr['key'], 'decision': 'rejected', 'note': 'x'})
        after = {c['id']: c for c in intel.relevance(self.store.db, ws)}
        self.assertEqual(after['adversarial-evasion']['exposure'], 0)
        self.assertTrue(after['adversarial-evasion']['apps'][0]['excluded'])

    def test_feed_merges_sources_and_marks_relevance(self):
        ws = self.bank()
        cards = intel.relevance(self.store.db, ws)
        items = intel.feed(self.store.db, ws, cards)
        kinds = {i['kind'] for i in items}
        self.assertTrue({'regulator', 'standard', 'research', 'atlas_release', 'atlas_case_study'} <= kinds)
        self.assertEqual(sum(i['kind'] == 'atlas_case_study' for i in items), len(aisec.ATLAS['case_studies']))
        self.assertTrue(any(i['relevant'] for i in items))
        dated = [i['published'] for i in items if i.get('published')]
        self.assertEqual(dated, sorted(dated, reverse=True))
        it = intel.add_item(self.store.db, {'workspace': ws, 'item': {'title': 'Vendor report', 'url': 'https://example.com/r',
                                                                     'published': '2026-10', 'kind': 'vendor', 'techniques': ['AML.T0051.001']}})
        self.assertTrue(next(i for i in intel.feed(self.store.db, ws, cards) if i['id'] == it['id'])['relevant'])
        for bad in ({'title': 'x', 'url': 'http://x', 'published': '2026-10'}, {'title': 'x', 'url': 'https://x', 'published': 'Oct'},
                    {'title': 'x', 'url': 'https://x', 'published': '2026-10', 'techniques': ['NOPE']}):
            with self.assertRaises(Problem):
                intel.add_item(self.store.db, {'workspace': ws, 'item': bad})
        self.assertEqual(intel.feed(self.store.db, 'socharness', cards)[0]['id'] != it['id'], True)  # manual items are scoped

    def test_advisories_from_the_bill_of_materials(self):
        ws = self.bank()
        calls = []

        def fake(path, payload=None):
            calls.append(path)
            if path == '/querybatch':
                return {'results': [{'vulns': [{'id': 'GHSA-test-0001'}]} if 'langchain' in q['package']['purl'] else {}
                                    for q in payload['queries']]}
            return {'id': 'GHSA-test-0001', 'summary': 'Example issue', 'aliases': ['CVE-2099-0001'], 'published': '2026-09-01T00:00:00Z'}
        r = intel.check_advisories(self.store.db, {'workspace': ws}, call=fake)
        self.assertEqual((r['checked'], r['found']), (3, 1))
        self.assertEqual(r['items'][0]['assets'], ['langchain-core'])
        adv = [i for i in intel.feed(self.store.db, ws, intel.relevance(self.store.db, ws)) if i['kind'] == 'advisory']
        self.assertEqual(adv[0]['url'], 'https://osv.dev/vulnerability/GHSA-test-0001')

        def down(path, payload=None):
            raise OSError('blocked')
        with self.assertRaises(Problem) as e:
            intel.check_advisories(self.store.db, {'workspace': ws}, call=down)
        self.assertEqual(e.exception.status, 502)
        self.assertEqual(intel.check_advisories(self.store.db, {'workspace': 'socharness'}, call=down)['checked'], 0)

    def test_register_residual_follows_controls(self):
        ws = self.bank()
        reg = intel.register(self.store.db, ws)
        self.assertTrue(reg[0]['priority'])  # sector priorities first
        r = intel.save_register(self.store.db, {'workspace': ws, 'id': 'deepfake-payment', 'likelihood': 3, 'impact': 4,
                                                'controls': {'callback': 'in_place', 'dual': 'in_place', 'training': 'planned'}})
        self.assertEqual((r['inherent'], r['residual_likelihood'], r['residual_impact'], r['residual']), (12, 2, 3, 6))
        self.assertEqual((r['inherent_band'], r['residual_band']), ('high', 'medium'))
        for bad in ({'likelihood': 5, 'impact': 1}, {'likelihood': 1, 'impact': 1, 'controls': {'nope': 'in_place'}},
                    {'likelihood': 1, 'impact': 1, 'controls': {'callback': 'maybe'}}):
            with self.assertRaises(Problem):
                intel.save_register(self.store.db, {'workspace': ws, 'id': 'deepfake-payment', **bad})

    def test_phase2_gate_snapshot_and_coverage(self):
        ws = self.bank()
        s = intel.snapshot(self.store.db, {'workspace': ws}, today=date(2026, 10, 4))
        self.assertEqual(s['month'], '2026-10')
        self.assertFalse(s['coverage']['ok'])  # high threats with no test yet
        for cid in s['coverage']['uncovered']:
            intel.open_gap(self.store.db, {'workspace': ws, 'card': cid, 'note': 'No automated test yet', 'owner': 'Lab'})
        s = intel.snapshot(self.store.db, {'workspace': ws, 'month': '2026-10'}, today=date(2026, 10, 4))
        self.assertTrue(s['coverage']['ok'])
        self.assertTrue(all(c['coverage'] in ('tested', 'gap') for c in s['cards'] if c['band'] == 'high'))
        self.assertIn('# AI threat landscape', s['markdown'])
        self.assertIn('| Indirect prompt injection | high |', s['markdown'])
        self.assertEqual([x['month'] for x in intel.snapshots(self.store.db, ws)], ['2026-10'])
        self.assertEqual(intel.get_snapshot(self.store.db, ws, '2026-10')['coverage']['ok'], True)
        g = intel.close_gap(self.store.db, {'workspace': ws, 'card': s['coverage']['uncovered'][0] if s['coverage']['uncovered'] else
                                            next(c['id'] for c in s['cards'] if c['coverage'] == 'gap'), 'resolution': 'Pack added'})
        self.assertEqual(g['status'], 'closed')
        with self.assertRaises(Problem):
            intel.snapshot(self.store.db, {'workspace': ws, 'month': '2026-13'})
        with self.assertRaises(Problem):
            intel.open_gap(self.store.db, {'workspace': ws, 'card': 'nope', 'note': 'x'})

    def test_overview_shape(self):
        ws = self.bank()
        o = intel.overview(self.store.db, ws)
        self.assertEqual(o['sector']['label'], 'Financial services')
        self.assertEqual(len(o['heatmap']['cols']), 3)
        self.assertEqual(len(o['heatmap']['rows']), len(intel.CARDS))
        cell = o['heatmap']['cells']['indirect-injection']['app-support']
        self.assertEqual(cell['weight'], 3)


class IntelHttpTests(LabFixture):
    def test_routes(self):
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
                ws = request('/api/aisec/import', {'sample': True})['workspace']
                o = request('/api/aisec/intel?workspace=' + ws)
                self.assertEqual(len(o['cards']), len(intel.CARDS))
                g = request('/api/aisec/intel/gap', {'workspace': ws, 'card': 'rag-poisoning', 'note': 'Phase 3 pack'})
                self.assertEqual(g['status'], 'open')
                r = request('/api/aisec/intel/register', {'workspace': ws, 'id': 'ai-phishing', 'likelihood': 4, 'impact': 2, 'controls': {'fido': 'in_place'}})
                self.assertEqual(r['residual'], 4)
                s = request('/api/aisec/intel/snapshot', {'workspace': ws, 'month': '2026-10'})
                self.assertEqual(request(f'/api/aisec/snapshot?workspace={ws}&month=2026-10')['month'], s['month'])
                with self.assertRaises(urllib.error.HTTPError) as cm:
                    request(f'/api/aisec/snapshot?workspace={ws}&month=2020-01')
                self.assertEqual(cm.exception.code, 404)
            finally:
                server.shutdown(); server.server_close()
