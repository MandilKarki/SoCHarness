"""Native SDK file operations are limited to flat, session-owned text workspaces."""
import os
import re
import subprocess
from pathlib import Path
from store import ROOT, DATA, Problem

BASE = DATA/'native-workspaces'

def directory(sid):
    if not re.fullmatch(r'ses_[a-f0-9]{32}',sid):raise Problem('Invalid session workspace',400)
    root=BASE/sid
    # A parent junction/symlink must not redirect any workspace operation.
    base=BASE.absolute()
    if base.resolve()!=base:raise Problem('Workspace base must not be redirected',403)
    root.mkdir(parents=True,exist_ok=True)
    if root.resolve()!=root.absolute():raise Problem('Workspace must not be redirected',403)
    return root

def checked_path(sid,value):
    if not isinstance(value,str):raise Problem('File path must be text')
    root=directory(sid)
    candidate=Path(value)
    if not candidate.is_absolute():candidate=root/candidate
    if candidate.parent.resolve()!=root.resolve():raise Problem('Only files directly in this session workspace are allowed',403)
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,74}\.(md|txt|json)',candidate.name) or '..' in candidate.name:
        raise Problem('Only simple .md, .txt and .json filenames are allowed',403)
    if candidate.name.split('.')[0].upper() in {'CON','PRN','AUX','NUL',*(f'COM{i}' for i in range(1,10)),*(f'LPT{i}' for i in range(1,10))}:raise Problem('Device names are forbidden',403)
    if candidate.is_symlink() or candidate.resolve()!=candidate.absolute():raise Problem('Redirected file paths are forbidden',403)
    return candidate

def validate_tool(sid,name,args,config):
    if not config.get('file_workspace') or name not in ('Read','Write','Edit'):raise Problem('Native file tool not enabled',403)
    path=checked_path(sid,args.get('file_path'))
    if path.exists() and (not path.is_file() or path.stat().st_size>64000):raise Problem('Only text files up to 64 KB are supported',403)
    if name in ('Write','Edit'):
        if config['permission']=='read_only':raise Problem('Read-only policy denies native edits',403)
        content=args.get('content') if name=='Write' else args.get('new_string')
        if not isinstance(content,str) or len(content.encode('utf-8'))>32000:raise Problem('Native edit is too large or invalid')
    return {**args,'file_path':str(path)}

def snapshot(store,sid):
    s=store.session(sid)
    if not s['config']['file_workspace']:return {'enabled':False,'files':[],'checkpoints':[]}
    root=directory(sid)
    files=[]
    for path in list(root.iterdir())[:100]:
        try:
            checked_path(sid,str(path))
            if path.is_file():files.append({'name':path.name,'bytes':path.stat().st_size})
        except Problem:continue
    checkpoints=[{'seq':e['seq'],**e['payload']} for e in store.traces(sid) if e['kind']=='sdk.file_checkpoint']
    return {'enabled':True,'files':files,'checkpoints':checkpoints,'boundary':'Session text files only; not an OS sandbox'}

def read(store,sid,name):
    if not store.session(sid)['config']['file_workspace']:raise Problem('Native workspace disabled',403)
    path=checked_path(sid,name)
    if not path.is_file():raise Problem('Workspace file not found',404)
    if path.stat().st_size>64000:raise Problem('Workspace file exceeds the read limit',413)
    return {'name':path.name,'content':path.read_text(encoding='utf-8')}

def rewind(store,sid,checkpoint_seq):
    from engine import ACTIVE
    if sid in ACTIVE:raise Problem('Stop the active SDK run before rewinding files',409)
    s=store.session(sid)
    if not s['config']['file_workspace']:raise Problem('Native workspace is disabled',403)
    cp=next((e for e in store.traces(sid) if e['seq']==checkpoint_seq and e['kind']=='sdk.file_checkpoint'),None)
    if not cp:raise Problem('Native checkpoint not found in this session',404)
    sdk_id=cp['payload'].get('sdk_session');message_id=cp['payload'].get('uuid')
    uuid_pattern=r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}'
    if not isinstance(sdk_id,str) or not isinstance(message_id,str) or not re.fullmatch(uuid_pattern,sdk_id) or not re.fullmatch(uuid_pattern,message_id):raise Problem('Invalid SDK checkpoint identity')
    root=directory(sid)
    for path in root.iterdir():checked_path(sid,str(path))
    import claude_agent_sdk
    executable=Path(claude_agent_sdk.__file__).parent/'_bundled'/('claude.exe' if os.name=='nt' else 'claude')
    if not executable.is_file():raise Problem('Bundled Claude executable unavailable',503)
    env={**__import__('child_env').claude_environment(),'CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING':'true'}
    result=subprocess.run([str(executable),'-p','--setting-sources=','--strict-mcp-config','--resume',sdk_id,'--rewind-files',message_id],
        cwd=root,env=env,capture_output=True,text=True,timeout=30)
    if result.returncode:raise Problem('SDK rewind failed; no success is claimed. '+result.stderr[:300],502)
    return {'checkpoint_seq':checkpoint_seq,'uuid':message_id,'sdk_session':sdk_id,'rewound':True,'scope':'native session workspace','output':result.stdout[:600]}
