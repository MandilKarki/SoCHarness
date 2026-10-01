# Isolated Python SDK workers

Google ADK 2.10.0, Microsoft Agent Framework core 1.19.0 + OpenAI provider
1.14.4, and OpenHands SDK 1.50.1 share a separate Python 3.12 environment.
OpenHands requires OpenAI 2.x; the main harness uses 3.x. Do not install this
requirements file into the main environment.

From the repository root (replace `bin/python` with `Scripts/python.exe` on Windows):

Windows convenience installer: `./install-extended.ps1 -Python PATH_TO_PYTHON_3_12`
with optional `-HermesPython PATH_TO_PYTHON_3_14`. It installs and runs the offline
contracts; it never changes an existing mismatched Hermes checkout.

```sh
python3.12 -m venv .venv-extended
.venv-extended/bin/python -m pip install -r workers/python-bridge/requirements.txt
.venv-extended/bin/python -m pip check
.venv-extended/bin/python -m unittest discover -s workers/python-bridge -p test_contracts.py -v
```

Hermes requires Python 3.14 and an editable official source checkout; upstream
explicitly does not distribute an ordinary wheel. Do not install a similarly
named PyPI package. The tested source revision is fixed:

```sh
git clone https://github.com/NousResearch/hermes-agent.git work/vendor/hermes-agent
git -C work/vendor/hermes-agent checkout --detach a4bd966aeee27d4e26316d69f2d2355dc5f32c21
python3.14 -m venv .venv-hermes
.venv-hermes/bin/python -m pip install -e ./work/vendor/hermes-agent
.venv-hermes/bin/python -m pip check
.venv-hermes/bin/python -m unittest discover -s workers/python-bridge -p test_hermes.py -v
```

Restart Relay after installation. Interpreters are discovered locally, or set
`RELAY_GOOGLE_ADK_PYTHON`, `RELAY_MICROSOFT_PYTHON`, `RELAY_OPENHANDS_PYTHON` and
`RELAY_HERMES_PYTHON` to absolute interpreter paths. Hermes readiness verifies
the checkout revision; install it with Git available on PATH. Do not switch that
checkout while workers run.

Set `GOOGLE_API_KEY` for Google and `OPENAI_API_KEY` for the other three. Keys stay
server-side. A ChatGPT subscription is not an API credential. Only selected
provider credentials enter each child; ambient cloud credentials, .env files and
personal SDK profiles are not inherited. Tests use fake model transports and
do not verify provider access, billing, model availability or inference quality.

## Implemented boundaries

- Real native agent/tool loops. Google and Microsoft bind each schema separately;
  OpenHands wraps the Relay catalog in one typed custom tool; Hermes registers a
  prefixed private toolset. No host terminal, browser, arbitrary MCP, plugin or
  delegation tools are registered. OpenHands includes only its native FinishTool.
- Google/Microsoft/Hermes text deltas; OpenHands lifecycle events and final text.
- Google and Microsoft typed findings; unsupported flags are rejected server-side.
- Native ADK events/state, Microsoft AgentSession, OpenHands events and Hermes
  message history. Parent SQLite commits only successful results. No resumable
  mid-tool execution, provider-hosted sessions or recovery of native side effects.
- Shared exact-argument approvals, analyst questions, cited notes, plans,
  playbooks and versioned artifacts are Relay tools, not native parity claims.
- Worker termination cancels local execution. Google/Microsoft/OpenHands enforce
  call/iteration and output bounds. Hermes can issue a final-summary request after
  its iteration limit, and can retry provider failures; the parent 180-second
  deadline remains authoritative. No hard USD cap on any of these four.

Private processes/configuration directories are **not an OS security sandbox**.
Do not expose untrusted executable tools. State/log directories are local sensitive
data; include them in retention and backup policy. Hermes may retain native logs
in its isolated SDK home even when a turn fails.

## Deployment and remaining work

The main Dockerfile installs the three Python 3.12 SDKs in `/opt/relay-extended`.
Hermes remains an optional separately installed Python 3.14 runtime; it is not
silently bundled in that image. Supply the verified source/interpreter in a
dedicated image before enabling Hermes in a cloud pilot. The image was built and
76 backend plus six extended SDK tests passed in a network-disabled Linux container.
Hermes' two SDK tests passed on Windows; Linux Hermes acceptance is still outstanding.
Provider-backed and deployment acceptance remain required; no public deployment is made.

Not integrated: Google multi-agent/Vertex/A2A/live media/native services/evals;
Microsoft workflows/Foundry/hosted tools/A2A; OpenHands native sandbox delegation,
token streaming, typed output and checkpoint navigation; Hermes native learning,
skills, messaging gateway, shell/browser, delegation, MCP and compaction.
Those are engineering gaps—not capabilities that merely need an API key.

Official references: [Google](https://google.github.io/adk-docs/),
[Microsoft](https://learn.microsoft.com/en-us/agent-framework/),
[OpenHands](https://docs.openhands.dev/sdk),
[Hermes](https://hermes-agent.nousresearch.com/docs/).
