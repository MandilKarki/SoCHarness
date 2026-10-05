"""Pin a MITRE ATLAS release into services/aisec/taxonomy/atlas.json.

ATLAS is published as YAML in https://github.com/mitre-atlas/atlas-data
(Apache-2.0). Relay does not depend on PyYAML at runtime, so this script converts
one release once, keeping ATLAS's own text and ids; only fields the lab uses are
kept (case-study narratives are shortened to their first paragraph and link back).

    git clone --depth 1 https://github.com/mitre-atlas/atlas-data
    python services/aisec/pin_atlas.py atlas-data            # latest release
    python services/aisec/pin_atlas.py atlas-data 2026.09    # a named release

Requires PyYAML only when you run it.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

OUT = Path(__file__).with_name('taxonomy')/'atlas.json'
SITE = 'https://atlas.mitre.org'


def first_paragraph(text, limit=600):
    para = (text or '').strip().split('\n\n')[0].strip()
    return para if len(para) <= limit else para[:limit].rsplit(' ', 1)[0] + '…'


def release_notes(repo, keep=8):
    """Added techniques and case studies per release, from atlas-data's CHANGELOG.md."""
    path = Path(repo)/'CHANGELOG.md'
    if not path.exists():
        return []
    out, cur, section, mode = [], None, None, None
    for line in path.read_text(encoding='utf-8').splitlines():
        m = re.match(r'^## \[(\d{4}\.\d{2})\]\(\)\s*\((\d{4}-\d{2}-\d{2})\)', line)
        if m:
            if len(out) == keep:
                break
            cur = {'release': m.group(1), 'date': m.group(2), 'summary': '', 'added_techniques': [], 'added_case_studies': []}
            out.append(cur)
            section = mode = None
            continue
        if cur is None:
            continue
        if line.startswith('This version of ATLAS data contains'):
            cur['summary'] = line.strip()
        h = re.match(r'^###### (\w[\w ]*)', line)
        if h:
            section, mode = h.group(1).strip(), None
            continue
        if line.startswith('- Added new'):
            mode = 'added'
        elif line.startswith('- '):
            mode = None
        ref = re.match(r'^\s{2}- \[[^\]]*\]\(/(techniques|studies)/([A-Z0-9.]+)\)', line)
        if ref and mode == 'added':
            key = 'added_techniques' if ref.group(1) == 'techniques' and section == 'Techniques' else \
                'added_case_studies' if ref.group(1) == 'studies' else None
            if key:
                cur[key].append(ref.group(2))
    return out


def convert(repo, release=None):
    import yaml
    repo = Path(repo)
    manifest = yaml.safe_load((repo/'dist'/'manifest.yaml').read_text(encoding='utf-8'))
    entry = manifest[0] if release is None else next(m for m in manifest if str(m['release']) == release)
    path = repo/'dist'/entry['versions'][0]['path']
    data = yaml.safe_load(path.read_text(encoding='utf-8'))
    try:
        commit = subprocess.run(['git', '-C', str(repo), 'rev-parse', 'HEAD'], capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        commit = None
    rel = data['relationships']
    order = sorted(rel['ATLAS-matrix']['sequences'], key=lambda r: r['position'])
    achieves, parent, mitigates, employs = {}, {}, {}, {}
    for src, kinds in rel.items():
        for r in kinds.get('achieves', []):
            achieves.setdefault(src, []).append(r['target'])
        for r in kinds.get('specializes', []):
            parent[src] = r['target']
        for r in kinds.get('mitigates', []):
            mitigates.setdefault(r['target'], []).append({'id': src, 'how': (r.get('description') or '').strip()})
        for r in kinds.get('employs', []):
            employs.setdefault(r['target'], []).append(src)

    def refs(obj):
        return [{'title': r.get('title', '').strip(), 'url': r['url']} for r in obj.get('references') or [] if r.get('url')]

    techniques = {}
    for tid, t in data['techniques'].items():
        techniques[tid] = {'name': t['name'].strip(), 'description': (t.get('description') or '').strip(),
                           'platforms': t.get('platforms') or [], 'maturity': t.get('maturity'),
                           'created': str(t.get('created-date') or ''), 'modified': str(t.get('modified-date') or ''),
                           'parent': parent.get(tid), 'tactics': achieves.get(tid, []), 'references': refs(t),
                           'mitigations': mitigates.get(tid, []), 'case_studies': sorted(set(employs.get(tid, [])))}
    for tid, t in techniques.items():  # sub-techniques inherit their parent's tactics
        if t['parent'] and not t['tactics']:
            t['tactics'] = techniques[t['parent']]['tactics']
    notes = [n for n in release_notes(repo) if n['release'] <= str(entry['release'])]
    return {
        'releases': notes,
        'source': {'name': 'MITRE ATLAS', 'release': str(entry['release']), 'release_date': str(entry['release-date']),
                   'format_version': str(data.get('format-version')), 'repo': 'https://github.com/mitre-atlas/atlas-data',
                   'commit': commit, 'file': str(path.relative_to(repo)).replace('\\', '/'), 'site': SITE,
                   'license': 'Apache-2.0', 'converted_by': 'services/aisec/pin_atlas.py'},
        'tactics': [{'id': r['target'], 'name': data['tactics'][r['target']]['name'].strip(),
                     'description': data['tactics'][r['target']]['description'].strip()} for r in order],
        'techniques': techniques,
        'mitigations': {mid: {'name': m['name'].strip(), 'description': (m.get('description') or '').strip()}
                        for mid, m in data['mitigations'].items()},
        'case_studies': {cid: {'name': c['name'].strip(), 'summary': first_paragraph(c.get('description')),
                               'type': c.get('type'), 'date': str(c.get('date') or ''), 'actor': c.get('actor'),
                               'target': c.get('target'), 'references': [{'title': (r.get('title') or '').strip(), 'url': r['url']}
                                                                         for r in c.get('references') or [] if r.get('url')][:5]}
                         for cid, c in data['case-studies'].items()},
    }


if __name__ == '__main__':
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    out = convert(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(f"Pinned ATLAS {out['source']['release']}: {len(out['tactics'])} tactics, {len(out['techniques'])} techniques, "
          f"{len(out['mitigations'])} mitigations, {len(out['case_studies'])} case studies -> {OUT}")
