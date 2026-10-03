import type { DeepDive } from "./types";

const B = "https://pydantic.dev/docs/ai/";

export const pydantic: DeepDive = {
  intro:
    "A Pydantic AI run is a small graph executed by pydantic-graph: a user-prompt node, a model-request node and a call-tools node that loops back until an `End` node holds validated output. Dependencies, validation retries, approvals, history and limits all attach to specific nodes of that graph. Know the nodes and the rest follows.",
  chapters: [
    {
      id: "graph",
      title: "The agent graph and iter()",
      hook: "What actually happens between agent.run() and result.output?",
      diagram: {
        kind: "flow",
        steps: [
          { t: "agent.iter() / run()", s: "`run()` drives the graph to the end for you. `iter()` hands you each node as it executes.", tag: "you" },
          { t: "UserPromptNode", s: "Builds the first request: instructions, system prompts, prior `message_history` and the new user prompt.", tag: "core" },
          { t: "ModelRequestNode", s: "Sends one `ModelRequest` to the model and records the `ModelResponse` in the run history.", tag: "model" },
          { t: "CallToolsNode", s: "Reads the response parts: runs function tools, validates output tools or text, and decides the next node.", tag: "tool" },
          { t: "End", s: "Reached once a final result validates. `node.data.output` holds the typed output.", tag: "stop" },
        ],
        back: { from: 3, to: 2, label: "tool returns / retry prompts" },
      },
      explain: [
        "`Agent.run()` is a thin wrapper around `Agent.iter()`. Both execute the same graph: `UserPromptNode`, then alternating `ModelRequestNode` and `CallToolsNode`, until `CallToolsNode` produces an `End`. Tool results and retry prompts become parts of the next `ModelRequest`, which is why the graph loops.",
        "With `iter()` you get an `AgentRun`. You can `async for` over it, or step manually with `await agent_run.next(node)`, which runs one node and returns the next. Stepping manually lets you inspect or stop the run between any two nodes.",
        "The static helpers `Agent.is_user_prompt_node`, `is_model_request_node`, `is_call_tools_node` and `is_end_node` narrow the node type so you can log each phase separately.",
      ],
      code: {
        lang: "python",
        caption: "Walk a triage run node by node and log each phase.",
        src: `from pydantic_ai import Agent

agent = Agent('openai:gpt-5.2', instructions='Triage the alert. Be brief.')

async with agent.iter('Is 203.0.113.7 malicious?') as agent_run:
    async for node in agent_run:
        if Agent.is_user_prompt_node(node):
            print('prompt:', node.user_prompt)
        elif Agent.is_model_request_node(node):
            print('model request with', len(node.request.parts), 'parts')
        elif Agent.is_call_tools_node(node):
            print('response parts:', node.model_response.parts)
        elif Agent.is_end_node(node):
            print('output:', node.data.output)

print(agent_run.usage())`,
      },
      soc: "Node-level iteration is where you hang audit logging and kill switches: record every model request and tool phase against the case, and stop between nodes if an analyst cancels the investigation.",
      url: B + "core-concepts/agent/",
    },
    {
      id: "validation",
      title: "Output tools and validation retries",
      hook: "What happens when the model returns a finding that does not fit the schema?",
      diagram: {
        kind: "loop",
        center: "Output validation",
        exit: "valid output ends the run; an exhausted retry budget raises",
        steps: [
          { t: "Output tool call", s: "By default the output schema is exposed as a special output tool. The model ends the run by calling it.", tag: "model" },
          { t: "Pydantic validation", s: "The tool arguments are validated against `output_type`. Type, range and required-field errors are caught here.", tag: "guard" },
          { t: "@agent.output_validator", s: "Your async validator runs next and may check facts against deps, raising `ModelRetry` if they are wrong.", tag: "guard" },
          { t: "RetryPromptPart", s: "The error text goes back to the model as a retry prompt in the next request, not as an exception to you.", tag: "event" },
          { t: "Model corrects", s: "The model sees what failed and tries again, within the output retry budget.", tag: "model" },
        ],
      },
      explain: [
        "With the default tool output mode, the JSON schema of each output type becomes the parameters of an output tool. `ToolOutput` customises its name and `max_retries`. `NativeOutput` uses the provider's structured output feature instead, and `PromptedOutput` puts the schema in the prompt and parses text. Validation behaves the same in all three.",
        "Validation failure is not fatal. Schema errors and `ModelRetry` raised from an `@agent.output_validator` are turned into a `RetryPromptPart` and sent back. Each output tool has its own retry counter. In current releases the default comes from `Agent(retries={'output': N})`; older releases used `output_retries`, so check your version.",
        "When the budget runs out the run raises `UnexpectedModelBehavior`. Validation proves shape and the checks you wrote, not truth.",
      ],
      code: {
        lang: "python",
        caption: "A typed verdict whose hosts must belong to the case, or the model is asked to fix it.",
        src: `from pydantic import BaseModel, Field
from pydantic_ai import Agent, ModelRetry, RunContext, ToolOutput

class Verdict(BaseModel):
    severity: int = Field(ge=1, le=5)
    hosts: list[str]
    summary: str

agent = Agent(
    'openai:gpt-5.2',
    deps_type=set[str],  # hosts that belong to this case
    output_type=ToolOutput(Verdict, name='submit_verdict', max_retries=2),
)

@agent.output_validator
async def hosts_in_case(ctx: RunContext[set[str]], output: Verdict) -> Verdict:
    unknown = set(output.hosts) - ctx.deps
    if unknown:
        raise ModelRetry(f'These hosts are not in the case: {sorted(unknown)}')
    return output`,
      },
      soc: "Validators are a cheap control against hallucinated entities: a verdict that names a host, IP or user outside the case is sent back before it reaches a ticket. Keep the retry budget small so a confused model fails closed.",
      url: B + "core-concepts/output/",
    },
    {
      id: "deps",
      title: "Dependency injection with RunContext",
      hook: "How do tools reach the SIEM without the model ever seeing the credentials?",
      diagram: {
        kind: "stack",
        layers: [
          { t: "agent.run(deps=...)", s: "You pass one object of type `deps_type` per run. It is never serialised into the prompt.", u: "The run result carries output and usage, not deps.", tag: "you" },
          { t: "RunContext[Deps]", s: "Every instruction function, tool and validator receives `ctx`, with `ctx.deps`, `ctx.usage` and retry state.", u: "Usage counters on the context are updated per request.", tag: "state" },
          { t: "@agent.instructions", s: "Dynamic instructions are computed from `ctx.deps` at run time, so one agent serves many cases.", u: "Instructions are re-evaluated for the run, not stored as history.", tag: "core" },
          { t: "@agent.tool", s: "Tools take `ctx` as their first argument; only the remaining parameters appear in the tool schema.", u: "Only the tool's return value is sent back to the model.", tag: "tool" },
        ],
        core: { t: "Model request", s: "The model sees instructions, history and tool schemas. Deps stay in your process.", tag: "model" },
      },
      explain: [
        "`deps_type` declares the type of the dependency object; `Agent` is generic over it, so a type checker can verify that `ctx.deps` is used correctly in every tool. Pass the object with `agent.run(..., deps=...)`.",
        "`@agent.tool` functions receive `RunContext` as their first parameter, which is excluded from the JSON schema the model sees. `@agent.tool_plain` is for tools that need no context. `@agent.instructions` and `@agent.system_prompt` can also take `ctx`, so prompts are built from the same dependencies.",
        "For tests, `agent.override(deps=...)` swaps dependencies (and models or toolsets) without changing application code.",
      ],
      code: {
        lang: "python",
        caption: "Tenant and case live in deps; the model only sees a limit parameter.",
        src: `from dataclasses import dataclass
from pydantic_ai import Agent, RunContext

@dataclass
class CaseDeps:
    tenant: str
    case_id: str
    siem: SiemClient

agent = Agent('openai:gpt-5.2', deps_type=CaseDeps)

@agent.instructions
def case_scope(ctx: RunContext[CaseDeps]) -> str:
    return f'You are triaging case {ctx.deps.case_id}. Cite event IDs.'

@agent.tool
async def case_events(ctx: RunContext[CaseDeps], limit: int = 20) -> list[dict]:
    """Return recent events for the current case."""
    return await ctx.deps.siem.events(ctx.deps.tenant, ctx.deps.case_id, limit)

result = await agent.run('Summarise the case', deps=CaseDeps('acme', '4812', siem))`,
      },
      soc: "Tenant and case scoping belong in deps, never in tool arguments the model fills in. A prompt injection in alert text can then ask for another tenant, but the tool has no parameter to receive it.",
      url: B + "core-concepts/dependencies/",
    },
    {
      id: "deferred",
      title: "Deferred tools and human approval",
      hook: "How does a run stop for an analyst and continue later?",
      diagram: {
        kind: "lanes",
        actors: ["Analyst", "Agent run", "Model", "isolate_host"],
        msgs: [
          { from: 0, to: 1, t: "run('Contain WS-114')", s: "`output_type` includes `DeferredToolRequests`, which allows the run to end without a final answer.", tag: "you" },
          { from: 2, to: 1, t: "call isolate_host", s: "The model calls a tool registered with `requires_approval=True`. It is not executed.", tag: "model" },
          { from: 1, to: 0, t: "DeferredToolRequests", s: "The run ends with `result.output.approvals` listing the pending calls, their arguments and `tool_call_id`s.", tag: "guard" },
          { from: 0, to: 1, t: "DeferredToolResults", s: "Next run: pass `message_history` plus a decision per call ID: `True`, or `ToolDenied('reason')`.", tag: "guard" },
          { from: 1, to: 3, t: "execute approved call", s: "Approved calls now run. Inside the tool, `ctx.tool_call_approved` is true.", tag: "tool" },
          { from: 1, to: 2, t: "results + denials", s: "Tool returns and denial messages go to the model, which continues the investigation.", tag: "model" },
        ],
      },
      explain: [
        "Approval is two runs joined by message history. When a tool marked `requires_approval=True` is called, or a tool raises `ApprovalRequired` itself, the run ends early with a `DeferredToolRequests` output. Its `approvals` list holds the calls waiting for a decision; its `calls` list holds calls handed to external execution via `CallDeferred`.",
        "You build `DeferredToolResults`, map each `tool_call_id` to a decision, and start a new run with the saved `message_history` and `deferred_tool_results`. Nothing waits in memory between the two runs, so the decision can come hours later from another process.",
      ],
      code: {
        lang: "python",
        caption: "The documented approval pattern, applied to host isolation.",
        src: `from pydantic_ai import Agent, DeferredToolRequests, DeferredToolResults, ToolDenied

agent = Agent('openai:gpt-5.2', output_type=[str, DeferredToolRequests])

@agent.tool_plain(requires_approval=True)
def isolate_host(host: str) -> str:
    """Network-isolate a host."""
    return f'{host} isolated'

result = await agent.run('Contain WS-114')
messages = result.all_messages()

if isinstance(result.output, DeferredToolRequests):
    decisions = DeferredToolResults()
    for call in result.output.approvals:
        ok = analyst_approves(call.tool_name, call.args)
        decisions.approvals[call.tool_call_id] = ok or ToolDenied('Analyst declined')
    result = await agent.run(message_history=messages, deferred_tool_results=decisions)

print(result.output)`,
      },
      soc: "This is the containment gate: the model can propose isolating a host, but the call only executes against the exact arguments an analyst approved. Store the message history and the decision with the case for audit.",
      url: B + "tools-toolsets/deferred-tools/",
    },
    {
      id: "history",
      title: "Message history as plain data",
      hook: "How does a conversation survive a restart, tool calls included?",
      diagram: {
        kind: "timeline",
        legend: { model: "agent run", state: "stored data", core: "processing" },
        events: [
          { t: "Run 1", s: "The run produces `ModelRequest` and `ModelResponse` messages made of typed parts: prompts, text, tool calls, tool returns.", tag: "model" },
          { t: "all_messages()", s: "Returns the whole history including any input history. `new_messages()` returns only this run's messages.", tag: "state" },
          { t: "to_jsonable_python", s: "Messages become plain JSON-compatible data you can store in your own database.", tag: "state" },
          { t: "ModelMessagesTypeAdapter", s: "`validate_python` (or `validate_json`) rebuilds the typed message list from storage.", tag: "core" },
          { t: "Run 2 message_history", s: "The restored list is passed as `message_history`; the model sees the earlier tool calls and results.", tag: "model" },
          { t: "History processor", s: "Before each model request a processor can trim or summarise history. It must keep tool calls and returns paired.", tag: "core" },
        ],
      },
      explain: [
        "History is not hidden state inside the agent. It is a list of `ModelMessage` objects you own. `all_messages()` and `new_messages()` (and their `_json` variants) return it; `message_history=` feeds it back. `ModelMessagesTypeAdapter` is the Pydantic `TypeAdapter` that serialises and restores it without losing part types.",
        "History processors run before each model request. In current releases they are attached as `capabilities=[ProcessHistory(fn)]`; earlier releases used a `history_processors=` argument, so this is version-dependent. A processor that cuts a tool call from its return breaks pairing, and the docs warn that repairs will then change what the model sees.",
      ],
      code: {
        lang: "python",
        caption: "Persist a case conversation as JSON, restore it, and cap what is resent.",
        src: `from pydantic_core import to_jsonable_python
from pydantic_ai import Agent, ModelMessagesTypeAdapter
from pydantic_ai.capabilities import ProcessHistory
from pydantic_ai.messages import ModelMessage

async def keep_recent(messages: list[ModelMessage]) -> list[ModelMessage]:
    return messages[-12:] if len(messages) > 12 else messages

agent = Agent('openai:gpt-5.2', capabilities=[ProcessHistory(keep_recent)])

r1 = await agent.run('Summarise alert 4812')
stored = to_jsonable_python(r1.all_messages())  # save with the case

history = ModelMessagesTypeAdapter.validate_python(stored)
r2 = await agent.run('Which hosts are affected?', message_history=history)
print(len(r2.new_messages()), 'new messages')`,
      },
      soc: "Because history is plain data, you decide where it lives (data residency) and can store it next to the case. Relay restores it with `ModelMessagesTypeAdapter` and only publishes a continuation after a validated success.",
      url: B + "core-concepts/message-history/",
    },
    {
      id: "end-strategy",
      title: "end_strategy: output and tool calls in one response",
      hook: "If the model returns a verdict and a tool call together, does the tool still run?",
      diagram: {
        kind: "tree",
        root: { t: "Output + tool calls", s: "One model response contains an output tool call and other function tool calls. `end_strategy` decides their fate.", tag: "core" },
        children: [
          { t: "'graceful' (default)", s: "Output tools run in emission order and the first success wins; function tools still run.", tag: "tool" },
          { t: "'early'", s: "The run ends at the first successful output tool; function tools in that response are skipped.", tag: "stop" },
          { t: "'exhaustive'", s: "All output and function tools run, in parallel; the first valid result by emission order wins.", tag: "tool" },
        ],
      },
      explain: [
        "Models sometimes emit a final answer and more tool calls in the same response. `end_strategy` on the `Agent` decides what happens to those extra calls. The current docs list `'graceful'` as the default, plus `'early'` and `'exhaustive'`. Older releases defaulted to `'early'` and had no `'graceful'`, so this is version-dependent.",
        "The choice matters when tools have side effects. With `'early'`, a containment tool requested alongside the verdict never runs. With `'graceful'` or `'exhaustive'`, it does, even though the run is already ending.",
      ],
      code: {
        lang: "python",
        caption: "End as soon as the verdict validates and skip any tool call bundled with it.",
        src: `from pydantic_ai import Agent, ToolOutput

agent = Agent(
    'openai:gpt-5.2',
    output_type=ToolOutput(Verdict, name='submit_verdict'),
    end_strategy='early',
)

@agent.tool_plain(requires_approval=True)
def disable_account(user: str) -> str:
    """Disable a directory account."""
    return f'{user} disabled'`,
      },
      soc: "Pin `end_strategy` explicitly instead of relying on a default that has changed between versions. For agents with side-effecting tools, `'early'` means a verdict can never smuggle an action through with it.",
      url: B + "core-concepts/output/",
    },
    {
      id: "limits",
      title: "Usage limits: where the run is checked",
      hook: "What stops an investigation from calling the model forever?",
      diagram: {
        kind: "flow",
        steps: [
          { t: "usage_limits=UsageLimits", s: "Passed per run. `request_limit` defaults to 50; token, tool-call and cost limits are off unless set.", tag: "you" },
          { t: "Before each request", s: "The request count is checked before the model is called, so the limit is never overshot by a request.", tag: "guard" },
          { t: "Model response", s: "Token usage from the response is added to `RunUsage` and checked against the token limits.", tag: "model" },
          { t: "Before tool calls", s: "`tool_calls_limit` counts successful tool calls and is checked as tools are about to run.", tag: "guard" },
          { t: "UsageLimitExceeded", s: "The run stops with an exception instead of a result. Nothing partial is returned as output.", tag: "stop" },
        ],
      },
      explain: [
        "`UsageLimits` bounds one run: `request_limit`, `tool_calls_limit`, `input_tokens_limit`, `output_tokens_limit`, `total_tokens_limit` and `per_request_input_tokens_limit`. Recent releases add `cost_limit` in USD, which is best-effort and unavailable for models without pricing data. The exact check points are version-dependent.",
        "Usage accumulates on the run and is readable from `result.usage()`, from `agent_run.usage()` during `iter()`, and from `ctx.usage` inside tools, so a tool can behave differently as the budget shrinks.",
      ],
      code: {
        lang: "python",
        caption: "A bounded triage run that fails closed when the budget is spent.",
        src: `from pydantic_ai.exceptions import UsageLimitExceeded
from pydantic_ai.usage import UsageLimits

limits = UsageLimits(request_limit=8, tool_calls_limit=12, total_tokens_limit=60_000)

try:
    result = await agent.run(alert_text, deps=deps, usage_limits=limits)
    print(result.output, result.usage())
except UsageLimitExceeded as exc:
    print('investigation stopped:', exc)`,
      },
      soc: "Limits are the per-case cost and runaway control: a noisy alert storm cannot turn into unbounded model spend. Relay applies `UsageLimits` today and has no USD cap yet, so request and token limits carry that load.",
      url: B + "core-concepts/agent/",
    },
  ],
};
