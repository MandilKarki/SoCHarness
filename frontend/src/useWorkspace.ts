import { useCallback, useEffect, useRef, useState } from "react";
import { api, download, errorText, mergeTrace, readNDJSON } from "./lib/api";
import {
  defaultConfig,
  type Adapter,
  type Advanced,
  type Config,
  type Deployment,
  type Evidence,
  type Incident,
  type Inventory,
  type Json,
  type Session,
  type SessionData,
  type Tool,
  type Trace,
  type View,
} from "./lib/types";
export function useWorkspace(runtime?: string) {
  const [cases, setCases] = useState<Incident[]>([]),
    [caseId, setCaseId] = useState(""),
    [sessions, setSessions] = useState<Session[]>([]);
  const [data, setData] = useState<SessionData | null>(null),
    [advanced, setAdvanced] = useState<Advanced | null>(null),
    [adapters, setAdapters] = useState<Adapter[]>([]),
    [tools, setTools] = useState<Tool[]>([]);
  const [inventory, setInventory] = useState<Inventory | null>(null),
    [deployment, setDeployment] = useState<Deployment | null>(null);
  const [events, setEvents] = useState<Evidence[]>([]),
    [total, setTotal] = useState(0),
    [offset, setOffset] = useState(0),
    [search, setSearch] = useState(""),
    [loading, setLoading] = useState(true),
    [evidenceLoading, setEvidenceLoading] = useState(false);
  const [view, setView] = useState<View>(() =>
      window.location.hash === "#sdk-lab" ? "sdk-lab" : "evidence",
    ),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [runStatus, setRunStatus] = useState(""),
    [refreshId, setRefreshId] = useState(0);
  const lock = useRef(false),
    selected = useRef(""),
    sessionRef = useRef<Session | null>(null),
    mounted = useRef(true);
  sessionRef.current = data?.session || null;
  const safe = useCallback(async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (error) {
      setNotice(errorText(error));
    }
  }, []);
  const refreshRegistry = useCallback(async () => {
    await Promise.all([
      api<Adapter[]>("/api/adapters").then(setAdapters),
      api<Inventory>("/api/inventory").then((i) => {
        setInventory(i);
        setTools(i.tools);
      }),
      api<Deployment>("/api/deployment").then(setDeployment),
      api<Session[]>("/api/sessions").then(setSessions),
    ]);
  }, []);
  useEffect(() => {
    mounted.current = true;
    let alive = true;
    // Evidence becomes usable independently of slower SDK dependency checks.
    void refreshRegistry().catch((error) => {
      if (alive) setNotice(errorText(error));
    });
    void (async () => {
      try {
        const c = await api<Incident[]>("/api/incidents");
        if (!alive) return;
        setCases(c);
        selected.current = c[0]?.id || "";
        setCaseId(selected.current);
      } catch (error) {
        if (alive) setNotice(errorText(error));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      mounted.current = false;
    };
  }, [refreshRegistry]);
  useEffect(() => {
    if (!caseId) return;
    let alive = true;
    setEvidenceLoading(true);
    void api<{ items: Evidence[]; total: number }>(
      "/api/events?" +
        new URLSearchParams({
          case_id: caseId,
          limit: "15",
          offset: String(offset),
          search,
        }),
    )
      .then((result) => {
        if (alive) {
          setEvents(result.items);
          setTotal(result.total);
        }
      })
      .catch((error) => {
        if (alive) {
          setEvents([]);
          setTotal(0);
          setNotice(errorText(error));
        }
      })
      .finally(() => {
        if (alive) setEvidenceLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [caseId, offset, search, refreshId]);
  const sync = useCallback(async (id: string) => {
    const [next, lab] = await Promise.all([
      api<SessionData>("/api/sessions/" + id),
      api<Advanced>("/api/sessions/" + id + "/advanced"),
    ]);
    if (!mounted.current || next.session.case_id !== selected.current) return;
    if (sessionRef.current && sessionRef.current.id !== id) return;
    setData((old) => ({
      ...next,
      trace:
        lock.current && old?.session.id === id
          ? mergeTrace(old.trace, next.trace)
          : next.trace,
    }));
    setAdvanced(lab);
  }, []);
  useEffect(() => {
    if (!caseId) return;
    let alive = true;
    void (async () => {
      try {
        const all = await api<Session[]>("/api/sessions");
        if (!alive) return;
        setSessions(all);
        const latest = all.find(
          (s) =>
            s.case_id === caseId && (!runtime || s.config.runtime === runtime),
        );
        if (latest && !sessionRef.current && !lock.current) {
          sessionRef.current = latest;
          await sync(latest.id);
        }
      } catch (error) {
        if (alive) setNotice(errorText(error));
      }
    })();
    return () => {
      alive = false;
    };
  }, [caseId, sync, runtime]);
  useEffect(() => {
    if ((!busy && data?.session.status !== "running") || !data?.session.id)
      return;
    let pending = false;
    const id = data.session.id;
    const timer = setInterval(() => {
      if (pending) return;
      pending = true;
      void sync(id)
        .catch((error) => setNotice(errorText(error)))
        .finally(() => {
          pending = false;
        });
    }, 2000);
    return () => clearInterval(timer);
  }, [busy, data?.session.id, data?.session.status, sync]);
  const idle = () => {
    if (lock.current)
      throw Error(
        "Finish or stop the active run before changing the investigation.",
      );
  };
  const selectCase = (id: string) => {
    idle();
    if (id === selected.current) {
      setView("evidence");
      return;
    }
    selected.current = id;
    sessionRef.current = null;
    setCaseId(id);
    setData(null);
    setAdvanced(null);
    setOffset(0);
    setSearch("");
    setEvents([]);
    setTotal(0);
    setRunStatus("");
    setView("evidence");
  };
  const loadSession = async (s: Session) => {
    idle();
    sessionRef.current = s;
    setData(null);
    setAdvanced(null);
    await sync(s.id);
  };
  const create = async (config: Config = defaultConfig) => {
    if (!selected.current) throw Error("Select a case first.");
    const s = await api<Session>("/api/sessions", {
      case_id: selected.current,
      config,
    });
    sessionRef.current = s;
    setData({ session: s, trace: [], approvals: [] });
    setSessions((old) => [s, ...old]);
    await sync(s.id);
    return s;
  };
  const newSession = async (config: Config) => {
    idle();
    lock.current = true;
    setBusy(true);
    try {
      return await create(config);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const send = async (message: string) => {
    idle();
    if (!message.trim()) return;
    lock.current = true;
    setBusy(true);
    setRunStatus("Starting investigation…");
    let s = sessionRef.current;
    let failed = false,
      completed = false;
    try {
      s = s || (await create());
      const response = await fetch(`/api/sessions/${s.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (!response.ok)
        throw Error((await response.json()).error || "Run request failed");
      if (!response.body)
        throw Error("Streaming is unavailable in this browser.");
      await readNDJSON(response.body, (event: Trace) => {
        setData((old) =>
          old ? { ...old, trace: mergeTrace(old.trace, [event]) } : old,
        );
        setRunStatus(event.kind);
        if (event.kind === "run.completed") completed = true;
        if (event.kind === "approval.waiting") setView("approvals");
        if (event.kind === "input.waiting") setView("lab");
        if (event.kind === "run.failed" || event.kind === "run.cancelled") {
          failed = true;
          setNotice(String(event.payload.message || event.kind));
        }
      });
      if (!completed && !failed)
        throw Error(
          "The stream ended before completion was confirmed. Inspect the trace before retrying.",
        );
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      lock.current = false;
      setBusy(false);
      setRunStatus(
        failed
          ? "Run stopped — inspect the trace."
          : "Run complete · audit saved",
      );
      if (s) await sync(s.id);
      await refreshRegistry();
    }
  };
  const sessionAction = async (action: string, body: unknown = {}) => {
    if (!sessionRef.current) throw Error("Create a session first.");
    const id = sessionRef.current.id;
    await api(`/api/sessions/${id}/${action}`, body);
    await sync(id);
  };
  const tool = async (name: string, args: Record<string, Json>) => {
    idle();
    lock.current = true;
    setBusy(true);
    try {
      const s = sessionRef.current || (await create(defaultConfig));
      const result = await api<Record<string, Json>>(
        `/api/sessions/${s.id}/tool`,
        { tool: name, arguments: args },
      );
      await sync(s.id);
      if (result.pending_approval) {
        setView("approvals");
        setNotice(
          "Action proposed. Review its exact arguments before approval.",
        );
      } else
        setNotice(
          "Tool returned. Inspect the trace for the execution receipt.",
        );
      return result;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const fork = async (seq: number) => {
    idle();
    if (!sessionRef.current) throw Error("Create a session first.");
    const child = await api<Session>(
      `/api/sessions/${sessionRef.current.id}/fork`,
      { seq },
    );
    await loadSession(child);
    await refreshRegistry();
    setNotice(
      "Created a conversation branch. No files or external actions were undone.",
    );
  };
  const exportSession = async (kind = "export") => {
    if (!data) throw Error("Create a session first.");
    download(
      `${data.session.id}-${kind}.json`,
      await api(`/api/sessions/${data.session.id}/${kind}`),
    );
  };
  const refresh = async () => {
    await refreshRegistry();
    setRefreshId((n) => n + 1);
    if (sessionRef.current) await sync(sessionRef.current.id);
    setNotice("Workspace refreshed. No model call made.");
  };
  return {
    cases,
    caseId,
    sessions,
    data,
    advanced,
    adapters,
    tools,
    inventory,
    deployment,
    events,
    total,
    offset,
    setOffset,
    search,
    setSearch,
    loading,
    evidenceLoading,
    view,
    setView,
    busy,
    notice,
    setNotice,
    runStatus,
    safe,
    selectCase,
    loadSession,
    newSession,
    send,
    sessionAction,
    tool,
    fork,
    exportSession,
    refresh,
    refreshRegistry,
  };
}
export type Workspace = ReturnType<typeof useWorkspace>;
