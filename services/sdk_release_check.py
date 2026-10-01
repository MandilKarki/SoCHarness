"""Read-only release discovery. No SDK imports, provider keys, installs or model calls.

Usage: python services/sdk_release_check.py [--offline] [--output report.json]
Remote version differences are review candidates, never automatic upgrades.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import urllib.request
from urllib.parse import quote
from sdk_audit import MANIFEST, validate_manifest

def check_release(item):
    runtime,spec = item
    result = {'runtime':runtime,'pinned':spec['pinned_version'],'release_source':spec['release_source']}
    if spec['registry']=='pypi': url='https://pypi.org/pypi/'+quote(spec['package'],safe='')+'/json'
    elif spec['registry']=='npm': url='https://registry.npmjs.org/'+quote(spec['package'],safe='')+'/latest'
    else: url='https://api.github.com/repos/'+spec['repository']+'/commits/HEAD'
    result['metadata_source']=url
    try:
        req=urllib.request.Request(url,headers={'User-Agent':'SoCHarness-read-only-release-audit/1.0','Accept':'application/json'})
        with urllib.request.urlopen(req,timeout=20) as response:
            body=response.read(8*1024*1024+1)
        if len(body)>8*1024*1024: raise ValueError('Oversized registry response')
        value=json.loads(body)
        latest=value['info']['version'] if spec['registry']=='pypi' else value['version'] if spec['registry']=='npm' else value['sha']
        result.update(latest=latest,status='matches pin' if latest==spec['pinned_version'] else 'review required',
                      metadata_sha256=hashlib.sha256(body).hexdigest(),
                      feature_review='Read official release notes and pinned-to-latest source diff; version metadata alone cannot establish feature changes.')
    except Exception as exc:
        result.update(status='unknown',error=type(exc).__name__,feature_review='Fetch failed; do not claim up-to-date.')
    return result

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline',action='store_true')
    parser.add_argument('--output',type=Path)
    args=parser.parse_args()
    errors=validate_manifest(Path(__file__).resolve().parents[1])
    with ThreadPoolExecutor(max_workers=4) as pool:
        releases=[] if args.offline else list(pool.map(check_release,MANIFEST['sdks'].items()))
    report={'checked_at':datetime.now(timezone.utc).isoformat(),'model_calls':0,'mode':'offline' if args.offline else 'registry metadata',
            'manifest_errors':errors,'releases':releases,'candidates':MANIFEST['candidates'],
            'scope':'All 11 registered adapters. Rolling documentation is not pinned-version proof. Companion dependency pins remain separately recorded in sdk_manifest.json.'}
    text=json.dumps(report,indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(text+'\n',encoding='utf-8')
    print(text)
    return 1 if errors or any(r['status']=='unknown' for r in releases) else 0

if __name__=='__main__': raise SystemExit(main())
