import type { Mechanism } from "./types";

export const tools: Mechanism = {
  id: "tools",
  title: "Tool definition and execution",
  question: "How does a function become a tool, and what happens when it fails?",
  why: "Tools are the agent's only way to touch your SIEM, EDR and ticketing systems, so the tool layer decides case scope, argument validation and error handling. How a framework derives schemas, runs parallel calls and reports failures determines whether a malformed or injected argument reaches a production API, and whether the model can recover from a failed lookup.",
  patterns: [
    {
      id: "decorated-functions",
      name: "Decorated functions",
      say: "A decorator or wrapper turns a typed function into a tool; the schema comes from the signature and docstring.",
      tradeoff: "Least boilerplate, but the schema is only as precise as your type hints and docstrings.",
    },
    {
      id: "schema-objects",
      name: "Explicit schema objects",
      say: "Each tool is an object with a description, an explicit schema (Zod, TypeBox or JSON Schema) and an execute function.",
      tradeoff: "The model-facing contract is explicit and portable, at the cost of more code per tool.",
    },
    {
      id: "in-process-mcp",
      name: "In-process MCP server",
      say: "Tools are packaged as an MCP server, even when they run inside your process, and addressed as `mcp__server__tool`.",
      tradeoff: "One protocol for local and remote tools, but naming and permission layers add concepts to learn.",
    },
    {
      id: "typed-actions",
      name: "Action and Observation types",
      say: "A tool is a typed Action schema, a typed Observation and an executor, registered by name and resolved when the conversation starts.",
      tradeoff: "Strong typing and a serialisable agent, but the most ceremony of any pattern here.",
    },
  ],
  dimensions: ["Schema from", "Parallel calls", "Tool error to model", "MCP"],
  entries: {
    claude: {
      pattern: "in-process-mcp",
      api: "@tool + create_sdk_mcp_server",
      how: "`@tool(name, description, schema)` defines a handler that returns `{\"content\": [...]}`; `create_sdk_mcp_server` packages handlers as an in-process server. `tools=[]` removes the built-ins, and `allowed_tools` takes exact names or `mcp__relay__*`.",
      cells: [
        "Dict of types or JSON Schema in @tool",
        "readOnlyHint tools may run in parallel",
        "is_error: True, or an uncaught exception",
        "Native: in-process and external servers",
      ],
      code: `@tool("lookup_ip", "Reputation for an IP in the current case", {"ip": str},
      annotations=ToolAnnotations(readOnlyHint=True))
async def lookup_ip(args: dict[str, Any]) -> dict[str, Any]:
    rep = await intel.reputation(CURRENT_CASE.tenant, args["ip"])
    if rep is None:
        return {"content": [{"type": "text", "text": "No record"}], "is_error": True}
    return {"content": [{"type": "text", "text": rep.summary}]}
relay = create_sdk_mcp_server(name="relay", version="1.0.0", tools=[lookup_ip])`,
      lang: "python",
      chapter: "sdk-mcp",
    },
    pydantic: {
      pattern: "decorated-functions",
      api: "@agent.tool + ModelRetry",
      how: "`@agent.tool` functions take `RunContext` first, which is hidden from the schema; `@agent.tool_plain` take none. Raising `ModelRetry` sends feedback to the model within the tool's `retries` budget. Toolsets group, filter, prefix or wrap tools.",
      cells: [
        "Signature and docstring (Pydantic)",
        "Concurrent by default; sequential option",
        "ModelRetry becomes a retry prompt",
        "MCP servers attached as toolsets",
      ],
      code: `@agent.tool
async def case_events(ctx: RunContext[CaseDeps], limit: int = 20) -> list[dict]:
    """Return recent events for the current case."""
    if limit > 200:
        raise ModelRetry('limit must be 200 or less')
    return await ctx.deps.siem.events(ctx.deps.tenant, ctx.deps.case_id, limit)`,
      lang: "python",
      chapter: "deps",
    },
    deepagents: {
      pattern: "decorated-functions",
      api: "@tool + create_deep_agent(tools=)",
      how: "Pass LangChain tools, plain functions or MCP tools to `create_deep_agent(tools=...)`; the default stack adds file tools and `task`. `wrap_tool_call` middleware can intercept each execution, retry it, or return its own `ToolMessage`.",
      cells: [
        "Signature and docstring (@tool)",
        "Tools node runs a turn's calls together",
        "ToolMessage; reshape in wrap_tool_call",
        "MCP tools passed in tools=",
      ],
      code: `@tool
def search_alerts(query: str) -> str:
    """Search SIEM alerts for the current case."""
    return siem.search(query)

agent = create_deep_agent(model="anthropic:claude-sonnet-5", tools=[search_alerts],
                          system_prompt="You are a SOC investigator. Cite alert IDs.")`,
      lang: "python",
      chapter: "onion",
    },
    pi: {
      pattern: "schema-objects",
      api: "defineTool + TypeBox parameters",
      how: "`defineTool` takes a name, label, description, TypeBox `parameters` and `execute(toolCallId, params)` returning content blocks. `tools` allowlists, `excludeTools` denies, `customTools` adds. A response cut off by length fails its tool calls instead of running them.",
      cells: [
        "TypeBox Type.Object",
        "Calls from one message can run in parallel",
        "Error result (isError on execution end)",
        "Via the built-in MCP extension",
      ],
      code: `const hostLookup = defineTool({
  name: "host_lookup",
  label: "Host lookup",
  description: "Return owner and criticality for a hostname from the CMDB",
  parameters: Type.Object({ host: Type.String() }),
  async execute(_toolCallId, params) {
    return { content: [{ type: "text", text: await cmdbLookup(params.host) }], details: undefined };
  } });`,
      lang: "ts",
      chapter: "loop",
    },
    vercel: {
      pattern: "schema-objects",
      api: "tool({ inputSchema, execute })",
      how: "`tool()` takes a description, a Zod `inputSchema` and `execute`; omit `execute` and the call comes back to you. Failures surface as `tool-error` parts and go back to the model in the next step. `createMCPClient()` exposes MCP server tools.",
      cells: [
        "Zod inputSchema",
        "Calls in one step execute concurrently",
        "tool-error part, sent back next step",
        "createMCPClient() over stdio, SSE or HTTP",
      ],
      code: `const lookupIp = tool({
  description: 'Reputation for an IP address',
  inputSchema: z.object({ ip: z.string() }),
  execute: async ({ ip }) => intel.reputation(ip),
});`,
      lang: "ts",
      chapter: "steps",
    },
    opencode: {
      pattern: "schema-objects",
      api: "tool() from @opencode-ai/plugin",
      how: "Built-in tools (read, edit, bash, grep, task and more) live on the server. Custom tools use `tool()` with Zod args from `tool.schema`, loaded from `.opencode/tools/` or a plugin. MCP servers are configured in `opencode.json`; permissions filter everything.",
      cells: [
        "Zod via tool.schema",
        "Not specified in the docs used here",
        "Errors and denials return as tool errors",
        "Local and remote servers in opencode.json",
      ],
      code: `export const SocTools: Plugin = async () => ({
  tool: {
    ip_reputation: tool({
      description: "Look up reputation for an IP address in the TI platform",
      args: { ip: tool.schema.string().describe("IPv4 or IPv6 address") },
      async execute(args) { return await tiLookup(args.ip); },
    }) },
});`,
      lang: "ts",
      chapter: "extend",
    },
    openai: {
      pattern: "decorated-functions",
      api: "@function_tool",
      how: "`@function_tool` builds the JSON schema from the signature and docstring; a `RunContextWrapper` first parameter is hidden from the model. By default a failing tool returns an error message to the model (`failure_error_function`). Several calls in one turn run in parallel.",
      cells: [
        "Signature and docstring",
        "Yes, in parallel within a turn",
        "Error message via failure_error_function",
        "Stdio, SSE, streamable HTTP, hosted MCP",
      ],
      code: `@function_tool
def case_events(ctx: RunContextWrapper[Case], limit: int = 20) -> str:
    """Return recent events for the current case."""
    return fetch_events(ctx.context.tenant, ctx.context.case_id, limit)

agent = Agent[Case](name="Triage", instructions=instructions, tools=[case_events])`,
      lang: "python",
      chapter: "context",
    },
    google_adk: {
      pattern: "decorated-functions",
      api: "plain function + ToolContext",
      how: "A plain Python function becomes a `FunctionTool`: name, docstring and type hints form the schema, and a `tool_context: ToolContext` parameter is injected rather than exposed. `MCPToolset`, `OpenAPIToolset` and `AgentTool` cover remote tools and agents.",
      cells: [
        "Signature and docstring",
        "Several calls per response are handled",
        "Return an error dict; callbacks can rewrite",
        "MCPToolset",
      ],
      code: `def record_ioc(ioc: str, tool_context: ToolContext) -> dict:
    """Record an indicator of compromise on the current case."""
    tool_context.state["iocs"] = tool_context.state.get("iocs", []) + [ioc]
    return {"recorded": ioc}

agent = LlmAgent(name="triage", model="gemini-2.5-flash", tools=[record_ioc])`,
      lang: "python",
      chapter: "state-scopes",
    },
    microsoft: {
      pattern: "decorated-functions",
      api: "@tool + approval_mode",
      how: "`@tool` turns a function into a `FunctionTool`; `Annotated[..., Field(description=...)]` documents parameters. The chat client's `FunctionInvocationLayer` executes calls, and a tool exception becomes an error result the model sees while the loop continues.",
      cells: [
        "Signature plus Annotated Field",
        "Concurrent by default; can be disabled",
        "Exception becomes a tool error result",
        "Local and hosted MCP tools",
      ],
      code: `@tool(approval_mode="never_require")
def ip_reputation(ip: Annotated[str, Field(description="IPv4 address")]) -> str:
    """Return reputation for an IP address."""
    return f"{ip}: seen in 3 phishing campaigns"

agent = Agent(client=client, name="triage", tools=[ip_reputation])`,
      lang: "python",
      chapter: "agent-loop",
    },
    openhands: {
      pattern: "typed-actions",
      api: "ToolDefinition + register_tool",
      how: "A tool is an `Action` schema, an `Observation` schema and a `ToolExecutor`. You register the class and give the agent a `Tool(name=...)` spec, resolved when the conversation starts so the agent stays serialisable. Pydantic validates arguments before execution.",
      cells: [
        "Pydantic Action model",
        "Parallel ActionEvents grouped per response",
        "Validation runs before the executor",
        "MCP servers as tools",
      ],
      code: `class IpLookupAction(Action):
    ip: str = Field(description="IPv4 or IPv6 address to look up")
class IpLookupExecutor(ToolExecutor[IpLookupAction, Observation]):
    def __call__(self, action: IpLookupAction, conversation=None) -> Observation:
        return Observation.from_text(f"{action.ip}: {threat_intel.lookup(action.ip)}")

register_tool(IpLookupTool.name, IpLookupTool)
agent = Agent(llm=llm, tools=[Tool(name=IpLookupTool.name)])`,
      lang: "python",
      chapter: "tools",
    },
    hermes: {
      pattern: "schema-objects",
      api: "registry.register(schema, handler)",
      how: "Each tool belongs to one toolset and is registered with an OpenAI-format JSON schema, a handler returning a JSON string and an optional `check_fn`. Several calls from one response run in a thread pool, except interactive tools such as `clarify`.",
      cells: [
        "Hand-written JSON Schema",
        "Thread pool; interactive tools sequential",
        "Handler returns error JSON; must not raise",
        "MCP servers via configuration",
      ],
      code: `registry.register(
    name="relay_ip_reputation",
    toolset="relay_soc",
    schema={"name": "relay_ip_reputation", "description": "Look up reputation for an IP.",
            "parameters": {"type": "object", "properties": {"ip": {"type": "string"}},
                           "required": ["ip"]}},
    handler=ip_reputation, check_fn=check_ti,
)`,
      lang: "python",
      chapter: "toolsets",
    },
  },
  choose: [
    "Keep tenant and case IDs out of tool schemas. Inject them from run context (deps, RunContextWrapper, ToolContext, a closure in an in-process MCP server) so injected alert text cannot redirect a query.",
    "Return failures as tool results the model can read and recover from, but never include raw exception text, stack traces or credentials in them.",
    "Run containment tools one at a time through a single gateway; parallel isolate or disable calls make approval, audit and rollback harder to reason about.",
    "Use explicit schemas with enums and bounds for anything that reaches a production API. Validation before execution is a free control against malformed and injected arguments.",
    "Treat external MCP servers as third-party code: allowlist their tools by name and keep them off containment paths until reviewed.",
  ],
};
