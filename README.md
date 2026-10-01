# SoCHarness — Relay ISOC agent laboratory

## Start here: guide and architecture

The [protected Fly pilot](https://socharness-mandil.fly.dev/) includes **Start here**:
a six-step interactive guide covering case selection, evidence inspection, safe
replay setup, traces, approvals and SDK selection. Navigation never automatically
runs an agent or approves an operation. Checklist progress is stored in this browser.

Open the [architecture atlas](https://socharness-mandil.fly.dev/architecture) after
signing in, or download [the standalone offline HTML](docs/architecture.html).
It contains eight views, 60 component specifications, 13 SDK entries (11 implemented,
Strands and Mastra proposed), 14 tools and explicit production gates.

The current login still uses the operator token. **Passkeys are not implemented**;
iPhone enrollment, server-side WebAuthn verification and credential recovery are a
separate security change. No credential or recovery token is in this repository.

## Four additional native runtimes

Google ADK, Microsoft Agent Framework, OpenHands and Hermes now have executable,
isolated Python workers with native tool loops and conversation continuation.
Google/Microsoft also support typed findings. OpenHands currently emits lifecycle
events plus final text; Hermes/Google/Microsoft support text deltas. All tool calls
use Relay's policy gateway. See [setup, tests and exact limits](workers/python-bridge/README.md).

These bring the registry to eleven SDK adapters plus replay. **Full upstream
feature parity is not complete.** Native delegation/workflows, external MCP,
multimodal features and general-purpose sandbox tools remain explicit gaps.

## Native SDK expansion

Native continuation now preserves tool receipts for PydanticAI, Vercel and OpenAI; Pi forks persistent JSONL sessions, Deep Agents uses SQLite checkpoints, and OpenCode forks successful remote sessions. Deep Agents also has persistent planning, structured findings and two bounded read-only specialists. Claude adds explicit thinking budgets and strict terminal-result validation. OpenCode adds filtered SSE and structured output.

This is not full upstream-feature parity. See [the tested scope and remaining work](services/SDK_COVERAGE.md). No provider call has been live-verified in this pass. Keys and evidence databases are intentionally excluded from GitHub.

## UI and deployment checkpoint

The workspace includes SDK coverage (27 capability families across eleven tracked frameworks), a searchable library of 14 registered tools plus seven platform features, database-derived metrics, quick actions (Ctrl/Cmd+K), and deployment-readiness cards. Native, Relay-shared, partial and missing coverage are distinguished; upstream support marked unassessed is not a claim of absence.

Read [deployment checklist](DEPLOYMENT.txt) before cloud use. Dockerfile and fly.toml target the deployed single-machine, single-operator pilot with required operator login in pilot mode, secure cookies, origin validation, bounded workers, persistent data paths and an online backup utility. Default local startup remains loopback-only. This is not production SaaS: Supabase Auth, tenant/RBAC enforcement, PostgreSQL migration and distributed workers are planned, not implemented. See [the deployment record](FLY_PILOT.txt).

A working local analyst UI, SQLite evidence store, and framework-neutral tool boundary. The default runtime is deterministic replay, **not an LLM**. Optional adapters include Claude, PydanticAI, Deep Agents, Pi, Vercel AI SDK, OpenAI Agents, Google ADK, Microsoft Agent Framework, OpenHands, Hermes and a restricted OpenCode snapshot connector.

## Multi-SDK checkpoint

Open **Frameworks** to see installed versions, setup requirements, persistent enable switches, documentation and capability coverage. These are real SDK integrations tested with fake models/transports, not labels pointing to the simulator. No live model calls have been verified without credentials.

Use `./start.ps1` for the installed multi-SDK environment. For a fresh Windows setup, use `./install-agents.ps1 -Python PATH_TO_PYTHON_3_11_OR_NEWER -Node PATH_TO_NODE_22_19_OR_NEWER`. Dependencies are pinned in requirements-agents.lock and workers/agent-bridge/package-lock.json.

Read [SDK coverage](services/SDK_COVERAGE.md) for native versus shared features, limitations, credentials, and adding another adapter. This build does **not** implement every feature of every SDK. Unintegrated features are explicit, and unsupported session flags are rejected. Most adapters do not enforce a hard USD cap; the UI requires acknowledgment instead of silently ignoring the budget.

## Start

From this directory, run:

```powershell
python services/app.py
```

Open http://127.0.0.1:8787/. Existing imported telemetry remains in work/telemetry-lab.sqlite3. No database server is needed. Local mode binds to loopback. The protected Fly pilot is at https://socharness-mandil.fly.dev/; see FLY_PILOT.txt for login and acceptance. Neither mode is a production/multi-user server.

## Claude

Use Python 3.10+ and an isolated environment:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --no-cache-dir -r requirements-claude.txt
.\.venv\Scripts\python.exe services/app.py
```

Supply ANTHROPIC_API_KEY through your server's environment/secret manager before starting. Do not paste secrets into the UI or source. The app never sends the key to the browser. Claude sends the prompt and tool-returned evidence to Anthropic; only enable it for data you are authorized to share. Model calls are billable; the budget is a per-run SDK estimate, not an invoice guarantee.

The official SDK launches a Claude subprocess. The adapter uses registered case-scoped MCP tools, ignores filesystem setting sources, enables strict MCP configuration, and uses a dedicated working directory. Optional built-ins are restricted to named Agent delegation, bundled Skill loading, and session-scoped Read/Write/Edit. Bash, arbitrary plugin paths, external MCP configuration, and general-purpose agents are not exposed. This is a tool restriction, NOT an OS security sandbox.

## Implemented and verified locally

- Seven stable review cohorts over the existing benchmark corpus. Priorities are lab labels, not detector verdicts.
- Search, pagination, raw JSON inspection, saved-session selection and JSON audit export.
- Durable SQLite messages, run events, tool results, approvals, local notes and checkpoints.
- Case-scoped evidence tools; tools can be disabled for each session.
- Read-only, supervised-write and ask-every-tool policies, enforced in the tool gateway.
- One-shot approval of exact stored arguments. Missing, cross-session and repeated approvals rejected.
- NDJSON streaming, cancellation requests, restart recovery, visible failure states.
- Conversation branching from checkpoints and local context compaction. No external action is reversed.
- Claude adapter: streamed messages, MCP custom tools, SDK hooks, session resume, model/turn/budget settings, cost and usage recording, optional structured findings.
- Laboratory panel: evidence-linked case memory, persistent investigation tasks, human-input requests, vetted SOC playbooks, and versioned SQLite report artifacts.
- Active-run approval waits: approve/deny without starting another turn; the waiting tool resumes with its stored execution receipt. Timeout/cancellation expires pending requests.
- Named read-only SDK specialists (evidence-reviewer and hypothesis-checker), with nesting disabled and concurrency capped at two. Contract-tested, not live-model verified.
- Bundled relay-soc native plugin with triage, hypothesis-review and handoff skills. MCP playbooks work locally; native plugin loading still needs live verification.
- Optional native SDK text-file workspace: path-checked Read/Write/Edit, human approval for edits, checkpoint UUID capture, and approved native rewind. SDK/CLI contracts are tested with fake transport/mocked rewind, not live file-change runs.
- Local OTLP/JSON event-span export excluding prompt/evidence payloads. No external collector is configured or contacted.

Run tests with `python -m unittest discover -s services -p test_*.py -v`.

Use `.\.venv\Scripts\python.exe` instead of `python` to include the installed-SDK contract test. That test uses the real SDK option/decorator classes with a fake transport; it does not send a prompt to Anthropic. The local replay server also has no model requirement.

For a fresh checkout, import your existing `sample.zip` with `python services/import_corpus.py PATH_TO_SAMPLE_ZIP`. Import refuses an existing destination. The source archive intentionally does not contain the 488 MB telemetry database, secrets, virtual environment, or SDK transcripts.

## Honest limitations

The simulator validates orchestration; it does not reason about arbitrary prompts. Claude integration needs installed dependencies and credentials; a passing contract test does not prove a live model run.

By default, the active SDK tool waits up to 90 seconds for approval or analyst input. The overall run timeout remains 180 seconds. Approvals are accepted while the run is waiting. Disabling the session's pause option preserves the earlier deferred-action behavior. Native file permission requests always wait. No real endpoint isolation or identity modification exists. Containment is explicitly a dry-run.

Still outside this build: full native-feature parity across adapters, arbitrary third-party plugin installation, user-configurable external MCP connections, Mem0/vector retrieval, live sensor/OTLP ingestion, multi-user authentication/RBAC, verified remote deployment and production hardening. Optional pilot operator login is not multi-user identity. Do not describe these gaps as completed. Local compaction retains the last checkpoint, not a lossless or model-generated memory summary. Native filesystem rewind and SQLite artifact rollback are distinct operations; neither reverses sensor/control-plane actions.

## Advanced demo

Open Laboratory → New advanced replay session. Add a task, remember an observation with an in-case event ID, or write a report. Each write appears under Approvals and changes durable state only after approval. Editing the same report produces another version; restoring an older version adds a new version without deleting history. Human-input demo stores a question and answer. To exercise a live approval wait without a model, create an ask-before-every-tool replay session and click Inspect evidence.

For Claude, create a new session with the desired capability toggles. A configuration being enabled is not evidence that the model used it: inspect agent.delegated, agent.lifecycle, sdk.system plugin/skill fields, sdk.file_checkpoint and workspace.tool_result events. Failed or interrupted tool attempts are not treated as successful execution.

## Next framework

Deep Agents and Pi now have initial adapters alongside PydanticAI, Vercel and OpenCode. Next, validate a paid end-to-end investigation per configured provider, then extend native capability coverage against the same cases and safety contracts. Do not add unbounded host tools merely to claim feature parity.

Primary references: https://docs.langchain.com/oss/python/deepagents/overview and https://github.com/earendil-works/pi/tree/main/packages/coding-agent .

## Code map

- web/ — maintained HTML/CSS/JavaScript client; no build step or external assets.
- services/app.py — HTTP validation, streaming, static files, loopback boundary.
- services/store.py — SQLite state, stable cohorts, checkpoint/branch storage.
- services/engine.py — runtime orchestration, policy and exact-argument approvals.
- services/claude_runtime.py — optional official Claude Agent SDK adapter.
- services/advanced.py — memory, tasks, artifact versions, human input and OTLP export.
- services/workspace.py — path validation and native SDK rewind boundary.
- plugins/relay-soc/ — fixed, reviewed skill-only Claude plugin; no executable hooks.
- services/test_lab.py — isolated regression tests; does not modify the actual corpus.
- services/telemetry_api.py — compatibility launcher for the new server.
- workers/agent-bridge/ — maintained Pi, Vercel and OpenCode adapters.
- Historical dist/ and workers/claude-agent/ in the original development checkout are not published.

The existing DB and legacy harness tables are preserved. New state uses relay_* tables. This project does not push to GitHub or publish itself.
