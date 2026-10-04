import { useMemo, useState } from "react";
import { ArrowUpRight, Search } from "lucide-react";
import { frameworkDocs, type DocKind, type FrameworkDocs } from "../../lib/docs";
import { safeLink } from "../../lib/api";

const groups: { id: string; label: string; kinds: DocKind[] }[] = [
  { id: "all", label: "All", kinds: [] },
  { id: "class", label: "Classes & types", kinds: ["class", "type", "module"] },
  { id: "fn", label: "Functions & methods", kinds: ["function", "method", "decorator", "cli"] },
  { id: "param", label: "Parameters & config", kinds: ["param", "config", "property"] },
  { id: "event", label: "Events, hooks & errors", kinds: ["event", "hook", "exception"] },
  { id: "tool", label: "Tools", kinds: ["tool"] },
  { id: "idea", label: "Concepts & techniques", kinds: ["concept", "technique"] },
];
const kindLabel: Record<DocKind, string> = {
  class: "class",
  function: "function",
  method: "method",
  param: "param",
  property: "property",
  event: "event",
  exception: "error",
  type: "type",
  decorator: "decorator",
  hook: "hook",
  tool: "tool",
  config: "config",
  module: "module",
  concept: "concept",
  technique: "technique",
  cli: "CLI",
};

/** Searchable reference of a framework's documented surface, linked to the official docs. */
export function DocsReference({
  id,
  name,
  pinned,
  docs: given,
  title = "From the official docs",
}: {
  id: string;
  name: string;
  pinned?: string;
  /** reference supplied directly (proving grounds) instead of a framework's */
  docs?: FrameworkDocs;
  title?: string;
}) {
  const docs = given || frameworkDocs[id];
  const relayAware = !given;
  const [q, setQ] = useState(""),
    [group, setGroup] = useState("all"),
    [relayOnly, setRelayOnly] = useState(false);
  const kinds = groups.find((g) => g.id === group)?.kinds || [];
  const needle = q.trim().toLowerCase();
  const sections = useMemo(
    () =>
      (docs?.sections || [])
        .map((s) => ({
          ...s,
          shown: s.items.filter(
            (i) =>
              (!kinds.length || kinds.includes(i.k)) &&
              (!relayOnly || !!i.r) &&
              (!needle || i.n.toLowerCase().includes(needle) || i.d.toLowerCase().includes(needle) || s.t.toLowerCase().includes(needle)),
          ),
        }))
        .filter((s) => s.shown.length),
    [docs, kinds, relayOnly, needle],
  );
  if (!docs) return null;
  const total = docs.sections.reduce((n, s) => n + s.items.length, 0);
  const wired = docs.sections.reduce((n, s) => n + s.items.filter((i) => i.r).length, 0);
  const shown = sections.reduce((n, s) => n + s.shown.length, 0);
  const anchor = (t: string) => `fwdoc-${id}-${t.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section className="fw-block fw-docs" id={`fw-docs-${id}`} aria-labelledby={`fw-docs-title-${id}`}>
      <header className="fw-block-head">
        <div>
          <h3 id={`fw-docs-title-${id}`}>{title}</h3>
          <p className="hl-fine">
            {total} documented {relayAware ? "features, classes, functions and techniques" : "parameters, classes, metrics and concepts"} across{" "}
            {docs.sections.length} sections{relayAware ? `; ${wired} are used by Relay` : ""}. Compiled from{" "}
            {safeLink(docs.source) ? (
              <a href={safeLink(docs.source)} target="_blank" rel="noreferrer">
                {name}'s docs
              </a>
            ) : (
              `${name}'s docs`
            )}{" "}
            on {docs.checked}.{" "}
            {relayAware
              ? `Docs follow the latest release${pinned ? `; Relay pins ${pinned}` : ""}, so names can differ slightly.`
              : `Read from the source at the pinned revision${pinned ? ` (${pinned})` : ""}.`}
          </p>
        </div>
      </header>
      <div className="fw-docs-tools">
        <label className="hl-search">
          <Search size={14} aria-hidden="true" />
          <span className="hl-sr">Search {name} docs</span>
          <input type="search" placeholder={`Search ${name}: class, function, idea…`} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="hl-chips" role="radiogroup" aria-label="Kind">
          {groups.map((g) => (
            <button key={g.id} role="radio" aria-checked={group === g.id} onClick={() => setGroup(g.id)}>
              {g.label}
            </button>
          ))}
        </div>
        {relayAware && (
          <label className="hl-check hl-check-inline">
            <input type="checkbox" checked={relayOnly} onChange={(e) => setRelayOnly(e.target.checked)} />
            <span>Only what Relay uses</span>
          </label>
        )}
        <span className="fw-docs-count" aria-live="polite">
          {shown} of {total}
        </span>
      </div>
      <div className="fw-docs-layout">
        <nav className="fw-docs-nav" aria-label={`${name} documentation sections`}>
          {docs.sections.map((s) => {
            const hit = sections.find((x) => x.t === s.t);
            return (
              <a
                key={s.t}
                href={`#${anchor(s.t)}`}
                className={hit ? "" : "is-empty"}
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(anchor(s.t))?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                <span>{s.t}</span>
                <small>{hit ? hit.shown.length : 0}</small>
              </a>
            );
          })}
        </nav>
        <div className="fw-docs-body">
          {!sections.length && <p className="hl-pad">Nothing matches. Clear the search or choose another kind.</p>}
          {sections.map((s) => (
            <section key={s.t} id={anchor(s.t)} className="fw-doc-section">
              <h4>
                <span>{s.t}</span>
                {safeLink(s.url) && (
                  <a href={safeLink(s.url)} target="_blank" rel="noreferrer" aria-label={`${s.t} in the official docs`}>
                    docs <ArrowUpRight size={12} />
                  </a>
                )}
              </h4>
              <ul>
                {s.shown.map((i) => (
                  <li key={i.n} className={i.r ? "is-relay" : ""}>
                    <code>{i.n}</code>
                    <span className={"fw-kind fw-kind-" + i.k}>{kindLabel[i.k] || i.k}</span>
                    {i.r && <span className="fw-relay">{i.r === "wired" ? "used by Relay" : "partly used"}</span>}
                    <p>{i.d}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}
