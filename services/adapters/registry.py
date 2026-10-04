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
 'claude':dict(name='Claude Agent SDK',module='claude-agent-sdk',key='ANTHROPIC_API_KEY',model='sonnet',features=COMMON+['structured_output','specialists','file_workspace','native_resume','usd_budget','thinking'],docs='https://code.claude.com/docs/en/agent-sdk/overview'),
 'pydantic':dict(name='PydanticAI',module='pydantic-ai-slim',key='ANTHROPIC_API_KEY',model='claude-sonnet-4-5',features=COMMON+['structured_output','native_resume'],docs='https://ai.pydantic.dev/agents/'),
 'deepagents':dict(name='Deep Agents',module='deepagents',key='ANTHROPIC_API_KEY',model='claude-sonnet-4-5',features=COMMON+['planning','native_resume','specialists','structured_output'],docs='https://docs.langchain.com/oss/python/deepagents/overview'),
 'pi':dict(name='Pi',package='@earendil-works/pi-coding-agent',key='ANTHROPIC_API_KEY',model='claude-sonnet-4-5',features=COMMON+['thinking','native_resume'],docs='https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs'),
 'vercel':dict(name='Vercel AI SDK',package='ai',key='AI_GATEWAY_API_KEY',model='anthropic/claude-sonnet-4.5',features=COMMON+['structured_output','native_resume'],docs='https://ai-sdk.dev/docs/agents/building-agents'),
 'opencode':dict(name='OpenCode',package='@opencode-ai/sdk',key='RELAY_OPENCODE_URL',model='anthropic/claude-sonnet-4-5',features=['sessions','native_resume','streaming','structured_output','cancellation','usage','evidence_snapshot'],docs='https://opencode.ai/docs/sdk/'),
 'openai':dict(name='OpenAI Agents',module='openai-agents',key='OPENAI_API_KEY',model='gpt-4.1-mini',features=COMMON+['structured_output','native_resume'],docs='https://developers.openai.com/api/docs/guides/agents/sdk'),
 'google_adk':dict(name='Google ADK',worker='google_adk',key='GOOGLE_API_KEY',model='gemini-2.5-flash',features=COMMON+['structured_output','native_resume'],docs='https://google.github.io/adk-docs/'),
 'microsoft':dict(name='Microsoft Agent Framework',worker='microsoft',key='OPENAI_API_KEY',model='gpt-4.1-mini',features=COMMON+['structured_output','native_resume'],docs='https://learn.microsoft.com/en-us/agent-framework/'),
 'openhands':dict(name='OpenHands',worker='openhands',key='OPENAI_API_KEY',model='openai/gpt-4.1-mini',features=[f for f in COMMON if f!='streaming']+['native_resume'],docs='https://docs.openhands.dev/sdk'),
 'hermes':dict(name='Hermes',worker='hermes',key='OPENAI_API_KEY',model='gpt-4.1-mini',features=COMMON+['native_resume'],docs='https://hermes-agent.nousresearch.com/docs/'),
}
ENTRYPOINTS = {
 'claude':'claude_runtime:run_claude',
 'pydantic':'adapters.pydantic_runtime:run_pydantic',
 'deepagents':'adapters.deep_runtime:run_deep',
 'pi':'adapters.node_runtime:run_node',
 'vercel':'adapters.node_runtime:run_node',
 'opencode':'adapters.node_runtime:run_node',
 'openai':'adapters.openai_runtime:run_openai',
 'google_adk':'adapters.python_runtime:run_python',
 'microsoft':'adapters.python_runtime:run_python',
 'openhands':'adapters.python_runtime:run_python',
 'hermes':'adapters.python_runtime:run_python',
}
DEFERRED = {
 'google_adk':['Multi-agent transfer/workflows','Vertex hosted sessions','External MCP/A2A','Live audio/video','Native memory/artifact services','Evaluation service'],
 'microsoft':['Graph workflows and handoffs','Foundry hosted tools','External MCP/A2A','Durable workflow workers','Native approval interruptions','Realtime'],
 'openhands':['Token streaming','Typed findings','Native terminal/browser/file tools','Remote sandbox workers','Delegation','Native checkpoint restore'],
 'hermes':['Typed findings','Native self-learning memory/skills','Messaging gateway','Native shell/browser tools','Delegation','External MCP','Native compaction'],
 'pydantic':['Native durable execution backends','Native capabilities/harness plugins','Multi-agent delegation','External MCP','Multimodal/realtime','Native spend limits'],
 'deepagents':['Native filesystem backends','Native skills discovery','Dynamic/async subagents','Automatic crash recovery','Remote deployment'],
 'pi':['Interactive native branch navigation','Steering/follow-up queue','Native compaction','Third-party extensions','Native skills discovery','OAuth storage','External MCP'],
 'vercel':['useChat UI protocol','Native workflow persistence','Subagents','Native approval protocol','External MCP','Multimodal/embeddings'],
 'opencode':['Case-tool MCP bridge','Native permission UI','Native rewind','External plugins','File/shell tools'],
 'openai':['External MCP/hosted tools','Cross-process durable approval resumes','Sandbox agents / isolated compute','Realtime/voice','Remote tracing export','Native spend limits (Relay ledger enforced)'],
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
    if spec.get('worker'):
        from adapters.python_runtime import installed_version
        return installed_version(spec['worker'])
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
    from trial_budget import enabled as trial_enabled, MODEL, check_runtime
    import anthropic_budget as ab
    switches={r['id']:bool(r['enabled']) for r in store.db.execute('SELECT * FROM relay_adapters')} if store else {}
    items=[]
    for id,spec in ADAPTERS.items():
        installed=version(spec);enabled=switches.get(id,True);requirements=[]
        if not installed:requirements.append('Install isolated '+id+' worker (workers/python-bridge/README.md)' if spec.get('worker') else 'Install '+str(spec.get('module') or spec.get('package')))
        if spec.get('package') and not node_binary():requirements.append('Node >=22.19 required (RELAY_NODE)')
        if spec.get('key') and not os.getenv(spec['key']):requirements.append('Set server-side '+spec['key'])
        if id=='opencode':requirements.append('Dedicated deny-all OpenCode server; snapshot-only connector')
        ready=bool(installed) and (not spec.get('package') or bool(node_binary())) and (not spec.get('key') or bool(os.getenv(spec['key'])))
        if trial_enabled() and id != 'simulator':
            try:check_runtime(id)
            except Problem as exc:
                ready=False;requirements.append(str(exc))
        items.append(dict(id=id,name=spec['name'],available=ready and enabled,enabled=enabled,installed=bool(installed),version=installed,
            detail=('Disabled for this installation. ' if not enabled else '')+('Local evidence replay; no model or provider calls.' if id=='simulator' else ('; '.join(requirements) or 'Configured; live run not yet verified.')),
            default_model=MODEL if trial_enabled() and id=='openai' else (ab.MODEL if ab.guarded(id) else spec['model']),features=spec['features'],deferred=DEFERRED[id],docs=spec['docs'],
            verification='local replay' if id=='simulator' else 'not live-verified',key=spec.get('key'),
            budget='Shared $5 total allowance: $4.50 spendable, $0.50 buffer; explicit expiry; no automatic reset; persistent pre-call reservations.' if trial_enabled() and id=='openai' else ('Anthropic $5 allowance ($4.50 spendable): every model request is metered by a local proxy that reserves a worst-case cost before Anthropic is called and settles from the usage receipt; '+ab.MODEL+' only; output capped at '+str(ab.MAX_OUTPUT)+' tokens; ends Nov 1.' if ab.guarded(id) else ('SDK USD cap' if id=='claude' else ('Timeout only; OpenCode server controls tokens/cost' if id=='opencode' else ('No USD cap; iteration limit plus native final-summary attempt; retries bounded by worker deadline' if id=='hermes' else 'No USD cap; bounded turns/output/time only')))),
            trial_guard=(trial_enabled() and id=='openai') or ab.guarded(id)))
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
    from trial_budget import enabled as trial_enabled, check_runtime
    import anthropic_budget as ab
    check_runtime(config['runtime'], config['model'])
    if ab.guarded(config['runtime']):
        if config.get('thinking','off')!='off':raise Problem('Extended thinking is off under the Anthropic allowance')
        if config.get('max_output_tokens',0)>ab.MAX_OUTPUT:raise Problem('Output is capped at '+str(ab.MAX_OUTPUT)+' tokens under the Anthropic allowance')
    spec=ADAPTERS.get(config['runtime'])
    if not spec:raise Problem('Runtime adapter is not registered')
    if config['runtime']=='simulator':return
    for feature in ('specialists','file_workspace','structured_output','memory','skills','artifacts'):
        if config.get(feature) and feature not in spec['features']:raise Problem(feature+' is not integrated for '+spec['name'])
    if config['runtime'] not in ('simulator','claude') and not (trial_enabled() and config['runtime']=='openai') and not ab.guarded(config['runtime']) and not config.get('accept_no_usd_cap'):
        raise Problem('Acknowledge that this adapter has no hard USD budget cap')
    if config['runtime']=='opencode' and config['permission']!='read_only':raise Problem('OpenCode connector is snapshot-only and read-only')

def ensure_ready(store,id):
    item=next((r for r in catalog(store) if r['id']==id),None)
    if not item or not item['available']:raise Problem(item['detail'] if item else 'Unknown adapter',409)

async def run(engine,prompt):
    runtime=engine.store.session(engine.sid)['config']['runtime']
    from trial_budget import check_runtime
    check_runtime(runtime, engine.store.session(engine.sid)['config']['model'])
    ensure_ready(engine.store,runtime)
    if runtime not in ENTRYPOINTS:raise Problem('No live adapter entrypoint',409)
    import importlib
    module,name=ENTRYPOINTS[runtime].split(':')
    return await getattr(importlib.import_module(module),name)(engine,prompt)
