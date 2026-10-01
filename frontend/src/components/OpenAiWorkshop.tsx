import { useRef, useState } from "react";
import { ArrowRight, Check, Square } from "lucide-react";
import type { Workspace } from "../useWorkspace";
import { errorText } from "../lib/api";
import {
  currentRun,
  missions,
  observations,
  workshopConfig,
  type Mission,
} from "../lib/openaiWorkshop";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { JsonView } from "./shared";
import "./openai-workshop.css";

export function OpenAiWorkshop({ w }: { w: Workspace }) {
  const [mission, setMission] = useState<Mission>("loop");
  const [prompt, setPrompt] = useState<string>(missions[0].prompt);
  const [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  const [focus, setFocus] = useState("result"),
    [answer, setAnswer] = useState("");
  const lock = useRef(false);
  const lesson = missions.find((m) => m.id === mission)!;
  const adapter = w.adapters?.find((a) => a.id === "openai"),
    trial = w.deployment?.trial;
  const session = w.data?.session,
    isOpenai = session?.config.runtime === "openai";
  const trace = isOpenai ? w.data?.trace || [] : [],
    run = currentRun(trace);
  const result = run.find((t) => t.kind === "sdk.result"),
    final = run.find((t) => t.kind === "message.assistant");
  const failed = [...run]
    .reverse()
    .find((t) => ["run.failed", "run.cancelled"].includes(t.kind));
  const complete = run.some((t) => t.kind === "run.completed"),
    toolResult = run.some((t) => t.kind === "tool.result");
  const resumed = run.some(
    (t) =>
      t.kind === "adapter.lifecycle" && t.payload.event === "session.resumed",
  );
  const configMatches =
    isOpenai &&
    session.config.model === adapter?.default_model &&
    session.config.permission === "read_only" &&
    session.config.max_turns === 3 &&
    session.config.max_output_tokens === 700 &&
    session.config.structured_output === (mission === "structured") &&
    !session.config.disabled_tools.includes("query_case_evidence") &&
    (w.tools || []).every(
      (t) =>
        t.name === "query_case_evidence" ||
        session.config.disabled_tools.includes(t.name),
    ) &&
    !session.config.memory &&
    !session.config.skills &&
    !session.config.artifacts &&
    !session.config.specialists &&
    !session.config.file_workspace;
  const ready =
    !!adapter?.available &&
    !!adapter.trial_guard &&
    !!trial?.enabled &&
    !trial.blocked;
  const canContinue =
    configMatches && trace.some((t) => t.kind === "run.completed");
  const working = pending || w.busy;
  const selected = observations.find((o) => o.id === focus)!;
  const receipts = run.filter((t) => selected.kinds.includes(t.kind));
  const settled = run
    .filter((t) => t.kind === "budget.settled")
    .reduce((sum, t) => sum + Number(t.payload.cost_usd || 0), 0);
  const recent = w.sessions?.find(
    (s) =>
      s.case_id === w.caseId &&
      s.config.runtime === "openai" &&
      s.id !== session?.id,
  );
  const exerciseObserved =
    complete &&
    (mission === "continuity"
      ? resumed
      : mission === "structured"
        ? !!result?.payload.structured_output && toolResult
        : toolResult);
  async function act(action: () => Promise<unknown>) {
    if (lock.current || w.busy) return;
    lock.current = true;
    setPending(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(errorText(e));
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  function choose(value: Mission) {
    setMission(value);
    setPrompt(missions.find((m) => m.id === value)!.prompt);
    setError("");
    setAnswer("");
  }
  return (
    <section className="openai-workshop" aria-label="Guided OpenAI workshop">
      <div className="workshop-heading">
        <span className="eyebrow">OPENAI AGENTS · TRAINING ROOM</span>
        <label className="workshop-lesson-picker">
          Lesson
          <select
            aria-label="OpenAI lesson"
            value={mission}
            disabled={working}
            onChange={(e) => choose(e.target.value as Mission)}
          >
            {missions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="workshop-brief">
        <span className="workshop-kicker">
          NORTHSTAR LOGISTICS / YOUR FIRST SHIFT
        </span>
        <h2>
          {mission === "loop"
            ? "Is this worth escalating?"
            : mission === "continuity"
              ? "Ask a better follow-up."
              : "Write a useful handover."}
        </h2>
        <p>
          You’re the on-call security analyst at a fictional delivery company.
          Maya, your SOC lead, asks you to review a small set of records before
          deciding what needs a closer look.
        </p>
        <blockquote>
          {mission === "loop"
            ? "“Ask the assistant to read three records. Tell me what we actually know—and what we don’t.”"
            : mission === "continuity"
              ? "“Use the evidence we already have. What’s one observation, and what is still uncertain?”"
              : "“Give the next shift a structured handover: observations, evidence IDs, hypotheses and next steps.”"}
        </blockquote>
        <small>
          Fictional story · existing benchmark evidence · no live company or
          sensors.
        </small>
      </div>
      <div className="workshop-task">
        <span className="workshop-kicker">YOUR TASK</span>
        <p>{lesson.goal}</p>
        {!configMatches ? (
          <>
            <Button
              disabled={
                working || !ready || !w.caseId || mission === "continuity"
              }
              onClick={() =>
                void act(() =>
                  w.newSession(
                    workshopConfig(adapter!.default_model, mission, w.tools),
                  ),
                )
              }
            >
              {pending ? "Preparing…" : "Start exercise"}
              <ArrowRight size={15} />
            </Button>
            <small>
              {mission === "continuity"
                ? "Finish lesson 1 first, then continue its same session."
                : "Creates a safe practice session. No AI credit used yet."}
            </small>
          </>
        ) : (
          <>
            <Button
              disabled={
                working ||
                !ready ||
                !prompt.trim() ||
                (mission === "continuity" && !canContinue)
              }
              onClick={() =>
                void act(async () => {
                  setFocus("result");
                  setAnswer("");
                  await w.send(prompt.trim());
                })
              }
            >
              {working
                ? "Working…"
                : mission === "loop"
                  ? "Read three records"
                  : mission === "continuity"
                    ? "Ask the follow-up"
                    : "Create the handover"}
              <ArrowRight size={15} />
            </Button>
            <small>
              Calls OpenAI · read-only · shared $5 allowance · no automatic
              retry.
            </small>
          </>
        )}
        {w.busy && isOpenai && (
          <Button
            variant="outline"
            onClick={() => void w.safe(() => w.sessionAction("cancel"))}
          >
            <Square size={13} /> Stop
          </Button>
        )}
        {!ready && (
          <div className="workshop-warning" role="status">
            <p>
              {!adapter
                ? "Checking whether OpenAI is ready…"
                : !adapter.available
                  ? adapter.detail
                  : trial?.blocked
                    ? "Your allowance is blocked or expired. Check Budget & setup before running."
                    : "The shared spending guard is unavailable. This exercise will not run uncapped."}
            </p>
            <Button
              variant="ghost"
              size="sm"
              disabled={working}
              onClick={() => void act(w.refreshRegistry)}
            >
              Check again
            </Button>
          </div>
        )}
      </div>
      <details className="workshop-disclosure">
        <summary>Meet the company and your team</summary>
        <div className="workshop-world">
          <div>
            <strong>The environment</strong>
            <p>
              Staff laptops, a sign-in service and a warehouse network. In a
              real SOC, endpoint, identity and network sensors send records to
              an evidence store.
            </p>
          </div>
          <div>
            <strong>Your team</strong>
            <p>
              You investigate. Maya reviews escalation. IT handles endpoint
              changes. The identity team handles account issues. These are story
              roles, not autonomous agents.
            </p>
          </div>
          <div>
            <strong>Your assistant</strong>
            <p>
              OpenAI proposes a tool call. Relay’s server reads the selected
              records. The model summarizes them; you check its claims. Nothing
              here isolates a laptop or disables an account.
            </p>
          </div>
        </div>
        <p>
          The story explains the workflow. Records keep their original IDs and
          contents; not every sensor type is present in every case.
        </p>
      </details>
      {error && (
        <div className="workshop-error" role="alert">
          <strong>We couldn’t start this step</strong>
          <p>{error}</p>
          <small>No automatic retry was made.</small>
        </div>
      )}
      {failed && (
        <div className="workshop-error" role="alert">
          <strong>This run stopped</strong>
          <p>{String(failed.payload.message || failed.kind)}</p>
          <small>
            {String(failed.payload.message).includes("limit must be")
              ? "The old run asked for too many records. The updated tool contract limits queries to 1–25 and allows bounded correction. This historical failure remains in the audit."
              : "Inspect What happened below before spending credit on another run."}
          </small>
        </div>
      )}
      {run.length > 0 && (
        <section className="workshop-results" aria-label="Exercise results">
          <div className="workshop-result-title">
            <h3>
              {failed
                ? "What we can inspect"
                : complete
                  ? "Your assistant’s findings"
                  : "Following the investigation"}
            </h3>
            <small aria-live="polite">
              {failed
                ? "Stopped"
                : complete
                  ? "Complete"
                  : working
                    ? "Running"
                    : "No completion recorded"}
            </small>
          </div>
          <ol
            className="workshop-flow"
            aria-label="Recorded investigation stages"
          >
            {[
              {
                label: "Task received",
                done: run.some((t) => t.kind === "message.user"),
              },
              { label: "Evidence returned", done: toolResult },
              { label: "Answer ready", done: !!final },
            ].map((s) => (
              <li key={s.label} data-done={s.done}>
                {s.done ? (
                  <Check size={14} />
                ) : (
                  <span className="workshop-dot" />
                )}
                {s.label}
              </li>
            ))}
          </ol>
          {mission === "continuity" && (
            <small>
              This lesson reuses previous evidence; a new evidence query is not
              expected.
            </small>
          )}
          {final && (
            <p className="workshop-answer">
              {String(final.payload.text || "")}
            </p>
          )}
          <p className="workshop-budget">
            This run: ${settled.toFixed(6)} settled estimate. Unresolved holds
            are separate.
          </p>
          <details className="workshop-disclosure">
            <summary>What happened under the hood?</summary>
            <p>
              These are recorded events, not a simulated animation. Select a
              step to connect the software action to its SDK concept.
            </p>
            <div className="workshop-receipts">
              {observations.map((o) => {
                const n = run.filter((t) => o.kinds.includes(t.kind)).length;
                return (
                  <button
                    key={o.id}
                    aria-pressed={focus === o.id}
                    onClick={() => setFocus(o.id)}
                  >
                    {o.title}
                    <small>{n ? n + " recorded" : "Not observed"}</small>
                  </button>
                );
              })}
            </div>
            <h4>{selected.title}</h4>
            <p>{selected.why}</p>
            <code>{selected.code}</code>
            <small>Abbreviated implementation excerpt.</small>
            <div className="workshop-raw">
              {receipts.length ? (
                receipts.map((t) => (
                  <details key={t.seq}>
                    <summary>
                      #{t.seq} · {t.kind}
                    </summary>
                    <JsonView value={t.payload} />
                  </details>
                ))
              ) : (
                <p>
                  No matching event in this run. Missing evidence is not a
                  completed step.
                </p>
              )}
            </div>
          </details>
        </section>
      )}
      {complete && (
        <section className="workshop-mastery">
          <h3>One quick check</h3>
          <p>
            Who actually reads the records when the model asks for evidence?
          </p>
          <div className="workshop-actions">
            {["The model itself", "Relay's server-side tool"].map((a) => (
              <Button
                variant={answer === a ? "default" : "outline"}
                key={a}
                onClick={() => setAnswer(a)}
              >
                {a}
              </Button>
            ))}
          </div>
          {answer && (
            <p>
              {answer === "Relay's server-side tool"
                ? "Exactly. The model asks; the SDK routes the request; Relay validates and reads the records. The result goes back to the model so it can answer."
                : "The model chooses the request, but it cannot read the database itself. Relay’s server-side tool does that under the case’s read-only policy."}
            </p>
          )}
          {exerciseObserved && answer === "Relay's server-side tool" && (
            <p className="workshop-progress">
              <Check size={15} /> Exercise observed. Next:{" "}
              {mission === "loop"
                ? "choose lesson 2 to reuse this evidence in a follow-up."
                : mission === "continuity"
                  ? "choose lesson 3 to produce a typed handover."
                  : "review the handover’s claims against the original records."}
            </p>
          )}
        </section>
      )}
      <details className="workshop-disclosure">
        <summary>Budget & setup</summary>
        <p>
          {trial?.remaining_usd === undefined
            ? "Allowance loading…"
            : "$" +
              trial.remaining_usd.toFixed(4) +
              " spendable remaining"}{" "}
          · {adapter?.default_model || "Model loading…"}
        </p>
        <p>
          One evidence tool enabled. At most 3 model turns and 700 output tokens
          per request. Each request reserves $0.10 before settlement. Preparing
          a session is free; running and repeating a task uses credit.
        </p>
        <label>
          Evidence set
          <select
            aria-label="OpenAI exercise case"
            value={w.caseId}
            disabled={working}
            onChange={(e) => {
              w.selectCase(e.target.value);
              w.setView("sdk-lab");
              setError("");
            }}
          >
            {w.cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id} · {c.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Task sent to OpenAI
          <Textarea
            aria-label="OpenAI exercise prompt"
            value={prompt}
            disabled={working}
            maxLength={12000}
            rows={5}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </label>
        {isOpenai && <small>Selected session: {session.id}</small>}
        <div className="workshop-actions">
          {recent && (
            <Button
              variant="outline"
              disabled={working}
              onClick={() => void act(() => w.loadSession(recent))}
            >
              Inspect previous OpenAI session
            </Button>
          )}
          {configMatches && mission !== "continuity" && (
            <Button
              variant="outline"
              disabled={working || !ready}
              onClick={() =>
                void act(() =>
                  w.newSession(
                    workshopConfig(adapter!.default_model, mission, w.tools),
                  ),
                )
              }
            >
              Start a fresh session
            </Button>
          )}
        </div>
      </details>
      <details className="workshop-disclosure">
        <summary>The OpenAI learning path</summary>
        <p>
          One concept at a time. Available exercises are not a claim that every
          upstream feature is integrated.
        </p>
        <ol>
          <li>
            <strong>Agent + Runner + tools:</strong> who decides, who executes,
            and how the loop ends. Lesson 1.
          </li>
          <li>
            <strong>Context + sessions:</strong> what the model remembers and
            what a new run costs. Lesson 2.
          </li>
          <li>
            <strong>Structured output:</strong> a valid schema is not proof of a
            true finding. Lesson 3.
          </li>
          <li>
            <strong>Streaming + observability:</strong> inspect actual events,
            token usage and errors under each result.
          </li>
          <li>
            <strong>Safety + control:</strong> tool validation, read-only
            permissions, bounded recovery and Stop are active here.
            Human-approval exercises come next; Relay policy is not SDK-native
            guardrails.
          </li>
          <li>
            <strong>Evaluation:</strong> test cited IDs, supported claims and
            tool behavior against a repeatable case. A successful API call alone
            proves neither accuracy nor mastery.
          </li>
          <li>
            <strong>Advanced orchestration:</strong> native handoffs, agents as
            tools, SDK guardrails, native approval interrupts, external MCP and
            hosted tracing need separate implementation and exercises. Not
            enabled by this room.
          </li>
        </ol>
        <a
          href="https://github.com/MandilKarki/SoCHarness/blob/main/services/adapters/openai_runtime.py"
          target="_blank"
          rel="noreferrer"
        >
          Read the OpenAI adapter ↗
        </a>
      </details>
    </section>
  );
}
