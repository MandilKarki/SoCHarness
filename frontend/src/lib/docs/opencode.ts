import { parse, type FrameworkDocs } from "./types";
const B = "https://opencode.ai/docs/";
export const opencodeDocs: FrameworkDocs = {
  source: B + "sdk/",
  checked: "2026-10-03",
  sections: [
    { t: "SDK setup", url: B + "sdk/", items: parse(`
createOpencode()|function|Start a server and a client together
createOpencodeClient()|function|Connect to an existing server|w
createOpencodeServer()|function|Start a standalone server
`) },
    { t: "client.session", url: B + "sdk/", items: parse(`
session.create() / list() / get() / children() / delete() / update()|method|Manage sessions|w
session.prompt()|method|Send a message, optionally with structured output|w
session.command() / session.shell()|method|Run a command or shell
session.abort()|method|Stop a running session|w
session.fork()|method|Branch a session|w
session.share() / unshare()|method|Share control
session.messages() / message()|method|Read conversation history|w
session.revert() / unrevert()|method|Undo or restore actions
session.init()|method|Analyse the codebase and create AGENTS.md
session.summarize()|method|Condense session content
format: json_schema|config|Validated structured output|w
`) },
    { t: "Other client namespaces", url: B + "sdk/", items: parse(`
event.subscribe()|method|Server-sent events stream|w
config.get() / config.providers()|method|Configuration and providers
app.log() / app.agents()|method|Logs and available agents
project.list() / project.current()|method|Projects
file.read() / file.status()|method|Files
find.text() / find.files() / find.symbols()|method|Search
tui.* (appendPrompt, submitPrompt, showToast…)|method|Drive the terminal UI
auth.set()|method|Store provider credentials
global.health() / path.get()|method|Health and paths
`) },
    { t: "Configuring the agent server", url: B + "agents/", items: parse(`
Agents / modes (build, plan…)|concept|Configured agent personas and modes
Tools / custom tools|concept|Built-in and user-defined tools
Permissions|config|Allow, ask or deny per tool (Relay uses deny-all)|w
MCP servers|config|External tool servers
Plugins|concept|Extend the server
Rules (AGENTS.md)|config|Project instructions
LSP / formatters|concept|Language servers and code formatting
Providers / models|config|Model providers and defaults|w
Server|concept|HTTP API that clients drive|w
ACP support|concept|Agent Client Protocol
Share|concept|Shareable session links
`) },
  ],
};
