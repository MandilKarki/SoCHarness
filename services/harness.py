"""Relay's framework-neutral, evidence-first agent harness.

The model adapter may be Claude Agent SDK, Pi, Deep Agents, or a deterministic
simulator. The harness - not the model - owns session state, permissions,
tool records, checkpoints, and completion evidence.
"""
from __future__ import annotations

import json, sqlite3, uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

DB = Path(__file__).resolve().parents[1] / "work" / "telemetry-lab.sqlite3"
now = lambda: datetime.now(timezone.utc).isoformat()

@dataclass
class Message: role: str; content: str; created_at: str
@dataclass
class ToolProposal: name: str; arguments: dict; permission: str = "ask"

class Harness:
    def __init__(self, db: Path = DB):
        self.db = sqlite3.connect(db)
        self.db.execute("CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, runtime TEXT, mode TEXT, status TEXT, created_at TEXT)")
        self.db.execute("CREATE TABLE IF NOT EXISTS turns(id TEXT PRIMARY KEY, session_id TEXT, type TEXT, payload TEXT, created_at TEXT)")
        self.db.execute("CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY, session_id TEXT, proposal TEXT, status TEXT, created_at TEXT)")
        self.db.commit()
    def create_session(self, runtime: str = "claude-agent-sdk", mode: str = "simulated") -> str:
        session_id = f"ses_{uuid.uuid4().hex[:12]}"; self.db.execute("INSERT INTO sessions VALUES(?,?,?,?,?)", (session_id,runtime,mode,"idle",now())); self.db.commit(); return session_id
    def record(self, session_id: str, kind: str, payload: dict) -> str:
        turn_id=f"evt_{uuid.uuid4().hex[:12]}"; self.db.execute("INSERT INTO turns VALUES(?,?,?,?,?)",(turn_id,session_id,kind,json.dumps(payload),now()));self.db.commit();return turn_id
    def submit(self, session_id: str, message: Message) -> ToolProposal:
        self.record(session_id,"user.message",asdict(message)); self.db.execute("UPDATE sessions SET status='running' WHERE id=?",(session_id,)); self.db.commit()
        return ToolProposal("query_case_evidence", {"case_id":"IR-2841","limit":12}, "allow")
    def decide_tool(self, session_id: str, proposal: ToolProposal, approved: bool) -> None:
        outcome="approved" if approved else "denied"; self.record(session_id,"tool.decision",{"proposal":asdict(proposal),"outcome":outcome})
        self.db.execute("UPDATE sessions SET status=? WHERE id=?",("running" if approved else "idle",session_id));self.db.commit()
    def checkpoint(self, session_id: str, evidence_ids: list[int], summary: str) -> None:
        self.record(session_id,"checkpoint",{"evidence_ids":evidence_ids,"summary":summary});self.db.execute("UPDATE sessions SET status='idle' WHERE id=?",(session_id,));self.db.commit()
    def sessions(self) -> list[dict]:
        return [{"id":r[0],"runtime":r[1],"mode":r[2],"status":r[3],"created_at":r[4]} for r in self.db.execute("SELECT * FROM sessions ORDER BY created_at DESC")]
    def turns(self, session_id: str) -> list[dict]:
        return [{"id":r[0],"type":r[1],"payload":json.loads(r[2]),"created_at":r[3]} for r in self.db.execute("SELECT id,type,payload,created_at FROM turns WHERE session_id=? ORDER BY created_at",(session_id,))]
    def request_approval(self, session_id: str, proposal: ToolProposal) -> str:
        approval_id=f"apr_{uuid.uuid4().hex[:12]}";self.db.execute("INSERT INTO approvals VALUES(?,?,?,?,?)",(approval_id,session_id,json.dumps(asdict(proposal)),"pending",now()));self.db.execute("UPDATE sessions SET status='awaiting_approval' WHERE id=?",(session_id,));self.db.commit();return approval_id
    def resolve_approval(self, approval_id: str, approved: bool) -> None:
        self.db.execute("UPDATE approvals SET status=? WHERE id=?",("approved" if approved else "denied",approval_id));self.db.commit()
