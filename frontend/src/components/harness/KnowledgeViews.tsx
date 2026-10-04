import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { api, safeLink } from "../../lib/api";
import type { Diagram } from "../../lib/deep/types";
import type { ClaimReview, DfiqTree, Playbook, Scenario } from "../../lib/types";
import { AnimatedDiagram, rich } from "./DeepDive";

function useReduced() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? !!window.matchMedia("(prefers-reduced-motion: reduce)")?.matches
    : false;
}

/** Steps a beat counter from 0 to `n` once, at `ms` per beat; restartable. */
function useSequence(n: number, ms: number, key: unknown) {
  const reduced = useReduced();
  const [beat, setBeat] = useState(reduced ? n : 0);
  const [run, setRun] = useState(0);
  useEffect(() => {
    if (reduced) {
      setBeat(n);
      return;
    }
    setBeat(0);
    const t = setInterval(() => setBeat((b) => (b >= n ? b : b + 1)), ms);
    return () => clearInterval(t);
  }, [n, ms, key, run, reduced]);
  return { beat, replay: () => setRun((r) => r + 1) };
}

const OUTCOME = {
  act: { label: "Act", tone: "rose" },
  allow: { label: "Allow", tone: "green" },
  insufficient: { label: "Insufficient evidence", tone: "amber" },
} as const;

/**
 * The playbook as a decision: each observation's signal drops into the bin the
 * playbook gives it, then the decision and operation light up.
 */
export function PlaybookFlow({ scenario, playbook, readIds }: { scenario: Scenario; playbook?: Playbook; readIds?: number[] }) {
  const obs = scenario.observations;
  const steps = obs.length + 2;
  const { beat, replay } = useSequence(steps, 900, scenario.id);
  if (!playbook || !scenario.decision) return null;
  const bin = (o: Scenario["observations"][number]) =>
    !o.healthy && playbook.required_domains.includes(o.domain)
      ? "gap"
      : playbook.response_signals.includes(o.signal)
        ? "act"
        : playbook.benign_signals.includes(o.signal)
          ? "fine"
          : "other";
  const bins = [
    { id: "act", label: "Response signals", hint: playbook.response_signals.join(", ") },
    { id: "fine", label: "Benign context", hint: playbook.benign_signals.join(", ") },
    { id: "gap", label: "Missing domain", hint: "required: " + playbook.required_domains.join(", ") },
    { id: "other", label: "Not in playbook", hint: "neither signal list" },
  ];
  const out = OUTCOME[scenario.decision.outcome];
  const decided = beat >= obs.length + 1;
  return (
    <figure className="pb" aria-label={`Playbook: ${playbook.title}`}>
      <figcaption>
        <span>
          <b>Playbook</b> {playbook.title}
          <small> · Defense Collective</small>
        </span>
        <button className="hl-icon" aria-label="Replay playbook" onClick={replay}>
          <RefreshCw size={13} />
        </button>
      </figcaption>
      <div className="pb-bins">
        {bins.map((b) => {
          const items = obs.map((o, i) => ({ o, i, id: scenario.evidence_ids[i] })).filter(({ o }) => bin(o) === b.id);
          return (
            <div key={b.id} className={"pb-bin pb-bin-" + b.id + (items.some(({ i }) => i < beat) ? " is-lit" : "")}>
              <header>
                <strong>{b.label}</strong>
                <small>{b.hint}</small>
              </header>
              {items.map(({ o, i, id }) => (
                <span key={i} className={"pb-chip" + (i < beat ? " is-in" : "") + (readIds?.includes(id) ? " is-read" : "")} title={o.detail}>
                  <code>{o.signal}</code>
                  <small>
                    {o.domain}
                    {!o.healthy && " · no data"}
                    {readIds && (readIds.includes(id) ? " · agent read" : " · agent did not read")}
                  </small>
                </span>
              ))}
            </div>
          );
        })}
      </div>
      <div className={"pb-decision pb-" + out.tone + (decided ? " is-on" : "")} aria-live="polite">
        <span className="pb-arrow" aria-hidden="true" />
        <strong>{decided ? out.label : "…"}</strong>
        <span>{decided ? scenario.decision.reason : "Sorting the evidence by the playbook's signals"}</span>
        {scenario.decision.outcome === "act" && <code className={beat >= steps ? "is-on" : ""}>{playbook.operation}</code>}
      </div>
    </figure>
  );
}

const STATUS = {
  flagged: { label: "Unsupported", tone: "rose" },
  unseen: { label: "Cites unseen record", tone: "rose" },
  cited: { label: "Cites returned evidence", tone: "green" },
  unchecked: { label: "Not checked", tone: "muted" },
} as const;

/** Each sentence of the final answer, revealed in turn with its grounding status. */
export function ClaimCheck({ review }: { review: ClaimReview }) {
  const n = review.claims.length;
  const { beat, replay } = useSequence(n, 450, review);
  const why = (i: number) => review.issues.filter((x) => x.claim === i);
  return (
    <section className="cc" aria-label="Claim check">
      <header>
        <strong>Claim check</strong>
        <span className="cc-counts">
          {(Object.keys(STATUS) as (keyof typeof STATUS)[]).map((k) =>
            review.counts[k] ? (
              <span key={k} className={"cc-pill cc-" + STATUS[k].tone}>
                {review.counts[k]} {STATUS[k].label.toLowerCase()}
              </span>
            ) : null,
          )}
        </span>
        <button className="hl-icon" aria-label="Replay claim check" onClick={replay}>
          <RefreshCw size={13} />
        </button>
      </header>
      <ol>
        {review.claims.map((c, i) => (
          <li key={i} className={"cc-claim cc-" + STATUS[c.status].tone + (i < beat ? " is-in" : "")}>
            <span className="cc-status">{STATUS[c.status].label}</span>
            <span className="cc-text">{c.text}</span>
            {why(i).map((x) => (
              <small key={x.code}>{x.message}</small>
            ))}
          </li>
        ))}
      </ol>
      <p className="hl-fine">{review.scope} Ported from Defense Collective's grounding guard.</p>
    </section>
  );
}

/** Fetches and shows the claim check for a finished session. */
export function SessionClaimCheck({ sessionId, ready, nonce }: { sessionId?: string; ready: boolean; nonce: number }) {
  const [review, setReview] = useState<ClaimReview | null>(null);
  useEffect(() => {
    setReview(null);
    if (!sessionId || !ready) return;
    let alive = true;
    void api<{ review: ClaimReview | null }>("/api/grounding?session=" + encodeURIComponent(sessionId))
      .then((r) => alive && setReview(r.review))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [sessionId, ready, nonce]);
  return review && review.claims.length ? <ClaimCheck review={review} /> : null;
}

function treeDiagram(t: DfiqTree): Diagram {
  return {
    kind: "tree",
    root: { t: t.scenario.name, s: t.why, tag: "you" },
    children: t.facets.slice(0, 5).map((f) => ({
      t: f.name.length > 60 ? f.name.slice(0, 57) + "…" : f.name,
      s: "Facet " + f.id + ": a narrower question this collection can help answer.",
      tag: "core" as const,
      children: f.questions.slice(0, 3).map((q) => ({
        t: q.name,
        s: q.approaches.length
          ? `${q.approaches.length} documented approach${q.approaches.length > 1 ? "es" : ""}: ${q.approaches[0].name}.`
          : q.description || "DFIQ lists this question without a documented approach yet.",
        tag: q.approaches.length ? ("tool" as const) : ("state" as const),
      })),
    })),
  };
}

const GROUP_LABEL: Record<string, string> = {
  "IR-2841": "IR-2841 · Identity & credential",
  "IR-2840": "IR-2840 · Process execution",
  "IR-2839": "IR-2839 · Persistence",
  "IR-2838": "IR-2838 · Process access",
  "IR-2837": "IR-2837 · Network & DNS",
  "IR-2836": "IR-2836 · Privilege change",
  "IR-2835": "IR-2835 · File & system",
  "TG-01": "Test ground · identity and cloud",
  "TG-04": "Test ground · network and asset",
  "TG-10": "Test ground · endpoint and network",
};

/** DFIQ investigative questions linked to an evidence collection, as an animated tree plus approaches. */
export function InvestigationTree() {
  const [caseId, setCaseId] = useState("IR-2839"),
    [tree, setTree] = useState<DfiqTree | null>(null),
    [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setTree(null);
    void api<{ tree: DfiqTree | null }>("/api/knowledge/case?case_id=" + encodeURIComponent(caseId))
      .then((r) => alive && setTree(r.tree))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [caseId]);
  const diagram = useMemo(() => (tree ? treeDiagram(tree) : null), [tree]);
  const questions = tree ? tree.facets.flatMap((f) => f.questions.map((q) => ({ ...q, facet: f.name }))) : [];
  return (
    <section className="pg-dfiq" id="pg-dfiq" aria-labelledby="pg-dfiq-title">
      <header className="pg-tg-head">
        <div>
          <p className="dd-eyebrow">What an analyst should ask · DFIQ</p>
          <h3 id="pg-dfiq-title">Investigative questions for each evidence collection</h3>
          <p className="hl-fine">
            Google's Digital Forensics Investigative Questions break an investigation into scenarios, facets, questions and
            concrete approaches. Each SoCHarness collection is linked by hand to the closest facets, with the reason. Agents
            can read the same list with <code>get_playbook("investigative-questions")</code> when skills are on.
          </p>
        </div>
        <label className="pg-select">
          <span>Evidence collection</span>
          <select value={caseId} onChange={(e) => setCaseId(e.target.value)}>
            {Object.entries(GROUP_LABEL).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </header>
      {diagram && tree ? (
        <>
          <div className="pg-dfiq-body">
            <AnimatedDiagram diagram={diagram} label={`DFIQ tree for ${caseId}`} />
            <ol className="pg-questions">
              {questions.map((q) => (
                <li key={q.id} className={q.approaches.length ? "has-approach" : ""}>
                  <button aria-expanded={open === q.id} onClick={() => setOpen(open === q.id ? null : q.id)} disabled={!q.approaches.length}>
                    <code>{q.id}</code>
                    <span>{q.name}</span>
                    <small>{q.approaches.length ? `${q.approaches.length} approach${q.approaches.length > 1 ? "es" : ""}` : "question only"}</small>
                  </button>
                  {open === q.id &&
                    q.approaches.map((a) => (
                      <div key={a.name} className="pg-approach">
                        <strong>{a.name}</strong>
                        {a.description && <p>{rich(a.description.split("\n")[0])}</p>}
                        {!!a.steps?.length && (
                          <ol className="pg-steps">
                            {a.steps.map((s, i) => (
                              <li key={i} style={{ ["--i" as string]: i }}>
                                <span className={"pg-stage pg-stage-" + s.stage}>{s.stage}</span>
                                <span>{s.name}</span>
                                <small>{s.type}</small>
                              </li>
                            ))}
                          </ol>
                        )}
                        {!!a.not_covered?.length && <p className="hl-fine">Not covered: {a.not_covered.slice(0, 2).join(" ")}</p>}
                      </div>
                    ))}
                </li>
              ))}
            </ol>
          </div>
          <p className="hl-fine">
            DFIQ {tree.source.revision.slice(0, 7)}, {tree.source.license}, bundled unmodified with its licence. Reference
            steps are never executed.{" "}
            {safeLink(tree.source.url) && (
              <a href={safeLink(tree.source.url)} target="_blank" rel="noreferrer">
                dfiq <ArrowUpRight size={11} />
              </a>
            )}
          </p>
        </>
      ) : (
        <p className="pg-empty">Loading investigative questions…</p>
      )}
    </section>
  );
}
