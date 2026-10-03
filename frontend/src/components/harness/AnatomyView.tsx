import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Inventory } from "../../lib/types";
import { domains, partById, parts, type DomainId, type PartId } from "../../lib/anatomy";
import { CapabilityGrid, Section } from "./shared";
import { experimentFor } from "../../lib/openaiExperiments";

const relayTag = {
  implemented: ["current", "Implemented in Relay"],
  partial: ["partial", "Partly implemented"],
  target: ["target", "Not built yet"],
} as const;

function PartCard({
  id,
  selected,
  onSelect,
  className = "",
}: {
  id: PartId;
  selected: PartId;
  onSelect: (id: PartId) => void;
  className?: string;
}) {
  const p = partById[id];
  const [tone] = relayTag[p.relayStatus];
  return (
    <button
      className={`hl-node hl-node-${tone} ${className}`}
      aria-pressed={selected === id}
      onClick={() => onSelect(id)}
      data-part={id}
      title={p.short}
    >
      <strong>{p.name}</strong>
      <small>{p.short}</small>
    </button>
  );
}

function Domain({ id, children, className = "" }: { id: DomainId; children: React.ReactNode; className?: string }) {
  const d = domains.find((x) => x.id === id)!;
  const n = domains.indexOf(d) + 1;
  return (
    <div className={`hl-domain hl-domain-${id} ${className}`}>
      <div className="hl-domain-head">
        <span>{n}</span>
        <strong>{d.name}</strong>
        <small>{d.caption}</small>
      </div>
      {children}
    </div>
  );
}

export function AnatomyView({
  hidden,
  inventory,
  selected,
  onSelect,
  onCell,
  onLive,
  onTry,
  running,
}: {
  hidden: boolean;
  inventory: Inventory | null;
  selected: PartId;
  onSelect: (id: PartId) => void;
  onCell: (row: string, framework: string) => void;
  onLive: (kind: string) => void;
  onTry: (experiment: string) => void;
  running: boolean;
}) {
  const p = partById[selected];
  const i = parts.indexOf(p);
  const [tone, label] = relayTag[p.relayStatus];
  const inspRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!hidden && window.innerWidth < 1100) inspRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    // Only follow selection changes, not tab changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);
  const card = (id: PartId, cls?: string) => (
    <PartCard id={id} selected={selected} onSelect={onSelect} className={cls} />
  );
  return (
    <div className="hl-anatomy" hidden={hidden}>
      <div className="hl-view-head">
        <div>
          <h2>What every agent harness is made of</h2>
          <p>
            Twelve parts, the same in every framework. The model is one of them. Select a part to see
            what it does, how to build it, and how each SDK handles it.
          </p>
        </div>
        <div className="hl-key">
          <span><i className="hl-k-current" />Implemented in Relay</span>
          <span><i className="hl-k-partial" />Partial</span>
          <span><i className="hl-k-target" />Not built</span>
        </div>
      </div>

      <div className="hl-diagram-layout">
        <div className="hl-diagram" role="group" aria-label="Harness anatomy diagram">
          <div className="hl-bus" aria-hidden="true"><i /></div>
          <Domain id="input">{card("request")}</Domain>
          <Domain id="contract">
            {card("contract")}
            {card("policy")}
            {card("limits")}
          </Domain>
          <Domain id="loop" className="hl-domain-ring">
            <div className="hl-ring-box">
              <svg className="hl-ring" viewBox="0 0 360 240" aria-hidden="true">
                <defs>
                  <marker id="hl-arrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                    <path d="M0 0 8 4 0 8z" className="hl-arrowhead" />
                  </marker>
                </defs>
                <path id="hl-ring-path" className="hl-ring-path" d="M180 25 A150 95 0 1 1 179.9 25" />
                <path className="hl-ring-arc" d="M272.3 45.1 A150 95 0 0 1 328.5 106.8" markerEnd="url(#hl-arrow)" />
                <path className="hl-ring-arc" d="M236.2 208.1 A150 95 0 0 1 123.8 208.1" markerEnd="url(#hl-arrow)" />
                <path className="hl-ring-arc" d="M31.5 106.8 A150 95 0 0 1 87.7 45.1" markerEnd="url(#hl-arrow)" />
                <text x="300" y="76" className="hl-ring-label" textAnchor="end">function_call</text>
                <text x="180" y="234" className="hl-ring-label" textAnchor="middle">tool output</text>
                <text x="60" y="76" className="hl-ring-label">next request</text>
                <circle r="4.5" className="hl-packet">
                  <animateMotion dur="6s" repeatCount="indefinite">
                    <mpath href="#hl-ring-path" />
                  </animateMotion>
                </circle>
              </svg>
              {card("model", "hl-ring-model")}
              {card("tools", "hl-ring-tools")}
              {card("runner", "hl-ring-runner")}
            </div>
            <p className="hl-ring-exit">exits on a final answer or a limit</p>
          </Domain>
          <Domain id="state">
            {card("sessions")}
            {card("memory")}
            {card("trace")}
          </Domain>
          <Domain id="scale">
            {card("multi")}
            {card("durable")}
          </Domain>
        </div>

        <aside className="hl-inspector hl-part-insp" ref={inspRef} aria-live="polite" aria-label="Selected part">
          <div className="hl-insp-nav">
            <span className={"hl-status hl-status-" + tone}>{label}</span>
            <span className="hl-insp-count">{i + 1} of {parts.length}</span>
            <button aria-label="Previous part" disabled={i === 0} onClick={() => onSelect(parts[i - 1].id)}>
              <ChevronLeft size={15} />
            </button>
            <button aria-label="Next part" disabled={i === parts.length - 1} onClick={() => onSelect(parts[i + 1].id)}>
              <ChevronRight size={15} />
            </button>
          </div>
          <h3>{p.name}</h3>
          <p className="hl-desc">{p.what}</p>
          <Section title="Why a harness needs it">
            <p>{p.why}</p>
          </Section>
          <Section title="Build it yourself">
            <ul>
              {p.build.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </Section>
          <Section title="Where Relay does it">
            <ul className="hl-files">
              {p.relay.map((r) => (
                <li key={r.file}>
                  <code>{r.file}</code>
                  <span>{r.role}</span>
                </li>
              ))}
            </ul>
          </Section>
          {!!p.experiments?.length && (
            <Section title="Try it live">
              <ul className="hl-try">
                {p.experiments.map((id) => {
                  const e = experimentFor(id);
                  return (
                    <li key={id}>
                      <button className="hl-try-btn" disabled={running} onClick={() => onTry(id)}>
                        <strong>{e.title}</strong>
                        <span>{e.question}</span>
                        <code>{e.api}</code>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {p.events.length > 0 && (
                <button className="hl-link" onClick={() => onLive(p.events[0])}>
                  Or open the matching step in your latest run
                </button>
              )}
            </Section>
          )}
          <Section title="Across frameworks">
            <CapabilityGrid inventory={inventory} rowIds={p.rows} onOpen={onCell} />
          </Section>
        </aside>
      </div>
    </div>
  );
}
