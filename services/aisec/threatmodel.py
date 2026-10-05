"""Threat models: explicit rules propose techniques for each surface of an application.

A proposal names one ATLAS technique (or an OWASP risk where ATLAS has no direct
technique), the surface it applies to (an input, an action, an asset or the whole
application) and why. An analyst accepts or rejects each one; the model is accepted
once every proposal is decided, and becomes stale when the application or the assets
it uses change afterwards. Regenerating keeps earlier decisions.

The rules are deliberately simple and visible: they are a starting point for an
analyst, not a verdict.
"""
from datetime import datetime, timezone

UNTRUSTED_CONTENT = {'document', 'email', 'web', 'retrieval', 'tool_output', 'file_upload', 'data_feed'}
RISKY = {'write', 'external', 'money', 'identity', 'code_exec'}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _problem(message, status=400):
    from store import Problem
    return Problem(message, status)


def propose(app, by_id):
    """All proposals for one application, as (technique, surface, rationale) records."""
    out = []

    def add(tech, kind, sid, label, why):
        out.append({'key': f'{tech}@{kind}:{sid}', 'technique': tech, 'surface': {'kind': kind, 'id': sid, 'label': label}, 'rationale': why})

    llm = app['archetype'] != 'predictive_model'
    agentic = bool(app['actions'])
    external_users = app['users'] in ('customers', 'public')
    sensitive = app['classification'] in ('confidential', 'restricted')
    used = [by_id[x] for x in app['assets'] if x in by_id]

    for i in app['inputs']:
        L = i['label']
        if llm and i['kind'] == 'user':
            who = 'anyone using it' if not i['trusted'] else 'its own users'
            add('AML.T0051.000', 'input', i['id'], L, f'{L}: {who} can type instructions straight to the model.')
            add('AML.T0054', 'input', i['id'], L, f'{L}: a user can try to talk the model out of its rules.')
            if external_users:
                add('AML.T0034', 'input', i['id'], L, f'{L}: outside users can run up model spend.')
        if llm and i['kind'] in UNTRUSTED_CONTENT and not i['trusted']:
            add('AML.T0051.001', 'input', i['id'], L, f'{L}: whoever controls this content can hide instructions the model will read.')
            if agentic:
                add('ASI01', 'input', i['id'], L, f'{L}: injected instructions could redirect what the agent is trying to do, and it can act.')
        if i['kind'] == 'retrieval':
            add('AML.T0070', 'input', i['id'], L, f'{L}: anyone who can add to the indexed content can steer answers.')
            add('AML.T0071', 'input', i['id'], L, f'{L}: a planted entry can look like a legitimate source.')
        if i['kind'] == 'memory':
            add('AML.T0080.000', 'input', i['id'], L, f'{L}: a poisoned memory entry keeps influencing later sessions.')
        if i['kind'] == 'agent_message':
            add('AML.T0118', 'input', i['id'], L, f'{L}: messages from other agents are only as trustworthy as those agents and the channel.')
        if not llm and i['kind'] in ('data_feed', 'tool_output', 'user', 'file_upload'):
            add('AML.T0015', 'input', i['id'], L, f'{L}: crafted inputs can be shaped to get past the model.')

    for a in app['actions']:
        L = a['label']
        if a['effect'] in ('read', 'simulated') and not a['tool']:
            continue
        if llm:
            add('AML.T0053', 'action', a['id'], L, f'{L}: injected instructions could make the agent call this.')
        if a['effect'] == 'write':
            add('AML.T0101', 'action', a['id'], L, f'{L}: misuse could alter or delete data.')
        if a['effect'] == 'external':
            add('AML.T0086', 'action', a['id'], L, f'{L}: this can carry data outside the organisation.')
        if a['effect'] == 'code_exec':
            add('AML.T0050', 'action', a['id'], L, f'{L}: generated or injected code runs here.')
        if a['effect'] == 'identity':
            add('ASI03', 'action', a['id'], L, f'{L}: the agent can change access, so its own privileges become a target.')
        if a['effect'] in RISKY:
            if a['approval']:
                add('ASI09', 'action', a['id'], L, f'{L}: needs approval, so a convincing but wrong explanation can still get it approved.')
            else:
                add('LLM06', 'action', a['id'], L, f'{L}: happens without human approval.')

    for asset in used + [by_id[a['tool']] for a in app['actions'] if a['tool'] in by_id]:
        L = asset['name']
        if asset['type'] == 'model' and asset.get('hosting') == 'in_house':
            add('AML.T0020', 'asset', asset['id'], L, f'{L}: whoever can touch its training data can shape it.')
        if asset['type'] == 'mcp_server' or (asset['type'] == 'tool' and asset.get('vendor')):
            add('AML.T0110', 'asset', asset['id'], L, f'{L}: its tool descriptions come from {asset.get("vendor") or "outside"} and can change.')
        if asset['type'] == 'prompt' and llm:
            add('AML.T0056', 'asset', asset['id'], L, f'{L}: users can try to extract it; keep secrets out of it.')
        if asset['type'] == 'vector_store':
            add('AML.T0070', 'asset', asset['id'], L, f'{L}: write access to the index is write access to the answers.')
    reach = used + [by_id[u] for x in used for u in x.get('uses', []) if u in by_id]
    for group, label, test in (('models', 'Third-party models', lambda a: a['type'] == 'model' and a.get('hosting') in ('third_party_api', 'open_weights')),
                               ('frameworks', 'Third-party frameworks', lambda a: a['type'] == 'framework')):
        names = sorted({a['name'] for a in reach if test(a)})
        if names:
            kind = group[:-1] if len(names) == 1 else group
            add('AML.T0010', 'app', f"{app['id']}:{group}", label,
                f"Depends on {len(names)} {kind} it did not build ({', '.join(names[:4])}{'…' if len(names) > 4 else ''}).")

    A, N = 'app', app['id']
    if llm and sensitive:
        add('AML.T0057', A, N, app['name'], f"It handles {app['classification']} data that could appear in answers.")
    if llm and app['channel'] in ('web', 'email', 'internal_ui'):
        add('AML.T0077', A, N, app['name'], 'Its output is rendered for people, so links, images or markup in it are a channel.')
    if llm and (external_users or app['tier'] == 1):
        add('LLM09', A, N, app['name'], 'People act on its answers, so confident wrong answers carry real cost.')
    if external_users or app['channel'] == 'api':
        add('AML.T0029', A, N, app['name'], 'It is reachable from outside, so it can be flooded.')
    if not llm and (external_users or app['channel'] == 'api'):
        add('AML.T0024.002', A, N, app['name'], 'Its predictions are queryable, so its behaviour can be copied.')
    if not llm:
        add('AML.T0020', A, N, app['name'], 'A predictive model is only as sound as the data it was trained on.')
    if app['archetype'] == 'multi_agent':
        add('ASI08', A, N, app['name'], 'One bad step can spread through the other agents.')
    if app['autonomy'] == 4:
        add('ASI10', A, N, app['name'], 'It acts broadly without approval, so drift can go unnoticed.')
    seen, unique = set(), []
    for p in out:
        if p['key'] not in seen:
            seen.add(p['key'])
            unique.append(p)
    return unique


def _context(db, wid, app_id):
    from . import bom
    app = bom._get(db, wid, 'application', app_id)
    if not app:
        raise _problem('Unknown application', 404)
    by_id = {a['id']: a for a in bom._rows(db, wid, 'asset')}
    return app, by_id


def _stored(db, wid, app_id):
    from . import bom
    return bom._get(db, wid, 'threat_model', app_id) or {'status': 'none', 'proposals': [], 'decisions': {}}


def summary(db, wid, app):
    from . import bom
    m = _stored(db, wid, app['id'])
    if m['status'] == 'none':
        return {'status': 'none', 'proposed': 0, 'accepted': 0, 'rejected': 0, 'undecided': 0}
    by_id = {a['id']: a for a in bom._rows(db, wid, 'asset')}
    d = m['decisions']
    acc = sum(1 for p in m['proposals'] if d.get(p['key'], {}).get('decision') == 'accepted')
    rej = sum(1 for p in m['proposals'] if d.get(p['key'], {}).get('decision') == 'rejected')
    status = m['status']
    if status == 'accepted' and m.get('app_hash') != bom.app_hash(app, by_id):
        status = 'stale'
    return {'status': status, 'proposed': len(m['proposals']), 'accepted': acc, 'rejected': rej,
            'undecided': len(m['proposals']) - acc - rej, 'accepted_at': m.get('accepted_at'), 'generated_at': m.get('generated_at')}


def get(db, wid, app_id):
    import aisec
    from . import bom
    wid = bom._ws(db, wid)
    app, by_id = _context(db, wid, app_id)
    m = _stored(db, wid, app_id)
    proposals = []
    for p in m['proposals']:
        r = aisec.record(p['technique'])
        proposals.append({**p, **m['decisions'].get(p['key'], {'decision': None, 'note': ''}),
                          'name': r['name'], 'framework': r['framework'], 'refs': r['refs'], 'tactics': r['tactics']})
    return {'workspace': wid, 'application': app, 'assets': [by_id[x] for x in app['assets'] if x in by_id] +
            [by_id[a['tool']] for a in app['actions'] if a['tool'] in by_id and a['tool'] not in app['assets']],
            'summary': summary(db, wid, app), 'proposals': proposals, 'accepted_by': m.get('accepted_by')}


def generate(db, body):
    from . import bom
    wid = bom._ws(db, body.get('workspace'))
    app, by_id = _context(db, wid, body.get('app'))
    old = _stored(db, wid, app['id'])
    props = propose(app, by_id)
    keys = {p['key'] for p in props}
    decisions = {k: v for k, v in old['decisions'].items() if k in keys}
    same = old['status'] == 'accepted' and {p['key'] for p in old['proposals']} == keys and old.get('app_hash') == bom.app_hash(app, by_id)
    m = {'status': 'accepted' if same else 'draft', 'proposals': props, 'decisions': decisions, 'generated_at': _now(),
         **({k: old[k] for k in ('accepted_at', 'app_hash', 'accepted_by') if k in old} if same else {})}
    bom._put(db, wid, 'threat_model', app['id'], m)
    db.commit()
    return get(db, wid, app['id'])


def decide(db, body):
    from . import bom
    wid = bom._ws(db, body.get('workspace'))
    app, _ = _context(db, wid, body.get('app'))
    m = _stored(db, wid, app['id'])
    key = body.get('key')
    if key not in {p['key'] for p in m['proposals']}:
        raise _problem('Unknown proposal', 404)
    decision = body.get('decision')
    if decision not in ('accepted', 'rejected', None):
        raise _problem('decision must be accepted, rejected or null')
    note = body.get('note') or ''
    if not isinstance(note, str) or len(note) > 1000:
        raise _problem('note must be text up to 1000 characters')
    if decision is None:
        m['decisions'].pop(key, None)
    else:
        m['decisions'][key] = {'decision': decision, 'note': note.strip(), 'decided_at': _now()}
    if m['status'] == 'accepted':
        m['status'] = 'draft'
    bom._put(db, wid, 'threat_model', app['id'], m)
    db.commit()
    return get(db, wid, app['id'])


def accept(db, body):
    from . import bom
    wid = bom._ws(db, body.get('workspace'))
    app, by_id = _context(db, wid, body.get('app'))
    m = _stored(db, wid, app['id'])
    if not m['proposals']:
        raise _problem('Generate the threat model first', 409)
    undecided = [p['key'] for p in m['proposals'] if p['key'] not in m['decisions']]
    if undecided:
        raise _problem(f'{len(undecided)} proposals still need a decision', 409)
    if {p['key'] for p in propose(app, by_id)} != {p['key'] for p in m['proposals']}:
        raise _problem('The application changed since these proposals were generated; regenerate first', 409)
    m.update(status='accepted', accepted_at=_now(), app_hash=bom.app_hash(app, by_id), accepted_by='operator')
    bom._put(db, wid, 'threat_model', app['id'], m)
    db.commit()
    return get(db, wid, app['id'])


def techniques_in_models(db, wid):
    """technique id -> applications whose threat model accepted it (for the threat map)."""
    from . import bom
    out = {}
    for app in bom._rows(db, wid, 'application'):
        m = _stored(db, wid, app['id'])
        for p in m['proposals']:
            if m['decisions'].get(p['key'], {}).get('decision') == 'accepted':
                out.setdefault(p['technique'], [])
                if app['name'] not in out[p['technique']]:
                    out[p['technique']].append(app['name'])
    return out
