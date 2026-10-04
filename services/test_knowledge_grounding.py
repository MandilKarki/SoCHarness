import json
from test_lab import LabFixture
from engine import Engine
from store import Problem
import grounding
import knowledge
import test_ground


class GroundingTests(LabFixture):
    def test_historical_baseline_without_baseline_is_flagged(self):
        r = grounding.review('The logon is within the normal range for this host. Record #5 shows one logon.',
                             [{'id': 5, 'raw': {'EventID': 4624}}], [5])
        self.assertEqual([c['status'] for c in r['claims']], ['flagged', 'cited'])
        self.assertEqual(r['issues'][0]['code'], 'unsupported_historical_baseline')
        ok = grounding.review('The logon is within the normal range for this host.',
                              [{'id': 5, 'raw': {'baseline': {'window': '30d', 'sample_count': 40}}}], [5])
        self.assertEqual(ok['claims'][0]['status'], 'unchecked')

    def test_missing_mfa_and_negation(self):
        records = [{'id': 1, 'raw': {'detail': 'MFA status is unavailable for this sign-in'}}]
        self.assertEqual(grounding.review('The attacker bypassed MFA.', records, [1])['claims'][0]['status'], 'flagged')
        self.assertEqual(grounding.review('Missing data does not establish that MFA was bypassed.', records, [1])['claims'][0]['status'], 'unchecked')

    def test_missing_sensor_is_not_safety(self):
        records = [{'id': 9, 'raw': {'healthy': False, 'signal': 'sensor_unavailable'}}]
        self.assertEqual(grounding.review('The activity appears benign.', records, [9])['claims'][0]['status'], 'flagged')
        self.assertEqual(grounding.review('The evidence is insufficient to call it benign.', records, [9])['claims'][0]['status'], 'unchecked')
        self.assertEqual(grounding.review('The activity appears benign.', [{'id': 9, 'raw': {'healthy': True}}], [9])['claims'][0]['status'], 'unchecked')

    def test_citations_must_have_been_returned(self):
        r = grounding.review('See record 12 and #13. Event 4625 is a failed logon.', [{'id': 12}], [12])
        self.assertEqual(r['claims'][0]['status'], 'unseen')
        self.assertEqual(r['claims'][0]['unseen'], [13])
        self.assertEqual(r['claims'][1]['status'], 'unchecked')  # Windows event IDs are not record citations

    def test_grade_flags_unsupported_claims(self):
        run = [{'kind': 'message.user', 'payload': {}},
               {'kind': 'tool.result', 'payload': {'tool': 'query_case_evidence', 'result': {'items': [
                   {'id': 9000300, 'raw': {'healthy': False, 'signal': 'sensor_unavailable'}}]}}},
               {'kind': 'message.assistant', 'payload': {'text': 'The activity appears benign.\nVerdict: benign\nResponse required: no'}},
               {'kind': 'run.completed', 'payload': {}}]
        g = test_ground.grade_run('TG-03', run)
        self.assertIn('unsupported_claim', g['flags'])
        self.assertEqual(g['read_ids'], [9000300])


class KnowledgeTests(LabFixture):
    def test_playbook_logic_reproduces_every_answer_key(self):
        expected = {'malicious': 'act', 'benign': 'allow', 'unknown': 'insufficient'}
        for cid, s in test_ground.SCENARIOS.items():
            self.assertEqual(knowledge.decide(s['playbook'], s['observations'])[0], expected[s['truth']['verdict']], cid)

    def test_dfiq_links_resolve_and_licence_ships(self):
        self.assertEqual(knowledge.DFIQ['source']['license'], 'Apache-2.0')
        self.assertTrue((knowledge.HERE/'dfiq'/'LICENSE').exists())
        for key in list(knowledge.LINKS) + list(test_ground.SCENARIOS):
            tree = knowledge.questions_for(key)
            self.assertTrue(tree['facets'], key)
            for f in tree['facets']:
                self.assertTrue(f['questions'])
        self.assertIsNone(knowledge.questions_for('nope'))

    def test_get_playbook_serves_ported_playbooks_and_questions(self):
        from advanced import Advanced
        sid = self.store.create('IR-2839', {'skills': True})['id']
        tool = Advanced(self.store, sid)
        pb = tool.execute('get_playbook', {'name': 'network-beacon'})
        self.assertEqual(pb['operation'], 'block_destination')
        dq = tool.execute('get_playbook', {'name': 'investigative-questions'})
        self.assertIn('What files are referenced in Registry "Run" keys?', dq['steps'])
        self.assertNotIn('truth', json.dumps(dq))
        with self.assertRaises(Problem):
            tool.execute('get_playbook', {'name': 'account_compromise'})  # only the published names
