import { useRef, useEffect, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { ArrowUpRight, Fingerprint, History, Moon, Sun, X } from "lucide-react";
import { useWorkspace } from "./useWorkspace";
import { RunView } from "./components/harness/RunView";
import { AnatomyView } from "./components/harness/AnatomyView";
import { FrameworksView, type Focus } from "./components/harness/FrameworksView";
import type { PartId } from "./lib/anatomy";
import { experimentFor, type ExperimentId } from "./lib/openaiExperiments";
import { CompareView } from "./components/harness/CompareView";
import "./harness.css";

const tabs = [
  { id: "anatomy", label: "Anatomy", hint: "What a harness is made of" },
  { id: "run", label: "Live run", hint: "Watch one agent loop" },
  { id: "frameworks", label: "Frameworks", hint: "11 framework pages" },
  { id: "compare", label: "Compare", hint: "One mechanism, every SDK" },
] as const;
type Tab = (typeof tabs)[number]["id"];

function tabFromHash(): Tab {
  const h = window.location.hash.replace("#", "").split("/")[0];
  if (h === "anatomy" || h === "frameworks" || h === "compare") return h;
  return h === "run" || h === "sdk-lab" ? "run" : "anatomy";
}
function pageFromHash(): string | null {
  const [tab, id] = window.location.hash.replace("#", "").split("/");
  return tab === "frameworks" && id ? id : null;
}
function readTheme(): "dark" | "light" {
  try {
    return localStorage.getItem("relay-harness-theme") === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function HarnessApp() {
  const w = useWorkspace("openai");
  const [tab, setTabState] = useState<Tab>(tabFromHash),
    [part, setPart] = useState<PartId>("runner"),
    [focus, setFocus] = useState<Focus>(null),
    [liveFocus, setLiveFocus] = useState<{ kind: string; nonce: number } | null>(null),
    [history, setHistory] = useState(false),
    [theme, setTheme] = useState(readTheme),
    [experiment, setExperiment] = useState<ExperimentId>("core"),
    [prompt, setPrompt] = useState<string>(experimentFor("core").prompt),
    [structured, setStructured] = useState(true),
    [page, setPageState] = useState<string | null>(pageFromHash),
    [runtime, setRuntime] = useState("openai");
  const adapter = w.adapters.find((a) => a.id === "openai"),
    trial = w.deployment?.trial,
    claudeTrial = w.deployment?.anthropic_trial;
  const running = w.busy || w.data?.session.status === "running";

  const setTab = (t: Tab) => {
    setTabState(t);
    const h = t === "frameworks" && page ? `frameworks/${page}` : t;
    if (window.location.hash !== "#" + h) history_replace(h);
    window.scrollTo?.({ top: 0, behavior: "smooth" });
  };
  const setPage = (id: string | null) => {
    setPageState(id);
    setTabState("frameworks");
    history_replace(id ? `frameworks/${id}` : "frameworks");
    window.scrollTo?.({ top: 0, behavior: "smooth" });
  };
  const runFramework = (id: string) => {
    if (running) return;
    setRuntime(id);
    if (id !== "openai") {
      setExperiment("core");
      setPrompt(experimentFor("core").prompt);
    }
    setTab("run");
  };
  useEffect(() => {
    const on = () => {
      setTabState(tabFromHash());
      setPageState(pageFromHash());
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const runnable = w.adapters.filter((a) => a.available && a.trial_guard).map((a) => a.id);
  const tabStrip = useRef<HTMLElement>(null);
  // On phones the tab strip scrolls sideways: keep the active tab in view.
  useEffect(() => {
    const nav = tabStrip.current,
      on = nav?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (nav && on && nav.scrollWidth > nav.clientWidth)
      nav.scrollLeft = Math.max(0, on.offsetLeft - nav.offsetLeft - (nav.clientWidth - on.offsetWidth) / 2);
  }, [tab]);
  useEffect(() => {
    try {
      localStorage.setItem("relay-harness-theme", theme);
    } catch {
      /* Theme is a convenience; ignore storage failures. */
    }
  }, [theme]);

  const openPart = (id: PartId) => {
    setPart(id);
    setTab("anatomy");
  };
  const openCell = (row: string, fw: string) => {
    setFocus({ kind: "cell", row, fw });
    setPageState(null);
    setTabState("frameworks");
    history_replace("frameworks");
  };
  const openLive = (kind: string) => {
    setLiveFocus({ kind, nonce: Date.now() });
    setTab("run");
  };
  const tryExperiment = (id: string) => {
    if (running) return setTab("run");
    const next = experimentFor(id);
    setExperiment(next.id);
    setPrompt(next.prompt);
    setTab("run");
  };
  const fwCount = w.inventory?.frameworks.length,
    rowCount = w.inventory?.rows.length;

  return (
    <div className="harness" data-theme={theme}>
      <header className="hl-top">
        <a className="hl-brand" href="/" aria-label="Relay harness lab home">
          <span className="hl-mark" aria-hidden="true">S</span>
          SoCHarness <span>/ Harness Lab</span>
        </a>
        <div className="hl-top-actions">
          {trial?.remaining_usd !== undefined && (
            <span
              className="hl-budget"
              data-short={claudeTrial?.remaining_usd !== undefined ? "OAI" : undefined}
              title={`OpenAI: $${trial.limit_usd ?? 5} allowance for live runs. Browsing, inspecting and exporting are free.`}
            >
              {claudeTrial?.remaining_usd !== undefined && <span className="hl-budget-of">OpenAI </span>}
              <strong>${trial.remaining_usd.toFixed(2)}</strong>
              <span className="hl-budget-of"> of ${trial.limit_usd ?? 5} left</span>
            </span>
          )}
          {claudeTrial?.remaining_usd !== undefined && (
            <span
              className="hl-budget"
              data-short="ANT"
              title={`Anthropic: $${claudeTrial.limit_usd ?? 5} allowance for Claude, Pydantic AI, Deep Agents and Pi, metered per request.`}
            >
              <span className="hl-budget-of">Anthropic </span>
              <strong>${claudeTrial.remaining_usd.toFixed(2)}</strong>
              <span className="hl-budget-of"> left</span>
            </span>
          )}
          {running && <span className="hl-live-pill">Run in progress</span>}
          <a className="hl-textlink" href="/architecture">Architecture atlas</a>
          <button className="hl-icon" onClick={() => setHistory(true)} aria-label="Session history">
            <History size={17} />
          </button>
          <button
            className="hl-icon"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          >
            {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <a className="hl-icon" href="/security" aria-label="Account security">
            <Fingerprint size={17} />
          </a>
        </div>
      </header>

      <main className="hl-main">
        {adapter?.version === "offline fixture" && (
          <div className="hl-banner">
            Offline QA: synthetic records and a fake model. No provider traffic or charges.
          </div>
        )}
        {w.notice && (
          <div className="hl-banner" role="status">
            <span>{w.notice}</span>
            <button onClick={() => w.setNotice("")} aria-label="Dismiss notice">
              <X size={15} />
            </button>
          </div>
        )}

        <section className="hl-hero" hidden={tab !== "anatomy"}>
          <div>
            <p className="hl-kicker">Agent engineering lab</p>
            <h1>
              The model is one part.
              <br />
              The harness is the rest.
            </h1>
            <p>
              Learn how agent frameworks wrap a model in contracts, loops, tools, limits and state.
              Take the parts apart, watch a real loop run against security evidence, then compare
              how each SDK does it.
            </p>
          </div>
          <dl className="hl-hero-side">
            <div><dt>{fwCount ?? "—"}</dt><dd>frameworks mapped</dd></div>
            <div><dt>{rowCount ?? "—"}</dt><dd>capability families</dd></div>
            <div><dt>12</dt><dd>harness parts</dd></div>
          </dl>
        </section>

        <nav className="hl-tabs" role="tablist" aria-label="Lab views" ref={tabStrip}>
          {tabs.map((t, i) => (
            <button
              key={t.id}
              role="tab"
              id={"tab-" + t.id}
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
            >
              <span className="hl-tab-n">0{i + 1}</span>
              {t.label}
              <small>{t.hint}</small>
              {t.id === "run" && running && <i className="hl-tab-live" aria-label="running" />}
            </button>
          ))}
        </nav>

        <AnatomyView
          hidden={tab !== "anatomy"}
          inventory={w.inventory}
          selected={part}
          onSelect={setPart}
          onCell={openCell}
          onLive={openLive}
          onTry={tryExperiment}
          running={!!running}
        />
        <RunView
          w={w}
          hidden={tab !== "run"}
          onPart={openPart}
          focus={liveFocus}
          experiment={experiment}
          setExperiment={setExperiment}
          prompt={prompt}
          setPrompt={setPrompt}
          structured={structured}
          setStructured={setStructured}
          runtime={runtime}
          setRuntime={setRuntime}
          runnable={runnable}
        />
        <CompareView hidden={tab !== "compare"} />
        <FrameworksView
          hidden={tab !== "frameworks"}
          inventory={w.inventory}
          focus={focus}
          setFocus={setFocus}
          onPart={openPart}
          page={page}
          onPage={setPage}
          adapters={w.adapters}
          onRun={runFramework}
          running={!!running}
          lastRun={w.data ? { runtime: w.data.session.config.runtime, trace: w.data.trace } : undefined}
        />

        <footer className="hl-footer">
          <span>OpenAI Agents SDK {adapter?.version || ""} runs live. Other frameworks are mapped from the versioned inventory.</span>
          <a href="https://openai.github.io/openai-agents-python/running_agents/" target="_blank" rel="noreferrer">
            SDK documentation <ArrowUpRight size={12} />
          </a>
        </footer>
      </main>

      <DialogPrimitive.Root open={history} onOpenChange={setHistory}>
        {history && (
          <DialogPrimitive.Portal>
            <div className="harness hl-modal-backdrop" data-theme={theme}>
              <DialogPrimitive.Overlay className="hl-shade" />
              <DialogPrimitive.Content asChild aria-describedby={undefined}>
                <section className="hl-modal" aria-label="Session history">
                  <header>
                    <DialogPrimitive.Title asChild>
                      <h2>Session history</h2>
                    </DialogPrimitive.Title>
                    <button className="hl-icon" autoFocus aria-label="Close dialog" onClick={() => setHistory(false)}>
                      <X size={18} />
                    </button>
                  </header>
                  <p>{runtime === "openai" ? "OpenAI" : runtime} sessions for {w.caseId}. Opening one is free.</p>
                  {w.sessions
                    .filter((s) => s.config.runtime === runtime && s.case_id === w.caseId)
                    .map((s) => (
                      <button
                        className="hl-history-item"
                        disabled={!!running}
                        key={s.id}
                        onClick={() =>
                          void w.safe(async () => {
                            await w.loadSession(s);
                            const saved = experimentFor(s.config.openai_experiment);
                            setExperiment(saved.id);
                            setPrompt(saved.prompt);
                            setStructured(s.config.structured_output);
                            setHistory(false);
                            setTab("run");
                          })
                        }
                      >
                        <span>
                          <strong>{s.title || s.id}</strong>
                          <small>
                            {experimentFor(s.config.openai_experiment).title},{" "}
                            {new Date(s.created_at).toLocaleString()}, {s.status}
                          </small>
                        </span>
                        <ArrowUpRight size={16} />
                      </button>
                    ))}
                  {!w.sessions.some((s) => s.config.runtime === runtime && s.case_id === w.caseId) && (
                    <p>No sessions for this runtime and collection yet.</p>
                  )}
                </section>
              </DialogPrimitive.Content>
            </div>
          </DialogPrimitive.Portal>
        )}
      </DialogPrimitive.Root>
    </div>
  );
}

function history_replace(t: string) {
  try {
    window.history.replaceState(null, "", "#" + t);
  } catch {
    /* Non-browser environments. */
  }
}
