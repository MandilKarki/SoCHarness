"""Export all versioned mapping cells without opening a database or calling a model."""
import argparse
import json
from pathlib import Path
from inventory import ROWS, DOCS
from sdk_audit import MANIFEST, cell_metadata, framework_metadata

def grid():
    rows=[]
    for key,label,category,upstream,native,shared,partial,note in ROWS:
        for runtime in MANIFEST['sdks']:
            status='native' if runtime in native else 'shared' if runtime in shared else 'partial' if runtime in partial else 'gap'
            support='documented' if runtime in upstream else 'not assessed'
            boundary=note
            if runtime=='pi' and key in ('planning','approvals','mcp','subagents'):
                support='extension pattern'
                boundary+=' Pi documents these as extension patterns, not built-in plan mode, permission popups, MCP or subagents.'
            if runtime=='hermes' and key in ('mcp','cancellation'): support='documented'
            rows.append({'runtime':runtime,'capability':key,'label':label,'category':category,
                         'integration':status,'upstream':support,
                         'source':DOCS[runtime],'boundary':boundary,**cell_metadata(runtime,key,status)})
    return {'reviewed':MANIFEST['reviewed'],'scope':MANIFEST['scope'],
            'frameworks':[{ 'id':key,**framework_metadata(key),'version_state':'not inspected (static export)'} for key in MANIFEST['sdks']],
            'cells':rows,'candidates':MANIFEST['candidates'],
            'verification':'Mapping export only; consult SDK_AUDIT.txt for actual execution results. Missing installed versions mean this export did not inspect the running environment.'}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output',type=Path)
    target=parser.parse_args().output
    target.parent.mkdir(parents=True,exist_ok=True)
    value=grid()
    target.write_text(json.dumps(value,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'cells':len(value['cells']),'sdk_count':len(value['frameworks']),'model_calls':0,'output':str(target)}))
