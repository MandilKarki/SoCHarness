import { ArrowLeft, ArrowUpRight, Check, ChevronLeft, ChevronRight, Lock, Play } from "lucide-react";
import type { Adapter, Inventory } from "../../lib/types";
import { frameworks, frameworkById, isRealApi, type FrameworkProfile } from "../../lib/frameworks";
import { safeLink } from "../../lib/api";
import { FwIcon, Scene } from "./FrameworkArt";
import { Glyph, Legend, Section, cellText } from "./shared";
import { DocsReference } from "./DocsReference";
import { Blueprint } from "./Blueprint";
import { DeepDive } from "./DeepDive";
import { deepDives } from "../../lib/deep";
import { frameworkDocs } from "../../lib/docs";

export interface Readiness {
  runnable: boolean;
  label: string;
  tone: "live" | "key" | "guard" | "off";
  checks: { ok: boolean; label: string; detail: string }[];
}
/** Derived only from the server's adapter catalog; nothing is assumed client-side. */
export function readiness(id: string, adapter: Adapter | undefined, inventory: Inventory | null): Readiness {
  const fw = inventory?.frameworks.find((f) => f.id === id);
  const key = adapter?.key || fw?.credential || "provider key";
  const detail = adapter?.detail || "";
  const installed = !!adapter && adapter.installed !== false;
  const keySet = !!adapter && !detail.includes("Set server-side");
  const guarded = !!adapter?.trial_guard;
  const enabled = adapter?.enabled !== false;
  const runnable = !!adapter?.available && guarded;
  const verified = !!fw?.live_evidence;
  const checks = [
    {
      ok: installed,
      label: "Adapter installed on the server",
      detail: installed ? `Version ${adapter?.version || "unknown"}` : adapter ? "Install the pinned SDK or worker (see services/SDK_COVERAGE.md)." : "Waiting for the adapter catalog…",
    },
    {
      ok: keySet,
      label: id === "opencode" ? "OpenCode server configured" : `${key} set on the server`,
      detail: keySet
        ? "Configured server-side; never sent to the browser."
        : id === "opencode"
          ? "Run a dedicated deny-all OpenCode server and set RELAY_OPENCODE_URL as a server secret."
          : `Add ${key} as a server secret (for example with fly secrets set). Never paste it into the browser or chat.`,
    },
    {
      ok: guarded,
      label: "Covered by the spending guard",
      detail: guarded
        ? "Each call reserves budget from the shared allowance before it runs."
        : "While the $5 trial is active, only guarded adapters may call a model. This one needs a reservation ledger for its provider first.",
    },
    { ok: enabled, label: "Enabled switch", detail: enabled ? "On" : "Turned off for this installation." },
    { ok: verified, label: "Live-verified", detail: verified ? "Recorded live acceptance evidence exists." : "Only contract-tested with fake model transports so far." },
  ];
  const tone: Readiness["tone"] = runnable ? "live" : !installed || !enabled ? "off" : !keySet ? "key" : "guard";
  const label = runnable
    ? "Runs live"
    : !adapter
      ? "Checking…"
      : !installed
        ? "Not installed"
        : !keySet
          ? id === "opencode"
            ? "Needs OpenCode server"
            : `Needs ${key}`
          : !guarded
            ? "Waiting on spending guard"
            : "Unavailable";
  return { runnable, label, tone, checks };
}

export function FrameworkGallery({
  inventory,
  adapters,
  onOpen,
}: {
  inventory: Inventory | null;
  adapters: Adapter[];
  onOpen: (id: string) => void;
}) {
  return (
    <section className="fw-gallery" aria-label="Framework pages">
      {frameworks.map((f) => {
        const r = readiness(f.id, adapters.find((a) => a.id === f.id), inventory);
        return (
          <button
            key={f.id}
            className="fw-card"
            style={{ ["--fw-src" as string]: f.accent }}
            onClick={() => onOpen(f.id)}
          >
            <span className="fw-tile">
              <FwIcon glyph={f.glyph} size={26} />
            </span>
            <span className="fw-card-body">
              <strong>{f.name}</strong>
              <small>
                {f.maker} · {f.language}
              </small>
              <span className="fw-card-tag">{f.tagline}</span>
            </span>
            <span className={"fw-ready fw-ready-" + r.tone}>{r.label}</span>
          </button>
        );
      })}
    </section>
  );
}

/** Commit-pinned packages (Hermes) show a short hash. */
const shortVersion = (v: string) => (/^[0-9a-f]{20,}$/.test(v) ? v.slice(0, 10) : v);
const categoryOrder = ["Execution", "Governance", "Tools", "State", "Collaboration", "Operations", "Modalities"];

export function FrameworkPage({
  id,
  inventory,
  adapters,
  onBack,
  onOpen,
  onCell,
  onRun,
  running,
}: {
  id: string;
  inventory: Inventory | null;
  adapters: Adapter[];
  onBack: () => void;
  onOpen: (id: string) => void;
  onCell: (row: string, fw: string) => void;
  onRun: (id: string) => void;
  running: boolean;
}) {
  const fw: FrameworkProfile | undefined = frameworkById[id];
  if (!fw) return null;
  const meta = inventory?.frameworks.find((f) => f.id === id);
  const adapter = adapters.find((a) => a.id === id);
  const r = readiness(id, adapter, inventory);
  const idx = frameworks.indexOf(fw);
  const prev = frameworks[(idx - 1 + frameworks.length) % frameworks.length],
    next = frameworks[(idx + 1) % frameworks.length];
  const rows = inventory?.rows || [];
  const counts = { native: 0, shared: 0, partial: 0, gap: 0 } as Record<string, number>;
  rows.forEach((row) => {
    const s = row.cells[id]?.status;
    if (s) counts[s] = (counts[s] || 0) + 1;
  });
  const cats = categoryOrder.filter((c) => rows.some((row) => row.category === c));
  return (
    <article className="fw-page" style={{ ["--fw-src" as string]: fw.accent }} aria-labelledby="fw-title">
      <nav className="fw-nav" aria-label="Framework navigation">
        <button className="hl-link" onClick={onBack}>
          <ArrowLeft size={14} /> All frameworks
        </button>
        <span>
          <button className="hl-icon" aria-label={`Previous: ${prev.name}`} onClick={() => onOpen(prev.id)}>
            <ChevronLeft size={16} />
          </button>
          <button className="hl-icon" aria-label={`Next: ${next.name}`} onClick={() => onOpen(next.id)}>
            <ChevronRight size={16} />
          </button>
        </span>
      </nav>

      <header className="fw-hero">
        <span className="fw-tile fw-tile-lg">
          <FwIcon glyph={fw.glyph} size={46} />
        </span>
        <div className="fw-hero-text">
          <p className="fw-meta">
            <span>{fw.maker}</span>
            <span>{fw.language}</span>
            {meta?.package && (
              <code>
                {String(meta.package)}@{shortVersion(String(meta.pinned_version || meta.version || ""))}
              </code>
            )}
          </p>
          <h2 id="fw-title">{fw.name}</h2>
          <p className="fw-tagline">{fw.tagline}</p>
          <p className="fw-model">
            <strong>Mental model.</strong> {fw.mentalModel}
          </p>
        </div>
        <span className={"fw-ready fw-ready-" + r.tone}>{r.label}</span>
      </header>

      <nav className="fw-jump" aria-label="On this page">
        {[
          ["walkthrough", "Walkthrough"],
          ["deep", `Under the hood (${deepDives[id]?.chapters.length || 0} chapters)`],
          ["blueprint", "Blueprint · Reference & SOC"],
          ["concepts", "Concepts"],
          ["docs", `Official docs reference (${(frameworkDocs[id]?.sections || []).reduce((n, x) => n + x.items.length, 0)})`],
          ["caps", "Capability profile"],
        ].map(([k, label]) => (
          <button
            key={k}
            onClick={() =>
              document.getElementById(k === "docs" ? `fw-docs-${id}` : `fw-${k}-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="fw-main" id={`fw-walkthrough-${id}`}>
        <Scene fw={fw} />
        <aside className="fw-run" aria-label="Run this framework">
          <h3>Run it</h3>
          {r.runnable ? (
            <>
              <p>This adapter is keyed and covered by the spending guard.</p>
              <button className="hl-primary" disabled={running} onClick={() => onRun(id)}>
                <Play size={15} /> Open in Live run
              </button>
            </>
          ) : (
            <p>
              Locked until every check below passes. The page switches on automatically once the server reports it.
            </p>
          )}
          <ul className="fw-checks">
            {r.checks.map((c) => (
              <li key={c.label} className={c.ok ? "is-ok" : ""}>
                {c.ok ? <Check size={14} /> : <Lock size={13} />}
                <span>
                  <strong>{c.label}</strong>
                  <small>{c.detail}</small>
                </span>
              </li>
            ))}
          </ul>
          {adapter?.budget && <p className="hl-fine">Budget: {adapter.budget}</p>}
          {safeLink(meta?.docs || adapter?.docs) && (
            <a className="hl-ext" href={safeLink(meta?.docs || adapter?.docs)} target="_blank" rel="noreferrer">
              {fw.name} documentation <ArrowUpRight size={13} />
            </a>
          )}
        </aside>
      </div>

      <DeepDive id={id} name={fw.name} />

      <Blueprint id={id} name={fw.name} />

      <div className="fw-grid-2">
        <section className="fw-block">
          <h3>Design philosophy</h3>
          <ul className="fw-bullets">
            {fw.philosophy.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <dl className="fw-fit">
            <div>
              <dt>Best for</dt>
              <dd>{fw.bestFor}</dd>
            </div>
            <div>
              <dt>Watch out</dt>
              <dd>{fw.watchOut}</dd>
            </div>
          </dl>
        </section>
        <section className="fw-block">
          <h3>How Relay wires it</h3>
          <dl className="hl-kv fw-wiring">
            <dt>Adapter</dt>
            <dd><code>{fw.relay.adapter}</code></dd>
            <dt>Runs in</dt>
            <dd>{fw.relay.bridge}</dd>
            <dt>Integrated</dt>
            <dd>{fw.relay.integration}</dd>
            <dt>Continuation</dt>
            <dd>{fw.relay.persistence}</dd>
            <dt>Limits</dt>
            <dd>{fw.relay.limits}</dd>
            <dt>Not yet</dt>
            <dd>{fw.relay.gaps}</dd>
          </dl>
        </section>
      </div>

      <section className="fw-block" id={`fw-concepts-${id}`}>
        <h3>Core concepts</h3>
        <div className="fw-concepts">
          {fw.concepts.map((c) => (
            <div key={c.name} className="fw-concept">
              <strong>{c.name}</strong>
              <code>{c.api}</code>
              <p>{c.say}</p>
            </div>
          ))}
        </div>
      </section>

      <DocsReference
        id={id}
        name={fw.name}
        pinned={meta ? shortVersion(String(meta.pinned_version || meta.version || "")) : undefined}
      />

      <section className="fw-block" id={`fw-caps-${id}`}>
        <header className="fw-block-head">
          <h3>Capability profile</h3>
          <Legend />
        </header>
        {!inventory ? (
          <p>Loading the capability inventory…</p>
        ) : (
          <>
            <div
              className="hl-bar fw-bar"
              role="img"
              aria-label={`${counts.native} SDK-native, ${counts.shared} built by Relay, ${counts.partial} restricted, ${counts.gap} not integrated, of ${rows.length}`}
            >
              {(["native", "shared", "partial", "gap"] as const).map((k) =>
                counts[k] ? <i key={k} className={"hl-bar-" + k} style={{ flexGrow: counts[k] }} /> : null,
              )}
            </div>
            <p className="hl-fine">
              {counts.native} SDK-native · {counts.shared} built by Relay · {counts.partial} restricted · {counts.gap} not
              integrated, of {rows.length} capability families. Select one to compare across frameworks.
            </p>
            <div className="fw-caps">
              {cats.map((cat) => (
                <Section key={cat} title={cat}>
                  <ul className="fw-cap-list">
                    {rows
                      .filter((row) => row.category === cat)
                      .map((row) => {
                        const c = row.cells[id];
                        if (!c) return null;
                        return (
                          <li key={row.id}>
                            <button onClick={() => onCell(row.id, id)} title={cellText(c.status, c.upstream)}>
                              <Glyph status={c.status} upstream={c.upstream} />
                              <span>{row.label}</span>
                              {isRealApi(c.upstream_api) && <code>{c.upstream_api}</code>}
                            </button>
                          </li>
                        );
                      })}
                  </ul>
                </Section>
              ))}
            </div>
          </>
        )}
      </section>
    </article>
  );
}
