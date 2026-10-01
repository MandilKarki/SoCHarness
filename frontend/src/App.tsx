import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Command,
  Database,
  Fingerprint,
  FlaskConical,
  FolderOpen,
  GitBranch,
  Grid2X2,
  HelpCircle,
  Layers3,
  Menu,
  MessageSquare,
  Monitor,
  Moon,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Square,
  Sun,
  Terminal,
  Waypoints,
  X,
} from "lucide-react";
import { useWorkspace, type Workspace } from "./useWorkspace";
import { api, errorText } from "./lib/api";
import type { Json, View } from "./lib/types";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "./components/ui/sheet";
import {
  Empty,
  Field,
  JsonView,
  Modal,
  Section,
  Status,
} from "./components/shared";
import { Settings } from "./components/Settings";
import { Catalog } from "./components/Catalog";
import { Lab } from "./components/Lab";
import { SdkLab } from "./components/SdkLab";
const nav: {
  group: string;
  items: { id: View; label: string; icon: typeof Activity }[];
}[] = [
  {
    group: "Investigate",
    items: [
      { id: "evidence", label: "Cases", icon: FolderOpen },
      { id: "trace", label: "Execution trace", icon: Activity },
      { id: "approvals", label: "Approvals", icon: ShieldCheck },
      { id: "sessions", label: "Sessions", icon: MessageSquare },
    ],
  },
  {
    group: "Agent lab",
    items: [
      { id: "sdk-lab", label: "SDK learning lab", icon: Waypoints },
      { id: "lab", label: "Investigation lab", icon: FlaskConical },
      { id: "frameworks", label: "Agent runtimes", icon: Layers3 },
      { id: "matrix", label: "Capability matrix", icon: Grid2X2 },
      { id: "tools", label: "Tool library", icon: Terminal },
    ],
  },
  {
    group: "Operate",
    items: [{ id: "deployment", label: "Deployment", icon: Monitor }],
  },
];
const viewInfo: Record<View, [string, string]> = {
  "sdk-lab": ["Learning room", "One scenario. One SDK. One step at a time."],
  evidence: [
    "Investigations",
    "Evidence first. Every agent action accountable.",
  ],
  trace: ["Execution trace", "Follow the loop, one recorded event at a time."],
  approvals: [
    "Approval inbox",
    "You decide what changes. Review the exact action.",
  ],
  sessions: [
    "Session history",
    "Pick up where you left off, with context intact.",
  ],
  lab: [
    "Investigation lab",
    "Explore how agents plan, remember, and collaborate.",
  ],
  frameworks: [
    "Agent runtimes",
    "Different engines. One accountable workspace.",
  ],
  matrix: ["Capability explorer", "An honest map of implementation and gaps."],
  tools: [
    "Tool library",
    "Small, scoped capabilities. Shared policy boundaries.",
  ],
  deployment: [
    "Deployment readiness",
    "A protected pilot first. Explicit gates before production.",
  ],
};
function readPreference(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
function savePreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Private browsing may disable storage. */
  }
}
function useTheme() {
  const [theme, setTheme] = useState(() =>
    readPreference("relay-theme", "light"),
  );
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    savePreference("relay-theme", theme);
  }, [theme]);
  return {
    theme,
    toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")),
  };
}
export function App() {
  const w = useWorkspace(),
    { theme, toggle } = useTheme();
  const [settings, setSettings] = useState<string | null>(null),
    [chat, setChat] = useState(false),
    [mobile, setMobile] = useState(false),
    [palette, setPalette] = useState(false),
    [guide, setGuide] = useState(false),
    [command, setCommand] = useState(""),
    [caseSearch, setCaseSearch] = useState(""),
    [prompt, setPrompt] = useState(""),
    [record, setRecord] = useState<unknown>(null),
    [proposal, setProposal] = useState<
      "save_case_note" | "simulate_containment" | null
    >(null),
    [value, setValue] = useState("");
  const current = w.cases.find((c) => c.id === w.caseId),
    global = [
      "sdk-lab",
      "frameworks",
      "matrix",
      "tools",
      "deployment",
    ].includes(w.view),
    pending =
      w.data?.approvals.filter((a) => a.status === "pending").length || 0;
  const navigate = (view: View) => {
    w.setView(view);
    setMobile(false);
    setPalette(false);
  };
  useEffect(() => {
    const keyboard = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  }, []);
  useEffect(() => {
    if (w.runStatus === "approval.waiting" || w.runStatus === "input.waiting")
      setChat(false);
  }, [w.runStatus]);
  const draft = (text: string) => {
    setPrompt(text);
    setChat(true);
  };
  const navigation = (
    <>
      <a href="/" className="brand">
        <span className="brand-mark">r</span>
        <strong>
          relay<span> / soc</span>
        </strong>
      </a>
      <button className="search-command" onClick={() => setPalette(true)}>
        <Search size={15} />
        <span>Find anything</span>
        <kbd>⌘ K</kbd>
      </button>
      <div className="nav-groups">
        {(w.view === "sdk-lab"
          ? [
              {
                group: "Learn",
                items: [
                  {
                    id: "sdk-lab" as View,
                    label: "Learning room",
                    icon: Waypoints,
                  },
                  {
                    id: "evidence" as View,
                    label: "Full SOC workspace",
                    icon: FolderOpen,
                  },
                ],
              },
            ]
          : nav
        ).map((group) => (
          <div className="nav-group" key={group.group}>
            <p>{group.group}</p>
            {group.items.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={"nav-item " + (w.view === id ? "active" : "")}
                aria-current={w.view === id ? "page" : undefined}
                onClick={() => navigate(id)}
              >
                <Icon size={17} />
                <span>{label}</span>
                {id === "approvals" && pending > 0 && (
                  <span className="nav-count">{pending}</span>
                )}
                {id === "evidence" && <small>{w.cases.length}</small>}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="nav-footer">
        <a className="nav-item" href="/architecture">
          <Waypoints size={17} />
          Architecture ↗
        </a>
        <a className="nav-item" href="/security">
          <Fingerprint size={17} />
          Account security
        </a>
        <button
          className="nav-item"
          onClick={() => {
            setGuide(true);
            setMobile(false);
          }}
        >
          <HelpCircle size={17} />
          Getting started
        </button>
        <div className="workspace-identity">
          <span className="operator-avatar">MK</span>
          <div>
            <strong>Operator workspace</strong>
            <small>Single-operator pilot</small>
          </div>
          <button
            className="icon-button"
            aria-label={theme === "dark" ? "Use light theme" : "Use dark theme"}
            onClick={toggle}
          >
            {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </div>
        <button
          className="signout"
          onClick={() =>
            void w.safe(async () => {
              await api("/api/logout", {});
              location.assign("/login");
            })
          }
        >
          Sign out
        </button>
      </div>
    </>
  );
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to workspace
      </a>
      <aside className="sidebar" aria-label="Main navigation">
        {navigation}
      </aside>
      <Sheet open={mobile} onOpenChange={setMobile}>
        <SheetContent side="left" className="mobile-nav">
          <SheetHeader className="sr-only">
            <SheetTitle>Workspace navigation</SheetTitle>
            <SheetDescription>
              Choose an investigation or workspace section.
            </SheetDescription>
          </SheetHeader>
          {navigation}
        </SheetContent>
      </Sheet>
      <div className="app-main">
        <header className="topbar">
          <div className="breadcrumbs">
            <Button
              className="mobile-menu"
              variant="ghost"
              size="icon"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu />
            </Button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{viewInfo[w.view][0]}</strong>
          </div>
          <div className="topbar-actions">
            <span className="connection">
              <span />
              {w.loading ? "Connecting" : "Evidence workspace"}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Refresh workspace"
              onClick={() => void w.safe(w.refresh)}
            >
              <RefreshCw size={16} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open command palette"
              onClick={() => setPalette(true)}
            >
              <Command size={16} />
            </Button>
          </div>
        </header>
        <main id="main" className="workspace">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                AGENT OPERATIONS / {global ? "EXPLORE" : "INVESTIGATE"}
              </div>
              <h1>
                {viewInfo[w.view][0]}
                {w.view === "evidence" && (
                  <span className="title-count">{w.cases.length} open</span>
                )}
              </h1>
              <p>{viewInfo[w.view][1]}</p>
            </div>
            {w.view !== "sdk-lab" && (
              <div className="page-actions">
                <Button variant="outline" onClick={() => setGuide(true)}>
                  <BookOpen />
                  Quick start
                </Button>
                <Button
                  disabled={w.busy || !current}
                  onClick={() =>
                    setSettings(w.view === "sdk-lab" ? "openai" : "simulator")
                  }
                >
                  <Plus />
                  New session
                </Button>
              </div>
            )}
          </div>
          {w.loading ? (
            <Empty title="Connecting to Relay">
              Loading the evidence store and runtime registry…
            </Empty>
          ) : (
            <>
              {w.view !== "sdk-lab" && (
                <div className="metric-strip">
                  {[
                    ["records", "Evidence records"],
                    ["hosts", "Observed hosts"],
                    ["sdk_adapters", "SDK adapters"],
                    ["tools", "Controlled tools"],
                  ].map(([key, label]) => (
                    <div key={key}>
                      <span>{label}</span>
                      <strong>
                        {w.inventory
                          ? Number(
                              w.inventory.metrics[key] || 0,
                            ).toLocaleString()
                          : "—"}
                      </strong>
                    </div>
                  ))}
                  <div className="metric-note">
                    <ShieldCheck size={18} />
                    <span>
                      Benchmark evidence
                      <br />
                      <small>Review cohorts, not detection verdicts</small>
                    </span>
                  </div>
                </div>
              )}
              <div className={"work-area " + (global ? "global-area" : "")}>
                {!global && (
                  <aside className="case-rail" aria-label="Open cases">
                    <div className="case-rail-heading">
                      <strong>
                        Open cases <span>{w.cases.length}</span>
                      </strong>
                      <Search size={15} />
                    </div>
                    <Input
                      aria-label="Search cases"
                      placeholder="Filter cases…"
                      value={caseSearch}
                      onChange={(e) => setCaseSearch(e.target.value)}
                    />
                    <div className="case-list">
                      {w.cases
                        .filter((c) =>
                          (c.title + " " + c.id)
                            .toLowerCase()
                            .includes(caseSearch.toLowerCase()),
                        )
                        .map((c) => (
                          <button
                            key={c.id}
                            disabled={w.busy}
                            className={
                              "case-item " +
                              (c.id === w.caseId ? "selected" : "")
                            }
                            aria-current={
                              c.id === w.caseId ? "true" : undefined
                            }
                            onClick={() =>
                              void w.safe(async () => w.selectCase(c.id))
                            }
                          >
                            <div>
                              <span className={"priority-dot " + c.severity} />
                              <span>{c.id}</span>
                              <small>{c.severity}</small>
                            </div>
                            <h3>{c.title}</h3>
                            <p>
                              {c.event_count.toLocaleString()} records
                              <span>{c.asset_count} hosts</span>
                            </p>
                          </button>
                        ))}
                    </div>
                    <div className="rail-foot">
                      <Database size={14} />
                      <span>Original records preserved</span>
                    </div>
                  </aside>
                )}
                <div className="case-workspace">
                  {!global && current && (
                    <>
                      <div className="case-header">
                        <div className="chips">
                          <Status tone={current.severity}>
                            {current.severity} review priority
                          </Status>
                          <span>{current.id}</span>
                          <span>Open · review cohort</span>
                        </div>
                        <div className="case-title-row">
                          <h2>{current.title}</h2>
                          <Button
                            variant="outline"
                            onClick={() => setChat(true)}
                          >
                            <MessageSquare />
                            Open agent
                          </Button>
                        </div>
                        <div className="session-bar">
                          <span className="session-dot" />
                          <strong>
                            {w.data?.session.config.runtime || "simulator"}
                          </strong>
                          <span>
                            {(
                              w.data?.session.config.permission || "read_only"
                            ).replaceAll("_", " ")}
                          </span>
                          <span className="session-id">
                            {w.data?.session.id.slice(0, 16) ||
                              "No session yet"}
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={w.busy}
                            onClick={() =>
                              setSettings(
                                w.data?.session.config.runtime || "simulator",
                              )
                            }
                          >
                            Configure <MoreHorizontal size={14} />
                          </Button>
                        </div>
                      </div>
                      <div className="case-tabs" aria-label="Case sections">
                        {(
                          [
                            "evidence",
                            "trace",
                            "approvals",
                            "sessions",
                            "lab",
                          ] as const
                        ).map((v) => (
                          <button
                            key={v}
                            aria-current={w.view === v ? "page" : undefined}
                            className={w.view === v ? "selected" : ""}
                            onClick={() => w.setView(v)}
                          >
                            {
                              {
                                evidence: "Evidence",
                                trace: "Trace",
                                approvals: "Approvals",
                                sessions: "Sessions",
                                lab: "Lab",
                              }[v]
                            }
                            {v === "approvals" && pending > 0 && (
                              <span>{pending}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  <div className="view-content" key={global ? w.view : "case"}>
                    {w.view === "sdk-lab" ? (
                      <SdkLab w={w} configure={setSettings} draft={draft} />
                    ) : global ? (
                      <Catalog
                        key={w.view}
                        w={w}
                        configure={setSettings}
                        draft={draft}
                      />
                    ) : w.view === "evidence" ? (
                      <EvidenceView w={w} inspect={setRecord} draft={draft} />
                    ) : w.view === "trace" ? (
                      <Section
                        title="The agent loop, made visible"
                        description={`${w.data?.trace.length || 0} recorded events · deltas are retained in exports`}
                        action={
                          <Button
                            variant="outline"
                            disabled={!w.data}
                            onClick={() => void w.safe(() => w.exportSession())}
                          >
                            <ArrowDownToLine />
                            Export
                          </Button>
                        }
                      >
                        {!w.data?.trace.length ? (
                          <Empty title="No execution events yet">
                            Start with a replay investigation. Every tool call
                            and result will appear here.
                          </Empty>
                        ) : (
                          <div className="trace-list">
                            {w.data.trace
                              .filter((t) => t.kind !== "message.delta")
                              .slice(-150)
                              .map((t) => (
                                <details key={t.seq}>
                                  <summary>
                                    <span className="trace-seq">
                                      {String(t.seq).padStart(2, "0")}
                                    </span>
                                    <strong>{t.kind}</strong>
                                    <time>
                                      {new Date(
                                        t.created_at,
                                      ).toLocaleTimeString()}
                                    </time>
                                  </summary>
                                  <JsonView value={t.payload} />
                                  {t.kind === "checkpoint" && (
                                    <Button
                                      variant="outline"
                                      disabled={w.busy}
                                      onClick={() =>
                                        void w.safe(() => w.fork(t.seq))
                                      }
                                    >
                                      <GitBranch />
                                      Branch conversation
                                    </Button>
                                  )}
                                </details>
                              ))}
                          </div>
                        )}
                      </Section>
                    ) : w.view === "approvals" ? (
                      <Section
                        title="Human authorization"
                        description="An approval authorizes one exact action; it does not prove successful execution."
                      >
                        {!w.data?.approvals.length ? (
                          <Empty title="Nothing waiting on you">
                            Agent actions that need permission will appear here
                            with their exact arguments.
                          </Empty>
                        ) : (
                          w.data.approvals.map((a) => (
                            <div className="approval-card" key={a.id}>
                              <div className="section-heading">
                                <h3>{a.tool}</h3>
                                <Status
                                  tone={
                                    a.status === "pending"
                                      ? "warning"
                                      : "neutral"
                                  }
                                >
                                  {a.status}
                                </Status>
                              </div>
                              <JsonView value={a.arguments} />
                              {a.status === "pending" && (
                                <ApprovalButtons w={w} id={a.id} />
                              )}
                            </div>
                          ))
                        )}
                      </Section>
                    ) : w.view === "sessions" ? (
                      <Section
                        title="Saved investigations"
                        description="Resume the same case with its original runtime and policy."
                      >
                        {w.sessions.filter((s) => s.case_id === w.caseId)
                          .length === 0 ? (
                          <Empty title="No saved sessions">
                            Create your first session to begin.
                          </Empty>
                        ) : (
                          w.sessions
                            .filter((s) => s.case_id === w.caseId)
                            .map((s) => (
                              <div className="list-row session-row" key={s.id}>
                                <div>
                                  <h3>{s.title}</h3>
                                  <p>
                                    {s.config.runtime} ·{" "}
                                    {s.config.permission.replaceAll("_", " ")}
                                  </p>
                                  <small>
                                    {new Date(s.created_at).toLocaleString()} ·{" "}
                                    {s.id.slice(0, 16)}
                                  </small>
                                </div>
                                <Button
                                  variant="outline"
                                  disabled={
                                    w.busy || s.id === w.data?.session.id
                                  }
                                  onClick={() =>
                                    void w.safe(() => w.loadSession(s))
                                  }
                                >
                                  {s.id === w.data?.session.id
                                    ? "Current"
                                    : "Resume"}
                                  <ArrowRight />
                                </Button>
                              </div>
                            ))
                        )}
                      </Section>
                    ) : (
                      <Lab w={w} />
                    )}
                  </div>
                  {!global && (
                    <footer className="evidence-footer">
                      <ShieldCheck size={14} />
                      Source data is untrusted. Agent conclusions are hypotheses
                      until verified.
                    </footer>
                  )}
                </div>
              </div>
            </>
          )}
        </main>
      </div>
      <Sheet open={chat} onOpenChange={setChat}>
        <SheetContent className="agent-sheet">
          <SheetHeader>
            <SheetTitle>
              <span className="agent-symbol">✳</span>Investigation agent
            </SheetTitle>
            <SheetDescription>
              {current?.id} ·{" "}
              {w.data?.session.config.runtime || "Deterministic replay"} ·{" "}
              {(w.data?.session.config.permission || "read_only").replaceAll(
                "_",
                " ",
              )}
            </SheetDescription>
          </SheetHeader>
          <AgentChat
            w={w}
            prompt={prompt}
            setPrompt={setPrompt}
            onProposal={(p) => {
              setProposal(p);
              setValue("");
            }}
          />
        </SheetContent>
      </Sheet>
      {settings !== null && (
        <Settings
          w={w}
          initialRuntime={settings}
          onClose={() => setSettings(null)}
          onCreated={() => setChat(true)}
        />
      )}
      <Modal
        open={record !== null}
        onClose={() => setRecord(null)}
        title="Original evidence record"
        description="Preserved source data. Treat every field as untrusted input."
        wide
      >
        <JsonView value={record} />
      </Modal>
      <Modal
        open={proposal !== null}
        onClose={() => setProposal(null)}
        title={
          proposal === "save_case_note"
            ? "Propose a case note"
            : "Simulate containment"
        }
        description={
          proposal === "save_case_note"
            ? "This local write requires an appropriate session policy and approval."
            : "Dry-run only. This never isolates an endpoint or contacts a device."
        }
      >
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void w.safe(async () => {
              if (!proposal) return;
              await w.tool(
                proposal,
                proposal === "save_case_note"
                  ? { content: value }
                  : { target: value },
              );
              setProposal(null);
              setChat(false);
            });
          }}
        >
          <Field label={proposal === "save_case_note" ? "Note" : "Target host"}>
            <Textarea
              required
              value={value}
              maxLength={4000}
              onChange={(e) => setValue(e.target.value)}
            />
          </Field>
          <Button disabled={w.busy}>Submit proposal</Button>
        </form>
      </Modal>
      <Modal
        open={palette}
        onClose={() => setPalette(false)}
        title="Go anywhere"
        description="Navigate without triggering an agent or modifying evidence."
      >
        <Input
          aria-label="Search commands"
          autoFocus
          placeholder="Cases, capabilities, tools…"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
        />
        <div className="command-list">
          {nav
            .flatMap((g) => g.items)
            .filter((i) =>
              i.label.toLowerCase().includes(command.toLowerCase()),
            )
            .map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => navigate(id)}>
                <Icon size={17} />
                {label}
                <ArrowRight size={14} />
              </button>
            ))}
          <button
            onClick={() => {
              setPalette(false);
              setGuide(true);
            }}
          >
            <HelpCircle size={17} />
            Getting started
            <ArrowRight size={14} />
          </button>
        </div>
      </Modal>
      {guide && (
        <Guide
          w={w}
          close={() => setGuide(false)}
          configure={() => {
            setGuide(false);
            setSettings("simulator");
          }}
        />
      )}
      {w.notice && (
        <div className="toast" role="status">
          <span>{w.notice}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => w.setNotice("")}
          >
            <X size={17} />
          </button>
        </div>
      )}
    </div>
  );
}
function ApprovalButtons({ w, id }: { w: Workspace; id: string }) {
  const [pending, setPending] = useState(false);
  return (
    <div className="card-actions">
      {(["approve", "deny"] as const).map((decision) => (
        <Button
          key={decision}
          disabled={pending}
          variant={decision === "approve" ? "default" : "outline"}
          onClick={() => {
            setPending(true);
            void w.safe(async () => {
              try {
                await w.sessionAction("approval", { id, decision });
                w.setNotice(
                  "Decision recorded. Inspect the trace for the execution result.",
                );
              } finally {
                setPending(false);
              }
            });
          }}
        >
          {decision === "approve" ? (
            <>
              <Check />
              Approve once
            </>
          ) : (
            "Deny"
          )}
        </Button>
      ))}
    </div>
  );
}
function EvidenceView({
  w,
  inspect,
  draft,
}: {
  w: Workspace;
  inspect: (v: unknown) => void;
  draft: (s: string) => void;
}) {
  const [query, setQuery] = useState(w.search);
  useEffect(() => setQuery(w.search), [w.caseId, w.search]);
  return (
    <Section
      title="Evidence stream"
      description="Imported benchmark records · ordered by stable database ID"
      action={
        <Button
          variant="ghost"
          onClick={() =>
            draft(
              "Review the evidence in this case. Cite record IDs and separate observations from hypotheses.",
            )
          }
        >
          <Play />
          Investigate
        </Button>
      }
    >
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          w.setOffset(0);
          w.setSearch(query);
        }}
      >
        <div className="search-field">
          <Search size={16} />
          <Input
            aria-label="Search evidence"
            placeholder="Search host, event, or record content…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={200}
          />
        </div>
        <Button variant="outline">Filter</Button>
        <span className="muted">{w.total.toLocaleString()} records</span>
      </form>
      <div className="table-scroll" aria-busy={w.evidenceLoading}>
        <table className="evidence-table">
          <thead>
            <tr>
              <th scope="col">Record / time</th>
              <th scope="col">Host</th>
              <th scope="col">Source</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {w.events.map((e) => (
              <tr key={e.id}>
                <td>
                  <strong>
                    <span className="record-mark">#</span>
                    {e.id} <span className="event-id">Event {e.event_id}</span>
                  </strong>
                  <small>{e.occurred_at || "Timestamp not supplied"}</small>
                </td>
                <td>
                  <span className="host-label">
                    <Monitor size={13} />
                    {e.host || "Unknown"}
                  </span>
                </td>
                <td className="source-cell">
                  {(e.source || "Unknown").replace("Microsoft-Windows-", "")}
                </td>
                <td>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={"Inspect record " + e.id}
                    onClick={() => inspect(e)}
                  >
                    <ArrowRight size={16} />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!w.events.length && (
          <Empty
            title={
              w.evidenceLoading ? "Loading evidence…" : "No matching records"
            }
          >
            Adjust your search or choose another review cohort.
          </Empty>
        )}
      </div>
      <div className="pagination">
        <span>
          {w.total
            ? `${w.offset + 1}–${w.offset + w.events.length} of ${w.total.toLocaleString()}`
            : "0 records"}
        </span>
        <div>
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous evidence page"
            disabled={w.offset === 0 || w.evidenceLoading}
            onClick={() => w.setOffset(Math.max(0, w.offset - 15))}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next evidence page"
            disabled={w.offset + 15 >= w.total || w.evidenceLoading}
            onClick={() => w.setOffset(w.offset + 15)}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
    </Section>
  );
}
function AgentChat({
  w,
  prompt,
  setPrompt,
  onProposal,
}: {
  w: Workspace;
  prompt: string;
  setPrompt: (s: string) => void;
  onProposal: (tool: "save_case_note" | "simulate_containment") => void;
}) {
  const end = useRef<HTMLDivElement>(null),
    trace = w.data?.trace || [],
    messages = trace.filter((t) =>
      ["message.user", "message.assistant"].includes(t.kind),
    );
  let last = -1;
  trace.forEach((t, i) => {
    if (["message.user", "message.assistant"].includes(t.kind)) last = i;
  });
  const partial = trace
    .slice(last + 1)
    .filter((t) => t.kind === "message.delta")
    .map((t) => String(t.payload.text || ""))
    .join("");
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, partial]);
  const submit = () => {
    const value = prompt.trim();
    if (!value || w.busy) return;
    setPrompt("");
    void w.safe(() => w.send(value));
  };
  const s = w.data?.session;
  return (
    <>
      <div className="agent-messages">
        {!messages.length && (
          <div className="agent-welcome">
            <span className="agent-symbol large">✳</span>
            <h2>
              Start with a question.
              <br />
              <span>Stay close to the evidence.</span>
            </h2>
            <p>
              Review records, challenge a hypothesis, or prepare a handoff.
              Replay mode makes no model calls.
            </p>
            <button
              disabled={w.busy}
              onClick={() =>
                setPrompt(
                  "Review the evidence in this case. Cite record IDs and separate observations from hypotheses.",
                )
              }
            >
              Review this case <ArrowRight size={15} />
            </button>
            <button
              disabled={w.busy}
              onClick={() =>
                setPrompt(
                  "What evidence is missing, and which bounded query should I run next?",
                )
              }
            >
              Find the next useful question <ArrowRight size={15} />
            </button>
          </div>
        )}
        {messages.map((m) => (
          <div
            className={
              "chat-message " + (m.kind === "message.user" ? "from-user" : "")
            }
            key={m.seq}
          >
            <span>
              {m.kind === "message.user"
                ? "You"
                : String(m.payload.runtime || "Agent")}
            </span>
            <div>{String(m.payload.text || "")}</div>
          </div>
        ))}
        {partial && (
          <div className="chat-message">
            <span>Agent · streaming</span>
            <div>{partial}</div>
          </div>
        )}
        <div ref={end} />
      </div>
      <div className="agent-controls">
        <div className="agent-actions">
          <Button
            size="sm"
            variant="ghost"
            disabled={w.busy}
            onClick={() => onProposal("save_case_note")}
          >
            Case note
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={w.busy}
            onClick={() => onProposal("simulate_containment")}
          >
            Containment dry-run
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={w.busy || !s}
            onClick={() => void w.safe(() => w.sessionAction("compact"))}
          >
            Compact
          </Button>
        </div>
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Textarea
            aria-label="Message the investigation agent"
            placeholder="Ask about this case…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            maxLength={12000}
            disabled={w.busy}
            rows={3}
          />
          <div>
            <span>
              {w.busy
                ? "Agent running"
                : s?.config.runtime === "simulator" || !s
                  ? "Replay · no model cost"
                  : s.config.runtime === "claude"
                    ? `$${(s.cost_usd || 0).toFixed(4)} · ${s.input_tokens || 0} in / ${s.output_tokens || 0} out`
                    : "Cost not reported · no USD cap"}
            </span>
            {w.busy ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void w.safe(() => w.sessionAction("cancel"))}
              >
                <Square size={13} />
                Stop run
              </Button>
            ) : (
              <Button size="sm" disabled={!prompt.trim()}>
                <ArrowRight />
                Send
              </Button>
            )}
          </div>
        </form>
        <p className="run-status" role="status">
          {w.runStatus || "Your prompt is sent only when you choose Send."}
        </p>
      </div>
    </>
  );
}
const steps: { title: string; body: string; view: View }[] = [
  {
    title: "Choose a review cohort",
    body: "Seven open cases organize benchmark evidence by activity. Their priority labels are not confirmed incident verdicts.",
    view: "evidence",
  },
  {
    title: "Inspect the original evidence",
    body: "Use Filter, page through records, and open a record with its arrow. Source content is always treated as untrusted data.",
    view: "evidence",
  },
  {
    title: "Start with deterministic replay",
    body: "Configure a read-only simulator session. No paid model is called. Create the session, open the agent, review your prompt, then choose Send.",
    view: "evidence",
  },
  {
    title: "Follow the agent loop",
    body: "Open Trace to see messages, tool calls, results, permission checks and checkpoints. Export the complete audit as JSON.",
    view: "trace",
  },
  {
    title: "Keep a human in control",
    body: "A supervised session proposes writes. Check the exact arguments in Approvals before approving once or denying. A proposal is not an execution.",
    view: "approvals",
  },
  {
    title: "Explore, with honest boundaries",
    body: "The capability matrix separates native features, Relay tools, partial implementations, and gaps. Configure a live runtime only after reviewing its setup and cost controls.",
    view: "matrix",
  },
];
function Guide({
  w,
  close,
  configure,
}: {
  w: Workspace;
  close: () => void;
  configure: () => void;
}) {
  const [step, setStep] = useState(() =>
    Math.min(
      5,
      Math.max(0, Number(readPreference("relay-guide-v2", "0")) || 0),
    ),
  );
  function go(n: number) {
    setStep(n);
    savePreference("relay-guide-v2", String(n));
  }
  return (
    <Modal
      open
      onClose={close}
      title="Your first investigation"
      description="A guided tour. Navigation never executes tools, creates sessions, or calls a model."
      wide
    >
      <div className="guide-layout">
        <div className="guide-steps">
          {steps.map((s, i) => (
            <button
              className={i === step ? "selected" : ""}
              key={s.title}
              onClick={() => go(i)}
            >
              <span>{i + 1}</span>
              {s.title}
            </button>
          ))}
        </div>
        <div className="guide-content">
          <Status>Step {step + 1} of 6</Status>
          <h2>{steps[step].title}</h2>
          <p>{steps[step].body}</p>
          <Button
            onClick={() => {
              if (step === 2) configure();
              else {
                w.setView(steps[step].view);
                close();
              }
            }}
          >
            {step === 2 ? "Configure safe replay" : "Open this section"}
            <ArrowRight />
          </Button>
        </div>
      </div>
      <div className="dialog-actions">
        <Button
          variant="outline"
          disabled={step === 0}
          onClick={() => go(step - 1)}
        >
          Back
        </Button>
        <Button
          variant="outline"
          onClick={() => (step === 5 ? close() : go(step + 1))}
        >
          {step === 5 ? "Finish" : "Next step"}
        </Button>
      </div>
    </Modal>
  );
}
