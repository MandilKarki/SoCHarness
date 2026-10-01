# SDK coverage and acceptance

Updated 2026-09-30. Seven executable SDK adapters and one documentation-only framework.
This is a **restricted SOC integration, not full parity with every upstream feature**.
The UI covers 27 capability families. Native means the specific described integration
exists; it does not mean every API in that family is exposed or live-verified.

## Implemented in this pass

| SDK | Pinned version | New native integration |
| --- | --- | --- |
| Claude Agent SDK | 0.2.159 | Explicit thinking budgets (off, 1024, 2048, 4096); reject missing terminal result, empty success and missing/invalid requested structured findings |
| PydanticAI slim | 2.52.0 | ModelMessagesTypeAdapter serialization and restoration, preserving tool calls/results across turns |
| Deep Agents | 0.7.21 | SQLite graph checkpoints (langgraph-checkpoint-sqlite 3.1.1), persistent todos, typed findings, two named read-only specialists sharing the model-call budget |
| Pi | 0.99.2 | Native JSONL persistence; fork the last successful session before each continuation; account only new-turn usage |
| Vercel AI SDK | 7.0.126 | Serialize and restore native model messages, including tool receipts, through the Relay state store |
| OpenCode SDK | 1.18.34 | Fork successful server sessions, reapply deny-all permissions, session/text-part-filtered SSE and schema output |
| OpenAI Agents | 0.22.3 | New real Runner integration: streamed events, case-scoped function tools, typed findings, max turns/output, cancellation, usage and native input-item continuation |

Hermes remains documentation-only: no executable adapter is registered. It needs
a separately reviewed runtime integration, tool boundary and dependency/isolation
plan. It is not counted in the seven adapters.

## What verification means

Python tests exercise real installed SDKs with fake model transports. Node tests
exercise real Pi/Vercel loops and the OpenCode generated client with fake fetch.
They do not use provider credentials, incur model charges, or prove live provider
acceptance. The UI states this explicitly. Test locations:

- services/test_claude_contract.py: SDK options, hooks, permissions, structured results.
- services/test_adapters.py: registry, switches, policy gateway and SDK loops.
- services/test_native_state.py: restart/branch/compaction isolation, native receipts,
  Deep Agents checkpoints/todos/specialists/structured output, OpenAI Runner.
- workers/agent-bridge/test/adapters.test.mjs: tool loops, continuation, usage,
  truncation failure and OpenCode session-filtered streaming.
- Other services/test_*.py: case isolation, approvals, artifacts, access control and backups.

Run Python with the installed project virtual environment:
python -m unittest discover -s services -p test_*.py -v
Run Node from workers/agent-bridge:
node --test test/adapters.test.mjs

## Persistence and recovery contract

Relay messages, audit, approvals and native-state references persist in SQLite.
Pydantic, Vercel and OpenAI native transcripts are JSON in relay_native_state.
Pi JSONL and Deep Agents checkpoint databases live under
<evidence-database-directory>/adapter-sessions/<Relay session ID>.
OpenCode persists remotely on the configured dedicated server.

For the six non-Claude adapters, only validated successful results publish a new
continuation anchor. Claude retains its existing SDK session behavior, including
partial transcripts after a failed turn; it does not roll back that conversation.
Failed Pi
and OpenCode attempts have separate forks. Deep Agents resumes the exact saved
checkpoint, not arbitrary latest incomplete work. Cancelled runs may still have
tool side effects already authorized; transcript rollback does not undo them.

State is isolated by session, runtime and compaction epoch. Relay branches start
with the selected summary; they do not inherit another session's native calls.
Compaction invalidates native history and preserves the raw audit. Native state
larger than 4 MiB is rejected; compact before retrying. Back up native directories
and the OpenCode server separately from the main database. Automatic crash-resume
of tool execution is NOT implemented.

Deep Agents uses explicit TodoListMiddleware, independent of model profiles.
Its two named specialists cannot delegate further or invoke write tools.
The parent and children share max_turns model calls; at most two delegations run.
Automatic native summarization is replaced with Relay's between-turn compaction
so background summary requests do not bypass that call budget.

## Shared versus native

Six full-loop adapters use the same Relay tool gateway for evidence, exact-argument
approval, memory, tasks, vetted playbooks, analyst questions and report versions.
Claude embeds that gateway as MCP. Other adapters bind native function tools.
Shared playbooks are not SDK-native skill discovery; only Claude loads the bundled
skill-only plugin. Pi's external resource discovery and automatic native retries/
compaction remain disabled.

OpenCode remains snapshot-only: five selected records, no executable Relay tools.
SSE and native continuation do not turn it into an autonomous SOC tool integration.
It requires a dedicated loopback server with permission='deny', no plugins, MCP
or inherited instructions. Existing personal OpenCode servers are not modified.

## Credentials and cost controls

Set server-side ANTHROPIC_API_KEY for Claude/Pydantic/Deep Agents/Pi,
AI_GATEWAY_API_KEY for Vercel, OPENAI_API_KEY for OpenAI, and RELAY_OPENCODE_URL
plus optional RELAY_OPENCODE_PASSWORD for OpenCode. Do not paste secrets in chat.
Provider calls send selected evidence to that provider; authorize data handling
before live use. No credentials are committed or returned to the browser.

Claude has an SDK-estimated USD budget, not an invoice guarantee. Other adapters
require the explicit no-hard-USD-cap acknowledgment. Requests/output/time are
bounded; OpenCode token/cost limits are controlled by its server. OpenAI hosted
tracing and LangSmith export are disabled. All runs have a 180-second deadline.

## Remaining integration work — not hidden or marked complete

| Runtime | Remaining features |
| --- | --- |
| Claude | Arbitrary external MCP, third-party executable plugins, general shell/browser isolation, broader SDK controls |
| PydanticAI | Native capability/harness plugins, delegation, durable workflow providers, external MCP, multimodal/realtime and spend limits |
| Deep Agents | Native skills/memory backends, sandbox filesystem, dynamic/async agents, native interruption UI and crash recovery |
| Pi | Interactive native branch navigation, steering/follow-up queues, native compaction UI, extensions, OAuth and external MCP |
| Vercel | useChat protocol, workflow durability, native subagent/approval APIs, MCP, multimodal and embeddings |
| OpenCode | Case-tool MCP bridge, permission UI, file rewind, plugins and sandboxed shell/filesystem |
| OpenAI Agents | Handoffs/agent-as-tool delegation, native approval interruptions, external MCP/hosted tools, realtime, remote tracing |
| Hermes | Runtime adapter, installation/isolation and all executable feature integration |
| Platform | Multi-user auth/RBAC, tenant isolation, distributed workers, live sensor ingestion, Mem0/vector retrieval, accepted cloud deployment |

Credentials are a blocker only to live acceptance, not an excuse for the remaining
integration code. Full upstream parity is unfinished engineering, not claimed here.
Do not enable unbounded host tools just to turn the matrix green.

## Additional frameworks worth evaluating

- Google ADK: a useful next contrast for event/session services and multi-agent workflows.
  https://adk.dev/
- Strands Agents: graph, swarm and workflow orchestration patterns.
  https://strandsagents.com/docs/user-guide/sdk/multi-agent/multi-agent-patterns/
- Mastra: TypeScript agents and explicit workflow composition.
  https://mastra.ai/examples/agents/agentic-workflows

These are recommendations, not installed adapters. Avoid adding overlapping
frameworks until the existing acceptance gaps are understood.

## Official references

Claude: https://code.claude.com/docs/en/agent-sdk/python
Pydantic: https://ai.pydantic.dev/message-history/
Deep Agents: https://docs.langchain.com/oss/python/deepagents/customization
Pi: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md
Vercel: https://ai-sdk.dev/docs/agents/building-agents
OpenCode: https://opencode.ai/docs/sdk/
OpenAI: https://developers.openai.com/api/docs/guides/agents/sdk
Hermes: https://github.com/NousResearch/hermes-agent

## Extension contract

Add a fixed registry entry and lazy run(engine,prompt) entrypoint, dependency/key
checks, supported/deferred features and real-SDK contract tests. Use common.dispatch
for every case tool, finish for validated results, state.load/turn_prompt for
continuation. Never execute arbitrary names from a request or silently fall back
to replay. Registry switches persist and cannot disable a running adapter.
