import type { Mechanism } from "./types";

export const loop: Mechanism = {
  id: "loop",
  title: "Loop and stopping",
  question: "What keeps the agent loop going, and what ends it?",
  why: "The loop is where cost and runaway risk live. A triage agent fed hostile alert text can be steered into calling enrichment tools indefinitely, and a run that stops on a budget can look like a finished verdict. You need to know what ends a run, what each ending looks like to your code, and whether an exhausted budget is distinguishable from a real answer.",
  patterns: [
    {
      id: "turn-budget",
      name: "Turn budget",
      say: "A fixed cap on model turns or calls; hitting it ends the run with a distinct error, status or result subtype.",
      tradeoff: "Simple and auditable, but blunt: a hard case fails at the same count as a trivial one.",
    },
    {
      id: "graceful-wind-down",
      name: "Graceful wind-down",
      say: "When the budget is spent, the harness stops offering tools and asks the model for a final text answer instead of raising.",
      tradeoff: "You always get an answer, but it may be an unfinished summary that reads like a conclusion.",
    },
    {
      id: "stop-predicates",
      name: "Stop predicates",
      say: "Your code inspects the run after each step and decides whether to continue: stop conditions, middleware jumps or tool-triggered stops.",
      tradeoff: "Precise per-case control, but every stopping rule is code you must write, test and keep in sync.",
    },
    {
      id: "validated-output",
      name: "Validated output ends it",
      say: "The run ends only when an output passes schema validation; usage limits bound how long that may take.",
      tradeoff: "Cannot stop on chatter, but a model that never satisfies the schema burns retries before failing.",
    },
    {
      id: "external-abort",
      name: "Natural stop plus abort",
      say: "The loop runs until the model stops calling tools; any budget is enforced from outside by aborting the session.",
      tradeoff: "Minimal and transparent, but there is no runaway protection unless you add it.",
    },
  ],
  dimensions: ["Natural end", "Budget knob", "On budget exhausted", "Cost cap"],
  entries: {
    claude: {
      pattern: "turn-budget",
      api: "max_turns + max_budget_usd",
      how: "The CLI runs the loop and stops when Claude answers without tool calls. `max_turns` and `max_budget_usd` cap it, and every run ends with one `ResultMessage` whose `subtype` says why (`success`, `error_max_turns`, `error_max_budget_usd`).",
      cells: [
        "Reply with no tool calls",
        "max_turns, max_budget_usd",
        "Error ResultMessage subtype; query() then raises",
        "Yes: USD estimate, one call can overshoot",
      ],
      code: `options = ClaudeAgentOptions(max_turns=8, max_budget_usd=0.50)
async for msg in query(prompt=alert_text, options=options):
    if isinstance(msg, ResultMessage):
        if msg.subtype == "success":
            save_verdict(msg.structured_output)
        else:                       # error_max_turns, error_max_budget_usd, ...
            flag_for_analyst(msg.session_id, msg.subtype)`,
      lang: "python",
      chapter: "result",
    },
    pydantic: {
      pattern: "validated-output",
      api: "UsageLimits + end_strategy",
      how: "The graph alternates model requests and tool calls until `CallToolsNode` yields an `End` with validated output. `UsageLimits` caps requests, tool calls and tokens; `end_strategy` decides whether tool calls bundled with the final output still run.",
      cells: [
        "Output validates (End node)",
        "UsageLimits: requests, tool calls, tokens",
        "Raises UsageLimitExceeded",
        "cost_limit in recent releases, best-effort",
      ],
      code: `limits = UsageLimits(request_limit=8, tool_calls_limit=12, total_tokens_limit=60_000)
try:
    result = await agent.run(alert_text, deps=deps, usage_limits=limits)
except UsageLimitExceeded as exc:
    print('investigation stopped:', exc)`,
      lang: "python",
      chapter: "limits",
    },
    deepagents: {
      pattern: "stop-predicates",
      api: "middleware jump_to + recursion_limit",
      how: "A LangGraph model-and-tools loop that ends when the model makes no tool calls. Bound it with LangGraph's `recursion_limit` in the run config, or with middleware whose `before_model` returns `jump_to: \"end\"` once your own budget is spent.",
      cells: [
        "AI message with no tool calls",
        "recursion_limit; custom middleware",
        "GraphRecursionError, or a clean jump to end",
        "None built in; count in middleware",
      ],
      code: `class ModelCallBudget(AgentMiddleware):
    @hook_config(can_jump_to=["end"])
    def before_model(self, state: AgentState, runtime: Runtime) -> dict[str, Any] | None:
        if sum(1 for m in state["messages"] if m.type == "ai") >= 12:
            return {"messages": [AIMessage("Model-call budget exhausted.")], "jump_to": "end"}
        return None

agent = create_deep_agent(tools=[search_alerts], middleware=[ModelCallBudget()])`,
      lang: "python",
      chapter: "hooks",
    },
    pi: {
      pattern: "external-abort",
      api: "agent_settled + session.abort()",
      how: "The loop continues while the last response had tool calls or a steering message is queued, then drains follow-ups and emits `agent_end`. The documented session options include no turn cap, so count `turn_start` events and call `session.abort()`.",
      cells: [
        "No tool calls and empty queues",
        "None documented; abort() from your code",
        "Whatever your abort handler records",
        "None",
      ],
      code: `let turns = 0;
session.subscribe((e) => {
  if (e.type === "turn_start" && ++turns > 8) void session.abort();
  if (e.type === "agent_settled") ui.status("done");
});
await session.prompt("Triage alert 4812");`,
      lang: "ts",
      chapter: "loop",
    },
    vercel: {
      pattern: "stop-predicates",
      api: "stopWhen: isStepCount / hasToolCall",
      how: "`generateText` and `streamText` loop step by step; a step without tool calls ends it. `stopWhen` takes conditions checked after each step, and `ToolLoopAgent` defaults to `isStepCount(20)`. A tool without `execute` ends the run on its arguments.",
      cells: [
        "Step with no tool calls",
        "stopWhen array: any true condition stops",
        "Returns normally with the steps so far",
        "None; write a condition over step usage",
      ],
      code: `const triage = new ToolLoopAgent({
  model: 'anthropic/claude-sonnet-5.5',
  tools,                      // includes closeCase with no execute
  toolChoice: 'required',
  stopWhen: [isStepCount(12), hasToolCall('closeCase'), overTokenBudget],
});`,
      lang: "ts",
      chapter: "stopping",
    },
    opencode: {
      pattern: "graceful-wind-down",
      api: "agent steps + session.idle",
      how: "The server runs the loop per prompt and publishes `session.idle` when it ends. An agent's `steps` caps iterations; at the cap a system prompt makes the model summarise its work. `doom_loop` asks when one call repeats three times.",
      cells: [
        "Model stops calling tools",
        "steps per agent (no limit if unset)",
        "Forced text-only summary of work so far",
        "None",
      ],
      code: `{
  "$schema": "https://opencode.ai/config.json",
  "agent": {
    "triage": { "mode": "primary", "steps": 12, "permission": { "doom_loop": "deny" } }
  }
}`,
      lang: "json",
      chapter: "agents",
    },
    openai: {
      pattern: "turn-budget",
      api: "max_turns + tool_use_behavior",
      how: "`Runner` classifies each response as final output, handoff or tool calls; with an `output_type` only that structured output counts as final. `max_turns` raises `MaxTurnsExceeded`, and `tool_use_behavior` lets a named tool end the run with its own output.",
      cells: [
        "Final output: output_type, or text without calls",
        "max_turns; tool_use_behavior",
        "MaxTurnsExceeded (or an error handler)",
        "None; read usage from context_wrapper",
      ],
      code: `agent = Agent(
    name="Responder",
    tools=[ip_reputation, block_ip],
    tool_use_behavior=StopAtTools(stop_at_tool_names=["block_ip"]),
)
result = await Runner.run(agent, alert_text, max_turns=6)`,
      lang: "python",
      chapter: "tool-use",
    },
    google_adk: {
      pattern: "turn-budget",
      api: "RunConfig.max_llm_calls",
      how: "An `LlmAgent` keeps calling the model while it returns function calls; `is_final_response()` marks the answer. `RunConfig.max_llm_calls` caps model calls per invocation. `LoopAgent` loops end on `escalate` (the `exit_loop` tool) or `max_iterations`.",
      cells: [
        "Final response with no function calls",
        "max_llm_calls; LoopAgent max_iterations",
        "Invocation stops with a limit error",
        "None",
      ],
      code: `cfg = RunConfig(max_llm_calls=20)
async for event in runner.run_async(user_id="analyst-7", session_id="case-4812",
                                    new_message=msg, run_config=cfg):
    if event.is_final_response():
        print(event.content.parts[0].text)`,
      lang: "python",
      chapter: "runner",
    },
    microsoft: {
      pattern: "graceful-wind-down",
      api: "function_invocation_configuration",
      how: "The loop lives in the chat client's `FunctionInvocationLayer`. `max_iterations`, `max_function_calls` and `max_duration_seconds` bound it; when one trips, the client stops calling tools and asks the model for a text answer. Workflows raise after `max_iterations` supersteps.",
      cells: [
        "Response with no function calls",
        "max_iterations, max_function_calls, duration",
        "Tools stop; model asked for a text answer",
        "None; read usage_details",
      ],
      code: `client = OpenAIChatCompletionClient(
    model="gpt-4.1-mini",
    function_invocation_configuration={"max_iterations": 6, "max_function_calls": 12},
)
agent = Agent(client=client, name="triage", tools=[ip_reputation])
response = await agent.run("Is 203.0.113.7 malicious?")`,
      lang: "python",
      chapter: "agent-loop",
    },
    openhands: {
      pattern: "turn-budget",
      api: "max_iteration_per_run + finish tool",
      how: "Each `step()` reads the event log and appends new events. The run ends on a plain-text reply or the built-in `finish` tool. Hitting `max_iteration_per_run` (default 500) sets status ERROR with `MaxIterationsReached`; a stuck detector flags repeated actions.",
      cells: [
        "Text reply or finish tool call",
        "max_iteration_per_run (default 500)",
        "ERROR status; run() raises ConversationRunError",
        "None; read LLM metrics",
      ],
      code: `conversation = Conversation(
    agent=agent,
    workspace="./case-4812",
    max_iteration_per_run=30,  # default is 500
)
conversation.send_message("Extract IPs, domains and hashes from alert.json")
conversation.run()
print(conversation.state.execution_status)`,
      lang: "python",
      chapter: "step",
    },
    hermes: {
      pattern: "graceful-wind-down",
      api: "max_iterations (IterationBudget)",
      how: "`AIAgent` calls the model and dispatches tool calls until it gets a text reply. An `IterationBudget` bounds the loop; when it is spent, the agent stops and returns a summary of the work done, which can cost one extra model call.",
      cells: [
        "Text reply with no tool calls",
        "max_iterations (guide default 500)",
        "Summary of work so far; may add one call",
        "None",
      ],
      code: `agent = AIAgent(
    model="anthropic/claude-sonnet-4.6",
    quiet_mode=True,
    max_iterations=12,        # bound the tool-calling loop
)
result = agent.run_conversation(user_message=alert_text, task_id="case-4812")`,
      lang: "python",
      chapter: "loop",
    },
  },
  choose: [
    "Treat any ending other than a validated final output as needing an analyst, never as a verdict. Wind-down summaries from Microsoft, OpenCode and Hermes look like answers, so flag them explicitly.",
    "Set an explicit turn or step cap on every run even where a default exists; defaults such as 500 iterations are sized for coding sessions, not per-alert triage.",
    "Only Claude has a USD cap, and it is an estimate. Elsewhere, enforce per-case cost in your own gateway by counting model calls and tokens across parent and subagents.",
    "End on a typed verdict (output type, verdict tool, structured output) rather than free text, so the loop cannot stop on chatter and the result is machine-checkable.",
    "Store the stop reason with the case record. It is the first thing a reviewer asks about an automated decision.",
  ],
};
