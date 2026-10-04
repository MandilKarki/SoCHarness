"""Conservative, explicit grounding checks on a finished answer. Not a general fact checker.

Ported from Defense Collective `squad/grounding.py` (two rules) and extended with
two rules that match SoCHarness evidence. Each sentence of the final answer gets
one status:

* ``flagged``   a rule found a claim the returned evidence cannot support;
* ``cited``     it cites record IDs, all of which a tool actually returned;
* ``unseen``    it cites a record ID no tool returned in this run;
* ``unchecked`` no rule applies and nothing is cited (not verified either way).
"""
import json
import re

SENTENCE = re.compile(r'(?<=[.!?])\s+|\n+')
# Record citations only ("#9000101", "record 9000101"). "Event 4625" is a Windows event ID, not a record.
CITE = re.compile(r'(?:#|\brecords?\s*(?:id)?\s*[:#]?\s*)(\d{1,9})\b', re.I)
NEGATED = re.compile(r"\b(?:does not|doesn't|cannot|can't|not establish|no evidence|not prove|unable to|insufficient|unknown|"
                     r"would need|requires|not available|not provided|missing|unverified)\b", re.I)

RULES = [
    {'code': 'unsupported_historical_baseline',
     'message': 'Claims a historical baseline, but no scoped baseline (a window and a sample count) was returned.',
     'claim': re.compile(r'based on (?:its |the |available )?historical (?:data|behavio(?:u)?r|activity)|within (?:the )?normal range for '
                         r'(?:this|the) (?:host|user)|(?:matches|consistent with) (?:the |its )?(?:historical|established|normal) baseline|'
                         r'(?:typical|usual|normal) (?:behavio(?:u)?r|pattern) for (?:this|the) (?:host|user|account)', re.I),
     'evidence': 'baseline'},
    {'code': 'missing_mfa_is_not_bypass',
     'message': 'Missing MFA evidence does not establish that MFA was absent or bypassed.',
     'claim': re.compile(r'without (?:mfa|multi.factor)|bypass(?:ed|ing)? (?:mfa|multi.factor)|(?:mfa|multi.factor authentication) '
                         r'(?:was |is )?(?:bypassed|disabled|absent)', re.I),
     'evidence': 'mfa_missing'},
    {'code': 'missing_sensor_is_not_safety',
     'message': 'A required sensor returned no data; absence of data is not evidence that the activity is safe or that nothing happened.',
     'claim': re.compile(r'\bno (?:sign|signs|evidence|indication)s? of (?:compromise|malicious|attack|intrusion)|\b(?:is|was|appears|looks) '
                         r'(?:benign|safe|clean|legitimate)\b|nothing (?:suspicious|malicious)|confirm(?:s|ed)? (?:that )?(?:no|the activity is benign)', re.I),
     'evidence': 'sensor_down'},
]


def _blob(record):
    return json.dumps(record, default=str).lower()


def evidence_facts(records):
    blobs = [_blob(r) for r in records]
    def baseline(r):
        raw = r.get('raw') if isinstance(r, dict) else None
        raw = raw.get('vendor_payload', raw) if isinstance(raw, dict) else {}
        b = (r.get('baseline') if isinstance(r, dict) else None) or (raw.get('baseline') if isinstance(raw, dict) else None)
        return isinstance(b, dict) and bool(b.get('window')) and type(b.get('sample_count')) is int and b['sample_count'] > 1
    return {
        'baseline': any(baseline(r) for r in records if isinstance(r, dict)),
        'mfa_missing': any(re.search(r'mfa (?:result|status|evidence) (?:is )?(?:not present|missing|unavailable|unknown)', b) for b in blobs),
        'sensor_down': any('"healthy": false' in b or 'sensor_unavailable' in b or 'not responding' in b or 'did not deliver' in b
                           for b in blobs),
    }


def review(answer, records, returned_ids):
    """Check each sentence of the answer against the records the tools returned."""
    facts = evidence_facts(records)
    returned = {int(i) for i in returned_ids if isinstance(i, int) or str(i).isdigit()}
    claims, issues = [], []
    for text in [t.strip() for t in SENTENCE.split(answer or '') if t and t.strip()]:
        if len(text) < 3:
            continue
        codes = []
        for rule in RULES:
            if not rule['claim'].search(text) or NEGATED.search(text):
                continue
            unsupported = (not facts['baseline']) if rule['evidence'] == 'baseline' else facts[rule['evidence']]
            if unsupported:
                codes.append(rule['code'])
        cites = sorted({int(m) for m in CITE.findall(text)})
        unseen = [c for c in cites if c not in returned]
        status = 'flagged' if codes else 'unseen' if unseen else 'cited' if cites else 'unchecked'
        index = len(claims)
        claims.append({'text': text[:600], 'status': status, 'codes': codes, 'cites': cites, 'unseen': unseen})
        for code in codes:
            rule = next(r for r in RULES if r['code'] == code)
            issues.append({'code': code, 'message': rule['message'], 'claim': index})
        if unseen:
            issues.append({'code': 'cites_unreturned_record', 'claim': index,
                           'message': 'Cites record IDs that no tool returned in this run: ' + ', '.join(map(str, unseen)) + '.'})
    counts = {s: sum(c['status'] == s for c in claims) for s in ('flagged', 'unseen', 'cited', 'unchecked')}
    return {'claims': claims, 'issues': issues, 'counts': counts, 'facts': facts,
            'scope': 'Explicit rules only: historical baselines, missing MFA, missing sensors and uncited records. Unchecked is not verified.'}


def _records(run):
    out = []
    for t in run:
        if t['kind'] != 'tool.result':
            continue
        result = t['payload'].get('result')
        if isinstance(result, dict) and isinstance(result.get('items'), list):
            out += [r for r in result['items'] if isinstance(r, dict)]
        elif isinstance(result, dict) and 'id' in result:
            out.append(result)
    return out


def review_run(run):
    answers = [t for t in run if t['kind'] == 'message.assistant']
    if not answers:
        return None
    records = _records(run)
    return review(answers[-1]['payload'].get('text', ''), records, [r.get('id') for r in records])


def review_session(store, sid):
    from test_ground import latest_run
    return review_run(latest_run(store.traces(sid)))
