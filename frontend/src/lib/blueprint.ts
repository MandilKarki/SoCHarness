/*
 * Blueprints: every documented capability (lib/docs) placed into an end-to-end
 * architecture, in two lenses. The reference lens is framework-neutral; the SOC
 * lens re-casts the same layers as a security-operations platform and rates fit.
 * Section placements and SOC uses are authored judgements, not vendor claims.
 */
import { frameworkDocs, type DocItem } from "./docs";

export type LayerId = "interface" | "orchestration" | "agent" | "tools" | "state" | "governance" | "runtime" | "observe";
export type Fit = "core" | "useful" | "situational" | "avoid";
export const layers: Record<LayerId, { ref: string; refSay: string; soc: string; socSay: string }> = {
  interface: {
    ref: "Interfaces & entry points",
    refSay: "How people and systems reach the agent: APIs, UIs, CLIs, voice, messaging.",
    soc: "Intake & analyst interfaces",
    socSay: "Alerts, analyst console, chat-ops and on-call voice enter here.",
  },
  orchestration: {
    ref: "Orchestration & control flow",
    refSay: "The loop and anything that decides which agent or step runs next.",
    soc: "Investigation orchestration",
    socSay: "Triage → specialists → decision; playbooks as deterministic flows.",
  },
  agent: {
    ref: "Agent definition & models",
    refSay: "Instructions, output contracts and the models behind them.",
    soc: "Analyst agents & models",
    socSay: "Role-specific agents that must return typed, cited findings.",
  },
  tools: {
    ref: "Tools & integrations",
    refSay: "Functions, hosted tools, MCP and agent-to-agent connections.",
    soc: "Evidence & enrichment tools",
    socSay: "SIEM, EDR, identity and threat-intel queries, scoped to one case.",
  },
  state: {
    ref: "Context, state & memory",
    refSay: "History, sessions, long-term memory, artifacts and checkpoints.",
    soc: "Case memory & evidence store",
    socSay: "Per-case history, cross-case knowledge, reports and evidence files.",
  },
  governance: {
    ref: "Governance & safety",
    refSay: "Guardrails, permissions, approvals, hooks, middleware and limits.",
    soc: "Response governance",
    socSay: "Read-only by default; containment only with analyst approval; spend caps.",
  },
  runtime: {
    ref: "Execution & deployment",
    refSay: "Sandboxes, workspaces, durable execution and hosting.",
    soc: "Secure execution & durability",
    socSay: "Isolated environments for risky analysis; investigations that survive restarts.",
  },
  observe: {
    ref: "Streaming, observability & quality",
    refSay: "Events, traces, usage, evaluation and testing.",
    soc: "Audit, timeline & quality",
    socSay: "Chain of custody, live timeline, cost per case and regression evals.",
  },
};
export const layerOrder: LayerId[] = ["interface", "orchestration", "agent", "tools", "state", "governance", "runtime", "observe"];
export const fitLabel: Record<Fit, string> = {
  core: "Core to a SOC platform",
  useful: "Useful",
  situational: "Situational",
  avoid: "Avoid unless isolated",
};

/** "framework|section" → layer | fit | SOC use. */
const MAP = `
claude|Entry points|orchestration|core|One long-lived session per case; interrupt when an analyst redirects; rewind_files undoes edits to case notes.
claude|ClaudeAgentOptions|agent|core|One hardened profile per SOC role: read-only tool lists, deny lists, budget, typed findings, case-scoped working directory.
claude|Agent loop|orchestration|core|The investigation loop: query evidence, reason, cite, stop at a terminal result.
claude|Tools and MCP|tools|core|Wrap SIEM, EDR, identity and threat-intel queries as in-process MCP tools bound to one case; keep built-in shell and web tools off.
claude|Permissions|governance|core|Read-only by default; containment tools need explicit analyst approval through can_use_tool.
claude|Hooks|governance|core|PreToolUse enforces case scope and blocks destructive commands; PostToolUse redacts secrets and logs evidence access.
claude|Subagents|orchestration|useful|Identity, endpoint, network and threat-intel specialists, each with its own read-only toolset.
claude|Sessions|state|core|Resume an investigation across shifts; fork to test an alternative hypothesis without touching the case.
claude|Messages and content|observe|useful|Stream analyst-visible progress; ResultMessage gives cost per case.
claude|Skills, commands, memory, plugins|state|useful|IR playbooks as skills; memory files for environment facts such as asset owners and naming rules.
claude|Structured outputs, cost and errors|agent|core|Typed findings (observations, hypotheses, evidence IDs) feed case management; cost per investigation.
pydantic|Agents|agent|core|Typed triage agent: alert in, validated Findings out; UsageLimits per alert.
pydantic|Dependencies|tools|core|Inject case-scoped SIEM/EDR clients and the analyst's identity; swap in fakes for tests.
pydantic|Function tools|tools|core|Evidence queries that use ModelRetry when the model passes a bad filter.
pydantic|Toolsets|tools|useful|Separate read-only enrichment from response toolsets; prefix tools per data source.
pydantic|Deferred tools and approvals|governance|core|Containment (isolate host, disable account) becomes a deferred request that waits for an analyst.
pydantic|Output|agent|core|Findings schema with validators that reject uncited claims.
pydantic|Messages and history|state|core|Persist the transcript per case; history processors drop raw log dumps before the next call.
pydantic|Core runtime|orchestration|useful|Timeouts and retries for flaky security APIs; multimodal input for phishing screenshots.
pydantic|Capabilities|tools|situational|Web fetch and search for public threat intel; tool search when the toolset grows large.
pydantic|Models and providers|agent|useful|Cheap model for triage, stronger model for complex incidents, fallback on provider outage.
pydantic|MCP and A2A|tools|useful|Vendor MCP servers (SIEM, ticketing); expose the triage agent to other teams over A2A.
pydantic|Harness library|runtime|situational|Planning, subagents, prompt-injection defence and spend limits fit directly; shell and sandboxes only for isolated malware work.
pydantic|Durable execution|runtime|useful|Investigations that wait hours for approval survive restarts.
pydantic|Interfaces and streaming UIs|interface|useful|Stream investigation progress into the analyst console.
pydantic|Pydantic Evals|observe|core|Regression-test the agent on labelled past incidents before every release.
pydantic|Pydantic Graph|orchestration|situational|Deterministic IR flows (triage → enrich → decide) with agent steps inside.
pydantic|Realtime|interface|situational|Voice briefings for on-call responders.
pydantic|Testing and observability|observe|core|Traces as an audit trail; TestModel in CI.
deepagents|create_deep_agent|agent|core|One investigation agent with case-scoped tools, a checkpointer per case and a typed response format.
deepagents|Built-in tools|tools|useful|write_todos as the investigation plan; virtual files as case notes; execute stays off outside sandboxes.
deepagents|Middleware|governance|core|Summarisation for long log reviews; human approval for containment; custom middleware for case-scope checks.
deepagents|Subagents|orchestration|core|Identity, endpoint and network specialists with isolated context.
deepagents|Backends and sandboxes|runtime|situational|StoreBackend for cross-case notes; sandboxes only for malware detonation.
deepagents|Human-in-the-loop and permissions|governance|core|interrupt_on for every write or containment tool; path rules protect evidence files.
deepagents|Context engineering|state|core|Skills as IR playbooks; AGENTS.md for environment facts; offload large log results to files.
deepagents|LangGraph runtime|state|core|Checkpoints per case for resumable, auditable investigations.
pi|Sessions|orchestration|useful|steer() lets an analyst redirect mid-investigation; abort on scope creep.
pi|Options|agent|core|Replace default tools with case-scoped evidence tools; no bash.
pi|Persistence and branching|state|core|Branch to explore competing hypotheses; the JSONL log is an append-only record.
pi|Events|observe|useful|Stream progress into the case timeline.
pi|Extensions|tools|avoid|Self-written extensions are unreviewed code; keep them out of production SOC.
vercel|Agents|orchestration|useful|A ToolLoopAgent behind the analyst console; prepareStep narrows tools as the case progresses.
vercel|Tools and tool calling|tools|core|Typed enrichment tools; repairToolCall fixes malformed queries.
vercel|Core generation|agent|situational|Embeddings for similar-incident search; object generation for alert summaries.
vercel|Models, providers and middleware|agent|useful|Gateway routing plus middleware for redaction and logging.
vercel|MCP|tools|useful|Pull SIEM and ticketing tools from MCP servers.
vercel|Loop control and approvals|governance|core|Step caps and approval policies for response actions.
vercel|AI SDK UI|interface|core|Live, streamed investigation UI with tool parts.
vercel|Telemetry and testing|observe|useful|OpenTelemetry spans per investigation; mock models in CI.
opencode|SDK setup|interface|situational|A dedicated server for detection engineering (writing rules), not live response.
opencode|client.session|orchestration|situational|Fork per hypothesis; revert edits to detection rules.
opencode|Other client namespaces|interface|situational|Code search across detection-as-code repositories.
opencode|Configuring the agent server|governance|useful|Deny-all permissions, no plugins, plan mode for reviewing detections.
openai|Agents|agent|core|Triage agent with a findings output_type, guardrails and case-scoped tools.
openai|Running agents|orchestration|core|A bounded Runner per alert; error handlers for max_turns; RunConfig enforces redaction filters.
openai|Results|state|core|to_input_list and last_agent carry the case forward; interruptions surface pending approvals.
openai|Streaming|observe|core|The live investigation timeline in the console.
openai|Tools|tools|core|Function tools for SIEM/EDR/IdP queries; file search over runbooks; computer and shell tools only in sandboxes.
openai|Handoffs|orchestration|core|Triage hands off to phishing, identity or malware specialists.
openai|Agent orchestration|orchestration|core|Manager pattern for multi-domain incidents; code orchestration for fixed playbooks.
openai|Guardrails|governance|core|Block containment requests in read-only mode; output guardrails check citations.
openai|Human-in-the-loop|governance|core|Approve isolate/disable actions; persist RunState while waiting for an analyst.
openai|Sessions|state|core|Per-case history; encrypted sessions for sensitive evidence; Redis for multi-worker SOCs.
openai|Context, usage and hooks|governance|useful|Analyst identity and case scope in context; hooks for audit logging; usage per case.
openai|Models|agent|useful|Cheap model for triage, reasoning model for complex cases; store=False for data control.
openai|MCP|tools|useful|Vendor MCP servers with tool filters and approvals.
openai|Tracing|observe|core|A chain-of-custody trace for every decision; export to your own SIEM if data must stay in.
openai|Sandbox agents|runtime|situational|Malware triage or heavy log parsing inside an isolated sandbox.
openai|Realtime and voice|interface|situational|A voice bridge for on-call incident commanders.
openai|Testing, visualization, REPL|observe|useful|Fake-model tests and agent graphs for design reviews.
google_adk|LLM agents|agent|core|Triage LlmAgent with output_schema; output_key writes findings into case state.
google_adk|Workflow and multi-agent|orchestration|core|SequentialAgent for triage → enrich → report; ParallelAgent for concurrent enrichment.
google_adk|Tools|tools|core|FunctionTools for queries; OpenAPIToolset for security vendor APIs; confirmations before actions.
google_adk|Runtime|orchestration|core|A Runner per case with max_llm_calls; the API server behind the SOC console.
google_adk|Sessions, state and memory|state|core|user:/app: state for analyst preferences and org facts; a memory bank of past incidents.
google_adk|Artifacts|state|useful|Keep PCAPs, screenshots and reports alongside the case.
google_adk|Callbacks and plugins|governance|core|before_tool_callback enforces case scope; a plugin for global redaction and audit.
google_adk|Models|agent|useful|Gemini or other providers via LiteLlm.
google_adk|Live and voice|interface|situational|Live voice for on-call responders.
google_adk|A2A|tools|useful|Federate with IT and cloud teams' agents over A2A.
google_adk|Evaluation, observability, deployment|observe|core|Eval sets from past incidents; traces for audit; managed deployment.
microsoft|Agents|agent|core|Investigation agent with typed findings; harness-agent features for long cases.
microsoft|Sessions and memory|state|core|A serialised AgentSession per case; context providers inject the asset inventory.
microsoft|Tools|tools|core|Function tools with approval_mode for response actions.
microsoft|Middleware|governance|core|Function middleware enforces scope and redacts; agent middleware writes the audit log.
microsoft|Chat clients and providers|agent|useful|Azure OpenAI or Foundry where data residency matters.
microsoft|Workflows|orchestration|core|Deterministic IR playbooks with checkpoints and human-approval nodes.
microsoft|Orchestrations|orchestration|useful|Concurrent enrichment, specialist handoff, manager-led planning for complex incidents.
microsoft|Observability, tooling and migration|observe|useful|OpenTelemetry into your SIEM; DevUI for testing playbooks.
openhands|Conversation|orchestration|useful|Event-sourced investigations with pause/resume and stuck detection.
openhands|Agent and LLM|agent|useful|Route between cheap and strong models.
openhands|Tools|tools|situational|Typed actions for evidence queries; bash and browser only inside isolated workspaces.
openhands|Events|observe|core|The immutable event log doubles as an audit trail.
openhands|Workspace|runtime|situational|Docker or remote workspaces for malware and forensic tooling.
openhands|Context, security and skills|governance|core|SecurityAnalyzer and ConfirmationPolicy gate risky actions; condensers for long log reviews.
hermes|Agent core|orchestration|situational|A bounded conversation loop; profiles isolate tenants.
hermes|Tools and toolsets|tools|situational|Restrict to a private evidence toolset; most built-ins stay off.
hermes|Learning loop|state|avoid|Self-written skills and memory need review before a SOC trusts them; fine in a lab.
hermes|Context and personality|agent|situational|Context files for environment facts.
hermes|Execution environments|runtime|situational|Scheduled hunts via cron; parallel hunts in isolated backends.
hermes|Interfaces|interface|useful|Chat-ops: post triage summaries to Slack or Teams through gateways.
`;
interface SectionMap {
  layer: LayerId;
  fit: Fit;
  soc: string;
}
const sectionMap: Record<string, SectionMap> = {};
MAP.trim()
  .split("\n")
  .forEach((line) => {
    const [fw, sec, layer, fit, ...soc] = line.split("|");
    sectionMap[fw + "|" + sec] = { layer: layer as LayerId, fit: fit as Fit, soc: soc.join("|") };
  });

/** Item-level placement: the entry's kind first, then specific name signals, then the section default. */
const byKind: Partial<Record<DocItem["k"], LayerId>> = { hook: "governance", event: "observe", tool: "tools", cli: "interface" };
const rules: [RegExp, LayerId][] = [
  [/uimessage|agentui|ui.?stream/i, "interface"],
  [/^session\.(?!subscribe)|createAgentSession|client\.query|^query\(\)|todo/i, "orchestration"],
  [/\btrac|\bspan\b|_span|telemetry|logfire|metric|observab|\busage|cost track|\beval|evaluat|\btest|mock|fake|draw_graph|visuali|run_demo_loop|devui|instrument/i, "observe"],
  [/guardrail|tripwire|approv|permission|hook|middleware|callback|interrupt|confirm|securityanalyzer|\bpolic|budget|usagelimits|max_turns|max_iter|max_llm|stopwhen|stepcount|limit|redact|can_use|command\(resume/i, "governance"],
  [/handoff|as_tool|subagent|sub_agents|transfer|sequential|parallel|loopagent|group chat|magentic|orchestrat|workflow|executor|\bedge|graph|delegat|specialist|^runner|runner\b/i, "orchestration"],
  [/mcp|toolset|tools?\b|tool\(|@tool|function_tool|functiontool|openapi|\ba2a|basetool|tooldefinition|\baction\b|\bobservation\b|websearch|web search|filesearch|codeinterpreter|imagegeneration|computer|shell|applypatch|bash|browser/i, "tools"],
  [/sandbox|workspace|docker|durable|temporal|dbos|prefect|restate|dapr|deploy|production|container|cloud run|gke|agent runtime|terminal backend|cron|batch|backend/i, "runtime"],
  [/stream|event|delta|subscribe/i, "observe"],
  [/session|history|memory|messages|artifact|\bstate\b|runstate|checkpoint|compaction|condenser|summar|\bstore\b|to_input_list|resume|fork|branch|jsonl|conversation_id|previous_response|skill|context file|agents\.md|claude\.md|persist|cach/i, "state"],
  [/realtime|voice|audio|\blive\b|usechat|usecompletion|useobject|uimessage|\bui\b|tui|\bcli\b|messaging|web interface|chat ui|ag-ui|repl|adk web|api_server|interface/i, "interface"],
  [/model|provider|\bllm|gateway|settings|temperature|reasoning|thinking|effort|output|schema|response_format|instructions|system_prompt|prompt/i, "agent"],
];
/** Hand-checked corrections where name signals mislead. */
const OVERRIDE: Record<string, LayerId> = {
  "include_hook_events / forward_subagent_text": "observe",
  include_partial_messages: "observe",
  agents: "orchestration",
  plugins: "tools",
  Plugins: "tools",
  "Agent.run()": "orchestration",
  "Agent.run_sync()": "orchestration",
  "Agent.iter() / AgentRun": "orchestration",
  "agent_run.next(node)": "orchestration",
  "is_user_prompt_node / is_model_request_node / is_call_tools_node / is_end_node": "orchestration",
  end_strategy: "orchestration",
  "CancellationToken / RunCancelled": "orchestration",
  RunUsage: "observe",
  "SubAgent (name, description, system_prompt, tools, model, middleware)": "orchestration",
  "cache / debug / name": "agent",
  "Agent (interface)": "orchestration",
  "model / instructions / tools": "agent",
  "toolCallId / messages / abortSignal": "tools",
  "generateObject() / streamObject()": "agent",
  "createAgentUIStreamResponse()": "interface",
  "toUIMessageStreamResponse() / createUIMessageStream()": "interface",
  "Agents / modes (build, plan…)": "agent",
  "LSP / formatters": "tools",
  Server: "runtime",
  "ACP support": "interface",
  Share: "interface",
  "RunConfig.session_input_callback": "state",
  "Agent.as_tool(tool_name, tool_description, max_turns, …)": "orchestration",
  "MongoDBSession / DaprSession": "state",
  "cancel()": "orchestration",
  "Model / Model.stream_response": "agent",
  "responses_websocket_session()": "runtime",
  code_executor: "runtime",
  "adk eval / AgentEvaluator": "observe",
  "adk deploy": "runtime",
  "Safety and security": "governance",
  "Context providers": "state",
  "run() / run_stream()": "orchestration",
  RequestInfoExecutor: "governance",
  ToolExecutor: "tools",
  stream_delta_callback: "observe",
  Security: "governance",
  "Context compression": "state",
  "Migration from Semantic Kernel / AutoGen": "interface",
};
export function layerFor(item: DocItem, section: SectionMap): LayerId {
  if (OVERRIDE[item.n]) return OVERRIDE[item.n];
  if (item.k === "exception")
    return /guardrail|tripwire|maxturns/i.test(item.n) ? "governance" : /tool/i.test(item.n) ? "tools" : "orchestration";
  const k = byKind[item.k];
  if (k) return k;
  for (const [re, layer] of rules) if (re.test(item.n)) return layer;
  return section.layer;
}
/** SOC fit per item: inherit the section's fit, but risky host-level tools need isolation. */
export function fitFor(item: DocItem, section: SectionMap): Fit {
  if (/shell|bash|computer|browser|execute|applypatch|localshell|plugins?\b|extensions?\b/i.test(item.n) && !item.r) return "avoid";
  return section.fit;
}

export interface Placed {
  item: DocItem;
  section: string;
  url: string;
  fit: Fit;
  soc: string;
}
export interface Component {
  section: string;
  url: string;
  fit: Fit;
  soc: string;
  home: boolean; // the section's primary layer (full SOC use shown here)
  items: Placed[];
}
/** Short SOC role for a section's entries that land outside its home layer. */
export const spillRole: Record<LayerId, string> = {
  interface: "Entry points from this area of the docs.",
  orchestration: "Control-flow pieces: who runs next and when the loop stops.",
  agent: "Agent and model settings that shape each analyst agent.",
  tools: "Tool wiring that reaches case evidence.",
  state: "History and state that keep the case continuous.",
  governance: "Safety controls to apply to every SOC action from this area.",
  runtime: "Execution and durability pieces for long or risky work.",
  observe: "Signals for the audit trail, timeline and evals.",
};
export type Blueprint = Record<LayerId, Component[]>;
export function blueprintFor(fw: string): { bp: Blueprint; total: number; unmapped: string[] } {
  const docs = frameworkDocs[fw];
  const bp = Object.fromEntries(layerOrder.map((l) => [l, [] as Component[]])) as Blueprint;
  const unmapped: string[] = [];
  let total = 0;
  for (const s of docs?.sections || []) {
    const m = sectionMap[fw + "|" + s.t];
    if (!m) {
      unmapped.push(s.t);
      continue;
    }
    for (const item of s.items) {
      const layer = layerFor(item, m);
      let comp = bp[layer].find((c) => c.section === s.t);
      if (!comp) {
        comp = { section: s.t, url: s.url, fit: m.fit, soc: m.soc, home: layer === m.layer, items: [] };
        bp[layer].push(comp);
      }
      comp.items.push({ item, section: s.t, url: s.url, fit: fitFor(item, m), soc: m.soc });
      total++;
    }
  }
  return { bp, total, unmapped };
}

/** The SOC end-to-end flow and the layers that carry each stage. */
export const socFlow: { stage: string; say: string; layers: LayerId[] }[] = [
  { stage: "Alert", say: "Detection, analyst question or scheduled hunt arrives", layers: ["interface"] },
  { stage: "Triage", say: "Classify, scope the case, pick specialists", layers: ["orchestration", "agent"] },
  { stage: "Investigate", say: "Query evidence and enrich within case scope", layers: ["tools", "agent"] },
  { stage: "Remember", say: "Keep case history, artifacts and prior incidents", layers: ["state"] },
  { stage: "Decide", say: "Typed, cited findings with hypotheses and limits", layers: ["agent", "governance"] },
  { stage: "Approve", say: "Analyst approves any containment action", layers: ["governance", "interface"] },
  { stage: "Respond", say: "Run approved actions in isolated, durable execution", layers: ["runtime", "tools"] },
  { stage: "Report & learn", say: "Audit trail, timeline, cost and regression evals", layers: ["observe", "state"] },
];
