"""Auditable integration inventory, not an exhaustive upstream feature promise."""
from adapters.registry import ADAPTERS, catalog
from store import TOOLS

DOCS = {k: v['docs'] for k, v in ADAPTERS.items() if k != 'simulator'}
DOCS.update(openai='https://developers.openai.com/api/docs/guides/agents/sdk', hermes='https://github.com/NousResearch/hermes-agent')
NAMES = {k: v['name'] for k, v in ADAPTERS.items() if k != 'simulator'}
NAMES.update(openai='OpenAI Agents', hermes='Hermes')
FULL = ['claude', 'pydantic', 'deepagents', 'pi', 'vercel', 'openai', 'google_adk', 'microsoft', 'openhands', 'hermes']
FEATURES = [
    {'name':'Evidence explorer','description':'Seven stable review cohorts, record search, pagination and raw JSON inspection. Benchmark replay, not live telemetry.','view':'evidence'},
    {'name':'Execution observability','description':'Durable messages, tools, failures, usage and checkpoints. Export JSON audit or payload-minimized OTLP JSON from Laboratory.','view':'trace'},
    {'name':'Human authorization','description':'Approve or deny exact tool arguments once. Active runs can wait for a decision; session policy remains authoritative.','view':'approvals'},
    {'name':'Session continuity','description':'Native continuation across eleven SDK adapters, including Google ADK events, Microsoft AgentSession, OpenHands events and Hermes messages. Non-Claude adapters publish anchors only after successful turns; Claude can retain partial SDK transcripts. Branches start from Relay summaries; compaction resets native context.','view':'sessions'},
    {'name':'Framework switches','description':'Persistent enable/disable, dependency checks, immutable per-session configuration and server-side rejection of unsupported features.','view':'frameworks'},
    {'name':'Investigation laboratory','description':'Persistent plans, evidence-linked memory, curated playbooks, analyst questions and versioned reports. Each capability is explicitly enabled per session.','view':'lab'},
    {'name':'Pilot access and backup','description':'Opt-in single-operator login, origin protection, resource bounds, persistent storage paths and a verified SQLite backup utility. Cloud deployment is not yet accepted.','view':'deployment'},
]

# Upstream support is only asserted for documented capability families. Unknown is not no.
# (key, label, category, documented upstream ids, native Relay ids, shared Relay ids, partial Relay ids, integration note)
ROWS = [
 ('loop','Agent / tool loop','Execution',list(NAMES),FULL,[],['opencode'],'OpenCode is a prompt/snapshot connector, not a Relay tool loop.'),
 ('streaming','Streaming responses','Execution',list(NAMES),[r for r in FULL if r!='openhands']+['opencode'],[],['openhands'],'NDJSON to Relay UI. OpenHands emits lifecycle events and a final answer, not token deltas. OpenCode SSE filters by session and text-part identity.'),
 ('tools','Custom function tools','Execution',list(NAMES),FULL,[],[],'All calls route through the case-scoped policy gateway.'),
 ('structured_output','Typed / structured output','Execution',['claude','pydantic','deepagents','vercel','opencode','openai','google_adk','microsoft'],['claude','pydantic','deepagents','vercel','opencode','openai','google_adk','microsoft'],[],[],'Opt-in findings schema; missing or invalid structured results fail. Not a factual-accuracy guarantee.'),
 ('planning','Native task planning','Execution',['deepagents','pi','opencode','hermes'],['deepagents'],[],[],'Deep Agents write_todos persists in native SQLite graph checkpoints. Relay analyst tasks are separate.'),
 ('thinking','Reasoning controls','Execution',['claude','pydantic','pi','vercel','opencode','openai'],['pi','claude'],[],[],'Pi thinking level; Claude disabled or explicit 1024/2048/4096-token thinking budget. Model support must be verified live.'),
 ('cancellation','Cancellation','Execution',['claude','pydantic','pi','vercel','opencode','openai'],[r for r in FULL if r not in ('google_adk','microsoft','openhands','hermes')],['google_adk','microsoft','openhands','hermes'],['opencode'],'Python bridge cancellation terminates the worker process. OpenCode abort is best effort; provider charges and already-authorized effects cannot be undone.'),
 ('limits','Turn / output limits','Governance',['claude','pydantic','deepagents','pi','vercel','openai','google_adk','microsoft','openhands','hermes'],[r for r in FULL if r!='hermes'],[],['hermes'],'Shared timeout also applies. Hermes can make a native final-summary call beyond its iteration limit, and native retries are deadline-bounded. OpenCode server must enforce its own model budgets.'),
 ('usd_budget','USD run budget','Governance',['claude'],['claude'],[],[],'SDK estimate, not an invoice guarantee. Other adapters do not enforce a USD cap.'),
 ('approvals','Human tool approvals','Governance',['claude','pydantic','deepagents','pi','vercel','opencode','openai','hermes'],[],FULL,[],'Relay exact-argument, one-shot approvals; not native approval protocol parity.'),
 ('hooks','Native hooks / middleware','Governance',['claude','pydantic','deepagents','pi','vercel','opencode'],['claude','deepagents'],[],[],'Claude hooks and Deep Agents denial middleware. Not every upstream lifecycle hook.'),
 ('trace','Auditable execution trace','Governance',['claude','pydantic','deepagents','pi','vercel','opencode','openai','hermes'],[],FULL,['opencode'],'Relay persists tool/run events. OpenCode has connector-level trace only.'),
 ('sessions','Durable conversation history','State',list(NAMES),[],FULL+['opencode'],[],'Relay SQLite messages persist independently of native transcripts.'),
 ('native_resume','Native SDK resume','State',list(NAMES),FULL+['opencode'],[],[],'Native transcript/checkpoint continuation between completed turns. Vercel/OpenAI/Pydantic serialize native message formats. Not automatic crash-resumable execution. Failed Pi/OpenCode forks do not replace the last good anchor.'),
 ('branch','Conversation branching','State',['claude','pi','opencode'],[],FULL,[],'Relay checkpoint branches; no native branch tree equivalence.'),
 ('compaction','Context compaction','State',['claude','pi','opencode','hermes'],[],FULL,[],'Relay checkpoint retention is not a lossless summary. Pi native compaction is disabled.'),
 ('memory','Long-term memory','State',['deepagents','hermes'],[],FULL,[],'Approved cited notes in SQLite. No vector store, Mem0 or automatic memory extraction.'),
 ('artifacts','Versioned report artifacts','State',[],[],FULL,[],'Relay artifact versions are database records, not SDK filesystem snapshots.'),
 ('file_workspace','Filesystem / checkpointing','Tools',['claude','deepagents','pi','opencode','hermes'],[],[],['claude'],'Claude flat text workspace with approvals and native checkpoint/rewind contracts. Not a general sandbox.'),
 ('mcp','MCP tools','Tools',['claude','pydantic','vercel','opencode','openai'],[],[],['claude'],'Claude uses an embedded scoped MCP server. External MCP configuration is not exposed.'),
 ('skills','Skills / playbooks','Tools',['claude','deepagents','pi','opencode','hermes'],[],[r for r in FULL if r!='claude'],['claude'],'Claude fixed skill-only plugin plus shared playbooks. Arbitrary plugins disabled.'),
 ('subagents','Subagents / handoffs','Collaboration',['claude','pydantic','deepagents','vercel','opencode','openai','hermes'],[],[],['claude','deepagents'],'Two named read-only Claude/Deep Agents specialists. Deep Agents shares a global model-call limit and at most two delegations per run. No generic cross-SDK delegation.'),
 ('human_input','Analyst questions','Collaboration',[],[],FULL,[],'Relay ask_human stores answers and resumes bounded active waits.'),
 ('durable','Durable background workflows','Operations',['pydantic','deepagents','vercel'],[],[],[],'No distributed queue or restart-resumable worker execution in Relay.'),
 ('multimodal','Multimodal input','Modalities',['claude','pydantic','pi','vercel','opencode','openai','hermes'],[],[],[],'Relay accepts text and case tool results only.'),
 ('realtime','Realtime / voice','Modalities',['openai'],[],[],[],'No Relay voice transport. Other ecosystem voice extensions have not been assessed.'),
 ('embeddings','Embeddings / vector retrieval','Modalities',['pydantic','vercel'],[],[],[],'No vector retrieval integration.'),
]


def inventory(store):
    adapters = {a['id']: a for a in catalog(store)}
    rows = []
    for key, label, category, upstream, native, shared, partial, note in ROWS:
        cells = {}
        for id in NAMES:
            status = 'native' if id in native else 'shared' if id in shared else 'partial' if id in partial else 'gap'
            support='documented' if id in upstream else 'not assessed'
            boundary=note
            if id=='pi' and key in ('planning','approvals','mcp','subagents'):
                support='extension pattern'
                boundary+=' Pi documents these as extension patterns, not built-in plan mode, permission popups, MCP or subagents.'
            if id=='hermes' and key in ('mcp','cancellation'):support='documented'
            cells[id] = {'status': status, 'upstream': support, 'note': boundary, 'source': DOCS[id]}
        rows.append({'id': key, 'label': label, 'category': category, 'cells': cells})
    sessions = store.db.execute('SELECT count(*) FROM relay_sessions').fetchone()[0]
    events = store.db.execute('SELECT count(*) FROM events').fetchone()[0]
    hosts = store.db.execute("SELECT count(DISTINCT host) FROM events WHERE host<>''").fetchone()[0]
    traces = store.db.execute('SELECT kind,count(*) AS n FROM relay_trace GROUP BY kind').fetchall()
    counts = {r['kind']: r['n'] for r in traces}
    tools = [{**t, 'runtimes': ['claude'] if t['name']=='rewind_workspace' else ['simulator']+FULL,
              'boundary': 'Analyst-only; idle Claude native workspace' if t['name']=='rewind_workspace' else 'Case/session scope · gateway policy enforced'} for t in TOOLS]
    return {'reviewed': '2026-10-01', 'scope': f'{len(ROWS)} capability families across {len(NAMES)} tracked frameworks. Not an exhaustive inventory of every upstream API. Source links are family-level references; support can vary by language and version.',
            'legend': {'native':'SDK-native integration', 'shared':'Implemented by Relay', 'partial':'Restricted subset', 'gap':'Not integrated'},
            'frameworks': [{'id':id,'name':name,'docs':DOCS[id],'integrated':id in adapters,'version':adapters.get(id,{}).get('version'),'verification':adapters.get(id,{}).get('verification','not integrated')} for id,name in NAMES.items()],
            'rows': rows, 'tools': tools, 'features': FEATURES,
            'metrics': {'records':events,'hosts':hosts,'cases':len(store.cases()),'sessions':sessions,'tools':len(TOOLS),'sdk_adapters':len(FULL)+1,
                        'completed_runs':counts.get('run.completed',0),'failed_runs':counts.get('run.failed',0),'cancelled_runs':counts.get('run.cancelled',0),
                        'basis':'Recorded execution events, including replay and tests on this database; not model quality or detection accuracy.'}}
