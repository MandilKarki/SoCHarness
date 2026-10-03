import { parse, type FrameworkDocs } from "./types";
const B = "https://ai-sdk.dev/docs/";
export const vercelDocs: FrameworkDocs = {
  source: B + "agents/building-agents",
  checked: "2026-10-03",
  sections: [
    { t: "Agents", url: B + "agents/building-agents", items: parse(`
ToolLoopAgent|class|Reusable agent: model, instructions, tools and loop rules|w
Agent (interface)|type|Implement your own agent shape
model / instructions / tools|param|Provider model, system instructions, tool map|w
toolChoice|param|auto, required, none or a specific tool
stopWhen|param|Conditions that end the loop|w
isStepCount() / stepCountIs()|function|Stop after N steps (renamed across versions; Relay's pin uses stepCountIs)|w
hasToolCall()|function|Stop once a named tool is called
isLoopFinished()|function|Run until the model stops calling tools
output / Output|class|Structured result schema (Output.object, …)|w
prepareStep|param|Override model, tools or messages per step
toolApproval|param|Approval policy before tool execution
runtimeContext / toolsContext|param|Shared loop state and server-side per-tool values
experimental_sandbox|param|Execution environment for code/command tools
agent.generate()|method|Run to completion
agent.stream()|method|Stream parts while running|w
createAgentUIStreamResponse()|function|Serve an agent's stream to a UI
InferAgentUIMessage|type|Typed UI messages from an agent
onStart / onStepStart / onStepEnd / onEnd|hook|Loop lifecycle callbacks
onToolExecutionStart / onToolExecutionEnd|hook|Around each tool execution
Workflow patterns|technique|Sequential, parallel, routing, orchestrator-worker, evaluator-optimizer
`) },
    { t: "Tools and tool calling", url: B + "ai-sdk-core/tools-and-tool-calling", items: parse(`
tool()|function|Typed tool with description, inputSchema and execute|w
dynamicTool()|function|Tool whose types are only known at runtime
inputSchema / outputSchema|param|Zod or JSON Schema for inputs and outputs|w
jsonSchema() / zodSchema() / valibotSchema()|function|Schema helpers|w
execute|param|Async implementation receiving validated input|w
strict / inputExamples / contextSchema|param|Strict validation, examples, typed context
toModelOutput|param|Convert results into model-readable content
activeTools / toolOrder|param|Limit or order tools per call
onInputStart / onInputDelta / onInputAvailable|hook|Stream tool input as it's generated
toolCallId / messages / abortSignal|param|Execution context passed to tools|w
repairToolCall|param|Fix invalid tool calls before execution
NoSuchToolError / InvalidToolInputError / ToolCallRepairError / ToolChoiceViolationError|exception|Tool-calling errors
TypedToolCall / TypedToolResult|type|Typed unions of calls and results
steps / responseMessages|property|Per-step details and messages for history|w
`) },
    { t: "Core generation", url: B + "reference/ai-sdk-core", items: parse(`
generateText()|function|Generate text, with tools and multi-step loops
streamText()|function|Stream text, tool calls and results|w
generateObject() / streamObject()|function|Structured objects (non-agent)
embed() / embedMany() / cosineSimilarity()|function|Embeddings and similarity
rerank()|function|Re-rank documents
generateImage() / transcribe() / generateSpeech()|function|Images, speech-to-text, text-to-speech
ModelMessage|type|System, user, assistant and tool messages|w
smoothStream() / simulateReadableStream()|function|Stream shaping and test streams
`) },
    { t: "Models, providers and middleware", url: B + "ai-sdk-core/provider-management", items: parse(`
AI Gateway|concept|One key, many providers (needs AI_GATEWAY_API_KEY)|w
createProviderRegistry() / customProvider()|function|Register and alias providers
wrapLanguageModel()|function|Apply middleware to a model
extractReasoningMiddleware / simulateStreamingMiddleware / defaultSettingsMiddleware|function|Ready-made middleware
`) },
    { t: "MCP", url: B + "ai-sdk-core/mcp-tools", items: parse(`
createMCPClient()|function|Connect to an MCP server and expose its tools
Transports (stdio, SSE, HTTP)|config|How the MCP client connects
`) },
    { t: "Loop control and approvals", url: B + "agents/loop-control", items: parse(`
Loop control|concept|stopWhen + prepareStep decide each iteration|w
Tool approvals|concept|Approved, denied or user-approval decisions per call
maxOutputTokens|param|Cap output tokens per call|w
`) },
    { t: "AI SDK UI", url: B + "ai-sdk-ui/overview", items: parse(`
useChat()|function|React hook for streaming chat with tool parts
useCompletion() / useObject()|function|Completion and streamed-object hooks
UIMessage|type|Message with typed parts for rendering
toUIMessageStreamResponse() / createUIMessageStream()|function|Serve UI message streams
`) },
    { t: "Telemetry and testing", url: B + "ai-sdk-core/telemetry", items: parse(`
experimental_telemetry|config|OpenTelemetry spans for calls and tools
MockLanguageModelV* (ai/test)|class|Deterministic fake model for tests|w
generateId()|function|Unique ids
`) },
  ],
};
