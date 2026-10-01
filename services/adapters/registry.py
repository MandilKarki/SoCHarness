"""Allowlisted adapter registry, setup diagnostics and per-install enable switches."""
import importlib.metadata
import os
from pathlib import Path
import shutil
import subprocess
from functools import lru_cache
from store import ROOT, Problem

COMMON = ['streaming','tools','approvals','human_input','sessions','memory','skills','artifacts','cancellation','usage']
ADAPTERS = {
 'simulator':dict(name='Deterministic replay',module=None,key=None,model='replay',features=['tools','approvals','sessions','memory','skills','artifacts'],docs=''),
 'claude':dict(name='Claude Agent SDK',module='claude-agent-sdk',key='ANTHROPIC_API_KEY',model='sonnet',features=COMMON+['structured_output','specialists','file_workspace','native_resume','usd_budget'],docs='https://code.claude.com/docs/en/agent-sdk/overview'),
 'pydantic':dict(name='PydanticAI',module='pydantic-ai-slim',key='ANTHROPIC_API_KEY',model='claude-sonnet-4-5',features=COMMON+['structured_output'],docs='https://ai.pydantic.dev/agents/'),
 'deepagents':dict(name='Deep Agents',module='deepagents',key='ANTHROPIC_API_KEY',model='claude-sonnet-4-5',features=COMMON+['planning'],docs='https://docs.langchain.com/oss/python/deepagents/overview'),
 'pi':dict(name='Pi',package='@earendil-works/pi-coding-agent',key='ANTHROPIC_API_KEY',model='claude-sonnet-4-5',features=COMMON+['thinking'],docs='https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs'),
 'vercel':dict(name='Vercel AI SDK',package='ai',key='AI_GATEWAY_API_KEY',model='anthropic/claude-sonnet-4.5',features=COMMON+['structured_output'],docs='https://ai-sdk.dev/docs/agents/building-agents'),
 'opencode':dict(name='OpenCode',package='@opencode-ai/sdk',key='RELAY_OPENCODE_URL',model='anthropic/claude-sonnet-4-5',features=['sessions','cancellation','usage','evidence_snapshot'],docs='https://opencode.ai/docs/sdk/'),
}
ENTRYPOINTS = {
 'claude':'claude_runtime:run_claude',
 'pydantic':'adapters.pydantic_runtime:run_pydantic',
 'deepagents':'adapters.deep_runtime:run_deep',
 'pi':'adapters.node_runtime:run_node',
 'vercel':'adapters.node_runtime:run_node',
 'opencode':'adapters.node_runtime:run_node',
}
DEFERRED = {
 'pydantic':['Native durable execution backends','Native capabilities/harness plugins','Multi-agent delegation','Native message serialization','External MCP','Multimodal/realtime','Native spend limits'],
 'deepagents':['Native graph checkpoint persistence','Subagent delegation','Native filesystem backends','Native skills discovery','Dynamic/async subagents','Remote deployment'],
 'pi':['Native JSONL branching','Steering/follow-up queue','Native compaction','Third-party extensions','Native skills discovery','OAuth storage','External MCP'],
 'vercel':['useChat UI protocol','Native workflow persistence','Subagents','Native approval protocol','External MCP','Multimodal/embeddings'],
 'opencode':['Case-tool MCP bridge','SSE streaming','Native permission UI','Native rewind','External plugins','File/shell tools','Native structured output'],
 'claude':['Arbitrary external MCP','Third-party executable plugins','Production hosting/RBAC'],
 'simulator':['Model reasoning'],
}

@lru_cache(maxsize=1)
def node_binary():
    candidates=[os.getenv('RELAY_NODE'),str(Path.home()/'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'),shutil.which('node')]
    for candidate in candidates:
        if not candidate or not Path(candidate).is_file():continue
        try:
            version=subprocess.check_output([candidate,'--version'],text=True,timeout=5).strip().lstrip('v')
            if tuple(map(int,version.split('.')[:2])) >= (22,19):return candidate
        except (OSError,ValueError,subprocess.SubprocessError):pass
    return None

def version(spec):
    if spec.get('module'):
        try:return importlib.metadata.version(spec['module'])
        except importlib.metadata.PackageNotFoundError:return None
    if spec.get('package'):
        import json
        file=ROOT/'workers/agent-bridge/node_modules'/spec['package']/'package.json'
        try:return json.loads(file.read_text(encoding='utf-8'))['version']
        except (OSError,ValueError,KeyError):return None
    return 'built-in'

def catalog(store=None):
    switches={r['id']:bool(r['enabled']) for r in store.db.execute('SELECT * FROM relay_adapters')} if store else {}
    items=[]
    for id,spec in ADAPTERS.items():
        installed=version(spec);enabled=switches.get(id,True);requirements=[]
        if not installed:requirements.append('Install '+str(spec.get('module') or spec.get('package')))
        if spec.get('package') and not node_binary():requirements.append('Node >=22.19 required (RELAY_NODE)')
        if spec.get('key') and not os.getenv(spec['key']):requirements.append('Set server-side '+spec['key'])
        if id=='opencode':requirements.append('Dedicated deny-all OpenCode server; snapshot-only connector')
        ready=bool(installed) and (not spec.get('package') or bool(node_binary())) and (not spec.get('key') or bool(os.getenv(spec['key'])))
        items.append(dict(id=id,name=spec['name'],available=ready and enabled,enabled=enabled,installed=bool(installed),version=installed,
            detail=('Disabled for this installation. ' if not enabled else '')+('Local evidence replay; no model or provider calls.' if id=='simulator' else ('; '.join(requirements) or 'Configured; live run not yet verified.')),
            default_model=spec['model'],features=spec['features'],deferred=DEFERRED[id],docs=spec['docs'],
            verification='local replay' if id=='simulator' else 'not live-verified',key=spec.get('key'),
            budget='SDK USD cap' if id=='claude' else ('Timeout only; OpenCode server controls tokens/cost' if id=='opencode' else 'No USD cap; bounded turns/output/time only')))
    return items

def set_enabled(store,id,enabled):
    if id not in ADAPTERS or id=='simulator':raise Problem('Unknown or non-toggleable adapter')
    if type(enabled) is not bool:raise Problem('enabled must be boolean')
    if not enabled:
        import json
        if any(json.loads(r['config'])['runtime']==id for r in store.db.execute("SELECT config FROM relay_sessions WHERE status='running'")):
            raise Problem('Stop active runs for this adapter before disabling it',409)
    store.db.execute('INSERT INTO relay_adapters(id,enabled) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled',(id,int(enabled)))
    store.db.commit()
    return next(r for r in catalog(store) if r['id']==id)

def validate(config):
    spec=ADAPTERS.get(config['runtime'])
    if not spec:raise Problem('Runtime adapter is not registered')
    if config['runtime']=='simulator':return
    for feature in ('specialists','file_workspace','structured_output','memory','skills','artifacts'):
        if config.get(feature) and feature not in spec['features']:raise Problem(feature+' is not integrated for '+spec['name'])
    if config['runtime'] not in ('simulator','claude') and not config.get('accept_no_usd_cap'):
        raise Problem('Acknowledge that this adapter has no hard USD budget cap')
    if config['runtime']=='opencode' and config['permission']!='read_only':raise Problem('OpenCode connector is snapshot-only and read-only')

def ensure_ready(store,id):
    item=next((r for r in catalog(store) if r['id']==id),None)
    if not item or not item['available']:raise Problem(item['detail'] if item else 'Unknown adapter',409)

async def run(engine,prompt):
    runtime=engine.store.session(engine.sid)['config']['runtime']
    ensure_ready(engine.store,runtime)
    if runtime not in ENTRYPOINTS:raise Problem('No live adapter entrypoint',409)
    import importlib
    module,name=ENTRYPOINTS[runtime].split(':')
    return await getattr(importlib.import_module(module),name)(engine,prompt)
