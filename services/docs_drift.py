"""Check that the APIs named in the Harness Lab learning content still exist.

The deep-dive chapters (frontend/src/lib/deep/*.ts) and the comparison view
(frontend/src/lib/compare/*.ts) contain real code for eleven frameworks. Upstream
APIs move every month, so this script extracts every import and every
`ImportedName.attribute` from those snippets and resolves them against the SDK
versions that Relay actually installs:

* Python snippets are checked with the main interpreter and, if configured, the
  isolated extended-worker interpreter (RELAY_GOOGLE_ADK_PYTHON and friends).
* TypeScript snippets are checked with Node from workers/agent-bridge.

Statuses: ok, missing (package installed, name gone: real drift), not_installed
(package absent in this environment: skipped), type_only (TypeScript name not
present at runtime; usually a type, reported but not failed).

It also reports the threat taxonomies the AI Security Lab pins (MITRE ATLAS,
OWASP Top 10 for LLM and for Agentic Applications): ATLAS is compared with the
latest release in mitre-atlas/atlas-data; the OWASP lists have no machine-readable
feed, so they are reported with the date they were last checked by hand and
flagged as stale after 180 days. Taxonomy findings never change the exit code.

    python services/docs_drift.py            # human summary, exit 1 on API drift
    python services/docs_drift.py --json out.json
    python services/docs_drift.py --offline  # skip the upstream ATLAS lookup
"""
import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTENT = [ROOT/'frontend/src/lib/deep', ROOT/'frontend/src/lib/compare']
BRIDGE = ROOT/'workers/agent-bridge'

TEMPLATE = re.compile(r'(?:src|code):\s*`((?:\\.|[^`\\])*)`', re.S)
PY_FROM = re.compile(r'^\s*from\s+([\w.]+)\s+import\s+(?:\(([^)]*)\)|([^(\n]+)$)', re.M)
PY_IMPORT = re.compile(r'^\s*import\s+([\w.]+)(?:\s+as\s+(\w+))?\s*$', re.M)
TS_IMPORT = re.compile(r'import\s*\{([^}]*)\}\s*from\s*[\'"]([^\'"]+)[\'"]')


def unescape(src):
    return src.replace('\\`', '`').replace('\\${', '${').replace('\\\\', '\\')


def language(code):
    if TS_IMPORT.search(code) or re.search(r'^\s*(const|let|await|export)\s', code, re.M) and 'def ' not in code:
        return 'ts'
    if PY_FROM.search(code) or PY_IMPORT.search(code) or 'def ' in code:
        return 'python'
    return 'other'


def snippets():
    """Yield (file, framework_or_mechanism, code) for every snippet in the learning content."""
    for folder in CONTENT:
        for file in sorted(folder.glob('*.ts')):
            if file.name in ('types.ts', 'index.ts', 'live.ts'):
                continue
            text = file.read_text(encoding='utf-8')
            for match in TEMPLATE.finditer(text):
                yield str(file.relative_to(ROOT)), file.stem, unescape(match.group(1))


def python_refs(code):
    """Imports and attribute uses: [(module, name_or_None, attr_or_None)]."""
    refs, local = [], {}
    clean = re.sub(r'#.*', '', code)
    for module, grouped, plain in PY_FROM.findall(clean):
        names = grouped or plain
        if module.startswith('.'):
            continue
        for part in names.replace('\n', ' ').split(','):
            part = part.strip().strip('()').strip()
            if not part or part == '*':
                continue
            name, _, alias = part.partition(' as ')
            name = name.strip()
            refs.append((module, name, None))
            local[(alias or name).strip()] = (module, name)
    for module, alias in PY_IMPORT.findall(clean):
        refs.append((module, None, None))
        local[alias or module.split('.')[0]] = (module, None)
    for name, (module, imported) in local.items():
        for attr in set(re.findall(r'\b' + re.escape(name) + r'\.([A-Za-z_]\w*)', clean)):
            refs.append((module, imported, attr))
    return refs


def ts_refs(code):
    refs = []
    for names, package in TS_IMPORT.findall(code):
        for part in names.split(','):
            part = part.strip()
            if not part or part.startswith('type '):
                continue
            refs.append((package, part.split(' as ')[0].strip(), None))
    return refs


PY_PROBE = r'''
import importlib, importlib.metadata, importlib.util, json, sys
out = []
for module, name, attr in json.load(sys.stdin):
    top = module.split('.')[0]
    try:
        mod = importlib.import_module(module)
    except ModuleNotFoundError as exc:
        # A missing top-level package, or a missing child of a namespace package
        # (google.adk, google.genai), is a separately installed distribution.
        parts = (exc.name or top).split('.')
        absent = len(parts) == 1
        if not absent:
            try:
                spec = importlib.util.find_spec('.'.join(parts[:-1]))
                absent = spec is None or spec.origin in (None, 'namespace')
            except Exception:
                absent = True
        out.append([module, name, attr, 'not_installed' if absent else 'missing', 'module: ' + str(exc)]); continue
    except Exception as exc:
        out.append([module, name, attr, 'not_installed', type(exc).__name__ + ': ' + str(exc)[:120]]); continue
    obj, status, note = mod, 'ok', ''
    if name:
        if hasattr(mod, name):
            obj = getattr(mod, name)
        else:
            try:
                obj = importlib.import_module(module + '.' + name)
            except Exception:
                status, note = 'missing', module + ' has no ' + name
    if status == 'ok' and attr and not hasattr(obj, attr):
        status, note = 'missing', (name or module) + ' has no attribute ' + attr
    out.append([module, name, attr, status, note])
print(json.dumps(out))
'''

TS_PROBE = r'''
const refs = JSON.parse(require('fs').readFileSync(0, 'utf8'));
(async () => {
  const out = [];
  for (const [pkg, name] of refs) {
    let mod;
    try { mod = await import(pkg); }
    catch (e) { out.push([pkg, name, null, String(e.code || '').includes('NOT_FOUND') ? 'not_installed' : 'missing', String(e.message).slice(0, 120)]); continue; }
    out.push([pkg, name, null, name in mod || (mod.default && name in mod.default) ? 'ok' : 'type_only', name in mod ? '' : 'not a runtime export (type or removed)']);
  }
  console.log(JSON.stringify(out));
})();
'''


def interpreters():
    seen, out = set(), []
    for value in [sys.executable] + [os.getenv(k) for k in ('RELAY_GOOGLE_ADK_PYTHON', 'RELAY_MICROSOFT_PYTHON', 'RELAY_OPENHANDS_PYTHON', 'RELAY_HERMES_PYTHON')]:
        if value and value not in seen and Path(value).exists():
            seen.add(value)
            out.append(value)
    return out


def probe_python(refs):
    """Resolve each ref with every interpreter; the best status wins (ok > missing > not_installed)."""
    rank = {'ok': 0, 'missing': 1, 'not_installed': 2}
    best = {}
    for python in interpreters():
        try:
            result = subprocess.run([python, '-c', PY_PROBE], input=json.dumps(refs), capture_output=True, text=True, timeout=300)
            rows = json.loads(result.stdout or '[]')
        except (OSError, ValueError, subprocess.SubprocessError):
            continue
        for module, name, attr, status, note in rows:
            key = (module, name, attr)
            if key not in best or rank[status] < rank[best[key][0]]:
                best[key] = (status, note)
    return {tuple(k): v for k, v in best.items()}


def probe_ts(refs):
    node = os.getenv('RELAY_NODE') or 'node'
    try:
        result = subprocess.run([node, '-e', TS_PROBE], input=json.dumps(refs), capture_output=True, text=True,
                                cwd=str(BRIDGE), timeout=300)
        rows = json.loads(result.stdout or '[]')
    except (OSError, ValueError, subprocess.SubprocessError):
        return {}
    return {(pkg, name, None): (status, note) for pkg, name, _, status, note in rows}


def check():
    found = []  # (file, owner, lang, ref)
    for file, owner, code in snippets():
        lang = language(code)
        refs = python_refs(code) if lang == 'python' else ts_refs(code) if lang == 'ts' else []
        found += [(file, owner, lang, ref) for ref in refs]
    py = sorted({r for *_, lang, r in found if lang == 'python'}, key=str)
    ts = sorted({r for *_, lang, r in found if lang == 'ts'}, key=str)
    results = {**probe_python([list(r) for r in py]), **probe_ts([list(r) for r in ts])}
    report = []
    for file, owner, lang, ref in found:
        status, note = results.get(tuple(ref), ('not_installed', 'probe unavailable'))
        report.append({'file': file, 'owner': owner, 'lang': lang, 'module': ref[0], 'name': ref[1], 'attr': ref[2],
                       'status': status, 'note': note})
    return report


ATLAS_MANIFEST = 'https://raw.githubusercontent.com/mitre-atlas/atlas-data/main/dist/manifest.yaml'
STALE_DAYS = 180


def _fetch(url):
    import urllib.request
    with urllib.request.urlopen(url, timeout=10) as r:
        return r.read(200_000).decode('utf-8', 'replace')


def latest_atlas_release(fetch=_fetch):
    """The newest release named in atlas-data's manifest (its first entry), or None."""
    try:
        m = re.search(r"^- release:\s*'?([0-9][0-9.]*)'?", fetch(ATLAS_MANIFEST), re.M)
    except Exception:
        return None
    return m.group(1) if m else None


def taxonomies(online=True, fetch=_fetch, today=None):
    import datetime
    sys.path.insert(0, str(Path(__file__).parent))
    import aisec
    today = today or datetime.date.today()
    rows = []
    for v in aisec.versions():
        row = {'id': v['id'], 'name': v['name'], 'pinned': v['version']}
        if v['id'] == 'atlas':
            latest = latest_atlas_release(fetch) if online else None
            row['upstream'] = latest
            row['status'] = 'skipped' if not online else 'unknown' if latest is None else \
                'current' if latest == v['version'] else 'newer_upstream' if latest > v['version'] else 'current'
            row['note'] = 'Re-pin with services/aisec/pin_atlas.py' if row['status'] == 'newer_upstream' else ''
        else:
            age = (today - datetime.date.fromisoformat(v['checked'])).days
            row['checked'] = v['checked']
            row['status'] = 'stale' if age > STALE_DAYS else 'manual'
            row['note'] = f"checked by hand {age} days ago at {v['url']}"
        rows.append(row)
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--json', help='write the full report to this file')
    parser.add_argument('--offline', action='store_true', help='do not look up the latest ATLAS release')
    args = parser.parse_args()
    report = check()
    tax = taxonomies(online=not args.offline)
    if args.json:
        Path(args.json).write_text(json.dumps({'api': report, 'taxonomies': tax}, indent=2), encoding='utf-8')
    counts = {}
    for row in report:
        counts[row['status']] = counts.get(row['status'], 0) + 1
    print('Learning-content API check:', ', '.join(f'{k} {v}' for k, v in sorted(counts.items())) or 'no references')
    seen = set()
    for row in report:
        if row['status'] not in ('missing', 'type_only'):
            continue
        key = (row['file'], row['module'], row['name'], row['attr'])
        if key in seen:
            continue
        seen.add(key)
        ref = row['module'] + (':' + row['name'] if row['name'] else '') + ('.' + row['attr'] if row['attr'] else '')
        print(f"  {row['status'].upper():9} {row['file']}  {ref}  ({row['note']})")
    print('Threat taxonomies:')
    for t in tax:
        upstream = f" (upstream {t['upstream']})" if t.get('upstream') else ''
        print(f"  {t['status'].upper():14} {t['name']} {t['pinned']}{upstream}" + (f"  {t['note']}" if t['note'] else ''))
    return 1 if counts.get('missing') else 0


if __name__ == '__main__':
    raise SystemExit(main())
