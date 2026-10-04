import type { Mechanism } from "./types";

export const multiagent: Mechanism = {
  id: "multiagent",
  title: "Multi-agent composition",
  question: "How does work move between agents, and who decides?",
  why: "Multi-agent designs promise specialists with narrow tools, but each one adds a loop, a cost and a place where context and permissions can leak. The real questions are who picks the next agent (your code or the model), what the child can see and do, and what comes back. Those answers determine cost predictability and least privilege.",
  patterns: [
    {
      id: "subagent-tool",
      name: "Subagent behind a tool",
      say: "The parent calls a tool such as `task` or `Agent`; a child runs its own loop with fresh context and returns a result.",
      tradeoff: "Keeps the parent's context small, but every delegation is a full extra loop with its own cost.",
    },
    {
      id: "handoff-transfer",
      name: "Handoff or transfer",
      say: "Control moves to another agent, which continues the same conversation with its own instructions and tools.",
      tradeoff: "Mirrors tier escalation, but the model chooses the route and the receiver sees shared history.",
    },
    {
      id: "workflow-graph",
      name: "Workflow graph",
      say: "Code defines the order (sequential, parallel, loop or graph edges) with agents as steps; model routing is optional.",
      tradeoff: "Predictable order and cost, but less adaptive, and routing logic lives in code you maintain.",
    },
    {
      id: "agent-as-tool",
      name: "Agent called from a tool",
      say: "You call another agent from inside a tool's function and return its output; no special construct is involved.",
      tradeoff: "Full control over inputs and budgets, but isolation, limits and tracing are yours to build.",
    },
    {
      id: "none",
      name: "Bring your own",
      say: "No multi-agent construct is provided; you create another session yourself and pass results back.",
      tradeoff: "Nothing hidden, but isolation, nesting limits and cost accounting are all your code.",
    },
  ],
  dimensions: ["Who picks the next agent", "Child's context", "Nesting", "Result to parent"],
  entries: {
    claude: {
      pattern: "subagent-tool",
      api: "agents={...} + Agent tool",
      how: "`AgentDefinition` sets a subagent's `description`, `prompt`, `tools`, `model` and `maxTurns`. Claude invokes it through the `Agent` tool (formerly `Task`) and gets only the final result. Subagents can nest and may run in the background.",
      cells: [
        "Parent model, by description",
        "Fresh conversation with its own tools",
        "Allowed; cap with spawn-depth setting",
        "Final message as the tool result",
      ],
      code: `reviewer = AgentDefinition(
    description="Checks each claim in a triage summary against case evidence.",
    prompt="You verify claims. Cite event IDs. Never take containment actions.",
    tools=["mcp__relay__case_events", "mcp__relay__lookup_ip"],
    maxTurns=5,
)
options = ClaudeAgentOptions(tools=["Agent"], agents={"evidence-reviewer": reviewer},
                             env={"CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH": "1"})`,
      lang: "python",
      chapter: "subagents",
    },
    pydantic: {
      pattern: "agent-as-tool",
      api: "agent.run() inside @agent.tool",
      how: "The documented delegation pattern is a tool that calls another agent's `run()` and returns its output, passing `usage=ctx.usage` so limits cover both. Programmatic hand-off is plain code between runs, and pydantic-graph covers explicit graphs.",
      cells: [
        "Parent model picks the tool",
        "Only what you pass to run()",
        "Your code decides",
        "The tool's return value",
      ],
      code: `@agent.tool
async def ask_malware_analyst(ctx: RunContext[CaseDeps], sample_hash: str) -> str:
    """Get a malware opinion on one sample."""
    r = await malware_agent.run(f'Assess {sample_hash}', deps=ctx.deps, usage=ctx.usage)
    return r.output`,
      lang: "python",
    },
    deepagents: {
      pattern: "subagent-tool",
      api: "subagents=[...] + task tool",
      how: "`SubAgentMiddleware` exposes a `task` tool. Each subagent is a dict with `name`, `description`, `system_prompt` and optional `tools` and `model`. Subagents start without parent history and return only their final result; a `general-purpose` one is added by default.",
      cells: [
        "Parent model via the task tool",
        "Isolated; no parent history",
        "No; subagents lack the task tool",
        "Final message as the task result",
      ],
      code: `host_analyst = {
    "name": "host-analyst",
    "description": "Investigate one host: processes, logons and network connections.",
    "system_prompt": "You are a read-only host analyst. Return findings with event IDs.",
    "tools": [host_timeline, process_tree],
}
agent = create_deep_agent(tools=[search_alerts], subagents=[host_analyst])`,
      lang: "python",
      chapter: "subagents",
    },
    pi: {
      pattern: "none",
      api: "none (create another AgentSession)",
      how: "Pi ships no subagent, handoff or workflow construct. To delegate, a custom tool can create a second `AgentSession` with its own tool allowlist, prompt it, and return its last assistant text.",
      cells: [
        "Your code",
        "Whatever session you create",
        "Your code decides",
        "Whatever your tool returns",
      ],
      code: `const askHostAnalyst = defineTool({ name: "ask_host_analyst", label: "Host analyst",
  description: "Ask a read-only analyst about one host",
  parameters: Type.Object({ host: Type.String() }),
  async execute(_id, params) {
    const { session } = await createAgentSession({ tools: ["read"], sessionManager: SessionManager.inMemory() });
    await session.prompt(\`Investigate \${params.host}. Cite evidence.\`);
    const text = session.getLastAssistantText() ?? ""; session.dispose();
    return { content: [{ type: "text", text }], details: undefined }; } });`,
      lang: "ts",
    },
    vercel: {
      pattern: "agent-as-tool",
      api: "agent.generate() inside execute",
      how: "There is no handoff construct. The docs describe workflow patterns (sequential, parallel, routing, orchestrator-worker, evaluator-optimizer) written in code, and a subagent is a `ToolLoopAgent` called from another tool's `execute`.",
      cells: [
        "Parent model, or your routing code",
        "Only the prompt you pass",
        "Your code decides",
        "Whatever execute returns",
      ],
      code: `const askHostAnalyst = tool({
  description: 'Ask the host analyst about one host',
  inputSchema: z.object({ host: z.string() }),
  execute: async ({ host }) =>
    (await hostAnalyst.generate({ prompt: \`Investigate \${host}. Cite evidence.\` })).text,
});`,
      lang: "ts",
    },
    opencode: {
      pattern: "subagent-tool",
      api: "task tool + mode: subagent",
      how: "Agents are configuration with a `mode` of `primary`, `subagent` or `all`. A primary agent delegates with the `task` tool, governed by `permission.task` globs, and each subagent run happens in a child session listed by `session.children()`.",
      cells: [
        "Primary agent via the task tool",
        "Child session with its own prompt",
        "Governed by permission.task globs",
        "Child result returns to the primary",
      ],
      code: `{ "agent": {
    "triage": { "mode": "primary", "steps": 12,
      "permission": { "edit": "deny", "task": { "*": "deny", "ioc-*": "allow" } } },
    "ioc-extractor": { "mode": "subagent",
      "description": "Extract IPs, domains and hashes from pasted log lines",
      "permission": { "edit": "deny", "bash": "deny", "webfetch": "deny" } }
} }`,
      lang: "json",
      chapter: "agents",
    },
    openai: {
      pattern: "handoff-transfer",
      api: "handoffs= / agent.as_tool()",
      how: "Each entry in `handoffs` becomes a tool; calling it switches the current agent, which continues the same run. `input_filter` controls what history the specialist sees. `agent.as_tool()` instead keeps a manager in charge and returns the specialist's answer as a tool output.",
      cells: [
        "Model calls a handoff tool",
        "Shared history, filterable",
        "Any agent can hand off again",
        "Receiver owns the rest of the run",
      ],
      code: `triage = Agent(
    name="Triage",
    handoffs=[handoff(malware, input_filter=handoff_filters.remove_all_tools)],
)
manager = Agent(name="Lead", tools=[malware.as_tool(
    tool_name="ask_malware_analyst", tool_description="Get a malware opinion")])`,
      lang: "python",
      chapter: "handoffs",
    },
    google_adk: {
      pattern: "workflow-graph",
      api: "Sequential/Parallel/LoopAgent",
      how: "Workflow agents (`SequentialAgent`, `ParallelAgent`, `LoopAgent`) fix order in code with no model call. An `LlmAgent` with `sub_agents` gains model-driven transfer, and `AgentTool` wraps an agent as a tool. Agents share session state via `output_key`.",
      cells: [
        "Code, or the model via transfer",
        "Shared session state; output_key",
        "Agent tree; one parent per agent",
        "State keys, or AgentTool result",
      ],
      code: `enrich = ParallelAgent(name="enrich", sub_agents=[ip_intel, host_intel])
refine = LoopAgent(name="refine", sub_agents=[draft, review], max_iterations=3)
pipeline = SequentialAgent(name="triage_pipeline", sub_agents=[enrich, refine])
lead = LlmAgent(name="lead", model=M, instruction="Coordinate the case.",
                tools=[AgentTool(agent=malware)])`,
      lang: "python",
      chapter: "multi-agent",
    },
    microsoft: {
      pattern: "workflow-graph",
      api: "WorkflowBuilder / orchestrations",
      how: "Workflows are typed executor graphs run in supersteps. Orchestration builders (sequential, concurrent, handoff, group chat, Magentic) wire agents as executors, so checkpoints and `request_info` still apply. Handoff, group chat and Magentic let a model pick the next speaker.",
      cells: [
        "Edges in code; model in handoff or Magentic",
        "Messages passed along edges",
        "Sub-workflows",
        "Workflow outputs",
      ],
      code: `enrich = ConcurrentBuilder(participants=[
    make("ip_intel", "Enrich the IPs."),
    make("host_intel", "Enrich the hosts."),
]).build()
report = SequentialBuilder(participants=[
    make("writer", "Draft the incident summary."),
    make("reviewer", "Check the summary against the evidence."),
]).build()`,
      lang: "python",
      chapter: "orchestrations",
    },
    openhands: {
      pattern: "subagent-tool",
      api: "TaskToolSet + register_agent",
      how: "Sub-agents are registered by name with `register_agent(name, factory_func, description)`. The main agent gets `TaskToolSet` and delegates by calling it; each sub-agent runs its own conversation in the same workspace and its result returns as an observation. Older releases used a `DelegateTool`.",
      cells: [
        "Parent model via the task tool",
        "Own conversation; shared workspace",
        "Can resume the same sub-agent conversation",
        "Observation returned to the parent",
      ],
      code: `from openhands.sdk import Agent, Tool
from openhands.sdk.subagent import register_agent
from openhands.tools.task import TaskToolSet

register_agent(name="malware_analyst", factory_func=make_malware_analyst,
               description="Analyses suspicious binaries for the case.")
agent = Agent(llm=llm, tools=[Tool(name=TaskToolSet.name)])`,
      lang: "python",
    },
    hermes: {
      pattern: "subagent-tool",
      api: "delegate_task",
      how: "`delegate_task` takes one task or a `tasks` batch (ten concurrent children by default), each with fresh context. Delegation is flat unless `delegation.max_spawn_depth` is raised. Children are not durable: a restart leaves a running child's outcome `unknown`.",
      cells: [
        "Parent model via delegate_task",
        "Fresh context per child",
        "Flat unless max_spawn_depth is raised",
        "Summary, or JSON per output_schema",
      ],
      code: `delegate_task(tasks=[
    {"goal": "List persistence mechanisms found on host WS-114",
     "context": "Case 4812. Read-only review of /cases/4812/ws114/. Cite file paths.",
     "output_schema": {"type": "object",
                       "properties": {"findings": {"type": "array", "items": {"type": "string"}}},
                       "required": ["findings"]}},
])`,
      lang: "python",
      chapter: "delegation",
    },
  },
  choose: [
    "Put mandatory steps (enrichment, evidence capture, verdict review) in code-ordered workflows; use model-chosen delegation only for routing among read-only specialists.",
    "Give each specialist the narrowest tool set. Reviewers and extractors read only; containment stays with one agent behind approval.",
    "Share one cost budget across parent and children and cap nesting depth. Claude, Hermes and Deep Agents all let a parent multiply spend by delegating.",
    "Pass children a case summary and IDs, not every raw log line. Handoff filters and fresh-context subagents are data-minimisation controls.",
    "Require structured results from children (output_schema, typed output) so the parent cannot mistake a child's prose for a confirmed finding.",
  ],
};
