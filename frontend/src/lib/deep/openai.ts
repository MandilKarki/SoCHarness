import type { DeepDive } from "./types";

const B = "https://openai.github.io/openai-agents-python/";

export const openai: DeepDive = {
  intro:
    "Underneath, the Agents SDK is one loop in `Runner`: call the model, classify what came back, act on it, repeat. Every other feature (handoffs, guardrails, approvals, sessions) is a hook into a specific point of that loop. Learn where each one plugs in and the whole SDK becomes predictable.",
  chapters: [
    {
      id: "loop",
      title: "The run loop and turn classification",
      hook: "What decides whether a run stops, calls a tool or switches agent?",
      diagram: {
        kind: "flow",
        steps: [
          { t: "Runner.run()", s: "You pass the starting agent and input. The runner owns the loop, not the agent.", tag: "you" },
          { t: "Call the model", s: "One model call with the current agent's instructions, tools, handoffs and the history so far. This is one turn.", tag: "model" },
          { t: "Classify output", s: "The response is sorted into exactly one outcome: final output, handoff, or tool calls.", tag: "core" },
          { t: "Run tools", s: "Function tools execute (in parallel when the model asked for several) and their outputs are appended to the history.", tag: "tool" },
          { t: "Final output", s: "Matches `output_type`, or plain text with no tool calls or handoffs. The loop ends and `RunResult` is returned.", tag: "stop" },
        ],
        back: { from: 3, to: 1, label: "next turn until max_turns" },
      },
      explain: [
        "Each pass through the loop is a turn. After the model responds, the runner checks three things in order: is this a final output, is it a handoff, or did the model ask for tools. Tool outputs go back into the history and the loop runs again. If `max_turns` is hit first, the runner raises `MaxTurnsExceeded`.",
        "What counts as final depends on `output_type`. With no output type, the first response that has no tool calls and no handoff is the answer. With an output type, the model must produce that structured output. This is why a structured agent can never accidentally stop on chatter.",
        "Everything the loop produced is on the result: `final_output`, `new_items` (each tool call, tool output, message and handoff as a typed item), `last_agent`, and `raw_responses` for the exact model payloads.",
      ],
      code: {
        lang: "python",
        caption: "One agent, one tool, a bounded loop, and the typed items it produced.",
        src: `from agents import Agent, Runner, function_tool

@function_tool
def ip_reputation(ip: str) -> str:
    """Return reputation for an IP address."""
    return f"{ip}: seen in 3 phishing campaigns"

agent = Agent(name="Triage", instructions="Triage the alert.", tools=[ip_reputation])

result = await Runner.run(agent, "Is 203.0.113.7 malicious?", max_turns=6)
print(result.final_output)
for item in result.new_items:
    print(type(item).__name__)  # ToolCallItem, ToolCallOutputItem, MessageOutputItem`,
      },
      soc: "`max_turns` is your first cost and runaway control: an investigation that keeps calling enrichment tools fails closed instead of spending forever. Keep `new_items` as the audit trail of what the agent actually did.",
      url: B + "running_agents/",
    },
    {
      id: "tool-use",
      title: "tool_use_behavior: who speaks after a tool",
      hook: "Does the model always get the last word after a tool runs?",
      diagram: {
        kind: "tree",
        root: { t: "Tool results ready", s: "Every function tool in this turn has returned. The agent's `tool_use_behavior` now decides what happens.", tag: "tool" },
        children: [
          { t: "run_llm_again", s: "Default. Outputs go back to the model, which reads them and decides the next step.", tag: "model" },
          { t: "stop_on_first_tool", s: "The first tool's output becomes the final output. No second model call.", tag: "stop" },
          { t: "StopAtTools([...])", s: "Stop only if one of the named tools was called; otherwise keep looping.", tag: "stop" },
          { t: "Custom function", s: "Your function sees every result and returns `ToolsToFinalOutputResult(is_final_output=…)`.", tag: "core" },
        ],
      },
      explain: [
        "By default the model always reads tool output and responds again (`run_llm_again`). That is right for reasoning, but it costs a model call and lets the model paraphrase data you may want verbatim.",
        "The other modes let a tool end the run. `stop_on_first_tool` returns the first tool's output as is. `StopAtTools` stops only for named tools. A custom function inspects all results and decides. Separately, `reset_tool_choice` (on by default) clears a forced `tool_choice` after a tool call so a required tool cannot loop forever.",
      ],
      code: {
        lang: "python",
        caption: "Stop as soon as the containment tool runs; never let the model reword its receipt.",
        src: `from agents import Agent, StopAtTools, ToolsToFinalOutputResult

agent = Agent(
    name="Responder",
    tools=[ip_reputation, block_ip],
    tool_use_behavior=StopAtTools(stop_at_tool_names=["block_ip"]),
)

def verdict_is_final(ctx, results) -> ToolsToFinalOutputResult:
    for r in results:
        if r.tool.name == "ip_reputation" and "malicious" in str(r.output):
            return ToolsToFinalOutputResult(is_final_output=True, final_output=r.output)
    return ToolsToFinalOutputResult(is_final_output=False, final_output=None)

lookup_only = Agent(name="Lookup", tools=[ip_reputation], tool_use_behavior=verdict_is_final)`,
      },
      soc: "For actions with a system of record (a ticket ID, a block receipt), stopping on the tool keeps the exact output and saves a model call. For enrichment, let the model read the results so it can correlate them.",
      url: B + "agents/#tool-use-behavior",
    },
    {
      id: "handoffs",
      title: "Handoffs are tools that swap the agent",
      hook: "How does one agent pass a case to another?",
      diagram: {
        kind: "lanes",
        actors: ["Runner", "Triage", "Model", "Malware analyst"],
        msgs: [
          { from: 0, to: 1, t: "run(triage)", s: "The run starts on the triage agent.", tag: "you" },
          { from: 1, to: 2, t: "tools + transfer_to_malware_analyst", s: "Each handoff is exposed to the model as a tool named `transfer_to_<agent>`.", tag: "model" },
          { from: 2, to: 1, t: "call transfer tool", s: "The model chooses the handoff by calling that tool.", tag: "model" },
          { from: 1, to: 3, t: "on_handoff + input_filter", s: "`on_handoff` fires; `input_filter` can trim the history the next agent sees.", tag: "core" },
          { from: 3, to: 2, t: "specialist's own prompt + tools", s: "The loop continues with the specialist as current agent. Control does not come back.", tag: "model" },
          { from: 3, to: 0, t: "final output", s: "`result.last_agent` tells you who finished the run.", tag: "stop" },
        ],
      },
      explain: [
        "A handoff is not a special channel. The runner turns each entry in `handoffs` into a tool the model can call. When it is called, the runner switches the current agent and continues the same loop with the new agent's instructions and tools.",
        "Use a handoff when the specialist should own the rest of the conversation. Use `agent.as_tool()` instead when a manager should stay in charge and just consult the specialist: the specialist runs as a nested call and its answer returns to the manager as a tool output.",
      ],
      code: {
        lang: "python",
        caption: "A filtered handoff (the specialist sees no prior tool chatter) versus agent-as-tool.",
        src: `from agents import Agent, Runner, handoff
from agents.extensions import handoff_filters

malware = Agent(name="Malware analyst", instructions="Analyse the sample.",
                handoff_description="Deep malware triage")

triage = Agent(
    name="Triage",
    instructions="Route the alert to the right specialist.",
    handoffs=[handoff(malware, input_filter=handoff_filters.remove_all_tools,
                      on_handoff=lambda ctx: print("escalated"))],
)
result = await Runner.run(triage, alert_text)
print(result.last_agent.name)

# Manager keeps control instead:
manager = Agent(name="Lead", tools=[malware.as_tool(
    tool_name="ask_malware_analyst", tool_description="Get a malware opinion")])`,
      },
      soc: "Handoffs mirror tier escalation (L1 to L2). The `input_filter` is a data-minimisation control: pass the specialist the case summary, not every raw log line the triage agent touched.",
      url: B + "handoffs/",
    },
    {
      id: "guardrails",
      title: "Guardrail timing: parallel versus blocking",
      hook: "When a guardrail trips, has the model already spent tokens?",
      diagram: {
        kind: "timeline",
        legend: { guard: "guardrail", model: "model call", stop: "tripwire" },
        events: [
          { t: "Run starts", s: "Input guardrails attach to the first agent only; output guardrails to the agent that produces the final output.", tag: "core" },
          { t: "Parallel (default)", s: "`run_in_parallel=True`: the input guardrail and the first model call start together. Lowest latency.", tag: "guard" },
          { t: "Model already running", s: "If the tripwire fires now, the model call is cancelled, but tokens may already be spent and tools may have started.", tag: "model" },
          { t: "Blocking", s: "`run_in_parallel=False`: the guardrail must pass before the model is called at all. No spend on bad input.", tag: "guard" },
          { t: "Tripwire", s: "`InputGuardrailTripwireTriggered` (or the Output variant) is raised and the run stops.", tag: "stop" },
          { t: "Final output check", s: "Output guardrails run on the final answer; tool guardrails can also wrap each function tool call.", tag: "guard" },
        ],
      },
      explain: [
        "A guardrail is a function that returns `GuardrailFunctionOutput` with a `tripwire_triggered` flag. Input guardrails see the user input of the first agent; output guardrails see the final output. They are often a small, cheap model or plain code.",
        "Parallel mode trades safety for speed: the main model starts before the guardrail has decided. Blocking mode costs latency but guarantees nothing reaches the model, or any tool, if the guardrail trips.",
      ],
      code: {
        lang: "python",
        caption: "A blocking input guardrail that stops secrets before any model call.",
        src: `from agents import (Agent, GuardrailFunctionOutput, InputGuardrailTripwireTriggered,
                    Runner, input_guardrail)

@input_guardrail(run_in_parallel=False)  # block before any tokens are spent
async def no_private_keys(ctx, agent, user_input):
    leaked = "BEGIN PRIVATE KEY" in str(user_input)
    return GuardrailFunctionOutput(output_info={"leaked": leaked}, tripwire_triggered=leaked)

agent = Agent(name="Triage", instructions="...", input_guardrails=[no_private_keys])
try:
    await Runner.run(agent, alert_text)
except InputGuardrailTripwireTriggered as e:
    print("blocked:", e.guardrail_result.output.output_info)`,
      },
      soc: "Use blocking guardrails for anything that must never leave the building (keys, PII, customer data) and for prompt-injection screening of untrusted alert text. Parallel mode is fine for quality checks where a wasted call is acceptable.",
      url: B + "guardrails/",
    },
    {
      id: "approvals",
      title: "Human approval: pause, serialise, resume",
      hook: "How can a run stop for an analyst and continue later?",
      diagram: {
        kind: "lanes",
        actors: ["Analyst", "Runner", "Model", "isolate_host"],
        msgs: [
          { from: 0, to: 1, t: "Contain WS-114", s: "The analyst starts a run that may need a sensitive tool.", tag: "you" },
          { from: 2, to: 1, t: "call isolate_host", s: "The model asks for a tool declared with `needs_approval=True`.", tag: "model" },
          { from: 1, to: 0, t: "result.interruptions", s: "The run returns early with `ToolApprovalItem`s instead of executing the tool.", tag: "guard" },
          { from: 0, to: 1, t: "state.approve(item)", s: "`result.to_state()` captures everything; the analyst approves or rejects each item. State can be saved and resumed later.", tag: "guard" },
          { from: 1, to: 3, t: "execute approved call", s: "`Runner.run(agent, state)` resumes exactly where it paused and runs only what was approved.", tag: "tool" },
          { from: 3, to: 2, t: "output → next turn", s: "A rejected call returns a rejection message to the model instead of a result.", tag: "model" },
        ],
      },
      explain: [
        "Approval is part of the run state, not a callback that blocks a thread. When a tool needs approval, the run returns with `interruptions`. `to_state()` gives a `RunState` you can serialise, so the decision can happen minutes or hours later in another process.",
        "`needs_approval` can be a boolean or a function of the arguments, so you can ask only for risky inputs. `approve(..., always_approve=True)` remembers the decision for the rest of the run.",
      ],
      code: {
        lang: "python",
        caption: "The documented approval loop, applied to host isolation.",
        src: `from agents import Runner, function_tool

@function_tool(needs_approval=True)
def isolate_host(host: str) -> str:
    """Network-isolate a host."""
    return f"{host} isolated"

result = await Runner.run(agent, "Contain WS-114")
while result.interruptions:
    state = result.to_state()
    for item in result.interruptions:
        if analyst_approves(item.name, item.arguments):
            state.approve(item, always_approve=False)
        else:
            state.reject(item)
    result = await Runner.run(agent, state)`,
      },
      soc: "This is the containment gate: the agent can propose isolating a host or disabling an account, but nothing executes until an analyst approves those exact arguments. Persist the serialised state with the case so the approval survives a restart.",
      url: B + "human_in_the_loop/",
    },
    {
      id: "context",
      title: "Two kinds of context",
      hook: "What does the model see, and what stays in your code?",
      diagram: {
        kind: "stack",
        layers: [
          { t: "RunContextWrapper", s: "Your local context object rides along the whole run. The model never sees it.", u: "Usage totals are collected on the wrapper.", tag: "state" },
          { t: "Tools, hooks, guardrails", s: "Every tool and callback receives `ctx` and reads `ctx.context` (case ID, clients, permissions).", u: "Tool outputs are what the model sees.", tag: "tool" },
          { t: "Instructions + history", s: "Only instructions, the conversation and tool outputs are sent to the model. That is the LLM context.", u: "The response comes back as items.", tag: "model" },
        ],
        core: { t: "Model call", s: "The model only knows what was put into the LLM context.", tag: "model" },
      },
      explain: [
        "The SDK separates local context (any Python object you pass as `context=`) from LLM context (instructions, input and history). Local context is dependency injection: database handles, the current case, the caller's role. It is typed through `Agent[MyContext]`.",
        "Dynamic instructions can be a function of the context, which is how one agent definition serves many cases without string-building prompts by hand.",
      ],
      code: {
        lang: "python",
        caption: "Case-scoped dependencies reach tools without ever being sent to the model.",
        src: `from dataclasses import dataclass
from agents import Agent, RunContextWrapper, Runner, function_tool

@dataclass
class Case:
    case_id: str
    tenant: str

@function_tool
def case_events(ctx: RunContextWrapper[Case], limit: int = 20) -> str:
    """Return recent events for the current case."""
    return fetch_events(ctx.context.tenant, ctx.context.case_id, limit)

def instructions(ctx: RunContextWrapper[Case], agent) -> str:
    return f"You are triaging case {ctx.context.case_id}. Cite event IDs."

agent = Agent[Case](name="Triage", instructions=instructions, tools=[case_events])
result = await Runner.run(agent, "Summarise", context=Case("4812", "acme"))
print(result.context_wrapper.usage.total_tokens)`,
      },
      soc: "Tenant and case scoping belong in local context, never in the prompt, so a prompt injection cannot change which tenant a tool queries. This is how Relay's tool gateway stays case-scoped.",
      url: B + "context/",
    },
    {
      id: "sessions",
      title: "Sessions and tracing",
      hook: "How does memory carry across runs, and how do you see every step?",
      diagram: {
        kind: "loop",
        center: "Session",
        exit: "trace closes when the with-block ends",
        steps: [
          { t: "get_items()", s: "Before the run, the session loads prior items and prepends them to the input.", tag: "state" },
          { t: "Runner.run()", s: "The loop runs as normal; every model call, tool and handoff becomes a span inside the current trace.", tag: "core" },
          { t: "add_items()", s: "New items from this run are appended to the session store.", tag: "state" },
          { t: "Next question", s: "A follow-up with the same session sees the full history without you passing it.", tag: "you" },
        ],
      },
      explain: [
        "A session is a tiny protocol: `get_items`, `add_items`, `pop_item`, `clear_session`. `SQLiteSession` is built in; you can implement the protocol on any store. Without a session you pass history yourself with `result.to_input_list()`.",
        "Tracing is on by default. `trace()` groups several runs into one workflow; agents, generations, tool calls, handoffs and guardrails become spans. You can add processors to send spans to your own backend or disable tracing per run.",
      ],
      code: {
        lang: "python",
        caption: "Two questions about one case, one trace, shared history.",
        src: `from agents import Runner, SQLiteSession, trace

session = SQLiteSession("case-4812", "relay.db")
with trace("Case 4812 triage", group_id="case-4812"):
    r1 = await Runner.run(agent, "Summarise the alert", session=session)
    r2 = await Runner.run(agent, "Which hosts are affected?", session=session)`,
      },
      soc: "Key sessions by case ID so every follow-up stays inside one case. Traces leave the building by default (to OpenAI's dashboard), so decide deliberately: disable or redirect them if alert data must stay on your infrastructure.",
      url: B + "sessions/",
    },
  ],
};
