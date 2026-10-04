"""Investigation knowledge ported from Defense Collective.

* Three incident playbooks (account compromise, network beaconing, endpoint
  containment): the decision logic behind the labelled test-ground cases.
* DFIQ (Google's Digital Forensics Investigative Questions, Apache-2.0, bundled
  unmodified as JSON with its licence) linked to SoCHarness evidence collections.
  Links are curated by hand: each names the DFIQ facet and questions closest to
  what the collection's records can answer, with the reason.
"""
import json
from pathlib import Path

HERE = Path(__file__).parent
DFIQ = json.loads((HERE/'dfiq'/'dfiq.json').read_text(encoding='utf-8'))
QUESTIONS = {q['id']: q for q in DFIQ['questions']}
FACETS = {f['id']: f for f in DFIQ['facets']}
SCENARIOS = {s['id']: s for s in DFIQ['scenarios']}

# Defense Collective playbooks/<id>.json at 5a3dced (decision fields unchanged).
PLAYBOOKS = {
    'account_compromise': {'title': 'Suspected account compromise', 'required_domains': ['identity', 'cloud'],
                           'response_signals': ['session_reuse', 'unexpected_privilege_change'],
                           'benign_signals': ['known_vpn', 'approved_identity_change'], 'operation': 'revoke_session',
                           'model_call_budget': 12},
    'network_beacon': {'title': 'Suspected network beaconing', 'required_domains': ['network', 'asset'],
                       'response_signals': ['periodic_external_connection', 'unapproved_destination'],
                       'benign_signals': ['approved_monitoring'], 'operation': 'block_destination', 'model_call_budget': 12},
    'endpoint_containment': {'title': 'Suspicious endpoint egress', 'required_domains': ['endpoint', 'network'],
                             'response_signals': ['suspicious_process', 'unexpected_egress'],
                             'benign_signals': ['signed_admin_job'], 'operation': 'isolate_host', 'model_call_budget': 12},
}
PLAYBOOK_STEPS = ['triage', 'specialists', 'investigate', 'critique', 'propose', 'authorize', 'execute', 'verify', 'report']


def decide(playbook_id, observations):
    """Defense Collective's playbook logic, made explicit. Returns (decision, reason)."""
    p = PLAYBOOKS[playbook_id]
    signals = {o['signal'] for o in observations}
    unhealthy = [o for o in observations if not o.get('healthy', True) and o.get('domain') in p['required_domains']]
    if unhealthy:
        return 'insufficient', 'A required domain (' + ', '.join(sorted({o['domain'] for o in unhealthy})) + ') returned no usable data.'
    act = [s for s in p['response_signals'] if s in signals]
    fine = [s for s in p['benign_signals'] if s in signals]
    if act and fine:
        return 'insufficient', 'Response signals and an explaining benign signal are both present; reconcile before acting.'
    if len(act) == len(p['response_signals']):
        return 'act', 'All response signals are present: ' + p['operation'].replace('_', ' ') + '.'
    if fine:
        return 'allow', 'Benign context explains the activity; no response.'
    if act:
        return 'insufficient', 'Only some response signals are present.'
    return 'insufficient', 'None of the playbook signals are present.'


def playbook_text(playbook_id):
    """Analyst-readable form for the get_playbook tool."""
    p = PLAYBOOKS[playbook_id]
    return {'title': p['title'] + ' (Defense Collective)', 'steps': [
        'Check every required domain: ' + ', '.join(p['required_domains']) + '. If one is missing or unhealthy, report insufficient evidence; missing data is not safety.',
        'Response signals: ' + ', '.join(p['response_signals']) + '. All present supports acting.',
        'Benign signals that can explain the activity: ' + ', '.join(p['benign_signals']) + '. If present alongside response signals, reconcile first.',
        'Proposed operation when warranted: ' + p['operation'] + '. Propose it; never claim it was executed without an approval receipt.',
        'Budget: ' + str(p['model_call_budget']) + ' model calls. Stages: ' + ' → '.join(PLAYBOOK_STEPS) + '.'],
        **{k: p[k] for k in ('required_domains', 'response_signals', 'benign_signals', 'operation')}}


def _link(scenario, why, facets):
    return {'scenario': scenario, 'why': why, 'facets': [{'id': f, 'questions': qs} for f, qs in facets]}


LINKS = {
    'IR-2841': _link('S1008', 'Authentication records show who logged on where. DFIQ\'s lateral-movement facets ask whether those logons are an attacker moving between hosts.',
                     [('F1028', ['Q1037']), ('F1027', ['Q1036']), ('F1021', ['Q1058', 'Q1059'])]),
    'IR-2840': _link('S1008', 'Process and script records can show remote execution tools, tampering and anti-forensic programs.',
                     [('F1027', ['Q1036']), ('F1007', ['Q1028', 'Q1029', 'Q1030']), ('F1012', ['Q1008'])]),
    'IR-2839': _link('S1007', 'Registry, scheduled-task and service records are the raw material of DFIQ\'s host persistence audit.',
                     [('F1023', ['Q1065', 'Q1066']), ('F1022', ['Q1061']), ('F1024', ['Q1067', 'Q1068']), ('F1020', ['Q1055', 'Q1057'])]),
    'IR-2838': _link('S1001', 'Cross-process access is how security agents get tampered with and logs get cleared.',
                     [('F1007', ['Q1030', 'Q1074'])]),
    'IR-2837': _link('S1003', 'Connection and DNS records answer DFIQ\'s suspicious-DNS questions: which process asked, and was it a browser.',
                     [('F1004', ['Q1018', 'Q1073']), ('F1005', ['Q1019', 'Q1072']), ('F1029', ['Q1085']), ('F1002', ['Q1031'])]),
    'IR-2836': _link('S1007', 'Account creation and privilege assignment records map to DFIQ\'s new-account and persistence questions.',
                     [('F1021', ['Q1058', 'Q1059']), ('F1014', ['Q1045', 'Q1046'])]),
    'IR-2835': _link('S1001', 'File and system records can show staging, copying and log clearing before exfiltration.',
                     [('F1008', ['Q1017', 'Q1035']), ('F1007', ['Q1074', 'Q1033']), ('F1001', ['Q1027'])]),
    'identity': _link('S1005', 'Identity and cloud-control-plane signals map to DFIQ\'s cloud compromise assessment.',
                      [('F1013', ['Q1040', 'Q1041']), ('F1014', ['Q1046', 'Q1045']), ('F1015', ['Q1048'])]),
    'network': _link('S1003', 'Periodic external connections raise DFIQ\'s DNS and external-communication questions.',
                     [('F1004', ['Q1018']), ('F1029', ['Q1085']), ('F1002', ['Q1031']), ('F1016', ['Q1049'])]),
    'endpoint': _link('S1007', 'An unexpected process with egress raises process-origin, service and tampering questions.',
                      [('F1024', ['Q1067']), ('F1012', ['Q1008']), ('F1004', ['Q1018']), ('F1007', ['Q1030'])]),
}


def _group(case_id):
    if case_id in LINKS:
        return case_id
    import test_ground
    s = test_ground.SCENARIOS.get(case_id)
    if not s:
        return None
    domains = {o['domain'] for o in s['observations']}
    return 'endpoint' if 'endpoint' in domains else 'identity' if 'identity' in domains else 'network'


def _question(qid, full=True):
    q = QUESTIONS[qid]
    out = {'id': qid, 'name': q['name'].strip(), 'description': (q.get('description') or '').strip(), 'tags': q.get('tags') or []}
    if full:
        out['approaches'] = q.get('approaches') or []
    else:
        out['approaches'] = [{'name': a['name'], 'steps': [s.get('stage') for s in a.get('steps') or []]} for a in q.get('approaches') or []]
    return out


def questions_for(case_id, full=True):
    """The DFIQ tree linked to one evidence collection, or None."""
    group = _group(case_id)
    if not group:
        return None
    link = LINKS[group]
    sc = SCENARIOS[link['scenario']]
    return {'case_id': case_id, 'group': group, 'why': link['why'],
            'scenario': {'id': sc['id'], 'name': sc['name'].strip(), 'description': (sc.get('description') or '').strip()},
            'facets': [{'id': f['id'], 'name': FACETS[f['id']]['name'].strip(),
                        'questions': [_question(q, full) for q in f['questions']]} for f in link['facets']],
            'source': DFIQ['source']}


def catalog():
    return {'source': DFIQ['source'], 'playbooks': PLAYBOOKS, 'steps': PLAYBOOK_STEPS,
            'links': {k: questions_for(k) for k in LINKS if k.startswith('IR-')},
            'counts': {'scenarios': len(SCENARIOS), 'facets': len(FACETS), 'questions': len(QUESTIONS),
                       'with_approaches': sum(1 for q in QUESTIONS.values() if q.get('approaches'))}}
