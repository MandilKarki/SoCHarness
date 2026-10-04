import type { Mechanism } from "./types";

export const observe: Mechanism = {
  id: "observe",
  title: "Events, streaming and tracing",
  question: "What can you watch live, and what can you audit afterwards?",
  why: "A SOC platform has to show an analyst what the agent is doing now and prove later what it did. That needs a live stream for the UI and a durable, ordered record of every model call, tool call, argument and result. Frameworks differ in what they emit, whether partial output is distinguishable from committed fact, and whether telemetry leaves your infrastructure by default.",
  patterns: [
    {
      id: "message-stream",
      name: "Typed message stream",
      say: "The run is consumed as a stream of typed messages or parts: text deltas, tool calls, tool results, finish.",
      tradeoff: "Everything is visible in order, but you must persist it yourself and handle error parts explicitly.",
    },
    {
      id: "event-bus",
      name: "Subscription and callbacks",
      say: "You subscribe to lifecycle events or register callbacks (turn, tool, compaction, queue), separate from the return value.",
      tradeoff: "Rich and decoupled, but callbacks and server-wide streams need careful filtering and ordering.",
    },
    {
      id: "committed-log",
      name: "Committed event log",
      say: "Every step is an event committed to the session or conversation log, so the log itself is the audit record.",
      tradeoff: "Audit by construction, but streamed partials are not committed and need separate handling.",
    },
    {
      id: "tracing-spans",
      name: "Tracing spans",
      say: "Agent runs, model calls, tools and handoffs become spans in traces exported to a backend.",
      tradeoff: "Good for latency and cost analysis, but traces can leave your infrastructure with alert data inside.",
    },
  ],
  dimensions: ["Live stream", "Durable record", "Tracing and export", "Leaves your host by default?"],
  entries: {
    claude: {
      pattern: "message-stream",
      api: "query() / receive_response()",
      how: "The SDK yields `SystemMessage` (`init` first), `AssistantMessage`, `UserMessage` for tool results, optional `StreamEvent`s and a final `ResultMessage` with cost and usage. Hooks on tool, compaction and subagent events give an in-process audit point.",
      cells: [
        "Typed messages; StreamEvents opt-in",
        "Session transcript; ResultMessage cost",
        "Hooks as audit points",
        "No; you persist what you need",
      ],
      code: `async for msg in client.receive_response():
    if isinstance(msg, SystemMessage) and msg.subtype == "init":
        print("session:", msg.data.get("session_id"))
    elif isinstance(msg, AssistantMessage):
        audit.assistant(msg.content)
    elif isinstance(msg, ResultMessage):
        print(msg.subtype, msg.num_turns, msg.total_cost_usd)`,
      lang: "python",
      chapter: "transport",
    },
    pydantic: {
      pattern: "tracing-spans",
      api: "instrumentation + iter()",
      how: "`Agent.iter()` exposes each graph node, and `event_stream_handler` or `run_stream_events()` deliver part and tool events. Instrumentation emits OpenTelemetry spans for runs, model requests and tool calls, with Logfire as the native backend.",
      cells: [
        "iter() nodes; run_stream_events()",
        "all_messages() that you store",
        "OpenTelemetry spans; Logfire native",
        "Only with an exporter you configure",
      ],
      code: `import logfire

logfire.configure(send_to_logfire=False)   # export via your own OTel setup
logfire.instrument_pydantic_ai()

async with agent.iter('Is 203.0.113.7 malicious?') as agent_run:
    async for node in agent_run:
        audit.node(type(node).__name__)`,
      lang: "python",
      chapter: "graph",
    },
    deepagents: {
      pattern: "message-stream",
      api: "astream(stream_mode=...)",
      how: "The compiled LangGraph graph streams with `astream()`: `stream_mode=\"updates\"` yields each node's state change and `\"messages\"` yields tokens; subagent events can be projected too. Checkpointed state is the durable record, and LangSmith tracing is available when configured.",
      cells: [
        "astream: updates or messages mode",
        "Checkpointed state per thread",
        "LangSmith tracing when enabled",
        "Only with LangSmith configured",
      ],
      code: `async for chunk in agent.astream(
    {"messages": [{"role": "user", "content": "Investigate alert 4812"}]},
    config={"configurable": {"thread_id": "case-4812"}},
    stream_mode="updates",
):
    audit.write(chunk)   # one update per node: model or tools`,
      lang: "python",
    },
    pi: {
      pattern: "event-bus",
      api: "session.subscribe()",
      how: "`subscribe()` delivers agent events (`turn_start`, `message_update`, `message_end`, `tool_execution_*`, `agent_end`) and session events (`queue_update`, `compaction_*`, `auto_retry_*`, `agent_settled`). Build records from `message_end`, and wait for `agent_settled` before marking a job done.",
      cells: [
        "subscribe(): agent and session events",
        "Append-only JSONL session file",
        "None built in",
        "No",
      ],
      code: `const unsubscribe = session.subscribe((e) => {
  if (e.type === "tool_execution_start") audit.start(caseId, e.toolCallId, e.toolName, e.args);
  if (e.type === "tool_execution_end") audit.end(caseId, e.toolCallId, e.isError);
  if (e.type === "agent_settled") ui.status("done");
});
try { await session.prompt("Summarise case 4812"); } finally { unsubscribe(); }`,
      lang: "ts",
      chapter: "events",
    },
    vercel: {
      pattern: "message-stream",
      api: "result.stream + onStepEnd",
      how: "`result.stream` (`fullStream` before v7) yields typed parts: `text-delta`, `tool-call`, `tool-result`, `tool-error`, `finish-step`, `error`. `streamText` does not throw on stream errors, so handle `error` parts. `experimental_telemetry` emits OpenTelemetry spans.",
      cells: [
        "result.stream typed parts",
        "responseMessages that you persist",
        "experimental_telemetry (OpenTelemetry)",
        "Only with an exporter you configure",
      ],
      code: `for await (const part of result.stream) {
  switch (part.type) {
    case 'tool-call': audit.call(part.toolCallId, part.toolName, part.input); break;
    case 'tool-result': audit.result(part.toolCallId, part.output); break;
    case 'tool-error': audit.fail(part.toolCallId, part.error); break;
    case 'error': throw part.error;
  }
}`,
      lang: "ts",
      chapter: "stream-parts",
    },
    opencode: {
      pattern: "event-bus",
      api: "client.event.subscribe() (SSE)",
      how: "`GET /event` is one server-wide SSE stream of `{ type, properties }` events: message parts, permissions, session status. You must filter by `sessionID` yourself. Each part update republishes the whole part, so render from the latest state.",
      cells: [
        "Server-wide SSE at /event",
        "Server-side sessions, messages, parts",
        "None documented here",
        "No; the server runs where you put it",
      ],
      code: `const events = await client.event.subscribe();
for await (const event of events.stream) {
  if (event.type === "message.part.updated" && event.properties.part.sessionID === caseSession) {
    audit.part(event.properties.part);
  } else if (event.type === "session.idle" && event.properties.sessionID === caseSession) {
    break;
  }
}`,
      lang: "ts",
      chapter: "events",
    },
    openai: {
      pattern: "tracing-spans",
      api: "trace() + run_streamed()",
      how: "Tracing is on by default: agents, generations, tool calls, handoffs and guardrails become spans, grouped by `trace()`. Processors send spans elsewhere, or tracing can be disabled. `run_streamed()` yields raw, run-item and agent-updated events, and `new_items` holds the typed record.",
      cells: [
        "stream_events() from run_streamed()",
        "Session items; result.new_items",
        "Spans for agents, tools, guardrails",
        "Yes: traces export to OpenAI by default",
      ],
      code: `set_trace_processors([CaseAuditProcessor()])   # replace the default OpenAI exporter
with trace("Case 4812 triage", group_id="case-4812"):
    result = Runner.run_streamed(agent, alert_text)
    async for event in result.stream_events():
        if event.type == "run_item_stream_event":
            audit.write(event.item)`,
      lang: "python",
      chapter: "sessions",
    },
    google_adk: {
      pattern: "committed-log",
      api: "run_async() events",
      how: "Everything is an `Event` yielded through `run_async()`. The runner commits each event's `state_delta` and appends it to the session before the agent resumes. In SSE mode, `partial=True` events are forwarded but their actions are not committed. OpenTelemetry tracing is documented.",
      cells: [
        "run_async events; partials in SSE mode",
        "Session events with state deltas",
        "OpenTelemetry traces; plugins",
        "Only with an exporter you configure",
      ],
      code: `async for event in runner.run_async(user_id="analyst-7", session_id="case-4812",
                                    new_message=msg, run_config=cfg):
    if event.partial:
        push_to_ui(event.content)  # forwarded only; actions not committed
        continue
    if event.actions.state_delta:
        audit_log(event.invocation_id, event.author, event.actions.state_delta)`,
      lang: "python",
      chapter: "dirty-reads",
    },
    microsoft: {
      pattern: "tracing-spans",
      api: "OpenTelemetry + stream=True",
      how: "Agents stream `AgentResponseUpdate` items with `stream=True`, and workflows stream typed events such as outputs and `request_info`. The chat client includes a telemetry layer, and observability is built on OpenTelemetry traces, logs and metrics.",
      cells: [
        "Agent updates; workflow events",
        "AgentSession; workflow checkpoints",
        "OpenTelemetry traces, logs, metrics",
        "Only with an exporter you configure",
      ],
      code: `async for event in workflow.run({"host": "WS-114", "cmdline": "mimikatz.exe"},
                                stream=True):
    audit.write(event.type)
    if event.type == "output":
        print(event.data)`,
      lang: "python",
      chapter: "supersteps",
    },
    openhands: {
      pattern: "committed-log",
      api: "callbacks + state.events",
      how: "Each update appends an immutable event (message, action, observation, condensation) under a lock, then fires your callbacks, so callbacks see commit order. `Event.source` separates user, agent and environment. LLM metrics track tokens, cost and latency per `usage_id`.",
      cells: [
        "Callbacks on each committed event",
        "Event files in persistence_dir",
        "LLM metrics: tokens, cost, latency",
        "No",
      ],
      code: `def on_event(event: Event) -> None:
    audit_log.write(event.model_dump_json())  # your append-only audit sink

conversation = Conversation(agent=agent, workspace="./case-4812", callbacks=[on_event])
conversation.send_message("Start triage of alert 4812")
conversation.run()`,
      lang: "python",
      chapter: "event-log",
    },
    hermes: {
      pattern: "event-bus",
      api: "stream_delta_callback and others",
      how: "`AIAgent` accepts callbacks including `stream_delta_callback`, `tool_progress_callback` (before and after each tool), `step_callback` and `status_callback`. CLI and gateway sessions persist to `state.db`, and sessions can be exported as ShareGPT-format trajectories.",
      cells: [
        "Delta, tool, step and status callbacks",
        "Returned messages; state.db for CLI",
        "Trajectory export (ShareGPT format)",
        "No",
      ],
      code: `agent = AIAgent(
    model="anthropic/claude-sonnet-4.6",
    quiet_mode=True,
    max_iterations=12,
    stream_delta_callback=ui.append,
    tool_progress_callback=audit_tool_progress,   # before and after each tool
)`,
      lang: "python",
    },
  },
  choose: [
    "Build the audit record from completed tool-call and tool-result events keyed by call ID, not from text deltas or the final answer.",
    "Check where traces go before the first real alert. OpenAI exports to its dashboard by default; replace the processor or disable tracing if alert data must stay in-region.",
    "Filter server-wide streams (OpenCode's SSE bus) by session ID at the edge so an analyst never sees another tenant's case.",
    "Never trigger side effects or ticket updates from partial events; act only on committed, final events.",
    "Record usage and cost per model call with the case and tenant IDs, subagents included, so per-tenant spend is reportable.",
  ],
};
