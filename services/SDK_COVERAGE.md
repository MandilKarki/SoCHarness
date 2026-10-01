# Plug-in runtime coverage

Verified package snapshot: 2026-09-30. This is an integration inventory, **not a claim that every upstream SDK feature is implemented**. Official docs evolve; pinned package source, exported types and executable contract tests determine this build's actual behavior.

The live SDK coverage view now exposes 27 capability families across eight tracked frameworks with native/shared/partial/gap labels. OpenAI Agents and Hermes are documentation-only entries, not registered adapters. The tool library contains all 14 registered tools plus seven platform features. `/api/inventory` supplies the same data for JSON/CSV checkpoint exports; this is a curated family-level matrix, not every upstream API.

Deployment update: an opt-in single-operator pilot access layer and Fly/container templates exist. Multi-user auth/RBAC, PostgreSQL/Supabase and distributed execution remain unimplemented. Read DEPLOYMENT.txt for acceptance gates.

## Installed adapters

| Runtime | Version | Actual integration | Verification |
| --- | --- | --- | --- |
| Claude Agent SDK | 0.2.159 | Existing native client, scoped MCP, hooks, specialists, plugin skills, resume, checkpoints | Real SDK classes / fake transport; no paid run |
| PydanticAI slim | 2.52.0 | Native Agent tool loop, explicit tool schemas, streamed events, typed findings, request limits | Real FunctionModel tool loop and structured-output test |
| Deep Agents | 0.7.21 | Native graph, streamed messages, native scratch planning, Relay tools, deny middleware, model-call limits | Real graph with fake chat model; tool gateway and native write denial |
| Pi coding agent | 0.99.2 | Native session, custom tools, event subscription, thinking selection, request/output bounds | Real two-turn session using fake stream; only Relay tools declared |
| Vercel AI SDK | 7.0.126 | Native ToolLoopAgent, schemas, streaming, structured output, step limits | Real two-step loop with MockLanguageModelV4; truncated answers rejected |
| OpenCode SDK | 1.18.34 | v2 client, dedicated server config check, deny-all session, bounded evidence snapshot, prompt and abort | Real client serialization with fake fetch; no server/model live test |

No provider credentials are configured. Installed is not the same as live-verified. Registry readiness checks package/runtime presence and environment configuration, not billing balance, model access or successful provider authentication.

Dependency audit: Pi's published shrinkwrap included vulnerable brace-expansion 5.0.9. This build overrides it to 5.0.12 and uses npm 12.2.0 to resolve the override. npm audit reports zero known Node dependency vulnerabilities after the patch; this is not a full security audit of the application or its Python dependencies.

## Shared versus native features

All full-loop adapters use the same SQLite case evidence, approvals, optional evidence-linked memory, analyst questions, tasks, report versions and audit trace. Shared skill lookup is a Relay function tool; it is not automatic native skill/plugin loading. Claude alone currently loads the bundled native plugin.

New adapters receive bounded Relay conversation history and the last local checkpoint. They do not restore their native SDK transcript trees between runs. Switching frameworks means creating a new session; session configuration is immutable. Same-case memory can be explicitly queried across sessions. Transcript history, approvals and report state remain session-scoped.

OpenCode is deliberately different: it receives five selected evidence records, fetched through the gateway before dispatch, and no executable tools. It does not yet call Relay tools or pause for Relay tool approvals inside its own loop. It is not an autonomous SOC integration yet.

Native Deep Agents write_todos is run-local scratch planning. Durable analyst tasks still use set_task and approvals. Native filesystem, shell, task/delegation and other unregistered tools are blocked by middleware. No filesystem backend with host access is installed in its graph.

Pi starts with an explicit tool allowlist, no discovered extensions, skills, context files, prompt templates or default file/shell tools. In-memory settings/session state keep it independent of the user's personal Pi configuration. Automatic native compaction and retries are disabled; local Relay compaction remains available.

## Capability controls

- Frameworks tab: installed version, credential requirement, enable/disable switch, supported capabilities, deferred coverage and official docs.
- Switches persist in relay_adapters. An active runtime cannot be disabled until its run stops.
- Session creation and run dispatch both check readiness; disabled adapters never fall back to replay.
- Unsupported feature flags are rejected server-side, not silently ignored.
- Credentials stay in server environment. Child workers get only their own provider key, not other provider/server secrets.
- Node tools use a private stdin/stdout protocol; there is no additional HTTP tool-execution port.
- Cancellation aborts the SDK task and cleans up its worker; unfinished results do not produce success checkpoints.

## Limits and costs

Claude retains its SDK USD limit. The other adapters do not implement that same dollar limit, and the UI requires explicit acknowledgment. PydanticAI, Pi, Deep Agents and Vercel are bounded by configured model requests/steps and output tokens per call plus the shared 180-second timeout. Retries/output repair can still differ by provider; these limits are not dollar guarantees. Unreported costs are unknown, not zero.

OpenCode's server controls token limits and cost; Relay enforces only its timeout and cancellation attempt. Its token/turn controls are disabled in the configuration UI. Operator configuration must address server budgets and hard process isolation separately.

## Setup

1. Use Python 3.11+ (verified here on 3.12) and Node 22.19+ (verified here on 24.19).
2. Run install-agents.ps1 with optional -Python and -Node executable paths. This installs pinned dependencies locally, with npm lifecycle scripts disabled. The Python lock is the verified Windows environment; requirements-agents.txt is the direct-dependency list for other platforms.
3. Set ANTHROPIC_API_KEY in the server environment for Claude/PydanticAI/Deep Agents/Pi. Vercel uses AI_GATEWAY_API_KEY. This build does not expose provider credentials in the browser or accept them in chat.
4. For OpenCode, provision a dedicated loopback server yourself with permission set to "deny", and no plugin, mcp or instructions entries. Set RELAY_OPENCODE_URL. If authenticated, set RELAY_OPENCODE_PASSWORD; username is opencode. Relay does not install or start that server or change an existing personal server.
5. Run start.ps1. It prefers .venv-agents and falls back to the existing .venv.
6. Open Frameworks → Check setup. Configure a new session, confirm the adapter-specific model identifier and permission policy, then run an investigation.

Model defaults are examples from the installed model catalog, not promises of access. Pi/PydanticAI/Deep Agents use Anthropic model IDs; Vercel uses gateway IDs; OpenCode uses provider/model. A provider rejection is surfaced as failure, never synthetic output.

## Remaining native feature work

| Runtime | Not yet integrated |
| --- | --- |
| PydanticAI | Durable execution providers, native capability/harness plugins, native serialized histories, multi-agent delegation, external MCP, multimodal/realtime, native spend limits |
| Deep Agents | Persistent native graph checkpoints, native skills/memory paths, subagents/dynamic/async delegation, sandbox backends, remote deployment |
| Pi | Native JSONL branch/resume/rewind, steering/follow-up queues, native compaction, external extensions/skills/MCP, OAuth storage |
| Vercel | useChat protocol, durable workflow persistence, native subagent/approval APIs, external MCP, multimodal/embeddings |
| OpenCode | Case-tool MCP bridge, SSE stream, permission UI, native file rewind, native structured output, plugins, shell/filesystem integration |
| All | Production authentication/RBAC, remote deployment, live sensor ingestion, third-party executable plugins and blanket filesystem/network authority |

OpenAI Agents, Google ADK, CrewAI and other frameworks are not adapters in this checkpoint. Add them deliberately through the same registry/entrypoint contract rather than implying universal compatibility.

## Extension contract

Add an allowlisted entry in adapters/registry.py with docs, supported and deferred features, dependency and credential checks. Add a lazy async run(engine,prompt) entrypoint and contract tests. Use adapters/common.py definitions/dispatch for every case-tool call. Streaming uses message.delta; verified final results use finish(). Never bypass policy by executing a tool directly in an SDK handler. Persist native state separately per Relay session if integrating native continuation later.

## Primary documentation

- Claude: https://code.claude.com/docs/en/agent-sdk/overview
- PydanticAI: https://ai.pydantic.dev/agents/ and the installed Agent/Tool/UsageLimits APIs
- Deep Agents: https://docs.langchain.com/oss/python/deepagents/customization and https://docs.langchain.com/oss/python/deepagents/backends
- Pi: https://github.com/earendil-works/pi/tree/main/packages/coding-agent/docs and its SDK/full-control examples
- Vercel: https://ai-sdk.dev/docs/agents/building-agents
- OpenCode: https://opencode.ai/docs/sdk/ and installed v2 generated client declarations

Several current APIs differ from older tutorials: PydanticAI result.usage is a property; Pi tool declarations are transcript system-message toolsAdded entries; Vercel uses isStepCount in v7; OpenCode v2 client uses flattened parameters and sessionID. Tests exercise these installed contracts.
