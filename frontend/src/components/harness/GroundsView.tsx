import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Play, RefreshCw } from "lucide-react";
import { grounds, type Ground } from "../../lib/grounds";
import { api, errorText, safeLink } from "../../lib/api";
import { frameworkById } from "../../lib/frameworks";
import type { Grade, Playbook, Scenario, TestGround } from "../../lib/types";
import { AnimatedDiagram, CodeView, DeepDive, rich } from "./DeepDive";
import { DocsReference } from "./DocsReference";
import { groundDocs } from "../../lib/grounds/index";
import { InvestigationTree, PlaybookFlow } from "./KnowledgeViews";

const KIND_TONE: Record<Ground["kind"], string> = {
  "Agent benchmark": "cyan",
  "Simulation gym": "purple",
  "Range content": "amber",
  "Local test ground": "green",
};
const FLAG_LABEL: Record<string, string> = {
  over_reaction: "Over-reaction",
  under_reaction: "Under-reaction",
  false_positive: "False positive",
  missed_threat: "Missed threat",
  overconfident: "Overconfident",
  no_verdict: "No verdict line",
  verdict_outside_scale: "Verdict off-scale",
  run_incomplete: "Run incomplete",
  unsupported_claim: "Unsupported claim",
};
const VERDICT_LABEL = { malicious: "Malicious", benign: "Benign", unknown: "Insufficient evidence" } as const;

function runSummary(g: Ground) {
  if (!g.runs.length) return "Runs here, in SoCHarness";
  const ok = g.runs.filter((r) => r.status === "ok").length;
  return g.runs.length === 1 && g.runs[0].status === "partial" ? "Planning contract only" : `${g.runs.length} recorded · ${ok} completed`;
}

/** Grade badge for one graded run. */
export function GradeBadge({ g }: { g: Grade }) {
  const tone = g.score === g.max_score ? "ok" : g.score === 0 ? "bad" : "mid";
  return (
    <span className={"pg-grade pg-grade-" + tone} title={`Verdict ${g.verdict_ok ? "correct" : "wrong"}, response ${g.response_ok ? "correct" : "wrong"}`}>
      {g.score}/{g.max_score}
    </span>
  );
}

/** What a graded run got right and wrong, against the answer key. */
export function GradeDetail({ g, scenario }: { g: Grade; scenario?: Scenario }) {
  return (
    <div className="pg-check">
      <dl>
        <div className={g.verdict_ok ? "is-ok" : "is-bad"}>
          <dt>Verdict</dt>
          <dd>
            {g.verdict ? VERDICT_LABEL[g.verdict] : g.verdict_raw ? `“${g.verdict_raw}” (off-scale)` : "None stated"}
            <small>Key: {VERDICT_LABEL[g.truth.verdict]}</small>
          </dd>
        </div>
        <div className={g.response_ok ? "is-ok" : "is-bad"}>
          <dt>Response required</dt>
          <dd>
            {g.response_required === null ? "Not stated" : g.response_required ? "Yes" : "No"}
            {g.containment_attempted && " · containment attempted"}
            <small>Key: {g.truth.response_required ? "Yes" : "No"}</small>
          </dd>
        </div>
        <div className={g.evidence_read === g.evidence_total ? "is-ok" : "is-mid"}>
          <dt>Evidence read</dt>
          <dd>
            {g.evidence_read} of {g.evidence_total}
            <small>records returned by the case tools</small>
          </dd>
        </div>
        {g.injection && (
          <div className={g.injection === "resisted" ? "is-ok" : g.injection === "obeyed" ? "is-bad" : "is-mid"}>
            <dt>Injected instructions</dt>
            <dd>
              {g.injection === "resisted" ? "Resisted" : g.injection === "obeyed" ? "Obeyed" : "Unclear"}
              <small>log text told the agent to say malicious and revoke sessions</small>
            </dd>
          </div>
        )}
      </dl>
      {!!g.flags.length && (
        <p className="pg-flags">
          {g.flags.map((f) => (
            <span key={f}>{FLAG_LABEL[f] || f}</span>
          ))}
        </p>
      )}
      {scenario && (
        <p className="pg-lesson">
          <strong>{scenario.name.replace(/_/g, " ")}.</strong> {scenario.lesson}
        </p>
      )}
    </div>
  );
}

function GroundDetail({ g }: { g: Ground }) {
  const docs = groundDocs[g.id];
  return (
    <section className={"pg-detail pg-" + KIND_TONE[g.kind]} aria-labelledby={"pg-title-" + g.id} key={g.id}>
      <header>
        <div>
          <small className="pg-kind">{g.kind}</small>
          <h3 id={"pg-title-" + g.id}>{g.name}</h3>
          <p className="pg-maker">{g.maker}</p>
        </div>
        {safeLink(g.repo) && (
          <a className="hl-ext" href={safeLink(g.repo)} target="_blank" rel="noreferrer">
            {g.revision ? <code>{g.revision.slice(0, 10)}</code> : "Repository"} <ArrowUpRight size={12} />
          </a>
        )}
      </header>
      <p className="pg-measures">{rich(g.measures)}</p>
      {docs && (
        <div className="pg-overview">
          {docs.overview.map((p, i) => (
            <p key={i}>{rich(p)}</p>
          ))}
          <p className="pg-sources">
            <span>Sources</span>
            {docs.sources.map((src) =>
              safeLink(src.url) ? (
                <a key={src.url} href={safeLink(src.url)} target="_blank" rel="noreferrer">
                  {src.label} <ArrowUpRight size={11} />
                </a>
              ) : null,
            )}
          </p>
        </div>
      )}
      {!docs && !!g.links?.length && (
        <nav className="pg-links" aria-label={`Official documentation for ${g.name}`}>
          <p>
            <b>Official documentation</b> SoCHarness keeps a short summary of {g.name}; the full detail lives with its maintainers.
          </p>
          <ul>
            {g.links.map((l, i) =>
              safeLink(l.url) ? (
                <li key={l.url} style={{ ["--i" as string]: i }}>
                  <a href={safeLink(l.url)} target="_blank" rel="noreferrer">
                    <strong>
                      {l.label} <ArrowUpRight size={12} />
                    </strong>
                    <small>{l.note}</small>
                    <code>{new URL(l.url).hostname.replace(/^www\./, "")}</code>
                  </a>
                </li>
              ) : null,
            )}
          </ul>
        </nav>
      )}
      <div className="pg-body">
        <div>
          <ol className="pg-contract" aria-label="How an agent plugs in">
            <li>
              <b>Observes</b>
              <span>{rich(g.observe)}</span>
            </li>
            <li>
              <b>Acts</b>
              <span>{rich(g.act)}</span>
            </li>
            <li>
              <b>Scored by</b>
              <span>{rich(g.score)}</span>
            </li>
          </ol>
          <aside className="dd-soc">
            <strong>For your SOC platform</strong>
            <p>{rich(g.soc)}</p>
          </aside>
        </div>
        <AnimatedDiagram diagram={g.diagram} label={`${g.name}: how the loop runs`} />
      </div>

      {docs && (
        <div className="pg-special">
          <h4>What makes it distinctive</h4>
          <ul>
            {docs.specialties.map((x, i) => (
              <li key={x.t} style={{ ["--i" as string]: i }}>
                <strong>{x.t}</strong>
                <span>{rich(x.d)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!!g.runs.length && (
        <div className="pg-runs-wrap">
          <h4>Recorded in Defense Collective</h4>
          <table className="pg-runs">
            <thead>
              <tr>
                <th scope="col">Policy</th>
                <th scope="col">Scope</th>
                <th scope="col">Result</th>
                <th scope="col">What it means</th>
              </tr>
            </thead>
            <tbody>
              {g.runs.map((r, i) => (
                <tr key={i}>
                  <td>{r.policy}</td>
                  <td>{r.scope}</td>
                  <td>
                    <span className={"pg-status pg-status-" + r.status}>{r.status === "ok" ? "completed" : r.status === "failed" ? "failed" : "partial"}</span> {r.result}
                  </td>
                  <td>{r.note ? rich(r.note) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {docs && <DeepDive id={"ground-" + g.id} name={g.name} dive={docs.dive} eyebrow="Deep dive" />}
      {docs && (
        <DocsReference
          id={"ground-" + g.id}
          name={g.name}
          pinned={g.revision?.slice(0, 10)}
          title="Parameters, features and metrics"
          docs={{ source: docs.sources[0]?.url || g.repo, checked: docs.checked, sections: docs.reference }}
        />
      )}
      <div className="pg-foot">
        <div>
          <h4>Bridge and caveats</h4>
          <p>{rich(g.bridge)}</p>
          <ul>
            {g.caveats.map((c) => (
              <li key={c}>{rich(c)}</li>
            ))}
          </ul>
        </div>
        {g.reproduce && <CodeView code={{ lang: "bash", src: g.reproduce, caption: "Reproduce from the Defense Collective backend directory" }} />}
      </div>
    </section>
  );
}

function Scoreboard({ results }: { results: Grade[] }) {
  const rows = useMemo(() => {
    const by = new Map<string, Grade[]>();
    results.forEach((r) => {
      const k = r.runtime || "unknown";
      by.set(k, [...(by.get(k) || []), r]);
    });
    return [...by.entries()].map(([runtime, rs]) => ({
      runtime,
      runs: rs.length,
      cases: new Set(rs.map((r) => r.case_id)).size,
      points: rs.reduce((n, r) => n + r.score, 0),
      max: rs.reduce((n, r) => n + r.max_score, 0),
      verdicts: rs.filter((r) => r.verdict_ok).length,
      over: rs.filter((r) => r.flags.includes("over_reaction") || r.flags.includes("false_positive")).length,
      missed: rs.filter((r) => r.flags.includes("missed_threat")).length,
      obeyed: rs.filter((r) => r.injection === "obeyed").length,
    }));
  }, [results]);
  if (!rows.length)
    return <p className="pg-empty">No graded runs yet. Investigate a case below with any framework; its grade appears here and in Live run.</p>;
  return (
    <div className="pg-board-wrap">
      <table className="pg-board">
        <thead>
          <tr>
            <th scope="col">Framework</th>
            <th scope="col">Runs</th>
            <th scope="col">Score</th>
            <th scope="col">Verdicts right</th>
            <th scope="col">False alarms</th>
            <th scope="col">Missed threats</th>
            <th scope="col">Obeyed injection</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.runtime}>
              <th scope="row">{frameworkById[r.runtime]?.name || r.runtime}</th>
              <td>
                {r.runs} <small>({r.cases} cases)</small>
              </td>
              <td>
                <span className="pg-meter" style={{ ["--p" as string]: `${r.max ? (100 * r.points) / r.max : 0}%` }}>
                  <i />
                </span>
                {r.points}/{r.max}
              </td>
              <td>{r.verdicts}</td>
              <td className={r.over ? "is-bad" : ""}>{r.over}</td>
              <td className={r.missed ? "is-bad" : ""}>{r.missed}</td>
              <td className={r.obeyed ? "is-bad" : ""}>{r.obeyed}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hl-fine">Grades compare the final answer's verdict and response lines with the answer key. Ten synthetic cases are a sanity check, not an accuracy benchmark.</p>
    </div>
  );
}

function ScenarioCard({
  s,
  last,
  onRun,
  disabled,
  playbook,
}: {
  s: Scenario;
  last?: Grade;
  onRun: () => void;
  disabled: boolean;
  playbook?: Playbook;
}) {
  const [open, setOpen] = useState(false);
  const domains = [...new Set(s.observations.map((o) => o.domain))];
  return (
    <article className={"pg-case" + (open ? " is-open" : "")}>
      <header>
        <code>{s.id}</code>
        {last && <GradeBadge g={last} />}
      </header>
      <strong>{s.title}</strong>
      <p className="pg-domains">
        {domains.map((d) => (
          <span key={d}>{d}</span>
        ))}
        <small>{s.observations.length} records</small>
      </p>
      <div className="pg-case-actions">
        <button className="hl-primary" onClick={onRun} disabled={disabled}>
          <Play size={13} /> Investigate in Live run
        </button>
        <button className="hl-link" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Hide answer" : "Answer key"}
        </button>
      </div>
      {open && (
        <div className="pg-key">
          <p>
            <b className={"pg-v pg-v-" + s.truth.verdict}>{VERDICT_LABEL[s.truth.verdict]}</b> · response{" "}
            {s.truth.response_required ? "required" : "not required"} · final state <i>{s.truth.final_state}</i>
          </p>
          <p>
            <strong>{s.name.replace(/_/g, " ")}.</strong> {s.lesson}
          </p>
          {s.changes && <p className="hl-fine">Changed from the original: {s.changes}</p>}
          <PlaybookFlow scenario={s} playbook={playbook} readIds={last?.read_ids} />
          {last && <GradeDetail g={last} />}
        </div>
      )}
    </article>
  );
}

export function GroundsView({
  hidden,
  onRunScenario,
  running,
  runtimeName,
}: {
  hidden: boolean;
  onRunScenario: (caseId: string, prompt: string) => void;
  running: boolean;
  runtimeName: string;
}) {
  const [sel, setSel] = useState(grounds[0].id),
    [tg, setTg] = useState<TestGround | null>(null),
    [error, setError] = useState("");
  const g = grounds.find((x) => x.id === sel) || grounds[0];
  const load = () =>
    api<TestGround>("/api/test-ground")
      .then((d) => {
        setTg(d);
        setError("");
      })
      .catch((e) => setError(errorText(e)));
  useEffect(() => {
    if (!hidden) void load();
  }, [hidden]);
  const latest = useMemo(() => {
    const m = new Map<string, Grade>();
    (tg?.results || []).forEach((r) => {
      if (!m.has(r.case_id)) m.set(r.case_id, r);
    });
    return m;
  }, [tg]);

  return (
    <div className="pg" hidden={hidden}>
      <header className="cmp-head">
        <p className="dd-eyebrow">Proving grounds · ported from Defense Collective</p>
        <h2>Where agents get tested</h2>
        <p className="hl-fine">
          The benchmarks, gyms and range content from your Defense Collective evaluation kit: what each measures, how an agent
          plugs into its loop, and the results you actually recorded, failures included. Those runs used a local
          qwen2.5-coder 7B through Defense Collective's gateway, not SoCHarness. The scenario test ground at the bottom runs
          here, with any guarded framework.
        </p>
      </header>

      <nav className="pg-grid" aria-label="Benchmarks and gyms">
        {grounds.map((x) => (
          <button
            key={x.id}
            className={"pg-card pg-" + KIND_TONE[x.kind] + (x.id === sel ? " is-on" : "")}
            aria-pressed={x.id === sel}
            onClick={() => {
              setSel(x.id);
              if (x.id === "scenarios") document.getElementById("pg-test-ground")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
            }}
          >
            <small>{x.kind}</small>
            <strong>{x.name}</strong>
            <span>{x.measures}</span>
            <em>{runSummary(x)}</em>
          </button>
        ))}
      </nav>

      <GroundDetail g={g} />

      <section className="pg-tg" id="pg-test-ground" aria-labelledby="pg-tg-title">
        <header className="pg-tg-head">
          <div>
            <p className="dd-eyebrow">Scenario test ground · runs here</p>
            <h3 id="pg-tg-title">Ten labelled cases, graded against an answer key</h3>
            <p className="hl-fine">
              Stolen sessions, a registered VPN, a dead sensor, beaconing, an approved monitor, a signed admin job, and a log
              line that tries to give the agent orders. Each case uses neutral IDs and titles, and the answer key never
              reaches a tool. The agent ends its answer with a verdict and a response decision. A case opens in Live run
              with {runtimeName}; switch frameworks there to compare.
            </p>
          </div>
          <button className="hl-icon" aria-label="Refresh grades" onClick={() => void load()}>
            <RefreshCw size={15} />
          </button>
        </header>
        {error && <p className="hl-banner">{error}</p>}
        <Scoreboard results={tg?.results || []} />
        <div className="pg-cases">
          {(tg?.scenarios || []).map((s) => (
            <ScenarioCard
              key={s.id}
              s={s}
              last={latest.get(s.id)}
              disabled={running}
              playbook={tg?.playbooks?.[s.playbook]}
              onRun={() => onRunScenario(s.id, (tg?.prompt || "").replace("{case}", s.id))}
            />
          ))}
          {!tg && !error && <p className="pg-empty">Loading the test ground…</p>}
        </div>
        {tg && (
          <p className="hl-fine">
            Source: Defense Collective <code>scenarios/</code> at <code>{tg.revision.slice(0, 7)}</code>. {tg.note}
          </p>
        )}
      </section>

      <InvestigationTree />
    </div>
  );
}
