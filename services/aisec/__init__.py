"""AI Security Lab, Phase 0: workspaces, roles and the pinned threat taxonomies.

* Taxonomies are versioned data in ``taxonomy/``: MITRE ATLAS (converted from
  mitre-atlas/atlas-data by ``pin_atlas.py``, Apache-2.0) and the OWASP Top 10 for
  LLM Applications and for Agentic Applications (ids, names and official links;
  summaries are SoCHarness paraphrases). Every technique, from either source, is
  served in one record shape (``record``).
* Every lab record belongs to a workspace. SoCHarness itself is workspace one.
  Roles are recorded per workspace; while Relay has a single signed-in operator,
  that operator acts as lead researcher everywhere and the other roles can only be
  previewed. ``can`` is the one place permissions are decided, ready for
  multi-user sign-in.
"""
import json
import re
import uuid
from functools import lru_cache
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).parent/'taxonomy'
ATLAS = json.loads((HERE/'atlas.json').read_text(encoding='utf-8'))
OWASP = json.loads((HERE/'owasp.json').read_text(encoding='utf-8'))
OWASP_ITEMS = {i['id']: {**i, 'list': l['id']} for l in OWASP['lists'] for i in l['items']}
LISTS = {l['id']: l for l in OWASP['lists']}
SITE = ATLAS['source']['site']

ROLES = {
    'lead_researcher': {'label': 'Lead researcher', 'summary': 'Runs the lab: threats, tests, findings and reports.',
                        'can': ['view_threats', 'track_techniques', 'manage_workspace', 'run_tests', 'manage_findings', 'publish_reports']},
    'app_owner': {'label': 'Application owner', 'summary': 'Sees threats and the findings for their own applications.',
                  'can': ['view_threats', 'view_own_findings', 'update_own_findings']},
    'vendor_guest': {'label': 'Vendor guest', 'summary': 'Sees only their own scorecard and requests.',
                     'can': ['view_own_scorecard']},
    'executive': {'label': 'Executive', 'summary': 'Sees dashboards and published reports only.',
                  'can': ['view_dashboards', 'view_published_reports']},
}
ACTIONS = {
    'view_threats': ('Threat taxonomy and threat cards', 0), 'track_techniques': ('Track techniques for this workspace', 0),
    'manage_workspace': ('Create workspaces and assign roles', 0), 'run_tests': ('Run attack packs', 3),
    'manage_findings': ('Create and close findings', 5), 'publish_reports': ('Publish reports', 7),
    'view_own_findings': ('Findings for own applications', 5), 'update_own_findings': ('Update own findings', 5),
    'view_own_scorecard': ('Own vendor scorecard', 6), 'view_dashboards': ('Executive dashboards', 7),
    'view_published_reports': ('Published reports', 7),
}
KINDS = {'lab': 'Lab', 'company': 'Company', 'business_unit': 'Business unit', 'client': 'Client company'}
SECTORS = {'financial_services': 'Financial services', 'healthcare': 'Healthcare', 'insurance': 'Insurance', 'retail': 'Retail',
           'public_sector': 'Public sector', 'technology': 'Technology', 'other': 'Other'}
OPERATOR = 'operator'
DEFAULT_WORKSPACE = 'socharness'


def _now():
    return datetime.now(timezone.utc).isoformat()


def _problem(message, status=400):
    from store import Problem
    return Problem(message, status)


def can(role, action):
    return role in ROLES and action in ROLES[role]['can']


# ---------------------------------------------------------------- taxonomy

def _atlas_url(tid):
    kind = 'tactics' if tid.startswith('AML.TA') else 'mitigations' if tid.startswith('AML.M') else \
        'studies' if tid.startswith('AML.CS') else 'techniques'
    return f'{SITE}/{kind}/{tid}'


def _owasp_for(tid):
    """OWASP items linked to an ATLAS technique (directly, or through its parent)."""
    parent = ATLAS['techniques'].get(tid, {}).get('parent')
    return [i['id'] for i in OWASP_ITEMS.values() if tid in i['atlas'] or (parent and parent in i['atlas'])]


def _summary(text, limit=220):
    first = re.sub(r'\[([^\]]+)\]\([^)]*\)', r'\1', (text or '').strip().split('\n\n')[0]).replace('\n', ' ')
    sentence = re.match(r'(.+?[.!?])(\s|$)', first)
    out = sentence.group(1) if sentence else first
    return out if len(out) <= limit else out[:limit].rsplit(' ', 1)[0] + '…'


def _sources_atlas(tid):
    src = ATLAS['source']
    return [{'label': f'MITRE ATLAS · {tid}', 'url': _atlas_url(tid)},
            {'label': f"atlas-data release {src['release']}", 'url': src['repo'] + '/blob/' + (src['commit'] or 'main') + '/' + src['file']}]


def record(tid, full=False):
    """One technique in the lab's single record shape, from ATLAS or OWASP."""
    if tid in ATLAS['techniques']:
        t = ATLAS['techniques'][tid]
        subs = sorted(k for k, v in ATLAS['techniques'].items() if v['parent'] == tid)
        out = {'id': tid, 'framework': 'atlas', 'kind': 'subtechnique' if t['parent'] else 'technique', 'name': t['name'],
               'summary': _summary(t['description']), 'parent': t['parent'], 'tactics': t['tactics'],
               'platforms': t['platforms'], 'maturity': t['maturity'], 'refs': _owasp_for(tid), 'subtechniques': subs,
               'counts': {'mitigations': len(t['mitigations']), 'case_studies': len(t['case_studies'])},
               'url': _atlas_url(tid)}
        if full:
            out.update(description=t['description'], created=t['created'], modified=t['modified'],
                       parent_name=ATLAS['techniques'][t['parent']]['name'] if t['parent'] else None,
                       tactic_names={x: next(a['name'] for a in ATLAS['tactics'] if a['id'] == x) for x in t['tactics']},
                       subtechniques=[{'id': s, 'name': ATLAS['techniques'][s]['name']} for s in subs],
                       mitigations=[{'id': m['id'], 'name': ATLAS['mitigations'][m['id']]['name'], 'how': m['how'],
                                     'url': _atlas_url(m['id'])} for m in t['mitigations']],
                       case_studies=[{'id': c, **{k: ATLAS['case_studies'][c][k] for k in ('name', 'summary', 'type', 'date')},
                                      'url': _atlas_url(c)} for c in t['case_studies']],
                       references=t['references'], sources=_sources_atlas(tid),
                       owasp=[{k: OWASP_ITEMS[i][k] for k in ('id', 'name', 'list', 'url')} for i in out['refs']])
        return out
    if tid in OWASP_ITEMS:
        i = OWASP_ITEMS[tid]
        lst = LISTS[i['list']]
        out = {'id': tid, 'framework': i['list'], 'kind': 'risk', 'name': i['name'], 'summary': i['summary'], 'parent': None,
               'tactics': [], 'platforms': [], 'maturity': None, 'refs': list(i['atlas']), 'subtechniques': [],
               'counts': {'atlas': len(i['atlas'])}, 'url': i['url']}
        if full:
            out.update(list_name=f"{lst['name']} ({lst['edition']})", license=lst['license'],
                       atlas=[record(x) for x in i['atlas']],
                       sources=[{'label': f"{lst['name']} {lst['edition']} · {tid}", 'url': i['url']},
                                {'label': f"{lst['name']} {lst['edition']}", 'url': lst['url']}],
                       crosswalk_note=OWASP['note'])
        return out
    raise _problem('Unknown technique', 404)


def versions():
    src = ATLAS['source']
    return [{'id': 'atlas', 'name': src['name'], 'version': src['release'], 'released': src['release_date'],
             'license': src['license'], 'url': src['site'], 'pinned_from': src['repo'], 'commit': src['commit']}] + \
        [{'id': l['id'], 'name': l['name'], 'version': l['edition'], 'released': l.get('published'), 'license': l['license'],
          'url': l['url'], 'checked': l['checked']} for l in OWASP['lists']]


@lru_cache(maxsize=1)
def catalog():
    """Read-only; cached because the pinned taxonomy never changes while running."""
    return {'versions': versions(),
            'tactics': [{'id': t['id'], 'name': t['name'], 'summary': _summary(t['description']), 'url': _atlas_url(t['id'])}
                        for t in ATLAS['tactics']],
            'techniques': [record(t) for t in ATLAS['techniques']],
            'owasp': [{'id': l['id'], 'name': l['name'], 'edition': l['edition'], 'url': l['url'], 'license': l['license'],
                       'items': [record(i['id']) for i in l['items']]} for l in OWASP['lists']],
            'crosswalk_note': OWASP['note'],
            'counts': {'tactics': len(ATLAS['tactics']), 'techniques': sum(1 for t in ATLAS['techniques'].values() if not t['parent']),
                       'subtechniques': sum(1 for t in ATLAS['techniques'].values() if t['parent']),
                       'mitigations': len(ATLAS['mitigations']), 'case_studies': len(ATLAS['case_studies']),
                       'owasp_items': len(OWASP_ITEMS)},
            'roles': ROLES, 'actions': {k: {'label': v[0], 'phase': v[1]} for k, v in ACTIONS.items()},
            'kinds': KINDS, 'sectors': SECTORS}


# ---------------------------------------------------------------- workspaces

def install(db):
    db.executescript('''
      CREATE TABLE IF NOT EXISTS aisec_workspaces(id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
        sector TEXT, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS aisec_members(workspace_id TEXT NOT NULL REFERENCES aisec_workspaces(id) ON DELETE CASCADE,
        member TEXT NOT NULL, role TEXT NOT NULL, added_at TEXT NOT NULL, PRIMARY KEY(workspace_id, member));
      CREATE TABLE IF NOT EXISTS aisec_records(id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES aisec_workspaces(id) ON DELETE CASCADE,
        kind TEXT NOT NULL, ref TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(workspace_id, kind, ref));
      CREATE INDEX IF NOT EXISTS aisec_records_ws ON aisec_records(workspace_id, kind);
    ''')
    if not db.execute('SELECT 1 FROM aisec_workspaces WHERE id=?', (DEFAULT_WORKSPACE,)).fetchone():
        db.execute('INSERT INTO aisec_workspaces VALUES(?,?,?,?,?)', (DEFAULT_WORKSPACE, 'SoCHarness', 'lab', 'technology', _now()))
        db.execute('INSERT INTO aisec_members VALUES(?,?,?,?)', (DEFAULT_WORKSPACE, OPERATOR, 'lead_researcher', _now()))
    db.commit()


def _workspace(db, wid):
    row = db.execute('SELECT * FROM aisec_workspaces WHERE id=?', (wid,)).fetchone()
    if not row:
        raise _problem('Unknown workspace', 404)
    return row


def _clean(value, field, limit):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > limit or re.search(r'[\x00-\x1f\x7f]', value):
        raise _problem(f'{field} must be 1–{limit} printable characters')
    return value.strip()


def workspaces(db):
    out = []
    for w in db.execute('SELECT * FROM aisec_workspaces ORDER BY created_at').fetchall():
        members = [{'member': m['member'], 'role': m['role'], 'added_at': m['added_at']} for m in
                   db.execute('SELECT * FROM aisec_members WHERE workspace_id=? ORDER BY added_at', (w['id'],)).fetchall()]
        counts = {r['kind']: r['n'] for r in
                  db.execute('SELECT kind, count(*) n FROM aisec_records WHERE workspace_id=? GROUP BY kind', (w['id'],)).fetchall()}
        out.append({'id': w['id'], 'name': w['name'], 'kind': w['kind'], 'sector': w['sector'], 'created_at': w['created_at'],
                    'members': members, 'records': counts, 'you': 'lead_researcher'})
    return {'workspaces': out, 'operator': OPERATOR,
            'enforcement': 'Single signed-in operator: you act as lead researcher in every workspace. Other roles are '
                           'recorded and can be previewed; they are enforced once multi-user sign-in exists.'}


def create_workspace(db, body):
    name = _clean(body.get('name'), 'Name', 80)
    kind = body.get('kind', 'company')
    sector = body.get('sector') or None
    if kind not in KINDS or kind == 'lab':
        raise _problem('Kind must be company, business_unit or client')
    if sector is not None and sector not in SECTORS:
        raise _problem('Unknown sector')
    base = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')[:40] or 'workspace'
    wid = base
    while db.execute('SELECT 1 FROM aisec_workspaces WHERE id=?', (wid,)).fetchone():
        wid = f'{base}-{uuid.uuid4().hex[:4]}'
    db.execute('INSERT INTO aisec_workspaces VALUES(?,?,?,?,?)', (wid, name, kind, sector, _now()))
    db.execute('INSERT INTO aisec_members VALUES(?,?,?,?)', (wid, OPERATOR, 'lead_researcher', _now()))
    db.commit()
    return next(w for w in workspaces(db)['workspaces'] if w['id'] == wid)


def set_member(db, body):
    wid = _workspace(db, body.get('workspace'))['id']
    member = _clean(body.get('member'), 'Member', 120)
    role = body.get('role')
    if member == OPERATOR:
        raise _problem('The operator is always lead researcher')
    if role is None:
        db.execute('DELETE FROM aisec_members WHERE workspace_id=? AND member=?', (wid, member))
    elif role in ROLES:
        db.execute('INSERT INTO aisec_members VALUES(?,?,?,?) ON CONFLICT(workspace_id, member) DO UPDATE SET role=excluded.role',
                   (wid, member, role, _now()))
    else:
        raise _problem('Unknown role')
    db.commit()
    return next(w for w in workspaces(db)['workspaces'] if w['id'] == wid)


# ---------------------------------------------------------------- workspace records

def tracked(db, wid):
    _workspace(db, wid)
    rows = db.execute("SELECT ref, data, updated_at FROM aisec_records WHERE workspace_id=? AND kind='tracked_technique' "
                      'ORDER BY updated_at DESC', (wid,)).fetchall()
    return {'workspace': wid, 'tracked': [{'id': r['ref'], 'note': json.loads(r['data']).get('note', ''),
                                            'updated_at': r['updated_at']} for r in rows]}


def track(db, body):
    if not can('lead_researcher', 'track_techniques'):
        raise _problem('Not allowed', 403)
    wid = _workspace(db, body.get('workspace'))['id']
    tid = body.get('technique')
    record(tid if isinstance(tid, str) else '')
    if body.get('tracked') is False:
        db.execute("DELETE FROM aisec_records WHERE workspace_id=? AND kind='tracked_technique' AND ref=?", (wid, tid))
    else:
        note = body.get('note') or ''
        if not isinstance(note, str) or len(note) > 2000:
            raise _problem('Note must be text up to 2000 characters')
        db.execute("INSERT INTO aisec_records VALUES(?,?,?,?,?,?,?) ON CONFLICT(workspace_id, kind, ref) DO UPDATE SET "
                   'data=excluded.data, updated_at=excluded.updated_at',
                   ('rec_' + uuid.uuid4().hex, wid, 'tracked_technique', tid, json.dumps({'note': note.strip()}), _now(), _now()))
    db.commit()
    return tracked(db, wid)
