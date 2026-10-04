# SoCHarness — Relay ISOC agent laboratory

## Open on your Mac or iPhone — no installation needed

- **[Open the application](https://socharness-mandil.fly.dev/)**
- **[First-time setup / recovery login](https://socharness-mandil.fly.dev/login?next=security)**
- **[Add or manage passkeys](https://socharness-mandil.fly.dev/security)**
- **[Architecture atlas](https://socharness-mandil.fly.dev/architecture)** (requires login)
- **[SDK learning lab](https://socharness-mandil.fly.dev/#sdk-lab)** (requires login)

### Harness Lab — the default signed-in homepage

The homepage is a learning lab for agent harnesses, in the same visual language as
the Architecture Atlas. Four views (`#anatomy`, `#run`, `#frameworks`, `#compare`; existing
`#sdk-lab` links open Live run):

1. **Anatomy:** an interactive map of the twelve parts every harness has — request,
   instructions & schemas, policy & approvals, limits & budget, model, runner, tools,
   context & sessions, memory, observability, multi-agent and durable execution —
   with the agent loop drawn as a ring. Selecting a part explains what it does, how to
   build it, where Relay implements it, which experiment exercises it (**Try it live**),
   and how each tracked framework handles it (status and upstream API name, read from
   `/api/inventory`).
2. **Live run:** choose an **Experiment**, edit the request and **Run investigation**
   from one panel. Imported benchmark records are not live sensors or confirmed
   incidents. Persisted events appear as a swimlane sequence (You → Your app → SDK
   runner → Model → Evidence): each dot sits in its owner's lane, hand-offs are drawn
   and every model call is a visible loop iteration. Select a step (or use ↑/↓) for its
   meaning, SDK equivalent and recorded payload. No invented steps or private
   chain-of-thought; context snapshots are bounded excerpts. The **Agent map** shows the
   experiment's configured route and replay. Pending approvals appear above the loop.
   Findings carry clickable record citations that jump to the returned evidence;
   follow-ups continue the same session and appear as Run tabs. Maximum: three model
   calls (four for manager + specialist), 1,000 output tokens per call, case-scoped
   read-only tools. All agents share these limits.
3. **Frameworks:** one page per framework (`#frameworks/<id>`, e.g. `#frameworks/claude`)
   with an original persona (colour, glyph), its design philosophy and mental model, an
   animated walkthrough of how it runs inside Relay using its real API names (an
   illustration, not a recorded run), core concepts, Relay wiring, its full capability
   profile and a **Run it** checklist (adapter installed, key set, spending-guard
   coverage, live verification). A page switches to **Runs live** only when the server
   reports that adapter as available *and* guarded; Live run then uses that runtime with
   bounded read-only limits. OpenAI is guarded by its trial ledger; Claude, Pydantic AI,
   Deep Agents and Pi by the separate Anthropic allowance below. Below the pages,
   all capability families × frameworks appear as one map, with search,
   category filter and A/B comparison ("only differences"). Select a cell for the
   upstream API, implementation file, test suite and boundary note; select a framework
   for its profile and coverage. A map entry is not proof of live verification.

   Each framework page also has **Under the hood** (6–7 chapters, `frontend/src/lib/deep/`):
   one internal mechanism per chapter, such as OpenAI's turn classification and guardrail
   timing, Pydantic AI's node graph, the Deep Agents middleware stack, ADK's
   yield–commit–resume event loop or Microsoft's workflow supersteps. Every chapter has
   an animated, steppable diagram, an explanation, real code from the official API and
   what it means for a SOC, with a link to its docs page. Below that are **Blueprints**
   (all documented capabilities placed in a reference architecture and a SOC version)
   and a searchable **official docs reference**. These are written from public docs and
   source; internals can change between releases.

   **Live runs meet the diagrams.** Each Live run step whose mechanism a chapter explains
   gets an **Under the hood** link in the inspector (`#frameworks/<id>/deep/<chapter>`).
   On the framework page, chapters exercised by your last run are marked *in your run*,
   and each shows the recorded events behind it with their timing.
4. **Compare** (`#compare/<mechanism>`): one mechanism, all eleven frameworks. Eight
   mechanisms (loop and stopping, tools, human approval, guardrails/hooks/permissions,
   sessions and memory, context management, multi-agent, events and tracing). Frameworks
   gather under the design pattern they use, with its trade-off; select one for its API,
   real code and the chapter that explains it. A table lines every framework up on the
   same dimensions, and each mechanism ends with guidance for a SOC agent platform.

**Keeping the content honest.** `python services/docs_drift.py` extracts every import and
`ImportedName.attribute` from the chapter and comparison snippets and resolves them
against the installed, pinned SDKs (Python with the main and extended interpreters,
TypeScript through `workers/agent-bridge`). It reports `missing` (real drift: the package
is installed but the name is gone), `not_installed` (skipped) and `type_only`. CI runs it
report-only in each SDK job. On October 4, 2026 the Python snippets were also checked
statically against the source of each pinned release tag.

Browsing, history and export make no model calls. The shared $5 October OpenAI
allowance and identity controls remain unchanged; Anthropic-key frameworks use their own
$5 allowance (see below). Failed or interrupted calls can
retain budget holds; refresh saved state before retrying. Keep the mobile tab
foregrounded during streaming; this is not a durable background-job service.

**Experiment** selects one focused SDK exercise. Target runtime: Python
`openai-agents==0.22.3`.

| Experiment | Native API | What the diagram makes inspectable |
| --- | --- | --- |
| Core loop | `Agent`, `Runner.run_streamed`, `FunctionTool` | Request → model → tool → evidence → answer |
| Multiple tools | Two `FunctionTool` callbacks | Query three records, inspect one, report |
| Manager + specialist | `Agent.as_tool(on_stream=...)` | Isolated specialist input, nested calls, return to manager |
| Transfer ownership | `handoff`, `RunHooks.on_handoff` | Triage yields control; specialist answers and continues follow-ups |
| Guardrails | Blocking `InputGuardrail`, `OutputGuardrail` | Deterministic input policy and citation-ID tripwires |
| Human approval | `needs_approval`, `RunState.approve/reject` | Pause before execution; approve or deny exact query arguments |
| SDK session memory | Native `Session` protocol | Load/stage history, then commit successful continuation |

Graphs distinguish configured routes from observed events. Select a node for the
public receipt; replay saved events free of charge. **Session overlay** shows item
counts before a run, in the latest model request and after successful persistence.
Items are not tokens or context-window capacity. Failed runs preserve the previous
successful history. Local Python context is not automatically model-visible.

The input guardrail is intentionally a narrow literal-word demonstration, not a
complete security classifier. The output guardrail checks citation provenance,
not factual correctness. It cannot undo model charges or erase observed output.
Native approvals expire after 90 seconds and resume in the current process; they
are not durable cross-worker jobs. Sandbox agents/isolated compute, external MCP,
provider trace export, voice/realtime and hosted tools are **not enabled** here.
Local receipts are not an OpenAI-hosted trace. Backend adapters and
legacy reference views remain in the repository, but other SDKs are intentionally
absent from this workflow. An inventory entry is not proof of full SDK coverage.

For reproducible, no-cost browser QA, run
`python services/preview_openai_workbench.py` and open `http://127.0.0.1:8794/`.
It runs the real SDK loop with a fake model and temporary synthetic database,
clears the API key in that process, and is explicitly labeled **OFFLINE QA**.

Use this exact HTTPS hostname on every device. A localhost address is only for
development; cloning this repository does not give access to the hosted account.

### Phone says “no saved passkeys”?

The Google-login build adds **Continue with Google** at
[Relay sign-in](https://socharness-mandil.fly.dev/login). Once configured by the
operator, use your approved Google account on iPhone, Mac or any trusted laptop.
No new password, password manager, passkey or repository clone is needed.
Only the server-configured verified Google email can enter this private pilot.
If the button is absent, Firebase has not been configured on that deployment;
the recovery-token and passkey methods below remain available.

**Sign in with a passkey uses an existing credential; it does not create one.**
First sign in with the operator recovery token, then explicitly **Add a passkey**.
This is a private, single-operator pilot, not public signup.

1. On the original Windows machine, in the original checkout containing
   `work/fly-operator-token.clixml`, run `./operator-login.ps1 -CopyToken` in
   PowerShell. This copies the existing token without printing it. A fresh clone
   does not contain that private file. Do not run `-Initialize` to recover access.
2. On that Windows machine, open [first-time setup](https://socharness-mandil.fly.dev/login?next=security),
   expand **Use recovery token**, paste, and choose **Sign in securely**.
   Clear the clipboard afterward with `Set-Clipboard -Value ''`; also remove any
   saved clipboard-history entry. Never paste the token into chat, GitHub or a URL.
3. Within five minutes, name the credential (for example, “iPhone / iCloud”) and
   choose **Add a passkey**. In the browser's **creation** prompt, choose the
   nearby iPhone/device option if offered, then scan that QR code and approve on
   the phone. Keep both devices nearby with Bluetooth enabled. A QR code from
   **Sign in with a passkey** is the wrong flow for creating your first credential.
4. Save in Apple Passwords / iCloud Keychain. Enable **iCloud Passwords & Keychain**
   on your iPhone and Mac, signed into the same Apple Account. Once synced, open
   [Relay in Safari on your Mac](https://socharness-mandil.fly.dev/) and choose
   **Sign in with a passkey**, approving Touch ID or the device prompt.
5. Confirm a successful sign-in before discarding any recovery access. If the key
   is saved only in Windows Hello, it will not automatically sync to your Mac.

If nearby-device **creation** is unavailable, use the recovery token directly on
your trusted Mac or iPhone and register there. The encrypted Windows token file
cannot be decrypted on a Mac; do not copy it there expecting it to work. If you
cannot access the original Windows user or a secure token copy, recovery requires
the Fly app owner to rotate the token, or the configured Google login; there is
no anonymous recovery-token reset.

Apple's [Mac passkey guide](https://support.apple.com/en-gb/guide/passwords/mchl4af65d1a/mac)
explains synced and nearby-device sign-in. See [security and recovery details](AUTH_SECURITY.txt).
Device enrollment needs your own Face ID / Touch ID / device approval; an agent
cannot create an Apple passkey for you in the background.

## October testing: one shared $5 allowance and Google authentication

**Live checkpoint — October 1, 2026:** Google sign-in is configured and a browser
sign-in reached the protected dashboard. Use **Continue with Google** with the
approved operator account on your phone or laptop. The OpenAI Default project
also has a **$5 monthly hard limit** enabled, covering every key in that project.
Provider enforcement can lag; it is not a guarantee of an exact final invoice.

After the owner added API credit, a bounded OpenAI nano connectivity test passed
on October 1, with $0.000251 estimated token cost. This proves connectivity and
budget settlement, not all tools or SOC accuracy. The earlier rejected request's
$0.10 uncertainty hold remains; it is not a confirmed provider charge. Free replay
and Google login require no API credit. No automatic recharge was configured.

The trial allows only OpenAI Agents with `gpt-5.4-nano-2026-03-17`, local Relay
function tools, at most 6 model turns per run and 2,048 output tokens per request.
Other paid SDK paths are blocked during the trial, apart from the separate Anthropic
allowance described below. Replay remains free.

The SQLite ledger reserves $0.10 **before every request**, settles verified usage
at conservative standard uncached token rates, and retains the entire hold for
errors, cancellation or missing usage. Atomic reservations across connections
prevent concurrent overspending. The internal ceiling is **$4.50**, leaving a
$0.50 buffer. This is one shared trial across sessions, not $5 per session/day.
Restarting the app does not reset its balance or extend its deadline. The pilot
configuration stops new paid calls after **October 31, 2026, 11:59:59 PM Pacific**;
already-dispatched requests remain covered by their reservations.
The owner explicitly extended the original one-day deadline. A single audited
migration preserves all usage, unresolved holds and any halted state. No monthly
refill, automatic renewal or new $5 allowance is authorized by this extension.

See **Operate → Deployment** for the accounted balance, outstanding holds and
expiry. Accounted cost is an upper estimate, not an invoice. This guard covers
only calls through this Relay database: it cannot limit another app using the
same API key, taxes, provider pricing changes, or account-wide spending. Configure
an OpenAI project hard limit as a second layer; account billing/credit remains
separate. No automatic recharge or extra API keys are created by Relay.

Pricing reviewed October 1, 2026: [$0.20/M input and $1.25/M output for GPT-5.4 nano](https://developers.openai.com/api/docs/models/gpt-5.4-nano).
Cached-input discounts are deliberately ignored. The $0.10 hold covers a full
400,000-token input window plus the enforced output ceiling at these rates.
Review rates before changing the model or extending any trial.

### Separate $5 Anthropic allowance (Claude, Pydantic AI, Deep Agents, Pi)

Owner-approved October 4, 2026: a second, independent ledger with the same rules as the
OpenAI trial ($5 total, $4.50 spendable, $0.50 buffer, no refill, same deadline and never
later than **2026-11-01T06:59:59Z**). Only `claude-haiku-4-5-20251001` is allowed, output
is capped at 2,048 tokens per request and extended thinking is off.

These frameworks own their HTTP clients (the Claude SDK even runs the Claude Code CLI as a
subprocess), so Relay meters at the network edge instead of wrapping a model object.
`services/anthropic_budget.py` starts a loopback proxy for each run. The framework gets
only a random per-run token and `http://127.0.0.1:<port>`. Child processes (the Claude
CLI, the Pi worker) never see the real key; PydanticAI and Deep Agents run inside the
server process, so they are handed the token too, but the server's own environment
still holds the key. For every Messages API request the proxy:

1. checks the request against an allowlist: the pinned model, known top-level fields
   only, custom (client) tools only, no extended thinking, the standard service tier, no
   document inputs, no priced beta headers, and a clean request line and headers (no
   control characters, a Content-Length body of at most 2 MB). It clamps `max_tokens` to
   2,048 and accepts only `/v1/messages` and the free `/v1/messages/count_tokens`, which
   gets the same checks;
2. reserves the worst case **before** contacting Anthropic: the whole 200k context
   window priced as 1-hour cache writes ($2/M) plus the output cap at $5/M, so **$0.41**
   per in-flight request (about ten at once fit in the allowance);
3. sends it to a fixed upstream path with only price-neutral headers, and streams the
   response back byte for byte;
4. settles the exact cost from the usage receipt (`message_start` plus cumulative
   `message_delta` for streams): $1/M input, $1.25/M or $2/M cache writes, $0.10/M cache
   reads, $5/M output (Haiku 4.5 pricing reviewed October 4, 2026).

A request that never reached Anthropic, or an HTTP error before any output (error
responses are not billed), is released at $0. A dropped stream, a missing, null or
implausible receipt, or unexpected billable fields (server tools, iterations, a
non-standard tier) keep the whole hold, and an unusable receipt halts the ledger. Live run shows each reservation and settlement as steps, and the header shows
both balances. This is not an account-wide limit: set a spend limit in the Anthropic
Console as a second layer.

To turn it on: `RELAY_ANTHROPIC_TRIAL_ENABLED=1` (already in `fly.toml`) and
`fly secrets set ANTHROPIC_API_KEY=...` from your own terminal. Never paste the key into
the browser or chat. The proxy was tested against a local fake Anthropic endpoint
(`services/test_anthropic_budget.py`, including request smuggling, null usage and
unreachable-upstream cases) and reviewed independently; a first live run of each
framework is still needed to confirm it end to end. If a framework sends a field the
allowlist does not know, the run fails closed with a `budget.blocked` step naming it.

Firebase uses the no-cost Spark plan with Google sign-in, not SMS, Hosting,
Firestore or Identity Platform upgrades. Configure server environment variables:

- `RELAY_FIREBASE_CONFIG`: JSON with `projectId`, `authDomain`, `apiKey`, `appId`.
  This is Firebase's **public web configuration**, not an LLM key or private key.
- `RELAY_GOOGLE_EMAIL`: the single allowed verified operator email.
- `RELAY_TRIAL_ENABLED=1` and an explicit UTC `RELAY_TRIAL_UNTIL`.
- `OPENAI_API_KEY`: server-only Fly secret; never a `VITE_*` variable.

In Firebase Authentication, enable Google and authorize the exact Fly hostname.
No service-account key is needed. Relay verifies the RS256 signature against
Google's certificates, project audience/issuer, expiry, recent authentication,
verified email and Google provider before issuing its existing eight-hour
Secure/HttpOnly cookie. Firebase ID tokens remain in memory only and are cleared
after the exchange. Google-session revocation is not continuously polled; Relay
sessions expire on logout, restart or after eight hours. This is not team RBAC.

Security tests exercise real RSA-signed test tokens and the real Agents runner
with an offline model. They do not claim live provider/billing acceptance.

Operators can run `verify-pilot.ps1 -ExpectFirebaseTrial -TokenFile <private-file>`
without model spending. `trial-smoke.ps1 -TokenFile <private-file>` explicitly
makes one small guarded LLM run with tools disabled and prints only status/cost
metadata. Before rolling back to a pre-guard image, remove `OPENAI_API_KEY` from
Fly; older builds do not enforce this ledger. Never reset or replace the live
trial database to replenish the allowance.

## Versioned SDK capability checker

Open **Agent lab → Capability matrix** for 42 capability areas across 11 adapters
(462 individually identified cells). Each cell includes a pinned version, native
API or Relay mechanism where mapped, implementation file, contract-suite reference,
credential requirement, live-test scope and explicit gap. Installed version drift
is separate from upstream release drift. Some API-level mappings remain unassessed;
this is **not full upstream parity** and a suite reference is not a passing test.

- Machine-readable baseline: [SDK manifest](services/sdk_manifest.json).
- Release check: [October registry results](reports/sdk-releases-2026-10-01.json).
- Testing and upgrade policy: [audit checkpoint](SDK_AUDIT.txt).
- Offline structural check: `python services/sdk_release_check.py --offline`.
- Full offline suite runner on Windows: `./check-sdks.ps1 -Python <main-python> -ExtendedPython <worker-python> -HermesPython <hermes-python> -Node <node-24>` (missing dependencies/skipped tests fail as incomplete; no installs or paid calls).
- Read-only release check: `python services/sdk_release_check.py --output reports/sdk-releases-latest.json`.

A Codex monthly automation checks releases and feature changes on the **1st at
9 AM America/Los_Angeles**, starting with the next scheduled occurrence. It reports
actionable changes and failures; it never installs upgrades, deploys, renews the
allowance or calls paid models. This is a local Codex automation, not a Fly cron;
the Codex app/host must be available to execute it. Registry checks use no LLM API
credit; the Codex follow-up uses your Codex account's normal usage allowance.

### Credentials for the adapters as currently wired

| Adapters | Required setup | Current guarded-pilot policy |
| --- | --- | --- |
| OpenAI Agents | Existing OpenAI key | Nano enabled; shared $5 total ledger |
| Microsoft, OpenHands, Hermes | OpenAI key; Hermes also needs its isolated source runtime | Blocked until their model calls use the same shared guard |
| Claude, PydanticAI, Deep Agents, Pi | Anthropic API key | Blocked; OpenAI credit does not fund this provider |
| Vercel | AI Gateway key | Blocked; gateway billing is separate |
| Google ADK | Google API key | Blocked; Google billing is separate |
| OpenCode | Dedicated deny-all server and server-side provider credentials | Disabled; snapshot-only integration |
| Strands, Mastra | No adapter exists yet | Candidates, not implemented |

Most policy, state, tool routing, schema and cancellation tests run offline with
fake model transports. Start there, then test one bounded feature at a time with
synthetic/benchmark data, a few records, short outputs and no automatic retry.
Do not buy more provider credits just to make the grid green. Keys cannot fix
missing integration code, runtime isolation, native workflows or unimplemented APIs.

## Guide and architecture

The [protected Fly pilot](https://socharness-mandil.fly.dev/) includes **Quick start**:
a six-step interactive guide covering case selection, evidence inspection, safe
replay setup, traces, approvals and SDK selection. Navigation never automatically
runs an agent or approves an operation. Checklist progress is stored in this browser.

Open the [architecture atlas](https://socharness-mandil.fly.dev/architecture) after
signing in, or download [the standalone offline HTML](docs/architecture.html).
It contains eight views, 60 component specifications, 13 SDK entries (11 implemented,
Strands and Mastra proposed), 14 tools and explicit production gates.

## React workspace and passkeys

The redesigned workspace separates **Investigate**, **Agent Lab** and **Operate**,
with light/dark appearances, mobile navigation and an on-demand agent console.
Existing evidence, sessions, approvals, SDK controls and the guide remain connected
to the real backend. The frontend is now **React + TypeScript + Vite**, with
official **shadcn/ui (Radix)** components and Tailwind CSS. React owns the workspace,
lab, catalog, guide and authentication pages; no legacy page scripts are loaded.
The Python backend, database, SDK contracts and WebAuthn security rules are retained.
The architecture atlas remains a separate, deliberately standalone HTML artifact.
See [design decisions and references](DESIGN_NOTES.txt).

**Passkey authentication is implemented** using server-verified WebAuthn. Open
[Account & security](https://socharness-mandil.fly.dev/security), sign in with the
existing operator token, then add a passkey within five minutes and approve your
device prompt. iCloud Keychain can sync it to your Mac; nearby-device QR sign-in is
available on supported devices. Physical iPhone/Mac acceptance remains a user step.
The operator token stays as recovery; no secret is included in this repository.
See [setup, recovery, tests and security limits](AUTH_SECURITY.txt).

The 91-test backend suite passes on Windows and a network-disabled Linux container.
The React frontend has 27 component, transport and credential-serialization tests.
Eleven WebAuthn test methods use real ES256 signatures, not mocked verification.
Browser checks cover mobile layout, navigation, guide-to-replay and saved traces.
These tests do not establish production security or full upstream SDK parity.

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

Use Node 24.15+ for the frontend. From this directory, build the static bundle,
then start the existing Python server:

```powershell
npm --prefix frontend ci
npm --prefix frontend run build:publish
python services/app.py
```

Frontend sources are in `frontend/src`. Run `npm --prefix frontend test` for
component/transport tests. Docker builds the same frontend from the lockfile;
there is no Node frontend server in production and no external asset CDN.
For local hot reload, start Python on port 8793 and run `npm --prefix frontend run dev`.
Use the built same-origin app for authentication/CSP acceptance checks; the dev
proxy does not bypass the backend's Host/Origin checks.

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

Still outside this build: full native-feature parity across adapters, arbitrary third-party plugin installation, user-configurable external MCP connections, Mem0/vector retrieval, live sensor/OTLP ingestion, multi-user authentication/RBAC and production hardening. The verified single-operator Fly pilot is not multi-user identity. Do not describe these gaps as completed. Local compaction retains the last checkpoint, not a lossless or model-generated memory summary. Native filesystem rewind and SQLite artifact rollback are distinct operations; neither reverses sensor/control-plane actions.

## Advanced demo

Open Laboratory → New advanced replay session. Add a task, remember an observation with an in-case event ID, or write a report. Each write appears under Approvals and changes durable state only after approval. Editing the same report produces another version; restoring an older version adds a new version without deleting history. Human-input demo stores a question and answer. To exercise a live approval wait without a model, create an ask-before-every-tool replay session and click Inspect evidence.

For Claude, create a new session with the desired capability toggles. A configuration being enabled is not evidence that the model used it: inspect agent.delegated, agent.lifecycle, sdk.system plugin/skill fields, sdk.file_checkpoint and workspace.tool_result events. Failed or interrupted tool attempts are not treated as successful execution.

## Next framework

Deep Agents and Pi now have initial adapters alongside PydanticAI, Vercel and OpenCode. Next, validate a paid end-to-end investigation per configured provider, then extend native capability coverage against the same cases and safety contracts. Do not add unbounded host tools merely to claim feature parity.

Primary references: https://docs.langchain.com/oss/python/deepagents/overview and https://github.com/earendil-works/pi/tree/main/packages/coding-agent .

## Code map

- frontend/ — React + TypeScript sources, shadcn/ui components, Vite build and frontend tests.
- web/ — compiled frontend destination, HTML entry points and standalone architecture assets; legacy scripts are not loaded by the React app.
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
