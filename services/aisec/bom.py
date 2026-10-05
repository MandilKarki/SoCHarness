"""AI Security Lab, Phase 1: what each workspace defends.

* An AI bill of materials (assets: models, agents, frameworks, tools, MCP servers,
  vector stores, prompts, data sources, vendors) exported as a CycloneDX 1.6 ML-BOM.
* An enterprise profile (sector, regulators, risk appetite, criticality tiers and
  retest deadlines) and per-application profiles (owner, data classification,
  users, autonomy, tier, and the inputs and actions that form its attack surface).
* Importers: SoCHarness itself, CycloneDX JSON and SPDX 2.3 JSON files. Application
  profiles travel inside CycloneDX as ``socharness:application`` properties, so an
  export re-imports losslessly.

Everything is stored in ``aisec_records`` and scoped to one workspace.
"""
import hashlib
import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

ASSET_TYPES = {
    'model': {'label': 'Model', 'cdx': 'machine-learning-model'},
    'agent': {'label': 'Agent', 'cdx': 'application'},
    'framework': {'label': 'Framework or SDK', 'cdx': 'library'},
    'tool': {'label': 'Tool', 'cdx': 'service'},
    'mcp_server': {'label': 'MCP server', 'cdx': 'service'},
    'vector_store': {'label': 'Vector store', 'cdx': 'data'},
    'prompt': {'label': 'Prompt', 'cdx': 'data'},
    'data_source': {'label': 'Data source', 'cdx': 'data'},
    'vendor': {'label': 'Vendor', 'cdx': None},
}
CLASSIFICATIONS = {'public': 'Public', 'internal': 'Internal', 'confidential': 'Confidential', 'restricted': 'Restricted'}
USERS = {'internal_staff': 'Internal staff', 'partners': 'Partners', 'customers': 'Customers', 'public': 'Anyone on the internet'}
AUTONOMY = {1: 'Answers only', 2: 'Proposes actions for approval', 3: 'Acts within a narrow allowlist', 4: 'Acts broadly without approval'}
TIERS = {1: 'Tier 1 · critical', 2: 'Tier 2 · important', 3: 'Tier 3 · supporting'}
ARCHETYPES = {'chat_assistant': 'Chat assistant', 'rag_search': 'RAG search', 'tool_agent': 'Tool-using agent',
              'coding_assistant': 'Coding assistant', 'multi_agent': 'Multi-agent workflow', 'predictive_model': 'Predictive model'}
CHANNELS = {'internal_ui': 'Internal web UI', 'web': 'Public web or app', 'email': 'Email', 'api': 'API', 'batch': 'Batch'}
INPUT_KINDS = {'user': 'People typing to it', 'document': 'Documents', 'email': 'Email', 'web': 'Web pages',
               'retrieval': 'Retrieved passages', 'tool_output': 'Tool output', 'memory': 'Memory', 'agent_message': 'Other agents',
               'file_upload': 'Uploaded files', 'data_feed': 'Data feed'}
EFFECTS = {'read': 'Reads data', 'write': 'Changes data', 'external': 'Sends data outside', 'money': 'Moves money',
           'identity': 'Changes access or identity', 'code_exec': 'Runs code', 'simulated': 'Dry run only'}
DEFAULT_PROFILE = {
    'sector': None, 'regulators': [], 'risk_appetite': 'moderate', 'appetite_note': '',
    'tiers': {'1': 'Customer-facing, moves money or holds restricted data', '2': 'Internal decisions or confidential data',
              '3': 'Internal productivity, no sensitive data'},
    'retest_days': {'critical': 7, 'high': 30, 'medium': 90, 'low': 180},
}
SAMPLE = Path(__file__).with_name('samples')/'ridgeway-savings-bank.cdx.json'
PROP = 'socharness:'


def _now():
    return datetime.now(timezone.utc).isoformat()


def _problem(message, status=400):
    from store import Problem
    return Problem(message, status)


def _slug(text, prefix=''):
    s = re.sub(r'[^a-z0-9]+', '-', str(text).lower()).strip('-')[:60]
    return (prefix + s) if s else prefix + uuid.uuid4().hex[:8]


def _text(value, field, limit, required=True):
    if value is None or value == '':
        if required:
            raise _problem(f'{field} is required')
        return ''
    if not isinstance(value, str) or len(value) > limit or re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', value):
        raise _problem(f'{field} must be text up to {limit} characters')
    return value.strip()


def _choice(value, options, field, default=None):
    if value in (None, '') and default is not None:
        return default
    if value not in options:
        raise _problem(f'{field} must be one of: ' + ', '.join(map(str, options)))
    return value


# ---------------------------------------------------------------- storage

def _ws(db, wid):
    import aisec
    return aisec._workspace(db, wid)['id']


def _rows(db, wid, kind):
    return [json.loads(r['data']) for r in db.execute(
        'SELECT data FROM aisec_records WHERE workspace_id=? AND kind=? ORDER BY created_at, ref', (wid, kind)).fetchall()]


def _get(db, wid, kind, ref):
    r = db.execute('SELECT data FROM aisec_records WHERE workspace_id=? AND kind=? AND ref=?', (wid, kind, ref)).fetchone()
    return json.loads(r['data']) if r else None


def _put(db, wid, kind, ref, data):
    db.execute('INSERT INTO aisec_records VALUES(?,?,?,?,?,?,?) ON CONFLICT(workspace_id, kind, ref) DO UPDATE SET '
               'data=excluded.data, updated_at=excluded.updated_at',
               ('rec_' + uuid.uuid4().hex, wid, kind, ref, json.dumps(data), _now(), _now()))


def _delete(db, wid, kind, ref):
    db.execute('DELETE FROM aisec_records WHERE workspace_id=? AND kind=? AND ref=?', (wid, kind, ref))


# ---------------------------------------------------------------- profile

def profile(db, wid):
    wid = _ws(db, wid)
    saved = _get(db, wid, 'profile', 'enterprise') or {}
    out = json.loads(json.dumps(DEFAULT_PROFILE))
    out.update(saved)
    if out.get('sector') is None:
        row = db.execute('SELECT sector FROM aisec_workspaces WHERE id=?', (wid,)).fetchone()
        out['sector'] = row['sector'] if row else None
    return out


def set_profile(db, body):
    import aisec
    wid = _ws(db, body.get('workspace'))
    p = body.get('profile')
    if not isinstance(p, dict):
        raise _problem('profile must be an object')
    sector = p.get('sector') or None
    if sector is not None:
        _choice(sector, aisec.SECTORS, 'sector')
    regs = p.get('regulators') or []
    if not isinstance(regs, list) or len(regs) > 20:
        raise _problem('regulators must be a list of up to 20 names')
    tiers = p.get('tiers') or DEFAULT_PROFILE['tiers']
    days = p.get('retest_days') or DEFAULT_PROFILE['retest_days']
    if not isinstance(tiers, dict) or set(tiers) != {'1', '2', '3'}:
        raise _problem('tiers must describe tiers 1, 2 and 3')
    if not isinstance(days, dict) or set(days) != {'critical', 'high', 'medium', 'low'} or \
            not all(type(v) is int and 1 <= v <= 730 for v in days.values()):
        raise _problem('retest_days needs critical, high, medium and low as 1–730 days')
    out = {'sector': sector, 'regulators': [_text(r, 'Regulator', 120) for r in regs if str(r).strip()],
           'risk_appetite': _choice(p.get('risk_appetite'), ('low', 'moderate', 'high'), 'risk_appetite', 'moderate'),
           'appetite_note': _text(p.get('appetite_note'), 'Risk appetite note', 1000, False),
           'tiers': {k: _text(v, f'Tier {k}', 200) for k, v in tiers.items()}, 'retest_days': days}
    _put(db, wid, 'profile', 'enterprise', out)
    db.execute('UPDATE aisec_workspaces SET sector=? WHERE id=?', (sector, wid))
    db.commit()
    return profile(db, wid)


# ---------------------------------------------------------------- assets

def _clean_asset(a, existing_ids=None):
    if not isinstance(a, dict):
        raise _problem('asset must be an object')
    typ = _choice(a.get('type'), ASSET_TYPES, 'type')
    name = _text(a.get('name'), 'Name', 160)
    out = {'id': _text(a.get('id'), 'id', 120, False) or _slug(name, typ.replace('_', '-') + '-'),
           'type': typ, 'name': name, 'version': _text(a.get('version'), 'Version', 80, False),
           'vendor': _text(a.get('vendor'), 'Vendor', 120, False), 'description': _text(a.get('description'), 'Description', 1000, False),
           'purl': _text(a.get('purl'), 'purl', 300, False), 'source': _text(a.get('source'), 'Source', 40, False) or 'manual',
           'classification': a.get('classification') or None, 'hosting': a.get('hosting') or None,
           'uses': [u for u in (a.get('uses') or []) if isinstance(u, str)][:100]}
    if not re.fullmatch(r'[A-Za-z0-9._:@/+-]{1,120}', out['id']):
        raise _problem('Asset id may use letters, digits and . _ : @ / + -')
    if out['classification'] is not None:
        _choice(out['classification'], CLASSIFICATIONS, 'classification')
    if out['hosting'] is not None:
        _choice(out['hosting'], ('third_party_api', 'self_hosted', 'open_weights', 'in_house'), 'hosting')
    return out


def assets(db, wid):
    return _rows(db, _ws(db, wid), 'asset')


def save_asset(db, body):
    wid = _ws(db, body.get('workspace'))
    a = _clean_asset(body.get('asset'))
    _put(db, wid, 'asset', a['id'], a)
    db.commit()
    return inventory(db, wid)


def delete_asset(db, body):
    wid = _ws(db, body.get('workspace'))
    aid = body.get('id')
    _delete(db, wid, 'asset', aid)
    for app in _rows(db, wid, 'application'):
        if aid in app['assets']:
            app['assets'] = [x for x in app['assets'] if x != aid]
            _put(db, wid, 'application', app['id'], app)
    for a in _rows(db, wid, 'asset'):
        if aid in a['uses']:
            a['uses'] = [x for x in a['uses'] if x != aid]
            _put(db, wid, 'asset', a['id'], a)
    db.commit()
    return inventory(db, wid)


# ---------------------------------------------------------------- applications

def _clean_app(a, asset_ids):
    if not isinstance(a, dict):
        raise _problem('application must be an object')
    name = _text(a.get('name'), 'Name', 160)
    out = {'id': _text(a.get('id'), 'id', 120, False) or _slug(name, 'app-'), 'name': name,
           'owner': _text(a.get('owner'), 'Owner', 160, False), 'description': _text(a.get('description'), 'Description', 2000, False),
           'archetype': _choice(a.get('archetype'), ARCHETYPES, 'archetype', 'chat_assistant'),
           'classification': _choice(a.get('classification'), CLASSIFICATIONS, 'classification', 'internal'),
           'users': _choice(a.get('users'), USERS, 'users', 'internal_staff'),
           'channel': _choice(a.get('channel'), CHANNELS, 'channel', 'internal_ui'),
           'autonomy': _choice(a.get('autonomy'), AUTONOMY, 'autonomy', 1),
           'tier': _choice(a.get('tier'), TIERS, 'tier', 3),
           'assets': [x for x in (a.get('assets') or []) if x in asset_ids],
           'inputs': [], 'actions': []}
    if not re.fullmatch(r'[A-Za-z0-9._:-]{1,120}', out['id']):
        raise _problem('Application id may use letters, digits and . _ : -')
    for i, inp in enumerate((a.get('inputs') or [])[:30]):
        if not isinstance(inp, dict):
            raise _problem('each input must be an object')
        kind = _choice(inp.get('kind'), INPUT_KINDS, 'input kind')
        trusted = inp.get('trusted')
        if trusted is None:
            trusted = kind == 'user' and out['users'] == 'internal_staff'
        out['inputs'].append({'id': _text(inp.get('id'), 'input id', 80, False) or f'in-{kind}-{i}', 'kind': kind,
                              'label': _text(inp.get('label'), 'Input label', 160, False) or INPUT_KINDS[kind], 'trusted': bool(trusted)})
    for i, act in enumerate((a.get('actions') or [])[:40]):
        if not isinstance(act, dict):
            raise _problem('each action must be an object')
        effect = _choice(act.get('effect'), EFFECTS, 'action effect')
        tool = act.get('tool') if act.get('tool') in asset_ids else None
        out['actions'].append({'id': _text(act.get('id'), 'action id', 80, False) or f'act-{i}', 'label': _text(act.get('label'), 'Action label', 160),
                               'effect': effect, 'tool': tool, 'approval': bool(act.get('approval'))})
    if out['archetype'] != 'predictive_model' and not out['inputs']:
        out['inputs'].append({'id': 'in-user-0', 'kind': 'user', 'label': INPUT_KINDS['user'],
                              'trusted': out['users'] == 'internal_staff'})
    return out


def applications(db, wid):
    from . import threatmodel
    wid = _ws(db, wid)
    out = []
    for app in _rows(db, wid, 'application'):
        out.append({**app, 'threat_model': threatmodel.summary(db, wid, app)})
    return out


def save_application(db, body):
    wid = _ws(db, body.get('workspace'))
    ids = {a['id'] for a in _rows(db, wid, 'asset')}
    app = _clean_app(body.get('application'), ids)
    _put(db, wid, 'application', app['id'], app)
    db.commit()
    return inventory(db, wid)


def delete_application(db, body):
    wid = _ws(db, body.get('workspace'))
    _delete(db, wid, 'application', body.get('id'))
    _delete(db, wid, 'threat_model', body.get('id'))
    db.commit()
    return inventory(db, wid)


def app_hash(app, by_id):
    used = sorted(set(app['assets']) | {a['tool'] for a in app['actions'] if a['tool']})
    body = {k: app[k] for k in ('archetype', 'classification', 'users', 'channel', 'autonomy', 'tier', 'assets', 'inputs', 'actions')}
    body['asset_facts'] = [{k: by_id[u].get(k) for k in ('type', 'vendor', 'hosting', 'classification')} for u in used if u in by_id]
    return hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()[:16]


def inventory(db, wid):
    wid = _ws(db, wid)
    items = assets(db, wid)
    counts = {t: sum(1 for a in items if a['type'] == t) for t in ASSET_TYPES}
    return {'workspace': wid, 'profile': profile(db, wid), 'assets': items, 'applications': applications(db, wid), 'counts': counts}


def enums():
    return {'asset_types': {k: v['label'] for k, v in ASSET_TYPES.items()}, 'classifications': CLASSIFICATIONS, 'users': USERS,
            'autonomy': {str(k): v for k, v in AUTONOMY.items()}, 'tiers': {str(k): v for k, v in TIERS.items()},
            'archetypes': ARCHETYPES, 'channels': CHANNELS, 'input_kinds': INPUT_KINDS, 'effects': EFFECTS,
            'hosting': {'third_party_api': 'Third-party API', 'self_hosted': 'Self-hosted', 'open_weights': 'Open weights',
                        'in_house': 'Built in house'}}


# ---------------------------------------------------------------- importers

def _upsert_all(db, wid, new_assets, new_apps, source):
    before = {a['id'] for a in _rows(db, wid, 'asset')}
    for a in new_assets:
        a = _clean_asset({**a, 'source': a.get('source') or source})
        _put(db, wid, 'asset', a['id'], a)
    ids = {a['id'] for a in _rows(db, wid, 'asset')}
    for app in new_apps:
        app = _clean_app(app, ids)
        _put(db, wid, 'application', app['id'], app)
    db.commit()
    added = len({a.get('id') for a in new_assets} - before)
    return {'source': source, 'assets_added': added, 'assets_updated': len(new_assets) - added, 'applications': len(new_apps)}


def socharness_bom():
    """SoCHarness describing itself: runtimes, models, providers, tools, data and the investigation agent."""
    import store
    from adapters.registry import ADAPTERS
    manifest = json.loads((Path(__file__).resolve().parents[1]/'sdk_manifest.json').read_text(encoding='utf-8'))
    providers = {'ANTHROPIC_API_KEY': 'Anthropic', 'OPENAI_API_KEY': 'OpenAI', 'GOOGLE_API_KEY': 'Google',
                 'AI_GATEWAY_API_KEY': 'Vercel AI Gateway'}
    out, models = [], {}
    for name in sorted(set(providers.values())):
        out.append({'id': _slug(name, 'vendor-'), 'type': 'vendor', 'name': name, 'source': 'socharness',
                    'description': 'Model provider reached by at least one SoCHarness runtime.'})
    for rid, sdk in manifest['sdks'].items():
        spec = ADAPTERS.get(rid, {})
        owner = (sdk.get('repository') or '').split('/')[0]
        purl = (f"pkg:{sdk['registry']}/{sdk['package'].replace('@', '%40')}@{sdk['pinned_version']}"
                if sdk.get('registry') in ('pypi', 'npm') else f"pkg:github/{sdk.get('repository')}@{sdk['pinned_version']}")
        model = spec.get('model')
        provider = providers.get((sdk.get('credential') or '').split(' ')[0])
        uses = []
        if model:
            mid = _slug(model, 'model-')
            models.setdefault(mid, {'id': mid, 'type': 'model', 'name': model, 'vendor': provider or '', 'source': 'socharness',
                                    'hosting': 'third_party_api', 'description': 'Default model for: ', 'runtimes': []})
            models[mid]['runtimes'].append(spec.get('name', rid))
            uses.append(mid)
        out.append({'id': 'fw-' + rid, 'type': 'framework', 'name': spec.get('name', rid), 'version': sdk['pinned_version'],
                    'vendor': owner, 'purl': purl, 'source': 'socharness', 'uses': uses,
                    'description': f"{sdk['package']} pinned in sdk_manifest.json; credential {sdk.get('credential')}."})
    for m in models.values():
        m['description'] += ', '.join(m.pop('runtimes')) + '.'
        if m['vendor']:
            m['uses'] = [_slug(m['vendor'], 'vendor-')]
        out.append(m)
    tool_ids = []
    for t in store.TOOLS:
        tid = 'tool-' + t['name']
        tool_ids.append(tid)
        out.append({'id': tid, 'type': 'tool', 'name': t['name'], 'source': 'socharness',
                    'description': t['description'] + (f" Requires the {t['feature']} feature." if t.get('feature') else '')})
    out += [
        {'id': 'data-telemetry', 'type': 'data_source', 'name': 'Imported telemetry corpus', 'classification': 'confidential', 'source': 'socharness',
         'description': 'Raw security events in the events table, grouped into review cohorts. Log fields can be attacker-influenced.'},
        {'id': 'data-test-ground', 'type': 'data_source', 'name': 'Test-ground scenarios', 'classification': 'internal', 'source': 'socharness',
         'description': 'Ten labelled synthetic cases from Defense Collective; the answer key never reaches a tool.'},
        {'id': 'data-dfiq', 'type': 'data_source', 'name': 'DFIQ investigative questions', 'classification': 'public', 'source': 'socharness',
         'description': 'Google DFIQ, Apache-2.0, bundled unmodified.'},
        {'id': 'data-memory', 'type': 'data_source', 'name': 'Analyst-approved memory', 'classification': 'confidential', 'source': 'socharness',
         'description': 'Findings saved with remember_finding after approval, scoped to one case.'},
        {'id': 'prompt-investigation', 'type': 'prompt', 'name': 'Investigation instructions and test-ground prompt', 'classification': 'internal',
         'source': 'socharness', 'description': 'System instructions sent to every runtime plus the test-ground prompt template.'},
        {'id': 'agent-investigator', 'type': 'agent', 'name': 'SoCHarness investigation agent', 'source': 'socharness',
         'uses': ['fw-' + r for r in manifest['sdks']] + tool_ids + ['prompt-investigation', 'data-telemetry', 'data-memory'],
         'description': 'One investigation loop, run by whichever of the 11 framework runtimes is selected.'},
    ]
    effects = {'read': 'read', 'write': 'write', 'simulation': 'simulated'}
    app = {'id': 'app-socharness', 'name': 'SoCHarness investigation agent', 'owner': 'Operator',
           'description': 'Analysts point an agent at a case; it reads evidence with case tools and proposes findings. Writes need approval.',
           'archetype': 'tool_agent', 'classification': 'confidential', 'users': 'internal_staff', 'channel': 'internal_ui',
           'autonomy': 2, 'tier': 2, 'assets': ['agent-investigator', 'prompt-investigation', 'data-telemetry', 'data-memory'] + list(models),
           'inputs': [{'id': 'in-analyst', 'kind': 'user', 'label': 'Analyst prompt', 'trusted': True},
                      {'id': 'in-evidence', 'kind': 'tool_output', 'label': 'Evidence records (attacker-influenced log fields)', 'trusted': False},
                      {'id': 'in-memory', 'kind': 'memory', 'label': 'Analyst-approved memory', 'trusted': True},
                      {'id': 'in-specialists', 'kind': 'agent_message', 'label': 'Specialist sub-agent replies', 'trusted': False}],
           'actions': [{'id': 'act-' + t['name'], 'label': t['name'], 'effect': effects.get(t['effect'], 'read'), 'tool': 'tool-' + t['name'],
                        'approval': t['effect'] == 'write'}
                       for t in store.TOOLS if t['name'] in ('query_case_evidence', 'get_event', 'save_case_note', 'simulate_containment',
                                                             'remember_finding', 'write_artifact')]}
    return out, [app]


def import_socharness(db, wid):
    a, apps = socharness_bom()
    return _upsert_all(db, wid, a, apps, 'socharness')


def _props(obj):
    return {p.get('name'): p.get('value') for p in obj.get('properties') or [] if isinstance(p, dict)}


def parse_cyclonedx(doc):
    if doc.get('bomFormat') != 'CycloneDX':
        raise _problem('Not a CycloneDX document')
    items, apps, vendors = [], [], set()
    rev = {v['cdx']: k for k, v in ASSET_TYPES.items() if v['cdx']}

    def take(c, service=False):
        p = _props(c)
        if p.get(PROP + 'application'):
            try:
                apps.append(json.loads(p[PROP + 'application']))
            except ValueError:
                raise _problem(f"Invalid {PROP}application on {c.get('name')}")
            return
        typ = p.get(PROP + 'type') or ('tool' if service else rev.get(c.get('type'), 'framework'))
        if typ not in ASSET_TYPES:
            typ = 'framework'
        supplier = (c.get('supplier') or c.get('provider') or {}).get('name') or c.get('publisher') or ''
        if supplier:
            vendors.add(supplier)
        items.append({'id': c.get('bom-ref') or _slug(c.get('name', ''), typ + '-'), 'type': typ, 'name': c.get('name') or c.get('bom-ref'),
                      'version': c.get('version') or '', 'vendor': supplier, 'description': c.get('description') or '',
                      'purl': c.get('purl') or '', 'classification': p.get(PROP + 'classification'), 'hosting': p.get(PROP + 'hosting')})
    for c in doc.get('components') or []:
        take(c)
    for s in doc.get('services') or []:
        take(s, service=True)
    deps = {d.get('ref'): d.get('dependsOn') or [] for d in doc.get('dependencies') or [] if isinstance(d, dict)}
    for a in items:
        a['uses'] = deps.get(a['id'], [])
    known = {a['name'] for a in items if a['type'] == 'vendor'}
    meta_vendors = [p['value'] for p in (doc.get('metadata') or {}).get('properties') or [] if p.get('name') == PROP + 'vendor']
    for v in sorted((vendors | set(meta_vendors)) - known):
        items.append({'id': _slug(v, 'vendor-'), 'type': 'vendor', 'name': v, 'uses': []})
    return items, apps


def parse_spdx(doc):
    if not str(doc.get('spdxVersion', '')).startswith('SPDX-2'):
        raise _problem('Only SPDX 2.x JSON is supported')
    purpose = {'APPLICATION': 'agent', 'FRAMEWORK': 'framework', 'LIBRARY': 'framework', 'DATA': 'data_source'}
    items = []
    for p in doc.get('packages') or []:
        ref = next((r.get('referenceLocator') for r in p.get('externalRefs') or [] if r.get('referenceType') == 'purl'), '')
        supplier = re.sub(r'^(Organization|Person):\s*', '', p.get('supplier') or '')
        items.append({'id': p.get('SPDXID') or _slug(p.get('name', '')), 'type': purpose.get(p.get('primaryPackagePurpose'), 'framework'),
                      'name': p.get('name') or p.get('SPDXID'), 'version': p.get('versionInfo') or '', 'vendor': '' if supplier == 'NOASSERTION' else supplier,
                      'description': p.get('description') or p.get('summary') or '', 'purl': ref, 'uses': []})
    by_id = {a['id']: a for a in items}
    for r in doc.get('relationships') or []:
        if r.get('relationshipType') == 'DEPENDS_ON' and r.get('spdxElementId') in by_id:
            by_id[r['spdxElementId']]['uses'].append(r.get('relatedSpdxElement'))
    return items, []


def import_file(db, body):
    wid = _ws(db, body.get('workspace'))
    text = body.get('text')
    if not isinstance(text, str) or not text.strip():
        raise _problem('Paste or choose a CycloneDX or SPDX JSON file')
    try:
        doc = json.loads(text)
    except ValueError:
        raise _problem('The file is not valid JSON')
    if not isinstance(doc, dict):
        raise _problem('The file must be a JSON object')
    if doc.get('bomFormat') == 'CycloneDX':
        items, apps = parse_cyclonedx(doc)
        source = 'cyclonedx'
    elif 'spdxVersion' in doc:
        items, apps = parse_spdx(doc)
        source = 'spdx'
    else:
        raise _problem('Unrecognised format: expected CycloneDX (bomFormat) or SPDX 2.x (spdxVersion) JSON')
    if len(items) > 2000 or len(apps) > 200:
        raise _problem('Too many components for one import')
    return _upsert_all(db, wid, items, apps, source)


def import_sample(db):
    """Create a workspace for the fictional sample enterprise and import its ML-BOM file."""
    import aisec
    w = aisec.create_workspace(db, {'name': 'Ridgeway Savings Bank (sample)', 'kind': 'company', 'sector': 'financial_services'})
    result = import_file(db, {'workspace': w['id'], 'text': SAMPLE.read_text(encoding='utf-8')})
    set_profile(db, {'workspace': w['id'], 'profile': {
        'sector': 'financial_services', 'regulators': ['NYDFS (23 NYCRR Part 500)', 'OCC', 'CFPB'], 'risk_appetite': 'low',
        'appetite_note': 'No customer-facing AI may move money without a human approval.',
        'tiers': DEFAULT_PROFILE['tiers'], 'retest_days': {'critical': 7, 'high': 30, 'medium': 60, 'low': 120}}})
    return {**result, 'workspace': w['id']}


# ---------------------------------------------------------------- export

def export_cyclonedx(db, wid):
    import aisec
    wid = _ws(db, wid)
    w = aisec._workspace(db, wid)
    items = assets(db, wid)
    comps, services, vendors = [], [], []
    for a in items:
        if a['type'] == 'vendor':
            vendors.append(a['name'])
            continue
        props = [{'name': PROP + 'type', 'value': a['type']}]
        for k in ('classification', 'hosting'):
            if a.get(k):
                props.append({'name': PROP + k, 'value': a[k]})
        c = {'bom-ref': a['id'], 'name': a['name']}
        if a.get('version'):
            c['version'] = a['version']
        if a.get('description'):
            c['description'] = a['description']
        if ASSET_TYPES[a['type']]['cdx'] == 'service':
            if a.get('vendor'):
                c['provider'] = {'name': a['vendor']}
            services.append({**c, 'properties': props})
            continue
        c = {'type': ASSET_TYPES[a['type']]['cdx'], **c}
        if a.get('vendor'):
            c['supplier'] = {'name': a['vendor']}
        if a.get('purl'):
            c['purl'] = a['purl']
        if a['type'] == 'model':
            c['modelCard'] = {'considerations': {'useCases': [a['description']] if a.get('description') else []}}
        if c['type'] == 'data':
            c['data'] = [{'type': 'configuration' if a['type'] == 'prompt' else 'dataset', 'name': a['name'],
                          **({'classification': a['classification']} if a.get('classification') else {})}]
        comps.append({**c, 'properties': props})
    for app in _rows(db, wid, 'application'):
        comps.append({'type': 'application', 'bom-ref': app['id'], 'name': app['name'],
                      **({'description': app['description']} if app.get('description') else {}),
                      'properties': [{'name': PROP + 'application', 'value': json.dumps(app, sort_keys=True)}]})
    deps = [{'ref': a['id'], 'dependsOn': a['uses']} for a in items if a.get('uses') and a['type'] != 'vendor']
    deps += [{'ref': app['id'], 'dependsOn': sorted(set(app['assets']) | {x['tool'] for x in app['actions'] if x['tool']})}
             for app in _rows(db, wid, 'application')]
    return {'bomFormat': 'CycloneDX', 'specVersion': '1.6', 'serialNumber': 'urn:uuid:' + str(uuid.uuid4()), 'version': 1,
            'metadata': {'timestamp': _now(), 'tools': {'components': [{'type': 'application', 'name': 'SoCHarness AI Security Lab'}]},
                         'component': {'type': 'application', 'bom-ref': 'workspace-' + wid, 'name': w['name']},
                         'properties': [{'name': PROP + 'vendor', 'value': v} for v in vendors] +
                                       [{'name': PROP + 'workspace', 'value': wid}]},
            'components': comps, 'services': services, 'dependencies': deps}
