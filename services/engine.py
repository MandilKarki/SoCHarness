"""Case-scoped tools and an auditable, cancellable runtime boundary."""
import asyncio
import importlib.util
import json
import os
import threading
import time
from functools import lru_cache
from store import Store, Problem, TOOLS, now, uid

ACTIVE = {}
LOCK = threading.Lock()

@lru_cache(maxsize=1)
def sdk_ready():
    try:
        import claude_agent_sdk
        return True
    except ImportError:return False

def capabilities(store=None):
    from adapters.registry import catalog
    return {'runtimes':catalog(store), 'tools':TOOLS,
        'advanced':__import__('advanced').FEATURES,'playbooks':__import__('advanced').PLAYBOOKS}

class Engine:
    def __init__(self, store, sid, emit=lambda event: None, cancelled=None):
        self.store, self.sid, self.emit = store, sid, emit
        self.cancelled = cancelled or threading.Event()

    def record(self, kind, payload):
        event = self.store.trace(self.sid, kind, payload)
        self.emit(event)
        return event

    def check(self):
        if self.cancelled.is_set(): raise Problem('Run cancelled',409)

    def call(self, name, args, approved=False):
        try:return self._call(name,args,approved)
        except Exception as exc:
            self.record('tool.failed',{'tool':name,'message':str(exc)[:800]})
            raise

    def _call(self, name, args, approved=False):
        self.check()
        s = self.store.session(self.sid)
        config = s['config']
        spec = next((t for t in TOOLS if t['name']==name),None)
        if not spec or name in config['disabled_tools']:
            self.record('tool.denied', {'tool':name,'reason':'Tool disabled or unknown'})
            raise Problem('Tool disabled or unknown',403)
        if spec.get('feature') and not config.get(spec['feature']):raise Problem(spec['feature']+' is disabled for this session',403)
        if name=='rewind_workspace' and self.sid in ACTIVE:raise Problem('Stop the active SDK run before proposing a native rewind',409)
        if not isinstance(args,dict): raise Problem('Tool arguments must be an object')
        self.record('hook.pre_tool', {'tool':name,'arguments':args})
        if config['permission']=='read_only' and spec['effect']!='read':
            self.record('tool.denied',{'tool':name,'reason':'Read-only session'})
            raise Problem('Read-only sessions cannot propose changes',403)
        gated = config['permission']=='ask_all' or spec['effect']!='read'
        if gated and not approved:
            aid=uid('apr')
            self.store.db.execute('INSERT INTO relay_approvals VALUES(?,?,?,?,?,?)',
                (aid,self.sid,name,json.dumps(args),'pending',now()))
            self.store.db.commit()
            self.record('approval.requested',{'id':aid,'tool':name,'arguments':args})
            return {'pending_approval':aid,'message':'No action executed. Review the exact arguments in Approvals.'}
        self.record('tool.started',{'tool':name,'arguments':args})
        if name=='query_case_evidence':
            limit=args.get('limit',5)
            if type(limit) is not int or not 1<=limit<=25: raise Problem('limit must be 1–25')
            search=args.get('search','')
            if not isinstance(search,str): raise Problem('search must be text')
            result=self.store.events(s['case_id'],limit=limit,search=search)
            # Bound model context. Full raw evidence remains available in the UI.
            result['items']=[{**{k:v for k,v in x.items() if k!='raw'},'raw_excerpt':json.dumps(x['raw'])[:1800]} for x in result['items']]
        elif name=='get_event':
            if type(args.get('id')) is not int: raise Problem('id must be an integer')
            row=self.store.event(s['case_id'],args['id'])
            result={**{k:v for k,v in row.items() if k!='raw'},'raw_excerpt':json.dumps(row['raw'])[:6000]}
        elif name=='save_case_note':
            content=args.get('content')
            if not isinstance(content,str) or not 1<=len(content)<=8000: raise Problem('Note must contain 1–8000 characters')
            nid=uid('note')
            self.store.db.execute('INSERT INTO relay_notes VALUES(?,?,?,?,?)',(nid,s['case_id'],self.sid,content,now()))
            self.store.db.commit()
            result={'note_id':nid,'saved':True,'content':content}
        elif name=='simulate_containment':
            target=args.get('target')
            if not isinstance(target,str) or not 1<=len(target)<=200: raise Problem('A target is required')
            result={'target':target,'dry_run':True,'executed_on_endpoint':False,'message':'Recorded simulation only. No sensor/control connector exists.'}
        else:
            from advanced import Advanced
            result=Advanced(self.store,self.sid).execute(name,args)
        self.record('tool.result',{'tool':name,'result':result})
        self.record('hook.post_tool',{'tool':name,'outcome':'success'})
        return result

    def approve(self, aid, decision):
        if decision not in ('approve','deny'): raise Problem('Decision must be approve or deny')
        row=self.store.db.execute('SELECT * FROM relay_approvals WHERE id=? AND session_id=?',(aid,self.sid)).fetchone()
        if not row: raise Problem('Approval not found',404)
        state=('approved' if row['tool'].startswith('sdk:') else 'executing') if decision=='approve' else 'denied'
        cur=self.store.db.execute("UPDATE relay_approvals SET status=? WHERE id=? AND status='pending'",(state,aid))
        self.store.db.commit()
        if cur.rowcount!=1: raise Problem('Approval has already been resolved',409)
        self.record('approval.decided',{'id':aid,'decision':decision})
        if decision=='deny': return {'status':'denied'}
        if row['tool'].startswith('sdk:'):return {'status':'approved','execution':'The waiting SDK tool must still execute; inspect its post-tool receipt.'}
        try:
            result=self.call(row['tool'],json.loads(row['arguments']),approved=True)
        except Exception:
            self.store.db.execute("UPDATE relay_approvals SET status='failed' WHERE id=?",(aid,));self.store.db.commit()
            raise
        self.store.db.execute("UPDATE relay_approvals SET status='executed' WHERE id=?",(aid,));self.store.db.commit()
        self.store.db.execute('INSERT INTO relay_approval_receipts VALUES(?,?)',(aid,json.dumps(result)));self.store.db.commit()
        return result

    async def wait_approval(self,aid,timeout=90,native=False):
        """Resume with the durable execution receipt, never rerun the approved tool."""
        started=time.monotonic()
        self.record('approval.waiting',{'id':aid,'timeout_seconds':timeout})
        try:
            while time.monotonic()-started<timeout:
                self.check()
                row=self.store.db.execute('SELECT * FROM relay_approvals WHERE id=? AND session_id=?',(aid,self.sid)).fetchone()
                if not row:raise Problem('Approval not found',404)
                if native and row['status']=='approved':
                    self.check()
                    cur=self.store.db.execute("UPDATE relay_approvals SET status='executing' WHERE id=? AND status='approved'",(aid,));self.store.db.commit()
                    if cur.rowcount==1:return json.loads(row['arguments'])
                if row['status']=='executed':
                    receipt=self.store.db.execute('SELECT result FROM relay_approval_receipts WHERE id=?',(aid,)).fetchone()
                    if receipt:
                        self.record('approval.resumed',{'id':aid,'status':'executed'})
                        return json.loads(receipt[0])
                elif row['status'] in ('denied','failed','expired','interrupted'):raise Problem('Approval '+row['status'],403)
                await asyncio.sleep(.15)
            raise Problem('Approval timed out; no pending action will execute',408)
        except (Exception,asyncio.CancelledError):
            self.store.db.execute("UPDATE relay_approvals SET status='expired' WHERE id=? AND status IN ('pending','approved')",(aid,));self.store.db.commit()
            raise

    async def native_permission(self,name,args):
        from workspace import validate_tool
        args=validate_tool(self.sid,name,args,self.store.session(self.sid)['config'])
        aid=uid('apr')
        self.store.db.execute('INSERT INTO relay_approvals VALUES(?,?,?,?,?,?)',(aid,self.sid,'sdk:'+name,json.dumps(args),'pending',now()));self.store.db.commit()
        self.record('approval.requested',{'id':aid,'tool':'sdk:'+name,'arguments':args})
        return aid,await self.wait_approval(aid,native=True)

    async def ask_human(self,question,timeout=90):
        from advanced import Advanced
        aid=Advanced(self.store,self.sid).ask(question)
        self.record('input.waiting',{'id':aid,'question':question,'timeout_seconds':timeout})
        started=time.monotonic()
        try:
            while time.monotonic()-started<timeout:
                self.check()
                row=self.store.db.execute('SELECT status,answer FROM relay_questions WHERE id=?',(aid,)).fetchone()
                if row['status']=='answered':
                    self.record('input.resumed',{'id':aid});return {'answer':row['answer']}
                if row['status']!='pending':raise Problem('Question expired',409)
                await asyncio.sleep(.15)
            raise Problem('Human input timed out',408)
        finally:
            self.store.db.execute("UPDATE relay_questions SET status='expired' WHERE id=? AND status='pending'",(aid,));self.store.db.commit()

    def run(self, prompt):
        self.record('message.user',{'text':prompt})
        self.record('run.started',{'runtime':self.store.session(self.sid)['config']['runtime']})
        try:
            s=self.store.session(self.sid)
            # Inspection receipts duplicate the native transcript; they are not
            # conversation context and must not cause premature compaction.
            context=json.dumps([event for event in self.store.traces(self.sid,s['context_after'])
                if event['kind'] not in ('model.request','model.response','harness.configured','session.context','session.loaded','session.staged','session.committed')])
            if len(context)>s['config']['context_chars']:
                self.store.compact(self.sid)
                s=self.store.session(self.sid)
            self.record('context.usage',{'retained_chars':len(context),'threshold_chars':s['config']['context_chars'],
                'note':'Local character estimate, not the model token window. SDK compaction is reported separately.'})
            if s['config']['runtime']!='simulator':
                from adapters.registry import run
                async def bounded_run():
                    await asyncio.wait_for(run(self,prompt),timeout=180)
                asyncio.run(bounded_run())
            else:
                result=self.call('query_case_evidence',{'limit':5,'search':''})
                if 'pending_approval' in result and s['config']['await_approvals']:
                    result=asyncio.run(self.wait_approval(result['pending_approval']))
                if 'pending_approval' in result:
                    text='Evidence access is awaiting your approval. No records have been read by this run.'
                else:
                    ids=[r['id'] for r in result['items']]
                    text=f"Replay completed for {s['case_id']}: {result['total']:,} records available; sampled {len(ids)} records ({', '.join(map(str,ids))}). This is a deterministic harness demonstration, not an AI threat verdict. Inspect the records, then use Claude for model-driven investigation."
                self.record('message.assistant',{'text':text,'runtime':'simulator'})
                self.record('checkpoint',{'summary':text,'case_id':s['case_id'],'evidence_ids':[r['id'] for r in result.get('items',[])],'verdict':'not_assessed'})
            self.check()
            self.record('run.completed',{'status':'completed'})
        except (Exception,asyncio.CancelledError) as exc:
            message='Run exceeded the 180-second local timeout' if isinstance(exc,asyncio.TimeoutError) else str(exc) or 'Run cancelled'
            self.record('run.cancelled' if self.cancelled.is_set() else 'run.failed',{'message':message[:1200]})
        finally:
            self.store.status(self.sid,'idle')

def cancel(sid):
    with LOCK:
        event=ACTIVE.get(sid)
        if not event: raise Problem('No active run',409)
        event.set()
