"""Export user-facing coverage artifacts and a source-only checkpoint archive."""
import argparse
import csv
import json
import zipfile
from pathlib import Path
from access import Access, deployment_status
from inventory import inventory
from store import Store, ROOT


def export(destination):
    destination=Path(destination);destination.mkdir(parents=True,exist_ok=True)
    with Store() as store:data=inventory(store)
    (destination/'relay-capabilities.json').write_text(json.dumps(data,indent=2),encoding='utf-8')
    (destination/'relay-deployment-readiness.json').write_text(json.dumps(deployment_status(Access(mode='local')),indent=2),encoding='utf-8')
    with (destination/'relay-capability-matrix.csv').open('w',newline='',encoding='utf-8-sig') as stream:
        writer=csv.writer(stream);writer.writerow(['Capability','Category']+[f['name'] for f in data['frameworks']])
        for row in data['rows']:
            writer.writerow([row['label'],row['category']]+[row['cells'][f['id']]['status']+' | upstream '+row['cells'][f['id']]['upstream'] for f in data['frameworks']])
    with (destination/'relay-tool-matrix.csv').open('w',newline='',encoding='utf-8-sig') as stream:
        writer=csv.writer(stream);writer.writerow(['Tool','Effect','Feature toggle','Runtimes','Description','Boundary'])
        for tool in data['tools']:writer.writerow([tool['name'],tool['effect'],tool.get('feature','standard'),', '.join(tool['runtimes']),tool['description'],tool['boundary']])
    (destination/'relay-deployment-guide.txt').write_text((ROOT/'DEPLOYMENT.txt').read_text(encoding='utf-8'),encoding='utf-8')
    files=[]
    for directory in ('services','web','plugins'):
        files.extend(p for p in (ROOT/directory).rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.suffix in ('.py','.js','.css','.html','.md','.txt','.json'))
    files.extend((ROOT/'workers/agent-bridge').glob('*.mjs'))
    files.extend((ROOT/'workers/agent-bridge/test').glob('*.mjs'))
    files.extend((ROOT/'.github/workflows').glob('*.yml'))
    files.extend(ROOT/p for p in ('README.md','DEPLOYMENT.txt','Dockerfile','.dockerignore','fly.toml','start.ps1','install-agents.ps1','requirements-agents.txt','requirements-agents.lock','requirements-claude.txt','workers/agent-bridge/package.json','workers/agent-bridge/package-lock.json'))
    with zipfile.ZipFile(destination/'relay-ui-deployment-source.zip','w',zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(set(files)):
            if path.is_file():archive.write(path,path.relative_to(ROOT))
    print(json.dumps({'directory':str(destination),'frameworks':len(data['frameworks']),'capability_families':len(data['rows']),'tools':len(data['tools']),'features':len(data['features']),'source_files':len(set(files))}))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('destination',type=Path)
    export(parser.parse_args().destination)
