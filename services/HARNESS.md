# Maintained harness

The current implementation is engine.py, store.py, and claude_runtime.py, served by app.py.

The loop is: persist user message, select runtime, invoke case-scoped tools, record the result, persist a checkpoint, and complete the run. Tool policy is enforced in Engine.call, not merely in a model prompt. A pending approval does not execute a tool. Engine.approve consumes the exact stored arguments once.

ClaudeSDKClient owns the real model/tool loop. The app records SDK messages and hooks and stores the SDK session ID for resume. Local compaction resets that SDK continuation and retains the latest checkpoint. Branching creates a new application session, not a filesystem rewind.

Deterministic replay is not Claude. The real SDK contract test uses a fake transport, not a model call. See the project README for the verified feature boundary and live credentials requirement.

Advanced tools use advanced.py for case memory, tasks and versioned reports. Async approval and analyst-input waits let the current SDK turn resume with the stored receipt. Native workspace operations use workspace.py, with flat text-file paths and write approvals. Native SDK checkpoint rewind is a separate, analyst-only operation after the active run stops; it is contract-tested but not live-verified.

The earlier harness.py is preserved as a historical prototype; the current server does not import it.
# Multi-SDK extension

The runtime allowlist lives in adapters/registry.py. PydanticAI and Deep Agents run in Python; Pi, Vercel and OpenCode use workers/agent-bridge with a private NDJSON subprocess protocol. Shared definitions and dispatch enforce the case policy before any SDK tool executes. The Frameworks tab exposes installation/configuration separately from live verification. See SDK_COVERAGE.md for native feature boundaries and remaining work.
