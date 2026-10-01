"""SQLite evidence and harness state. Raw benchmark records are never mutated."""
from __future__ import annotations
import json
import os
import sqlite3
import uuid
import math
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = Path(os.environ.get('RELAY_DATA_DIR', ROOT / 'work'))
DB = Path(os.environ.get('RELAY_DB', DATA / 'telemetry-lab.sqlite3'))

def now():
    return datetime.now(timezone.utc).isoformat()

def uid(prefix):
    return prefix + '_' + uuid.uuid4().hex

# These are review cohorts, not detector verdicts. Event IDs alone do not prove malice.
CASES = [
    ('IR-2841', 'Identity & credential review', 'critical', ['4624','4625','4648','4776'], 'Authentication records'),
    ('IR-2840', 'Process execution review', 'critical', ['1','4688','4103','4104','800'], 'Process and script activity'),
    ('IR-2839', 'Persistence review', 'high', ['12','13','14','4698','7045'], 'Registry and scheduled tasks'),
    ('IR-2838', 'Process access review', 'high', ['10','4656','4690'], 'Cross-process and object access'),
    ('IR-2837', 'Network activity review', 'high', ['3','5156','5158','22'], 'Connections and DNS'),
    ('IR-2836', 'Privilege change review', 'medium', ['4672','4673','4703','4720','4732'], 'Privilege and account activity'),
    ('IR-2835', 'File & system review', 'medium', [], 'Remaining file and system records'),
]
ALL_IDS = [v for c in CASES for v in c[3]]
DEFAULT_CONFIG = {'runtime': 'simulator', 'model': 'sonnet', 'permission': 'read_only',
                  'max_turns': 8, 'budget_usd': 1.0, 'context_chars': 24000,
                  'disabled_tools': [], 'structured_output': False, 'specialists': False,
                  'skills': False, 'memory': False, 'artifacts': False, 'await_approvals': True, 'file_workspace': False,
                  'max_output_tokens': 2048, 'accept_no_usd_cap': False, 'thinking': 'off'}
TOOLS = [
    {'name':'query_case_evidence','effect':'read','description':'Retrieve bounded records from the selected case.'},
    {'name':'get_event','effect':'read','description':'Inspect one raw record within this case.'},
    {'name':'save_case_note','effect':'write','description':'Save a local case note after approval.'},
    {'name':'simulate_containment','effect':'simulation','description':'Record a dry-run decision. Never contacts a device or identity provider.'},
    {'name':'search_memory','effect':'read','description':'Search analyst-approved memory in this case only.','feature':'memory'},
    {'name':'remember_finding','effect':'write','description':'Remember a finding with in-case evidence IDs after approval.','feature':'memory'},
    {'name':'list_tasks','effect':'read','description':'List this session investigation plan.'},
    {'name':'set_task','effect':'write','description':'Create or update an investigation task after approval.'},
    {'name':'get_playbook','effect':'read','description':'Read a vetted SOC investigation skill.','feature':'skills'},
    {'name':'read_artifact','effect':'read','description':'Read a versioned report in this session.','feature':'artifacts'},
    {'name':'write_artifact','effect':'write','description':'Save a versioned report after approval.','feature':'artifacts'},
    {'name':'restore_artifact','effect':'write','description':'Restore an earlier report version as a new version after approval.','feature':'artifacts'},
    {'name':'ask_human','effect':'read','description':'Ask the analyst a question and wait for a durable answer in the active SDK run.'},
    {'name':'rewind_workspace','effect':'write','description':'Rewind native SDK file changes to a recorded checkpoint after approval.','feature':'file_workspace'},
]

class Problem(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status

class Store:
    def __init__(self, path=DB):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, timeout=15)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA foreign_keys=ON')

    def __enter__(self): return self
    def __exit__(self, *_): self.db.close()

    def initialize(self):
        self.db.execute('PRAGMA journal_mode=WAL')
        # Cover cohort counts without scanning large raw telemetry JSON pages.
        self.db.execute('CREATE INDEX IF NOT EXISTS relay_events_cohort ON events(event_id,host,occurred_at)')
        self.db.executescript('''
          CREATE TABLE IF NOT EXISTS relay_adapters(id TEXT PRIMARY KEY, enabled INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS relay_trial(id INTEGER PRIMARY KEY CHECK(id=1),expires_at REAL NOT NULL,halted INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS relay_trial_calls(
            id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES relay_sessions(id),model TEXT NOT NULL,
            charged_micros INTEGER NOT NULL CHECK(charged_micros>=0),state TEXT NOT NULL,
            input_tokens INTEGER,output_tokens INTEGER,created_at TEXT NOT NULL,settled_at TEXT);
          CREATE TABLE IF NOT EXISTS relay_auth_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS relay_passkeys(
            id TEXT PRIMARY KEY,public_key BLOB NOT NULL,sign_count INTEGER NOT NULL,
            label TEXT NOT NULL,created_at TEXT NOT NULL,last_used_at TEXT,
            device_type TEXT NOT NULL,backed_up INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS relay_auth_audit(
            id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,credential_id TEXT,
            created_at TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS relay_native_state(
            session_id TEXT PRIMARY KEY REFERENCES relay_sessions(id), runtime TEXT NOT NULL,
            context_after INTEGER NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS relay_sessions(
            id TEXT PRIMARY KEY, case_id TEXT NOT NULL, title TEXT NOT NULL,
            config TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'idle', created_at TEXT NOT NULL,
            sdk_session TEXT, cost_usd REAL NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0,
            output_tokens INTEGER NOT NULL DEFAULT 0, context_summary TEXT NOT NULL DEFAULT '',
            context_after INTEGER NOT NULL DEFAULT 0, parent_id TEXT);
          CREATE TABLE IF NOT EXISTS relay_trace(
            seq INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES relay_sessions(id),
            kind TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS relay_trace_session ON relay_trace(session_id,seq);
          CREATE TABLE IF NOT EXISTS relay_approvals(
            id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES relay_sessions(id),
            tool TEXT NOT NULL, arguments TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS relay_notes(
            id TEXT PRIMARY KEY, case_id TEXT NOT NULL, session_id TEXT NOT NULL,
            content TEXT NOT NULL, created_at TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS events_type ON events(event_id);
          CREATE TABLE IF NOT EXISTS relay_approval_receipts(id TEXT PRIMARY KEY, result TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS relay_memory(id TEXT PRIMARY KEY,case_id TEXT NOT NULL,session_id TEXT NOT NULL,content TEXT NOT NULL,evidence_ids TEXT NOT NULL,created_at TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS relay_memory_case ON relay_memory(case_id);
          CREATE TABLE IF NOT EXISTS relay_tasks(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,title TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS relay_artifacts(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,name TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(session_id,name));
          CREATE TABLE IF NOT EXISTS relay_artifact_versions(id INTEGER PRIMARY KEY AUTOINCREMENT,artifact_id TEXT NOT NULL REFERENCES relay_artifacts(id),content TEXT NOT NULL,created_at TEXT NOT NULL,restored_from INTEGER);
          CREATE TABLE IF NOT EXISTS relay_questions(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,question TEXT NOT NULL,status TEXT NOT NULL,answer TEXT,created_at TEXT NOT NULL);
        ''')
        self.db.commit()

    def recover(self):
        for r in self.db.execute("SELECT id FROM relay_sessions WHERE status='running'").fetchall():
            self.trace(r['id'], 'run.interrupted', {'reason':'Server restarted; resume explicitly.'})
        self.db.execute("UPDATE relay_sessions SET status='idle' WHERE status='running'")
        self.db.execute("UPDATE relay_approvals SET status='interrupted' WHERE status='executing'")
        self.db.execute("UPDATE relay_approvals SET status='expired' WHERE tool LIKE 'sdk:%' AND status IN ('pending','approved')")
        self.db.execute("UPDATE relay_questions SET status='expired' WHERE status='pending'")
        self.db.commit()

    def clause(self, case_id):
        case = next((c for c in CASES if c[0] == case_id), None)
        if not case: raise Problem('Unknown case', 404)
        ids = case[3] or ALL_IDS
        return 'event_id ' + ('IN' if case[3] else 'NOT IN') + '(' + ','.join('?' for _ in ids) + ')', ids

    def cases(self):
        result = []
        for cid, title, priority, _, scenario in CASES:
            where, params = self.clause(cid)
            row = self.db.execute('SELECT count(*) n,count(DISTINCT host) hosts,min(occurred_at) first_at FROM events WHERE '+where, params).fetchone()
            result.append(dict(id=cid,title=title,severity=priority,status='open',scenario=scenario,
                               event_count=row['n'],asset_count=row['hosts'],first_at=row['first_at'],
                               source='Defense Collective benchmark',kind='review_cohort'))
        return result

    def events(self, case_id, limit=25, offset=0, search=''):
        where, params = self.clause(case_id)
        params = list(params)
        if search:
            where += ' AND (host LIKE ? OR raw_json LIKE ?)'
            params += ['%'+search[:200]+'%']*2
        count = self.db.execute('SELECT count(*) FROM events WHERE '+where,params).fetchone()[0]
        rows = self.db.execute('SELECT * FROM events WHERE '+where+' ORDER BY id LIMIT ? OFFSET ?',params+[limit,offset]).fetchall()
        return {'total':count,'offset':offset,'items':[self.event_dict(r) for r in rows]}

    @staticmethod
    def event_dict(row):
        r = dict(row)
        r['raw'] = json.loads(r.pop('raw_json'))
        r['source'] = r['source'] or r['raw'].get('SourceName') or 'benchmark'
        return r

    def event(self, case_id, event_id):
        where, params = self.clause(case_id)
        row = self.db.execute('SELECT * FROM events WHERE id=? AND '+where,[event_id]+list(params)).fetchone()
        if not row: raise Problem('Evidence is not in this case',404)
        return self.event_dict(row)

    def create(self, case_id, config=None, title=None, parent=None):
        self.clause(case_id)
        if config is not None and not isinstance(config,dict): raise Problem('Configuration must be an object')
        if title is not None and not isinstance(title,str): raise Problem('Title must be text')
        if config and set(config)-set(DEFAULT_CONFIG): raise Problem('Unknown configuration fields')
        config = {**DEFAULT_CONFIG, **(config or {})}
        from adapters.registry import validate
        validate(config)
        if config['permission'] not in ('read_only','ask_all','supervised'): raise Problem('Unknown permission policy')
        for field, lo, hi in [('max_turns',1,30),('context_chars',4000,100000),('max_output_tokens',128,8192)]:
            if type(config[field]) is not int or not lo<=config[field]<=hi: raise Problem('Invalid '+field)
        if type(config['budget_usd']) not in (int,float) or not math.isfinite(config['budget_usd']) or not 0<config['budget_usd']<=25: raise Problem('Budget must be between 0 and 25 USD')
        if type(config['structured_output']) is not bool: raise Problem('structured_output must be boolean')
        for key in ('specialists','skills','memory','artifacts','await_approvals','file_workspace','accept_no_usd_cap'):
            if type(config[key]) is not bool:raise Problem(key+' must be boolean')
        if config['thinking'] not in ('off','minimal','low','medium','high'):raise Problem('Invalid thinking level')
        if config['thinking']!='off' and config['runtime'] not in ('pi','claude'):raise Problem('Thinking control is only integrated for Pi and Claude')
        if config['runtime']=='claude' and config['thinking']=='minimal':raise Problem('Claude supports low, medium or high thinking in Relay')
        if not isinstance(config['model'],str) or not 1<=len(config['model'])<=100: raise Problem('Invalid model')
        if not isinstance(config['disabled_tools'],list) or any(t not in [x['name'] for x in TOOLS] for t in config['disabled_tools']): raise Problem('Invalid disabled tools')
        sid=uid('ses')
        self.db.execute('INSERT INTO relay_sessions(id,case_id,title,config,created_at,parent_id) VALUES(?,?,?,?,?,?)',
                        (sid,case_id,(title or 'Investigation '+case_id)[:100],json.dumps(config),now(),parent))
        self.db.commit()
        self.trace(sid,'session.created',{'case_id':case_id,'config':config,'parent_id':parent})
        return self.session(sid)

    def session(self,sid):
        row=self.db.execute('SELECT * FROM relay_sessions WHERE id=?',(sid,)).fetchone()
        if not row: raise Problem('Session not found',404)
        r=dict(row)
        saved=json.loads(r['config'])
        r['config']={**DEFAULT_CONFIG,**{k:v for k,v in saved.items() if k in DEFAULT_CONFIG}}
        return r

    def sessions(self):
        return [self.session(r[0]) for r in self.db.execute('SELECT id FROM relay_sessions ORDER BY created_at DESC LIMIT 200').fetchall()]

    def trace(self,sid,kind,payload):
        self.session(sid)
        at=now()
        cur=self.db.execute('INSERT INTO relay_trace(session_id,kind,payload,created_at) VALUES(?,?,?,?)',(sid,kind,json.dumps(payload),at))
        self.db.commit()
        return {'seq':cur.lastrowid,'session_id':sid,'kind':kind,'payload':payload,'created_at':at}

    def traces(self,sid,after=0):
        self.session(sid)
        return [dict(seq=r['seq'],session_id=sid,kind=r['kind'],payload=json.loads(r['payload']),created_at=r['created_at']) for r in self.db.execute('SELECT * FROM relay_trace WHERE session_id=? AND seq>? ORDER BY seq',(sid,after))]

    def status(self,sid,status):
        self.db.execute('UPDATE relay_sessions SET status=? WHERE id=?',(status,sid));self.db.commit()

    def begin(self,sid):
        self.session(sid)
        cur=self.db.execute("UPDATE relay_sessions SET status='running' WHERE id=? AND status='idle'",(sid,))
        self.db.commit()
        if cur.rowcount!=1: raise Problem('Session is busy or waiting for approval',409)

    def compact(self,sid):
        session=self.session(sid)
        turns=self.traces(sid,session['context_after'])
        last=next((t for t in reversed(turns) if t['kind']=='checkpoint'),None)
        summary=json.dumps(last['payload']) if last else session['context_summary']
        cutoff=last['seq'] if last else session['context_after']
        self.db.execute('UPDATE relay_sessions SET context_summary=?,context_after=?,sdk_session=NULL WHERE id=?',(summary[:8000],cutoff,sid));self.db.commit()
        return self.trace(sid,'context.compacted',{'through_seq':cutoff,'summary_chars':len(summary[:8000]),'method':'Keep last verified checkpoint; raw audit remains intact.'})

    def fork(self,sid,seq):
        s=self.session(sid)
        checkpoint=next((t for t in self.traces(sid) if t['seq']==seq and t['kind']=='checkpoint'),None)
        if not checkpoint: raise Problem('Checkpoint not found',404)
        child=self.create(s['case_id'],s['config'],'Branch of '+s['title'],sid)
        self.db.execute('UPDATE relay_sessions SET context_summary=? WHERE id=?',(json.dumps(checkpoint['payload']),child['id']));self.db.commit()
        self.trace(child['id'],'session.forked',{'parent_id':sid,'checkpoint_seq':seq,'note':'Conversation branch only; does not undo filesystem or external actions.'})
        return self.session(child['id'])
