import type { DeepDive } from "./types";

const B = "https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/";

export const pi: DeepDive = {
  intro:
    "Pi is one small loop inside an `AgentSession`: send the active branch to the model, run the tool calls it asks for, record everything as entries in a JSONL tree, repeat. Queues, events, extensions and compaction are all hooks on that loop or on that tree. Very little is hidden, so you can see exactly where your own controls go.",
  chapters: [
    {
      id: "loop",
      title: "The minimal loop: turns, tools and queues",
      hook: "What actually happens between prompt() and the answer?",
      diagram: {
        kind: "loop",
        center: "AgentSession",
        exit: "no tool calls and no queued messages: agent_end",
        steps: [
          { t: "Build the request", s: "System prompt, the active branch, the active tool declarations and the model settings become one request.", tag: "core" },
          { t: "Stream the response", s: "The provider streams text and tool calls. The finished assistant message is recorded in the session.", tag: "model" },
          { t: "Run tool calls", s: "Each tool call executes; calls from one message can run in parallel. Results are recorded as toolResult messages.", tag: "tool" },
          { t: "Poll steering queue", s: "After the tool batch, queued steering messages are injected before the next model call.", tag: "event" },
          { t: "Next turn or stop", s: "Tool results or queued messages trigger another turn. Otherwise follow-ups are checked, then the run ends.", tag: "stop" },
        ],
      },
      explain: [
        "A turn is one assistant response plus its tool calls and results. The loop in `pi-agent` keeps going while the last response had tool calls or a steering message is pending. When it would stop, it checks the follow-up queue; if that is empty, it emits `agent_end`. A response cut off with `stopReason: \"length\"` fails its tool calls instead of running half-written arguments.",
        "The default tool set is only `read`, `bash`, `edit` and `write`. `createAgentSession({ tools })` is an allowlist, `excludeTools` a denylist, `noTools` starts empty, and `customTools` adds your own `ToolDefinition`s. That is the whole surface, so replacing the defaults with case-scoped tools is a single option.",
      ],
      code: {
        lang: "ts",
        caption: "Drop the shell and file-writing tools and give the loop one read-only enrichment tool.",
        src: `import { Type } from "@earendil-works/pi-ai";
import { createAgentSession, defineTool, SessionManager }
  from "@earendil-works/pi-coding-agent";

const hostLookup = defineTool({
  name: "host_lookup",
  label: "Host lookup",
  description: "Return owner and criticality for a hostname from the CMDB",
  parameters: Type.Object({ host: Type.String() }),
  async execute(_toolCallId, params) {
    const text = await cmdbLookup(params.host); // your CMDB client
    return { content: [{ type: "text", text }], details: undefined };
  },
});

const { session } = await createAgentSession({
  tools: ["read", "host_lookup"], // allowlist: no bash, edit or write
  customTools: [hostLookup],
  sessionManager: SessionManager.inMemory(),
});
await session.prompt("Who owns WS-114 and how critical is it?");
console.log(session.getLastAssistantText());
session.dispose();`,
      },
      soc: "With only four built-in tools, the attack surface is easy to reason about: remove `bash` and `write` and the agent can only touch what your custom tools expose. Treat `bash` as a containment-grade capability, never a default.",
      url: B + "how-pi-works.md",
    },
    {
      id: "tree",
      title: "The session is a tree in a JSONL file",
      hook: "How can you go back and try again without losing what happened?",
      diagram: {
        kind: "tree",
        root: { t: "session header", s: "First JSONL line: version, session id, cwd, and `parentSession` if this file was forked. It is not part of the tree.", tag: "state" },
        children: [
          {
            t: "user: triage 4812",
            s: "Every later line is an entry with `id` and `parentId`. The first entry is the root.",
            tag: "you",
            children: [
              { t: "assistant + tools", s: "Messages, tool results, model changes and compactions all append as children of the current leaf.", tag: "model" },
            ],
          },
          {
            t: "branch A (abandoned)",
            s: "Moving the leaf back to an earlier entry does not delete this path. It stays in the same file.",
            tag: "state",
            children: [
              { t: "branch_summary", s: "Optional: an LLM summary of the abandoned path is attached where the new branch starts.", tag: "core" },
            ],
          },
          { t: "branch B = active leaf", s: "Only the path from the leaf back to the root becomes model context for the next request.", tag: "core" },
          { t: "forkFrom: new file", s: "`SessionManager.forkFrom()` or `/fork` copies history into a new session file with `parentSession` set.", tag: "state" },
        ],
      },
      explain: [
        "Each line of a session file is one entry: `message`, `model_change`, `thinking_level_change`, `compaction`, `branch_summary`, `custom`, `custom_message`, `label`, `context_edit` and more. `SessionManager` tracks the current leaf. `branch(id)` moves the leaf; the next append becomes a child of that entry. Nothing is rewritten, so the file is an append-only audit log.",
        "`buildSessionContext()` walks from the leaf to the root and turns that one path into model messages. `session.navigateTree()` is the programmatic `/tree`: it moves the leaf and can summarise the branch you leave. `/fork` and `/clone` instead write a new file. Custom entries never reach the model; `custom_message` entries do.",
      ],
      code: {
        lang: "ts",
        caption: "Test two hypotheses from one checkpoint; both branches stay in the case file.",
        src: `import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";

const sm = SessionManager.open("/cases/4812/session.jsonl");
const { session } = await createAgentSession({ sessionManager: sm });
const checkpoint = sm.getLeafId()!; // enrichment done, hypotheses start here

await session.prompt("Hypothesis A: credential stuffing on the VPN. Test it.");
// Go back. Branch A stays in the file; a summary of it is attached here.
await session.navigateTree(checkpoint, { summarize: true });
await session.prompt("Hypothesis B: token theft from WS-114. Test it.");

for (const e of sm.getBranch()) console.log(e.id, e.parentId, e.type);

// Continue elsewhere without touching the original file
const copy = SessionManager.forkFrom(sm.getSessionFile()!, process.cwd());`,
      },
      soc: "An append-only tree is a natural investigation record: dead-end hypotheses are kept, not overwritten, which matters for audit and peer review. Relay uses `forkFrom` so a failed attempt never contaminates the last good session.",
      url: B + "session-format.md",
    },
    {
      id: "queues",
      title: "steer versus followUp",
      hook: "What happens to a message sent while the agent is still working?",
      diagram: {
        kind: "timeline",
        legend: { model: "model call", tool: "tool batch", event: "queued message", stop: "run ends" },
        events: [
          { t: "prompt(): run starts", s: "The analyst asks for triage of two hosts. `prompt()` will resolve only when the whole run finishes.", tag: "you" },
          { t: "Turn 1 requests tools", s: "The model asks for `host_lookup` on both hosts. The tools start running.", tag: "model" },
          { t: "steer() arrives", s: "\"Skip WS-207, it is our scanner.\" It is queued, not injected mid-tool. `queue_update` reports it.", tag: "event" },
          { t: "Tool batch finishes", s: "The current turn completes normally. Running tools are not interrupted by a steer.", tag: "tool" },
          { t: "Steer delivered", s: "Before the next model call, the steering message joins the context as a user message.", tag: "event" },
          { t: "followUp delivered", s: "Only when there are no tool calls and no steering left does the follow-up start another turn.", tag: "event" },
          { t: "agent_end, then settled", s: "The run ends. `agent_settled` confirms Pi will not continue on its own.", tag: "stop" },
        ],
      },
      explain: [
        "While the session is streaming, `prompt()` refuses to guess and throws unless you pass `streamingBehavior: \"steer\"` or `\"followUp\"`. `session.steer()` and `session.followUp()` do the same directly and return `\"queued\"`, or `\"handled\"` if an extension consumed the input.",
        "A steering message is delivered after the current assistant turn and its tool calls, before the next model request. A follow-up waits until the agent has nothing left to do. The `steeringMode` and `followUpMode` settings choose `\"one-at-a-time\"` (default) or `\"all\"`. `abort()` stops the run; `clearQueue()` returns what was still waiting.",
      ],
      code: {
        lang: "ts",
        caption: "Correct the agent mid-run, and queue the write-up for after it finishes.",
        src: `let steered = false;
session.subscribe((e) => {
  if (e.type === "queue_update") console.log("queued:", e.steering, e.followUp);
  if (e.type === "tool_execution_start" && e.toolName === "host_lookup" && !steered) {
    steered = true;
    void session.steer("Skip WS-207. It is our authorised vulnerability scanner.");
  }
});

const run = session.prompt("Triage alert 4812: check WS-114 and WS-207.");
await session.followUp("When you are done, write a three-line case summary.");
await run; // resolves after the follow-up turn too`,
      },
      soc: "Steering is how an analyst corrects an investigation in flight (\"that IP is ours\") without killing it and paying for a restart. Both queues are user input, so pass them through the same injection screening as the original prompt.",
      url: B + "sdk.md#prompting",
    },
    {
      id: "events",
      title: "The event stream from subscribe()",
      hook: "What can a host observe while a run is in progress?",
      diagram: {
        kind: "lanes",
        actors: ["Host app", "AgentSession", "Model", "Tool"],
        msgs: [
          { from: 0, to: 1, t: "subscribe(), then prompt()", s: "Subscribe before prompting; the docs require it when the host needs streamed output.", tag: "you" },
          { from: 1, to: 0, t: "agent_start, turn_start", s: "The run and its first turn begin.", tag: "event" },
          { from: 2, to: 1, t: "streamed deltas", s: "The provider streams the assistant message token by token.", tag: "model" },
          { from: 1, to: 0, t: "message_update (text_delta)", s: "Each fragment arrives as `assistantMessageEvent`. Use it for live display only, not for records.", tag: "event" },
          { from: 1, to: 3, t: "execute tool call", s: "`tool_execution_start`, optional `_update`, then `tool_execution_end` with `isError`.", tag: "tool" },
          { from: 1, to: 0, t: "message_end, turn_end", s: "`message_end` carries the authoritative completed message. Store this one.", tag: "event" },
          { from: 1, to: 0, t: "agent_end, agent_settled", s: "`agent_end` may still be followed by a retry or queued work. `agent_settled` is final.", tag: "stop" },
        ],
      },
      explain: [
        "`session.subscribe()` delivers low-level agent events (`agent_start`, `turn_start`, `message_start`, `message_update`, `message_end`, `tool_execution_*`, `turn_end`, `agent_end`) plus session events: `queue_update`, `compaction_start`/`_end`, `auto_retry_start`/`_end`, `entry_appended` and `agent_settled`.",
        "Two rules avoid most bugs. Build records from `message_end`, not from deltas. Treat `agent_end` as the end of one low-level run only: its `willRetry` flag and queued follow-ups mean more can happen. Wait for `agent_settled` before you mark the job done. After `AgentSessionRuntime` replaces the session, subscriptions must be bound again.",
      ],
      code: {
        lang: "ts",
        caption: "Stream text to the analyst and write an audit record per tool call.",
        src: `const unsubscribe = session.subscribe((e) => {
  switch (e.type) {
    case "message_update": {
      const m = e.assistantMessageEvent;
      if (m.type === "text_delta") ui.append(m.delta);
      break;
    }
    case "tool_execution_start":
      audit.start(caseId, e.toolCallId, e.toolName, e.args);
      break;
    case "tool_execution_end":
      audit.end(caseId, e.toolCallId, e.isError);
      break;
    case "agent_end":
      if (e.willRetry) ui.status("retrying");
      break;
    case "agent_settled":
      ui.status("done");
      break;
  }
});
try { await session.prompt("Summarise case 4812"); } finally { unsubscribe(); }`,
      },
      soc: "The event stream is your live audit feed: every tool call with its arguments and outcome, keyed by `toolCallId`. Persist it with the case; do not rely on reconstructing what happened from the final answer.",
      url: B + "sdk.md#subscribing-to-events",
    },
    {
      id: "extensions",
      title: "Extensions intercept the loop in-process",
      hook: "Where do you put a policy that the agent cannot talk its way around?",
      diagram: {
        kind: "stack",
        layers: [
          { t: "input / before_agent_start", s: "Extensions can transform or consume user input and adjust prompt sections and active tools before the run.", u: "turn_end and agent_before_settle can request one more turn.", tag: "guard" },
          { t: "tool_call handlers", s: "Run in load order before execution. They can mutate `event.input` or return `{ block: true, reason }`. A handler that throws also blocks.", u: "A blocked call returns the reason to the model as an error.", tag: "guard" },
          { t: "tool_result handlers", s: "Compose in order; each sees prior changes and can rewrite `content`, `details` or `isError`.", u: "Redact here before the model sees output.", tag: "guard" },
        ],
        core: { t: "tool.execute()", s: "The tool runs with the Pi process's operating-system permissions. No sandbox is implied.", tag: "tool" },
      },
      explain: [
        "An extension is a factory that receives `ExtensionAPI`. It uses `pi.on(event, handler)` for lifecycle hooks, `pi.registerTool()` and `pi.registerCommand()` to add capabilities, and `pi.appendEntry()` to persist state that never enters model context. Files load from `~/.pi/agent/extensions/` or `.pi/extensions/`; SDK hosts can pass `extensionFactories` to `DefaultResourceLoader`.",
        "Extensions run inside the Pi process with full access to prompts, files and credentials, and the CLI can hot-reload them. That makes them powerful and dangerous. Load only trusted code, and note that project extensions load only after `project_trust` is resolved.",
      ],
      code: {
        lang: "ts",
        caption: "An inline extension that blocks outbound network commands and audits every result.",
        src: `import { createAgentSession, DefaultResourceLoader, getAgentDir, isToolCallEventType,
  type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const NETWORK = /\\b(curl|wget|ssh|nc)\\b/;
const egressGuard = (pi: ExtensionAPI) => {
  pi.on("tool_call", async (event) => {
    if (isToolCallEventType("bash", event) && NETWORK.test(event.input.command)) {
      return { block: true, reason: "Outbound network commands are blocked in triage" };
    }
    return undefined;
  });
  pi.on("tool_result", async (event) => {
    audit.record(event.toolName, event.input, event.isError);
    return undefined;
  });
};

const resourceLoader = new DefaultResourceLoader({
  cwd: process.cwd(), agentDir: getAgentDir(), extensionFactories: [egressGuard],
});
await resourceLoader.reload();
const { session } = await createAgentSession({ resourceLoader });`,
      },
      soc: "A `tool_call` handler is a deterministic policy point that sits outside the model, so injected alert text cannot argue past it. It still runs in-process with the agent, which is why Relay disables user extensions and enforces policy in its own tool gateway.",
      url: B + "extensions.md",
    },
    {
      id: "compaction",
      title: "Compaction rebuilds context, it does not delete",
      hook: "What does the model see once a long investigation outgrows the context window?",
      diagram: {
        kind: "flow",
        steps: [
          { t: "Threshold check", s: "After a tool batch: if context tokens exceed the window minus `reserveTokens` (16384 by default), compaction starts.", tag: "core" },
          { t: "Find the cut point", s: "Walk back from the leaf until `keepRecentTokens` (20000 by default) is kept. Normally cut at a user message.", tag: "state" },
          { t: "session_before_compact", s: "Extensions can cancel, or return their own summary, for example with a cheaper model.", tag: "guard" },
          { t: "Summarise older span", s: "A model call summarises the older messages, building on the previous summary if one exists.", tag: "model" },
          { t: "Append compaction entry", s: "A `compaction` entry stores the summary and `firstKeptEntryId`. Older entries stay in the file.", tag: "state" },
          { t: "Next request", s: "The model sees: system checkpoint, summary, then entries from `firstKeptEntryId` onwards.", tag: "stop" },
        ],
      },
      explain: [
        "Compaction is triggered three ways: the threshold check between turns, a provider context-overflow error (one compact-and-retry attempt), or `/compact` and `session.compact(instructions)`. It emits `compaction_start` and `compaction_end` with the `reason` (`manual`, `threshold` or `overflow`).",
        "The raw history is never removed. `buildSessionContext()` replaces everything before `firstKeptEntryId` with the summary only when building the next request. Tool output is truncated to 2000 characters when serialised for the summariser. The thresholds are settings (`compaction.reserveTokens`, `compaction.keepRecentTokens`) and can be overridden per model.",
      ],
      code: {
        lang: "ts",
        caption: "Make compaction explicit, and keep indicators verbatim in the summary.",
        src: `import { createAgentSession, SettingsManager } from "@earendil-works/pi-coding-agent";

const settingsManager = SettingsManager.inMemory({
  compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
});
const { session } = await createAgentSession({ settingsManager });

session.subscribe((e) => {
  if (e.type === "compaction_start") log.info("compacting", e.reason);
  if (e.type === "compaction_end" && e.result) {
    log.info("tokens before", e.result.tokensBefore);
  }
});

// Manual compaction with focus instructions
const result = await session.compact(
  "Keep every IP, hash, hostname and account name verbatim. Keep analyst decisions.",
);`,
      },
      soc: "A summary can silently drop the one indicator that mattered, so tell the summariser what must survive and keep the raw JSONL as evidence. Relay disables native compaction and controls context itself for exactly this reason.",
      url: B + "compaction.md",
    },
  ],
};
