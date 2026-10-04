import type { Mechanism } from "./types";

export const approval: Mechanism = {
  id: "approval",
  title: "Human approval",
  question: "How does a sensitive tool call wait for a human decision?",
  why: "Containment actions such as isolating a host, disabling an account or blocking an IP must not run on a model's say-so. The approval mechanism decides where a pending action waits, whether it survives a deploy or crash, which exact arguments the analyst approves, and what the model learns when the answer is no. Those properties decide whether approvals can live in a ticket queue.",
  patterns: [
    {
      id: "pause-serialise-resume",
      name: "Pause, serialise, resume",
      say: "The run returns with pending approvals; you persist its state and start a new run with the decisions, possibly in another process.",
      tradeoff: "Survives restarts and long waits, but you own storing state and matching decisions to call IDs.",
    },
    {
      id: "checkpoint-interrupt",
      name: "Checkpointed interrupt",
      say: "The graph pauses at an interrupt with state already checkpointed; a resume command carrying the decisions continues the same thread.",
      tradeoff: "Durable with little code, but requires a checkpointer and a correctly configured store.",
    },
    {
      id: "blocking-callback",
      name: "Blocking callback",
      say: "The loop calls your function and waits; it returns allow or deny, possibly after asking a human.",
      tradeoff: "Simplest to write, but the pending decision lives in a waiting process and dies with it.",
    },
    {
      id: "permission-ask",
      name: "Permission rule with ask",
      say: "Declarative rules mark tools or commands allow, ask or deny; an ask raises a prompt or event and waits for a reply.",
      tradeoff: "Config-driven, but the prompt is tied to a running server or chat, and rules match names, not intent.",
    },
    {
      id: "paused-status",
      name: "Paused status",
      say: "A policy flips the conversation to waiting-for-confirmation; running again executes, rejecting records a refusal the model sees.",
      tradeoff: "Persisted with the log, but what pauses depends on a risk rating that may come from a model.",
    },
  ],
  dimensions: ["Where the pause lives", "Survives restart?", "Granularity", "Rejection result"],
  entries: {
    claude: {
      pattern: "blocking-callback",
      api: "can_use_tool callback",
      how: "`can_use_tool` is awaited for each call that no hook, rule or mode resolved, and returns `PermissionResultAllow` (optionally with edited input) or `PermissionResultDeny`. Calls already approved by `allowed_tools` or `bypassPermissions` never reach it.",
      cells: [
        "Your callback; the CLI waits on the pipe",
        "No; resume the session and ask again",
        "Per call, after hooks, rules and mode",
        "PermissionResultDeny message to Claude",
      ],
      code: `async def analyst_gate(tool_name, tool_input, context):
    if tool_name == "mcp__relay__isolate_host":
        if not await analyst_approves(tool_input["host"], context.tool_use_id):
            return PermissionResultDeny(message="Analyst rejected isolation")
    return PermissionResultAllow()

options = ClaudeAgentOptions(permission_mode="default", can_use_tool=analyst_gate)`,
      lang: "python",
      chapter: "permissions",
    },
    pydantic: {
      pattern: "pause-serialise-resume",
      api: "requires_approval + DeferredToolResults",
      how: "A tool marked `requires_approval=True`, or one that raises `ApprovalRequired`, ends the run with a `DeferredToolRequests` output. You build `DeferredToolResults` keyed by `tool_call_id` and start a new run with the saved `message_history`.",
      cells: [
        "DeferredToolRequests output; run ends",
        "Yes; message history is plain data",
        "Per call: flag, or raised from the tool",
        "ToolDenied message returned to the model",
      ],
      code: `result = await agent.run('Contain WS-114')
if isinstance(result.output, DeferredToolRequests):
    decisions = DeferredToolResults()
    for call in result.output.approvals:
        ok = analyst_approves(call.tool_name, call.args)
        decisions.approvals[call.tool_call_id] = ok or ToolDenied('Analyst declined')
    result = await agent.run(message_history=result.all_messages(),
                             deferred_tool_results=decisions)`,
      lang: "python",
      chapter: "deferred",
    },
    deepagents: {
      pattern: "checkpoint-interrupt",
      api: "interrupt_on + Command(resume=)",
      how: "`interrupt_on` maps tool names to approval configs; `HumanInTheLoopMiddleware` raises a LangGraph interrupt after the model proposes the call. Resume with `Command(resume={\"decisions\": [...]})` on the same `thread_id`, matched to `action_requests` by position.",
      cells: [
        "LangGraph checkpoint; __interrupt__ in result",
        "Yes, with a durable checkpointer",
        "Per tool name; approve, edit, reject",
        "reject decision with a message",
      ],
      code: `agent = create_deep_agent(
    tools=[search_alerts, isolate_host],
    interrupt_on={"isolate_host": {"allowed_decisions": ["approve", "reject"]}},
    checkpointer=saver,
)
result = await agent.ainvoke({"messages": [msg]}, config)
if result.get("__interrupt__"):
    result = await agent.ainvoke(Command(resume={"decisions": decisions}), config)`,
      lang: "python",
      chapter: "hitl",
    },
    pi: {
      pattern: "blocking-callback",
      api: "extension tool_call handler",
      how: "Pi has no approval API. An extension's `tool_call` handler runs before execution and can await your decision; returning `{ block: true, reason }` stops the call and the reason goes back to the model. The wait lives in the Pi process.",
      cells: [
        "Your async tool_call handler",
        "No; the await is in-process",
        "Any rule you code, per call",
        "Block reason returned to the model",
      ],
      code: `const containmentGate = (pi: ExtensionAPI) => {
  pi.on("tool_call", async (event) => {
    if (event.toolName === "isolate_host" && !(await analystApproves(event.input))) {
      return { block: true, reason: "Analyst rejected isolation" };
    }
    return undefined;
  });
};`,
      lang: "ts",
      chapter: "extensions",
    },
    vercel: {
      pattern: "pause-serialise-resume",
      api: "toolApproval + tool-approval-response",
      how: "`toolApproval` maps tools to `'user-approval'`, fixed decisions or a function of the input. A user approval stops the loop with a `tool-approval-request`; you append a `tool-approval-response` to the persisted messages and call again.",
      cells: [
        "tool-approval-request in result content",
        "Yes; persist responseMessages",
        "Per tool, or a function of the input",
        "Response with approved: false and reason",
      ],
      code: `const first = await generateText({ ...settings, messages,
  toolApproval: { isolateHost: 'user-approval' } });
messages.push(...first.responseMessages);
for (const part of first.content) if (part.type === 'tool-approval-request' && !part.isAutomatic) {
  const ok = await analystDecision(part.toolCall);
  messages.push({ role: 'tool', content: [{ type: 'tool-approval-response',
    approvalId: part.approvalId, approved: ok, reason: ok ? 'L2 approved' : 'rejected' }] });
}`,
      lang: "ts",
      chapter: "approval",
    },
    opencode: {
      pattern: "permission-ask",
      api: "permission ask + permissions reply",
      how: "A rule set to `ask` publishes `permission.updated` on the SSE bus and holds the call. You reply through `POST /session/:id/permissions/:permissionID` with `once`, `always` or `reject`. `--auto` approves every ask but never overrides a deny.",
      cells: [
        "Server; permission.updated on the SSE bus",
        "Not documented; assume pending is lost",
        "Tool plus glob pattern (bash commands)",
        "reject; the model gets an error",
      ],
      code: `for await (const event of events.stream) {
  if (event.type === "permission.updated" && event.properties.sessionID === caseSession) {
    const ok = await analystDecision(event.properties);   // your UI or ticket queue
    await client.postSessionIdPermissionsPermissionId({
      path: { id: caseSession, permissionID: event.properties.id },
      body: { response: ok ? "once" : "reject" } });
  }
}`,
      lang: "ts",
      chapter: "permissions",
    },
    openai: {
      pattern: "pause-serialise-resume",
      api: "needs_approval + RunState",
      how: "A tool with `needs_approval` (a boolean or a function of the arguments) stops the run with `interruptions`. `to_state()` returns a serialisable `RunState`; you `approve` or `reject` each item and pass the state back to `Runner.run`.",
      cells: [
        "result.interruptions; RunState",
        "Yes; to_state() serialises the run",
        "Per call; bool or function of arguments",
        "state.reject(item); the run continues",
      ],
      code: `result = await Runner.run(agent, "Contain WS-114")
while result.interruptions:
    state = result.to_state()
    for item in result.interruptions:
        if analyst_approves(item.name, item.arguments): state.approve(item)
        else: state.reject(item)
    result = await Runner.run(agent, state)`,
      lang: "python",
      chapter: "approvals",
    },
    google_adk: {
      pattern: "pause-serialise-resume",
      api: "FunctionTool(require_confirmation=)",
      how: "Wrap a tool in `FunctionTool(fn, require_confirmation=True)` or a predicate, or call `tool_context.request_confirmation()` inside it. The run emits an `adk_request_confirmation` call; the client answers with a function response carrying `confirmed`.",
      cells: [
        "adk_request_confirmation event to client",
        "No: Database and Vertex sessions unsupported",
        "Per tool, or a threshold predicate",
        "Function response with confirmed: false",
      ],
      code: `def isolate_host(host: str) -> dict:
    """Network-isolate a host."""
    return edr.isolate(host)

responder = LlmAgent(name="responder", model="gemini-2.5-flash",
                     tools=[FunctionTool(isolate_host, require_confirmation=True)])`,
      lang: "python",
    },
    microsoft: {
      pattern: "checkpoint-interrupt",
      api: "ctx.request_info + @response_handler",
      how: "In workflows, an executor calls `ctx.request_info(...)`; the workflow emits a `request_info` event and stops that path until `run(responses={request_id: value})`. With checkpoint storage the response can arrive in another process. Single-agent tools use `approval_mode=\"always_require\"`.",
      cells: [
        "request_info event; workflow checkpoint",
        "Yes, with checkpoint_storage",
        "Any executor step; tools via approval_mode",
        "Your response_handler decides",
      ],
      code: `class ContainmentGate(Executor):
    @handler
    async def propose(self, alert: dict, ctx: WorkflowContext[str]) -> None:
        await ctx.request_info(IsolationRequest(alert["host"], "beaconing"), bool)
    @response_handler
    async def decided(self, request: IsolationRequest, approved: bool,
                      ctx: WorkflowContext[str]) -> None:
        await ctx.send_message(f"isolate {request.host}" if approved else "denied")`,
      lang: "python",
      chapter: "hitl",
    },
    openhands: {
      pattern: "paused-status",
      api: "set_confirmation_policy",
      how: "A security analyzer rates each action and the confirmation policy decides whether to pause. `run()` returns with `WAITING_FOR_CONFIRMATION`; calling it again executes the pending actions, while `reject_pending_actions()` records a rejection the model can read.",
      cells: [
        "WAITING_FOR_CONFIRMATION status",
        "Yes, with persistence_dir",
        "Per action, by risk and policy",
        "Rejection observation the model sees",
      ],
      code: `conversation.set_confirmation_policy(AlwaysConfirm())
conversation.send_message("Contain WS-114: block 203.0.113.7 on the host firewall")
conversation.run()
if conversation.state.execution_status == ConversationExecutionStatus.WAITING_FOR_CONFIRMATION:
    pending = ConversationState.get_unmatched_actions(conversation.state.events)
    if not analyst_approves(pending):
        conversation.reject_pending_actions("Analyst denied containment")
    conversation.run()`,
      lang: "python",
      chapter: "confirmation",
    },
    hermes: {
      pattern: "permission-ask",
      api: "approvals: mode / timeout / deny",
      how: "Dangerous-command checks run inside tool dispatch before the terminal handler. The CLI asks inline (once, session, always) and gateways ask in chat. `approvals.timeout` denies unanswered prompts; container backends skip the prompt but still apply `deny`.",
      cells: [
        "Inline CLI or chat prompt; process waits",
        "No; unanswered prompts time out",
        "Dangerous shell command patterns",
        "Denied; a timeout counts as deny",
      ],
      code: `# ~/.hermes/config.yaml
approvals:
  mode: manual            # smart | manual | off
  timeout: 300            # unanswered prompts are denied
  cron_mode: deny
  unattended_mode: deny   # webhook and API server sessions`,
      lang: "yaml",
      chapter: "approvals",
    },
  },
  choose: [
    "Prefer pause-and-resume designs (Pydantic, OpenAI, Vercel, Deep Agents, Microsoft workflows). Analysts answer in minutes or hours, and a pending isolation must survive a deploy.",
    "Approve exact arguments keyed by tool call ID, and store the decision with the case. An approval for host WS-114 must never authorise WS-115.",
    "Gate containment by tool name, not by a model-assigned risk score. LLM risk ratings (OpenHands LLM analyzer, Hermes smart mode) can be talked down by injected alert text.",
    "With a blocking callback (Claude, Pi), bound the wait and fail closed on timeout, and never list a containment tool in an auto-allow rule that skips the callback.",
    "Write the rejection reason in plain terms so the model proposes an alternative instead of retrying the same action.",
  ],
};
