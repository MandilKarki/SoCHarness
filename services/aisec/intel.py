"""AI Security Lab, Phase 2: threat intelligence and the landscape for one workspace.

* Feed: curated regulator, standards and research items, every ATLAS release and case
  study from the pinned data, items an analyst adds, and OSV advisories for the
  packages in the workspace's AI bill of materials.
* Threat cards (taxonomy/cards.json) scored for relevance against this workspace:
  exposure comes from the threat-model rules applied to each application (weighted by
  tier, and dropped where an analyst rejected every matching proposal); likelihood
  from ATLAS maturity plus recent case studies; the band moves with risk appetite and
  sector priorities. Every score lists its reasons.
* AI-enabled threats aimed at the company (deepfakes, AI phishing, automated
  vulnerability discovery), assessed as likelihood x impact with controls. Nothing is
  simulated or generated.
* Coverage: each card links to tests that exist in SoCHarness, or to an open gap.
* Monthly landscape snapshots, stored per workspace, with a Markdown rendering.
"""
import json
import re
import urllib.request
import uuid
from datetime import date, datetime, timezone
from pathlib import Path

HERE = Path(__file__).parent/'taxonomy'
CARDS = json.loads((HERE/'cards.json').read_text(encoding='utf-8'))['cards']
CARD = {c['id']: c for c in CARDS}
SECTORS = json.loads((HERE/'sectors.json').read_text(encoding='utf-8'))
REGISTER = json.loads((HERE/'ai_enabled.json').read_text(encoding='utf-8'))
FEED = json.loads((HERE/'feed.json').read_text(encoding='utf-8'))
MATURITY = {'Realized': 3, 'Demonstrated': 2, 'Feasible': 1}
MATURITY_LABEL = {3: 'Seen in the wild', 2: 'Demonstrated by researchers', 1: 'Feasible, not yet shown'}
TIER_WEIGHT = {1: 3, 2: 2, 3: 1}
RISKY = {'write', 'external', 'money', 'identity', 'code_exec'}
ACTIVE = 3  # ATLAS case studies within 24 months that count as active exploitation
OSV = 'https://api.osv.dev/v1'
FEED_KINDS = {'regulator': 'Regulator', 'standard': 'Standard', 'research': 'Research', 'vendor': 'Vendor report', 'news': 'News',
              'advisory': 'Advisory', 'atlas_release': 'ATLAS release', 'atlas_case_study': 'ATLAS case study'}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _problem(message, status=400):
    from store import Problem
    return Problem(message, status)


def _atlas():
    import aisec
    return aisec.ATLAS


def matches(card_tech, tid):
    return tid == card_tech or tid.startswith(card_tech + '.')


def _card_atlas_ids(card):
    """ATLAS techniques behind a card, expanding OWASP ids through the crosswalk."""
    import aisec
    out = []
    for t in card['techniques']:
        out += aisec.OWASP_ITEMS[t]['atlas'] if t in aisec.OWASP_ITEMS else [t]
    return out


def maturity(card):
    T = _atlas()['techniques']
    levels = [MATURITY.get(T[t]['maturity'], 1) for t in _card_atlas_ids(card) if t in T]
    return max(levels) if levels else 2


def case_studies(card):
    A = _atlas()
    ids = set()
    for tid, t in A['techniques'].items():
        if any(matches(c, tid) for c in _card_atlas_ids(card)):
            ids |= set(t['case_studies'])
    return sorted(({'id': c, **{k: A['case_studies'][c][k] for k in ('name', 'type', 'date')}} for c in ids),
                  key=lambda x: x['date'], reverse=True)


def _months_between(a, b):
    return (b.year - a.year) * 12 + b.month - a.month


def _parse_day(text):
    try:
        return date.fromisoformat(str(text)[:10])
    except ValueError:
        return None


# ---------------------------------------------------------------- relevance

def _applications(db, wid):
    from . import bom, threatmodel
    by_id = {a['id']: a for a in bom._rows(db, wid, 'asset')}
    out = []
    for app in bom._rows(db, wid, 'application'):
        stored = threatmodel._stored(db, wid, app['id'])
        out.append({'app': app, 'proposals': threatmodel.propose(app, by_id), 'decisions': stored['decisions'] if stored['status'] != 'none' else {}})
    return out


def _thresholds(appetite):
    return {'low': 9, 'moderate': 12, 'high': 14}.get(appetite, 12)


def _direct(app, p):
    """An attacker reaches this surface directly: an untrusted input, or a risky action that needs no approval."""
    if p['surface']['kind'] == 'input':
        inp = next((i for i in app['inputs'] if i['id'] == p['surface']['id']), None)
        return bool(inp and not inp['trusted'])
    if p['surface']['kind'] == 'action':
        act = next((a for a in app['actions'] if a['id'] == p['surface']['id']), None)
        return bool(act and act['effect'] in RISKY and not act['approval'])
    return False


def relevance(db, wid, today=None):
    from . import bom
    today = today or date.today()
    profile = bom.profile(db, wid)
    pack = SECTORS['sectors'].get(profile.get('sector') or '')
    apps = _applications(db, wid)
    gaps = {g['card']: g for g in _gaps(db, wid) if g['status'] == 'open'}
    high_at = _thresholds(profile['risk_appetite'])
    out = []
    for card in CARDS:
        reasons, exposed, weight = [], [], 0
        for a in apps:
            hit = [p for p in a['proposals'] if any(matches(c, p['technique']) for c in card['techniques'])]
            if not hit:
                continue
            dec = [a['decisions'].get(p['key'], {}).get('decision') for p in hit]
            rejected_all = all(d == 'rejected' for d in dec)
            direct = any(_direct(a['app'], p) for p in hit)
            entry = {'id': a['app']['id'], 'name': a['app']['name'], 'tier': a['app']['tier'], 'proposals': len(hit), 'direct': direct,
                     'accepted': dec.count('accepted'), 'rejected': dec.count('rejected'), 'excluded': rejected_all,
                     'surfaces': sorted({p['surface']['label'] for p in hit})[:6]}
            exposed.append(entry)
            if not rejected_all:
                weight = max(weight, TIER_WEIGHT[a['app']['tier']] * (2 if direct else 1))
        m = maturity(card)
        studies = case_studies(card)
        recent = [s for s in studies if _parse_day(s['date']) and 0 <= _months_between(_parse_day(s['date']), today) <= 24]
        likelihood = min(3, m + (1 if len(recent) >= ACTIVE else 0))
        score = weight * likelihood
        live = [e for e in exposed if not e['excluded']]
        if live:
            top = max(live, key=lambda e: TIER_WEIGHT[e['tier']] * (2 if e['direct'] else 1))
            how = 'directly reachable: an untrusted input or an unapproved risky action' if top['direct'] else 'reachable only indirectly'
            reasons.append(f"Exposure {weight}/6: applies to {len(live)} application{'s' if len(live) > 1 else ''}; highest is {top['name']} "
                           f"(tier {top['tier']}, {how}).")
        else:
            reasons.append('No application in this workspace has the surfaces this needs.' if not exposed else
                           'An analyst rejected every matching proposal, so it is not counted.')
        reasons.append(f"Likelihood {likelihood}/3: {MATURITY_LABEL[m].lower()}" +
                       (f"; {len(recent)} ATLAS case stud{'ies' if len(recent) > 1 else 'y'} in the last 24 months"
                        + (', counted as active exploitation.' if len(recent) >= ACTIVE else '.') if recent else '.'))
        if pack and card['id'] in pack['priority_cards'] and score:
            score += 2
            reasons.append(f"+2: a priority threat for {pack['label'].lower()}.")
        band = 'high' if score >= high_at else 'medium' if score >= 6 else 'low' if score >= 1 else 'none'
        reasons.append(f"Score {score}; high from {high_at} at {profile['risk_appetite']} risk appetite.")
        coverage = 'tested' if card['tests'] else 'gap' if card['id'] in gaps else 'none'
        out.append({'id': card['id'], 'title': card['title'], 'what': card['what'], 'techniques': card['techniques'],
                    'preconditions': card['preconditions'], 'components': card['components'], 'maturity': m,
                    'maturity_label': MATURITY_LABEL[m], 'likelihood': likelihood, 'exposure': weight, 'score': score, 'band': band,
                    'reasons': reasons, 'apps': exposed, 'tests': card['tests'], 'gap': gaps.get(card['id']), 'coverage': coverage,
                    'case_studies': studies[:6], 'case_study_count': len(studies), 'recent_case_studies': len(recent)})
    order = {'high': 0, 'medium': 1, 'low': 2, 'none': 3}
    return sorted(out, key=lambda c: (order[c['band']], -c['score'], c['title']))


def heatmap(cards, db, wid):
    from . import bom
    apps = bom._rows(db, wid, 'application')
    cells = {}
    for c in cards:
        row = {}
        for e in c['apps']:
            state = 'rejected' if e['excluded'] else 'accepted' if e['accepted'] else 'open'
            row[e['id']] = {'weight': TIER_WEIGHT[e['tier']], 'state': state, 'proposals': e['proposals']}
        cells[c['id']] = row
    return {'rows': [{'id': c['id'], 'title': c['title'], 'band': c['band'], 'coverage': c['coverage']} for c in cards],
            'cols': [{'id': a['id'], 'name': a['name'], 'tier': a['tier']} for a in apps], 'cells': cells}


# ---------------------------------------------------------------- feed

def _case_study_items():
    A = _atlas()
    techs = {}
    for tid, t in A['techniques'].items():
        for c in t['case_studies']:
            techs.setdefault(c, []).append(tid)
    for cid, c in A['case_studies'].items():
        yield {'id': cid, 'kind': 'atlas_case_study', 'published': c['date'], 'title': c['name'],
               'url': f"{A['source']['site']}/studies/{cid}", 'summary': c['summary'],
               'techniques': sorted(techs.get(cid, [])), 'detail': ('Observed incident' if c['type'] == 'Incident' else 'Research exercise'),
               'references': c.get('references', [])}


def _release_items():
    A = _atlas()
    for r in A.get('releases', []):
        yield {'id': 'atlas-' + r['release'], 'kind': 'atlas_release', 'published': r['date'],
               'title': f"MITRE ATLAS {r['release']}: {len(r['added_techniques'])} new techniques, {len(r['added_case_studies'])} new case studies",
               'url': A['source']['repo'] + '/blob/main/CHANGELOG.md', 'summary': r['summary'], 'techniques': r['added_techniques']}


def _gaps(db, wid):
    from . import bom
    return bom._rows(db, wid, 'gap')


def feed(db, wid, cards):
    from . import bom
    items = list(FEED['items']) + list(_release_items()) + list(_case_study_items())
    items += [{**x, 'kind': x['kind']} for x in bom._rows(db, wid, 'feed_item')]
    items += [{'id': a['id'], 'kind': 'advisory', 'published': a.get('published'), 'title': f"{a['id']}: {a['summary'] or 'advisory'}",
               'url': a['url'], 'summary': 'Affects ' + ', '.join(a['assets']) + (f" · aliases {', '.join(a['aliases'][:3])}" if a['aliases'] else ''),
               'techniques': ['AML.T0010'], 'assets': a['assets']} for a in bom._rows(db, wid, 'advisory')]
    live = {c['id']: c for c in cards if c['score']}
    for it in items:
        rel = [cid for cid, c in live.items() if any(matches(ct, t) or matches(t, ct) for t in it.get('techniques', []) for ct in _card_atlas_ids(CARD[cid]) + CARD[cid]['techniques'])]
        it['cards'] = rel
        it['relevant'] = bool(rel)
    return sorted(items, key=lambda x: str(x.get('published') or ''), reverse=True)


def add_item(db, body):
    import aisec
    from . import bom
    wid = bom._ws(db, body.get('workspace'))
    it = body.get('item') or {}
    title = bom._text(it.get('title'), 'Title', 200)
    url = bom._text(it.get('url'), 'Link', 500)
    if not re.match(r'^https://[^\s]+$', url):
        raise _problem('Link must start with https://')
    published = bom._text(it.get('published'), 'Date', 10)
    if not re.fullmatch(r'\d{4}-\d{2}(-\d{2})?', published):
        raise _problem('Date must be YYYY-MM or YYYY-MM-DD')
    kind = bom._choice(it.get('kind'), ('regulator', 'standard', 'research', 'vendor', 'news'), 'kind', 'research')
    techs = [t for t in (it.get('techniques') or []) if isinstance(t, str)][:20]
    for t in techs:
        aisec.record(t)
    item = {'id': 'note-' + uuid.uuid4().hex[:10], 'kind': kind, 'published': published, 'title': title, 'url': url,
            'summary': bom._text(it.get('summary'), 'Summary', 1500, False), 'techniques': techs, 'added_by': 'operator'}
    bom._put(db, wid, 'feed_item', item['id'], item)
    db.commit()
    return item


def delete_item(db, body):
    from . import bom
    wid = bom._ws(db, body.get('workspace'))
    bom._delete(db, wid, 'feed_item', body.get('id'))
    db.commit()
    return {'deleted': body.get('id')}


def _osv(path, payload=None):
    req = urllib.request.Request(OSV + path, data=json.dumps(payload).encode() if payload is not None else None,
                                 headers={'Content-Type': 'application/json'}, method='POST' if payload is not None else 'GET')
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read(2_000_000))


def check_advisories(db, body, call=_osv):
    """Query OSV for every pinned PyPI or npm package in the workspace's bill of materials."""
    from . import bom
    wid = bom._ws(db, body.get('workspace'))
    pkgs = [(a['purl'], a['name']) for a in bom._rows(db, wid, 'asset') if re.match(r'^pkg:(pypi|npm)/.+@.+', a.get('purl') or '')]
    if not pkgs:
        return {'checked': 0, 'found': 0, 'checked_at': _now(), 'note': 'No PyPI or npm packages with versions in this inventory.'}
    try:
        res = call('/querybatch', {'queries': [{'package': {'purl': p}} for p, _ in pkgs]})
        hits = {}
        for (purl, name), r in zip(pkgs, res.get('results') or []):
            for v in r.get('vulns') or []:
                hits.setdefault(v['id'], []).append(name)
        found = []
        for vid in sorted(hits)[:40]:
            d = call('/vulns/' + vid)
            found.append({'id': vid, 'summary': (d.get('summary') or d.get('details') or '')[:300], 'aliases': d.get('aliases') or [],
                          'published': (d.get('published') or '')[:10], 'url': 'https://osv.dev/vulnerability/' + vid, 'assets': sorted(set(hits[vid]))})
    except Exception as exc:
        raise _problem(f'Could not reach OSV (api.osv.dev): {type(exc).__name__}. The server needs outbound HTTPS to check advisories.', 502)
    for f in found:
        bom._put(db, wid, 'advisory', f['id'], f)
    bom._put(db, wid, 'advisory_check', 'last', {'checked_at': _now(), 'packages': len(pkgs), 'found': len(found)})
    db.commit()
    return {'checked': len(pkgs), 'found': len(found), 'checked_at': _now(), 'items': found}


# ---------------------------------------------------------------- AI-enabled threats

def _band(score):
    return 'critical' if score >= 13 else 'high' if score >= 9 else 'medium' if score >= 5 else 'low'


def register(db, wid):
    from . import bom
    wid = bom._ws(db, wid)
    pack = SECTORS['sectors'].get(bom.profile(db, wid).get('sector') or '')
    prio = pack['priority_register'] if pack else []
    out = []
    for t in REGISTER['register']:
        s = bom._get(db, wid, 'register', t['id']) or {}
        L = s.get('likelihood', t['default']['likelihood'])
        I = s.get('impact', t['default']['impact'])
        controls = [{**c, 'status': (s.get('controls') or {}).get(c['id'], 'none')} for c in t['controls']]
        rl = max(1, L - sum(1 for c in controls if c['status'] == 'in_place' and c['reduces'] == 'likelihood'))
        ri = max(1, I - sum(1 for c in controls if c['status'] == 'in_place' and c['reduces'] == 'impact'))
        out.append({**{k: t[k] for k in ('id', 'title', 'what', 'techniques')}, 'controls': controls, 'likelihood': L, 'impact': I,
                    'inherent': L * I, 'inherent_band': _band(L * I), 'residual_likelihood': rl, 'residual_impact': ri,
                    'residual': rl * ri, 'residual_band': _band(rl * ri), 'assessed': bool(s), 'owner': s.get('owner', ''),
                    'note': s.get('note', ''), 'assessed_at': s.get('assessed_at'), 'priority': t['id'] in prio})
    return sorted(out, key=lambda r: (not r['priority'], -r['residual']))


def save_register(db, body):
    from . import bom
    wid = bom._ws(db, body.get('workspace'))
    t = next((x for x in REGISTER['register'] if x['id'] == body.get('id')), None)
    if not t:
        raise _problem('Unknown AI-enabled threat', 404)
    L, I = body.get('likelihood'), body.get('impact')
    if type(L) is not int or type(I) is not int or not (1 <= L <= 4 and 1 <= I <= 4):
        raise _problem('likelihood and impact must be 1–4')
    ctrl = body.get('controls') or {}
    valid = {c['id'] for c in t['controls']}
    if not isinstance(ctrl, dict) or not set(ctrl) <= valid or not all(v in ('in_place', 'planned', 'none') for v in ctrl.values()):
        raise _problem('controls must map known control ids to in_place, planned or none')
    bom._put(db, wid, 'register', t['id'], {'likelihood': L, 'impact': I, 'controls': ctrl, 'assessed_at': _now(),
                                            'owner': bom._text(body.get('owner'), 'Owner', 120, False),
                                            'note': bom._text(body.get('note'), 'Note', 1000, False)})
    db.commit()
    return next(r for r in register(db, wid) if r['id'] == t['id'])


# ---------------------------------------------------------------- gaps

def open_gap(db, body):
    from . import bom
    wid = bom._ws(db, body.get('workspace'))
    if body.get('card') not in CARD:
        raise _problem('Unknown threat card', 404)
    g = {'card': body['card'], 'status': 'open', 'note': bom._text(body.get('note'), 'Note', 1000),
         'owner': bom._text(body.get('owner'), 'Owner', 120, False), 'planned': bom._text(body.get('planned'), 'Plan', 200, False) or
         'Attack-range pack in Phase 3', 'opened_at': _now()}
    bom._put(db, wid, 'gap', g['card'], g)
    db.commit()
    return g


def close_gap(db, body):
    from . import bom
    wid = bom._ws(db, body.get('workspace'))
    g = bom._get(db, wid, 'gap', body.get('card'))
    if not g:
        raise _problem('No gap recorded for this card', 404)
    g.update(status='closed', closed_at=_now(), resolution=bom._text(body.get('resolution'), 'Resolution', 1000))
    bom._put(db, wid, 'gap', g['card'], g)
    db.commit()
    return g


# ---------------------------------------------------------------- snapshot

def coverage(cards):
    high = [c for c in cards if c['band'] == 'high']
    uncovered = [c['id'] for c in high if c['coverage'] == 'none']
    return {'high': len(high), 'tested': sum(c['coverage'] == 'tested' for c in high), 'gaps': sum(c['coverage'] == 'gap' for c in high),
            'uncovered': uncovered, 'ok': not uncovered}


def _markdown(s):
    L = [f"# AI threat landscape · {s['workspace_name']} · {s['month']}", '',
         f"Generated {s['generated_at'][:10]} from SoCHarness AI Security Lab. Pinned taxonomies: " +
         ', '.join(f"{v['name']} {v['version']}" for v in s['versions']) + '.', '',
         '## Headline', '',
         f"- {s['counts']['high']} high, {s['counts']['medium']} medium and {s['counts']['low']} low relevance threats across {s['counts']['applications']} applications.",
         f"- Coverage of high threats: {s['coverage']['tested']} with a test, {s['coverage']['gaps']} with an open gap, "
         f"{len(s['coverage']['uncovered'])} with neither.",
         f"- {len(s['new_items'])} feed items dated {s['month']}.", '', '## Threats by relevance', '',
         '| Threat | Relevance | Score | Coverage | Applications |', '| --- | --- | --- | --- | --- |']
    for c in s['cards']:
        if c['band'] == 'none':
            continue
        apps = ', '.join(a['name'] for a in c['apps'] if not a['excluded']) or '-'
        L.append(f"| {c['title']} | {c['band']} | {c['score']} | {c['coverage']} | {apps} |")
    L += ['', '## AI-enabled threats against the company', '', '| Threat | Inherent | Residual | Assessed |', '| --- | --- | --- | --- |']
    for r in s['register']:
        L.append(f"| {r['title']} | {r['inherent']} ({r['inherent_band']}) | {r['residual']} ({r['residual_band']}) | {'yes' if r['assessed'] else 'no'} |")
    if s['new_items']:
        L += ['', f"## New this month", '']
        L += [f"- [{i['title']}]({i['url']}) ({FEED_KINDS.get(i['kind'], i['kind'])})" for i in s['new_items']]
    if s.get('sector'):
        L += ['', f"## {s['sector']['label']} guidance", '']
        L += [f"- [{g['name']}]({g['url']}) ({g['date']}): {g['why']}" for g in s['sector']['guidance']]
    L += ['', 'Relevance is computed from the inventory and threat models with explicit rules; see each card for its reasons.']
    return '\n'.join(L) + '\n'


def snapshot(db, body, today=None):
    import aisec
    from . import bom
    wid = bom._ws(db, body.get('workspace'))
    month = body.get('month') or (today or date.today()).strftime('%Y-%m')
    if not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', str(month)):
        raise _problem('month must be YYYY-MM')
    cards = relevance(db, wid, today)
    items = feed(db, wid, cards)
    reg = register(db, wid)
    profile = bom.profile(db, wid)
    pack = SECTORS['sectors'].get(profile.get('sector') or '')
    w = aisec._workspace(db, wid)
    s = {'month': month, 'generated_at': _now(), 'workspace': wid, 'workspace_name': w['name'], 'versions': aisec.versions(),
         'counts': {b: sum(c['band'] == b for c in cards) for b in ('high', 'medium', 'low', 'none')} |
                   {'applications': len(bom._rows(db, wid, 'application')), 'assets': len(bom._rows(db, wid, 'asset'))},
         'coverage': coverage(cards), 'cards': cards, 'heatmap': heatmap(cards, db, wid),
         'new_items': [i for i in items if str(i.get('published') or '').startswith(month)][:40],
         'register': reg, 'sector': pack, 'profile': {k: profile[k] for k in ('sector', 'risk_appetite', 'regulators')}}
    s['markdown'] = _markdown(s)
    bom._put(db, wid, 'snapshot', month, s)
    db.commit()
    return s


def snapshots(db, wid):
    from . import bom
    return [{'month': s['month'], 'generated_at': s['generated_at'], 'counts': s['counts'], 'coverage': s['coverage']}
            for s in sorted(bom._rows(db, wid, 'snapshot'), key=lambda s: s['month'], reverse=True)]


def get_snapshot(db, wid, month):
    from . import bom
    s = bom._get(db, bom._ws(db, wid), 'snapshot', month)
    if not s:
        raise _problem('No snapshot for that month', 404)
    return s


def overview(db, wid, today=None):
    from . import bom
    wid = bom._ws(db, wid)
    cards = relevance(db, wid, today)
    profile = bom.profile(db, wid)
    return {'workspace': wid, 'cards': cards, 'heatmap': heatmap(cards, db, wid), 'feed': feed(db, wid, cards),
            'feed_kinds': FEED_KINDS, 'register': register(db, wid), 'sector': SECTORS['sectors'].get(profile.get('sector') or ''),
            'sector_id': profile.get('sector'), 'gaps': _gaps(db, wid), 'coverage': coverage(cards), 'snapshots': snapshots(db, wid),
            'advisory_check': bom._get(db, wid, 'advisory_check', 'last'), 'risk_appetite': profile['risk_appetite'],
            'notes': {'cards': json.loads((HERE/'cards.json').read_text(encoding='utf-8'))['note'], 'sectors': SECTORS['note'],
                      'register': REGISTER['note'], 'feed': FEED['note']}}
