import { useState } from "react";
import type { Workspace } from "../useWorkspace";
import type { Json } from "../lib/types";
import { api } from "../lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Empty, Field, JsonView, Modal, Section, Status } from "./shared";
export function Lab({ w }: { w: Workspace }) {
  const [dialog, setDialog] = useState<{
      title: string;
      tool: string;
      args: string;
    } | null>(null),
    [result, setResult] = useState<unknown>(null),
    [question, setQuestion] = useState("");
  const a = w.advanced,
    s = w.data?.session;
  const propose = (title: string, tool: string, args: Record<string, Json>) =>
    setDialog({ title, tool, args: JSON.stringify(args, null, 2) });
  if (!a || !s)
    return (
      <Empty title="A workspace for every investigation">
        Create or resume a session to explore plans, memory, human input,
        artifacts, and native checkpoints.
      </Empty>
    );
  const act = (name: string, args: Record<string, Json>) =>
    void w.safe(async () => {
      const r = await w.tool(name, args);
      if (!r.pending_approval) setResult(r);
    });
  return (
    <div className="stack">
      <div className="callout">
        <div className="chips">
          {Object.entries(a.configuration)
            .filter(
              ([k, v]) =>
                typeof v === "boolean" && v && k !== "accept_no_usd_cap",
            )
            .map(([k]) => (
              <Status key={k} tone="good">
                {k.replaceAll("_", " ")}
              </Status>
            ))}
        </div>
        <p>
          Persistent state belongs to this session or case. Writes remain
          approval-gated. Native SDK features are separate from Relay’s shared
          tools.
        </p>
      </div>
      <Section
        title="Human input"
        description="Answer a waiting agent without restarting its run."
      >
        {a.questions.length === 0 && <p className="muted">No questions yet.</p>}
        {a.questions.map((q) => (
          <div className="list-row" key={q.id}>
            <div>
              <Status>{q.status}</Status>
              <h3>{q.question}</h3>
              {q.answer && <p>{q.answer}</p>}
              {q.status === "pending" && (
                <form
                  className="toolbar"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    const answer = String(
                      new FormData(form).get("answer") || "",
                    );
                    void w.safe(async () => {
                      await w.sessionAction("answer", { id: q.id, answer });
                      form.reset();
                    });
                  }}
                >
                  <Input
                    name="answer"
                    aria-label={"Answer: " + q.question}
                    required
                    maxLength={4000}
                  />
                  <Button>Send answer</Button>
                </form>
              )}
            </div>
          </div>
        ))}
        {s.config.runtime === "simulator" && (
          <form
            className="toolbar"
            onSubmit={(e) => {
              e.preventDefault();
              void w.safe(async () => {
                await w.sessionAction("question", { question });
                setQuestion("");
              });
            }}
          >
            <Input
              aria-label="Replay question"
              placeholder="Create a replay question…"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              required
              maxLength={1000}
            />
            <Button variant="outline" disabled={w.busy}>
              Add question
            </Button>
          </form>
        )}
      </Section>
      <div className="lab-grid">
        <Section
          title="Investigation plan"
          action={
            <Button
              variant="outline"
              disabled={w.busy}
              onClick={() =>
                propose("Propose a task", "set_task", {
                  title: "Review supporting evidence",
                  status: "pending",
                })
              }
            >
              Add task
            </Button>
          }
        >
          {!a.tasks.length && (
            <p className="muted">
              Turn your investigation into reviewable steps.
            </p>
          )}
          {a.tasks.map((t) => (
            <div key={t.id} className="list-row">
              <div>
                <strong>{t.title}</strong>
                <small>{t.status}</small>
              </div>
              {t.status !== "done" && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={w.busy}
                  onClick={() =>
                    act("set_task", {
                      id: t.id,
                      title: t.title,
                      status: "done",
                    })
                  }
                >
                  Mark done
                </Button>
              )}
            </div>
          ))}
        </Section>
        <Section
          title="Case memory"
          description="Approved findings, not ground truth."
          action={
            <Button
              variant="outline"
              disabled={w.busy || !s.config.memory}
              onClick={() =>
                propose(
                  "Remember an evidence-linked finding",
                  "remember_finding",
                  {
                    content: "Describe the observation and uncertainty.",
                    evidence_ids: [],
                  },
                )
              }
            >
              Remember
            </Button>
          }
        >
          {!a.memory.length && (
            <p className="muted">
              {s.config.memory
                ? "No approved findings in this case yet."
                : "Enable memory in a new session to retain evidence-linked findings."}
            </p>
          )}
          {a.memory.map((m) => (
            <div className="list-row" key={m.id}>
              <div>
                <p>{m.content}</p>
                <small>
                  Evidence: {m.evidence_ids.map((id) => "#" + id).join(", ")}
                </small>
              </div>
            </div>
          ))}
        </Section>
      </div>
      <Section
        title="Versioned artifacts"
        description="Reports are versioned in SQLite. Restoring a report is not a filesystem rewind."
        action={
          <Button
            variant="outline"
            disabled={w.busy || !s.config.artifacts}
            onClick={() =>
              propose("Propose a report", "write_artifact", {
                name: "handoff.md",
                content:
                  "## Observations\n\n## Evidence\n\n## Uncertainty\n\n## Next steps",
              })
            }
          >
            Write artifact
          </Button>
        }
      >
        {!a.artifacts.length && (
          <p className="muted">No report artifacts in this session.</p>
        )}
        {a.artifacts.map((file) => (
          <div className="list-row" key={file.id}>
            <div>
              <h3>{file.name}</h3>
              <small>{file.versions.length} versions</small>
              <div className="chips">
                {file.versions.slice(1).map((v) => (
                  <Button
                    key={v.id}
                    size="sm"
                    variant="ghost"
                    disabled={w.busy}
                    onClick={() =>
                      propose("Restore artifact version", "restore_artifact", {
                        name: file.name,
                        version: v.id,
                      })
                    }
                  >
                    Restore #{v.id} · {v.chars} chars
                  </Button>
                ))}
              </div>
            </div>
            <Button
              variant="outline"
              onClick={() =>
                void w.safe(async () =>
                  setResult(
                    await api(
                      `/api/sessions/${s.id}/artifact?name=${encodeURIComponent(file.name)}`,
                    ),
                  ),
                )
              }
            >
              Read latest
            </Button>
          </div>
        ))}
      </Section>
      <div className="lab-grid">
        <Section
          title="SOC skills"
          description="Vetted local playbooks; not a claim of native plugin parity."
        >
          {Object.entries(a.playbooks).map(([name, p]) => (
            <div className="list-row" key={name}>
              <strong>{p.title}</strong>
              <Button
                variant="ghost"
                disabled={w.busy || !s.config.skills}
                onClick={() => act("get_playbook", { name })}
              >
                Read skill
              </Button>
            </div>
          ))}
        </Section>
        <Section
          title="Native workspace"
          description={
            a.workspace.enabled
              ? "Scoped SDK files and recorded checkpoints."
              : "Native file workspace is disabled for this session."
          }
        >
          {a.workspace.files.map((f) => (
            <div className="list-row" key={f.name}>
              <div>
                {f.name}
                <small>{f.bytes} bytes</small>
              </div>
              <Button
                variant="ghost"
                onClick={() =>
                  void w.safe(async () =>
                    setResult(
                      await api(
                        `/api/sessions/${s.id}/workspace-file?name=${encodeURIComponent(f.name)}`,
                      ),
                    ),
                  )
                }
              >
                Inspect
              </Button>
            </div>
          ))}
          {a.workspace.checkpoints.map((c) => (
            <div className="list-row" key={c.uuid}>
              <span>Checkpoint #{c.seq}</span>
              <Button
                variant="outline"
                disabled={w.busy}
                onClick={() =>
                  propose("Request native file rewind", "rewind_workspace", {
                    checkpoint_seq: c.seq,
                  })
                }
              >
                Propose rewind
              </Button>
            </div>
          ))}
        </Section>
      </div>
      <Section
        title="Specialist activity"
        action={
          <Button
            variant="outline"
            onClick={() => void w.safe(() => w.exportSession("otel"))}
          >
            Export OTLP JSON
          </Button>
        }
      >
        {w.data?.trace
          .filter((t) => t.kind.startsWith("agent."))
          .map((t) => (
            <details key={t.seq}>
              <summary>
                {t.kind} · #{t.seq}
              </summary>
              <JsonView value={t.payload} />
            </details>
          ))}
        {!w.data?.trace.some((t) => t.kind.startsWith("agent.")) && (
          <p className="muted">
            No specialist activity recorded. Enabling a capability does not
            prove it ran.
          </p>
        )}
      </Section>
      <Modal
        open={!!dialog}
        onClose={() => setDialog(null)}
        title={dialog?.title || "Propose action"}
        description="Review the exact tool arguments. The server validates policy and may request a separate approval."
      >
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void w.safe(async () => {
              if (!dialog) return;
              const args: unknown = JSON.parse(dialog.args);
              if (!args || typeof args !== "object" || Array.isArray(args))
                throw Error("Arguments must be a JSON object.");
              const r = await w.tool(dialog.tool, args as Record<string, Json>);
              setDialog(null);
              if (!r.pending_approval) setResult(r);
            });
          }}
        >
          <Field label="Tool arguments (JSON)">
            <Textarea
              className="code-input"
              rows={12}
              value={dialog?.args || ""}
              onChange={(e) =>
                setDialog((d) => (d ? { ...d, args: e.target.value } : d))
              }
              required
              maxLength={12000}
            />
          </Field>
          <Button disabled={w.busy}>Submit proposal</Button>
        </form>
      </Modal>
      <Modal
        open={result !== null}
        onClose={() => setResult(null)}
        title="Tool result"
        description="Returned by the existing backend. Treat source content as untrusted evidence."
      >
        <JsonView value={result} />
      </Modal>
    </div>
  );
}
