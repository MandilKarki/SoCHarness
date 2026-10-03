import { parse, type FrameworkDocs } from "./types";
const B = "https://hermes-agent.nousresearch.com/docs/";
export const hermesDocs: FrameworkDocs = {
  source: B,
  checked: "2026-10-03",
  sections: [
    { t: "Agent core", url: B + "developer-guide/architecture", items: parse(`
AIAgent|class|The autonomous agent and its conversation loop|w
run_conversation()|method|Run a full conversation turn loop|w
stream_delta_callback|param|Receive streamed output deltas|w
max_iterations|config|Bound the loop (a final summary call may follow)|w
Providers and models|config|OpenAI-compatible endpoints, Nous Portal and others|w
Profiles|config|Isolated settings per user or environment|w
Context compression|technique|Compress long conversations
`) },
    { t: "Tools and toolsets", url: B + "user-guide/features/tools", items: parse(`
Toolsets|concept|Named groups of tools enabled together|w
Built-in tools (60+)|tool|Web, code, files, images, TTS, vision and more
Custom tool registration|technique|Register your own tools (Relay registers a private, prefixed set)|w
MCP|concept|Connect Model Context Protocol servers
Plugins|concept|Extend Hermes with plugins
`) },
    { t: "Learning loop", url: B + "user-guide/features/skills", items: parse(`
Skills|concept|Procedural memory the agent writes and refines (agentskills.io format)
Skills Hub|concept|Community skill catalogue
Memory system|concept|Persistent, agent-curated memory across sessions
MEMORY.md / USER.md|config|Agent memory and user model files
Session search (FTS5)|technique|Full-text recall with LLM summarisation
Cross-session user modelling|concept|Builds a model of the user over time
`) },
    { t: "Context and personality", url: B + "user-guide/features/context-files", items: parse(`
Context files|config|Project files that shape every conversation
SOUL.md (personality)|config|Global voice and persona
`) },
    { t: "Execution environments", url: B + "user-guide/configuration", items: parse(`
Terminal backends|concept|Local, Docker, SSH, Modal, Daytona, Singularity, Vercel
Subagents / delegation|technique|Spawn isolated subagents for parallel work
Scheduling (cron)|concept|Run tasks on a schedule with delivery to platforms
Batch processing / research mode|concept|Trajectory export and RL training
`) },
    { t: "Interfaces", url: B + "user-guide/cli", items: parse(`
CLI|cli|Interactive terminal interface and commands
Messaging gateways|concept|20+ platforms (Telegram, Discord, Slack…) from one gateway
Bot mode|concept|Named bots with their own model, memory and skills
Voice mode|concept|Real-time voice interaction
Security|concept|Approval and sandboxing guidance
`) },
  ],
};
