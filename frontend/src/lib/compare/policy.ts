import type { Mechanism } from "./types";

export const policy: Mechanism = {
  id: "policy",
  title: "Guardrails, hooks and permissions",
  question: "Where can your code veto or rewrite what the agent does?",
  why: "Policy code is the part of the harness that does not trust the model. It decides, deterministically and outside the prompt, whether a call is allowed, which arguments are acceptable and what gets logged. Where a framework lets code veto or rewrite, whether that layer sees every call, and whether it fails open or closed decide if your controls hold under prompt injection.",
  patterns: [
    {
      id: "permission-rules",
      name: "Declarative permission rules",
      say: "Configuration maps tools or command patterns to allow, ask or deny, evaluated before execution with fixed precedence.",
      tradeoff: "Easy to review and diff, but globs match names and strings, not intent or arguments in context.",
    },
    {
      id: "lifecycle-hooks",
      name: "Lifecycle hooks",
      say: "Your functions run at named points (before model, before tool, after tool) and can block, rewrite or replace that step.",
      tradeoff: "Precise and argument-aware, but each hook is code in the agent's process that must itself be trusted.",
    },
    {
      id: "middleware",
      name: "Middleware layers",
      say: "Wrappers around the run, the model call or the tool call; each calls the next layer or short-circuits.",
      tradeoff: "Composable and uniform, but ordering and fail-open versus fail-closed semantics are easy to get wrong.",
    },
    {
      id: "guardrails-validators",
      name: "Guardrails and validators",
      say: "Checks on input, output or tool calls that trip a wire to stop the run, or send the model back with feedback.",
      tradeoff: "Clean separation of safety logic, but content checks inherit the weaknesses of whatever classifier you use.",
    },
    {
      id: "risk-analyzer",
      name: "Risk analyzer plus policy",
      say: "An analyzer labels each action's risk, and a separate confirmation policy decides from that label whether to pause.",
      tradeoff: "Separates judgement from enforcement, but an LLM-based analyzer is itself exposed to prompt injection.",
    },
  ],
  dimensions: ["Veto point", "Can rewrite input?", "Sees every tool call?", "When it blocks"],
  entries: {
    claude: {
      pattern: "lifecycle-hooks",
      api: "hooks + allow/deny rules",
      how: "Each tool call passes hooks, deny rules, ask rules, the permission mode, allow rules, then `can_use_tool`; the first verdict wins. A `PreToolUse` hook can deny or edit input and is the only layer that sees every call, subagents included.",
      cells: [
        "PreToolUse hook, then rules and mode",
        "Yes: hook output or callback edits input",
        "PreToolUse hooks only",
        "Deny reason returned to Claude",
      ],
      code: `async def guard_isolation(input_data, tool_use_id, context):
    if str(input_data["tool_input"].get("host", "")).lower() in CROWN_JEWELS:
        return {"hookSpecificOutput": {"hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": "Domain controller; escalate to L3"}}
    return {}
options = ClaudeAgentOptions(hooks={"PreToolUse": [
    HookMatcher(matcher="mcp__relay__isolate_host", hooks=[guard_isolation])]})`,
      lang: "python",
      chapter: "hooks",
    },
    pydantic: {
      pattern: "guardrails-validators",
      api: "output_validator + ModelRetry",
      how: "`@agent.output_validator` and tool-level `ModelRetry` send the model back with feedback until a retry budget runs out. Toolsets such as `FilteredToolset` and `WrapperToolset` filter or intercept calls, and capabilities add lifecycle hooks around runs, requests and tools.",
      cells: [
        "Output validator; WrapperToolset",
        "Validators may return a corrected output",
        "Only through a wrapping toolset or hook",
        "Retry prompt; raises when budget spent",
      ],
      code: `@agent.output_validator
async def hosts_in_case(ctx: RunContext[set[str]], output: Verdict) -> Verdict:
    unknown = set(output.hosts) - ctx.deps
    if unknown:
        raise ModelRetry(f'These hosts are not in the case: {sorted(unknown)}')
    return output`,
      lang: "python",
      chapter: "validation",
    },
    deepagents: {
      pattern: "middleware",
      api: "AgentMiddleware wrap_tool_call",
      how: "LangChain middleware offers `before_model`, `after_model`, `wrap_model_call` and `wrap_tool_call`. Before hooks run first to last and wrap hooks nest. `wrap_tool_call` can refuse, rewrite or retry a call; node hooks can `jump_to` the end.",
      cells: [
        "wrap_tool_call; before and after model",
        "Yes, edit the request before handler",
        "Yes, if subagents get the same middleware",
        "Your ToolMessage, or jump to end",
      ],
      code: `class GuardIsolation(AgentMiddleware):
    def wrap_tool_call(self, request, handler):
        call = request.tool_call
        if call["name"] == "isolate_host" and call["args"].get("host") in CROWN_JEWELS:
            return ToolMessage(content="Refused: protected host", tool_call_id=call["id"])
        return handler(request)

agent = create_deep_agent(tools=[isolate_host], middleware=[GuardIsolation()])`,
      lang: "python",
      chapter: "hooks",
    },
    pi: {
      pattern: "lifecycle-hooks",
      api: "pi.on(\"tool_call\") extension",
      how: "Extensions register handlers with `pi.on(event, handler)`. A `tool_call` handler can return `{ block: true, reason }` before execution; `tool_result` sees every outcome. Extensions run in-process with full access, so load only trusted code.",
      cells: [
        "tool_call extension handler",
        "Documented use is block with a reason",
        "Yes, built-in and custom tools",
        "Reason returned as a blocked tool result",
      ],
      code: `const egressGuard = (pi: ExtensionAPI) => {
  pi.on("tool_call", async (event) => {
    if (isToolCallEventType("bash", event) && NETWORK.test(event.input.command)) {
      return { block: true, reason: "Outbound network commands are blocked in triage" };
    }
    return undefined;
  });
};`,
      lang: "ts",
      chapter: "extensions",
    },
    vercel: {
      pattern: "middleware",
      api: "wrapLanguageModel + prepareStep",
      how: "Model middleware (`transformParams`, `wrapGenerate`, `wrapStream`) wraps every model call, so redaction also covers tool results resent to the provider. It never sees tool execution; gate tools with `prepareStep` `activeTools` and `toolApproval` functions.",
      cells: [
        "Model call; prepareStep before each step",
        "Yes, transformParams rewrites the request",
        "No; middleware sees model calls only",
        "Middleware throws; hidden tools not offered",
      ],
      code: `const redactMiddleware: LanguageModelV4Middleware = {
  specificationVersion: 'v4',
  transformParams: async ({ params }) => redactSecrets(params),
};
export const socModel = wrapLanguageModel({ model: baseModel,
  middleware: [auditMiddleware, redactMiddleware] });`,
      lang: "ts",
      chapter: "middleware",
    },
    opencode: {
      pattern: "permission-rules",
      api: "permission config + plugin hooks",
      how: "Permission keys per tool (`read`, `edit`, `bash`, `task`, `webfetch` and more) map to allow, ask or deny with glob patterns, and the last match wins. Plugins add `tool.execute.before` hooks that throw to block. `--auto` never overrides a deny.",
      cells: [
        "Permission check, then plugin hooks",
        "Plugin hook receives the call's args",
        "Yes, server-side for every tool",
        "Denied call errors back to the model",
      ],
      code: `{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "*": "deny",
    "read": { "*": "allow", "*.env": "deny" },
    "bash": { "*": "deny", "jq *": "allow", "whois *": "ask" }
  }
}`,
      lang: "json",
      chapter: "permissions",
    },
    openai: {
      pattern: "guardrails-validators",
      api: "input/output/tool guardrails",
      how: "Input guardrails check the first agent's input, output guardrails the final output, and tool guardrails a function tool's arguments or result. A tripped wire raises an exception. `run_in_parallel=False` blocks the model until the input check passes.",
      cells: [
        "Input, output and tool guardrails",
        "No; they allow, reject or trip",
        "Function tools, via tool guardrails",
        "Tripwire exception ends the run",
      ],
      code: `@input_guardrail(run_in_parallel=False)  # block before any tokens are spent
async def no_private_keys(ctx, agent, user_input):
    leaked = "BEGIN PRIVATE KEY" in str(user_input)
    return GuardrailFunctionOutput(output_info={"leaked": leaked}, tripwire_triggered=leaked)

agent = Agent(name="Triage", instructions="...", input_guardrails=[no_private_keys])`,
      lang: "python",
      chapter: "guardrails",
    },
    google_adk: {
      pattern: "lifecycle-hooks",
      api: "before_tool_callback / BasePlugin",
      how: "Callbacks run before and after the agent, the model and each tool. Return `None` to continue or a value to replace the step: an `LlmResponse` skips the model, a dict skips the tool. `BasePlugin` applies the same hooks app-wide.",
      cells: [
        "before_model and before_tool callbacks",
        "Yes, modify args or the LLM request",
        "Per agent, or app-wide via plugins",
        "Returned dict becomes the tool result",
      ],
      code: `def gate_containment(tool: BaseTool, args: dict, tool_context: ToolContext):
    if tool.name == "isolate_host" and not tool_context.state.get("user:can_contain"):
        return {"status": "denied", "reason": "analyst lacks containment role"}
    return None  # run the tool

responder = LlmAgent(name="responder", model="gemini-2.5-flash", tools=[isolate_host],
                     before_tool_callback=gate_containment)`,
      lang: "python",
      chapter: "callbacks",
    },
    microsoft: {
      pattern: "middleware",
      api: "agent / function / chat middleware",
      how: "Middleware is `async def mw(context, call_next)`; the context type picks the layer: run, function call or chat request. A plain exception in function middleware becomes a tool error and the loop continues; `MiddlewareFailure` cancels the batch and reaches the caller.",
      cells: [
        "Function middleware before call_next",
        "Yes, via context.arguments",
        "Yes, function middleware wraps every call",
        "MiddlewareFailure fails closed to caller",
      ],
      code: `async def guard_isolation(context: FunctionInvocationContext,
                          call_next: Callable[[], Awaitable[None]]):
    if (context.function.name == "isolate_host"
            and context.arguments.get("ip") in PROTECTED):
        raise MiddlewareFailure("refusing to isolate a protected host")
    await call_next()

agent = Agent(client=client, tools=[isolate_host], middleware=[audit_run, guard_isolation])`,
      lang: "python",
      chapter: "middleware",
    },
    openhands: {
      pattern: "risk-analyzer",
      api: "SecurityAnalyzer + ConfirmationPolicy",
      how: "A security analyzer assigns a `SecurityRisk` to each `ActionEvent`; the confirmation policy (`AlwaysConfirm`, `ConfirmRisky` or custom) decides whether to pause. Both can change mid-conversation. `LLMSecurityAnalyzer` trusts the model's own risk label.",
      cells: [
        "Before each action executes",
        "No; confirm or reject only",
        "Yes, every ActionEvent is rated",
        "Pause; rejection recorded as observation",
      ],
      code: `from openhands.sdk.security.confirmation_policy import ConfirmRisky
from openhands.sdk.security.llm_analyzer import LLMSecurityAnalyzer

conversation = Conversation(agent=agent, workspace="./case-4812")
conversation.set_security_analyzer(LLMSecurityAnalyzer())
conversation.set_confirmation_policy(ConfirmRisky())`,
      lang: "python",
      chapter: "confirmation",
    },
    hermes: {
      pattern: "permission-rules",
      api: "toolsets + approvals.deny",
      how: "Toolsets decide which tools the model can see at all. For shell commands, `approvals.deny` patterns block on every backend and `command_allowlist` holds always-approved patterns. The docs call this a command policy, not an OS sandbox.",
      cells: [
        "Toolset filter, then command checks",
        "No",
        "Approvals cover shell commands only",
        "Command denied before the terminal runs",
      ],
      code: `# ~/.hermes/config.yaml
approvals:
  mode: manual
  deny:
    - "iptables -F*"
    - "systemctl stop *"
    - "*curl*|*sh*"`,
      lang: "yaml",
      chapter: "approvals",
    },
  },
  choose: [
    "Enforce tenant scope and protected-asset lists in one layer that sees every tool call (PreToolUse hook, wrap_tool_call, function middleware, before_tool_callback), not in a callback that some calls skip.",
    "Make enforcement fail closed and test it: check what happens when a hook times out or throws. Microsoft's plain middleware exceptions and LLM risk analyzers fail open.",
    "Use declarative rules for the coarse boundary (deny everything, then allow read tools) and code hooks for argument checks a glob cannot express.",
    "Screen untrusted alert text with a blocking input check, but treat keyword filters as routing to review, not as a prompt-injection defence.",
    "Log every allow and deny decision with its reason and call ID; a policy without an audit record cannot be defended after an incident.",
  ],
};
