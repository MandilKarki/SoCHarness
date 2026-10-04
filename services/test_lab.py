"""Run: python -m unittest discover -s services -p test_*.py -v"""
import json
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from pathlib import Path
from unittest.mock import patch
from http.server import ThreadingHTTPServer
from store import Store, Problem
from engine import Engine
from app import Handler

class LabFixture(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.path=Path(self.temp.name)/'test.sqlite'
        self.store=Store(self.path)
        self.store.db.execute('CREATE TABLE events(id INTEGER PRIMARY KEY,occurred_at TEXT,event_id TEXT,host TEXT,user_name TEXT,source TEXT,raw_json TEXT)')
        for i,event in enumerate(['4624','4625','4688','13','10','5156','4673','11'],1):
            self.store.db.execute('INSERT INTO events VALUES(?,?,?,?,?,?,?)',(i,'2026-01-01',event,'host-1','user','test',json.dumps({'message':'<script>alert(1)</script>'})))
        self.store.db.commit();self.store.initialize()

    def tearDown(self):self.store.db.close();self.temp.cleanup()
    def session(self,**config):return self.store.create('IR-2841',config)['id']

class LabTest(LabFixture):
    def test_seven_disjoint_stable_cohorts(self):
        cases=[c for c in self.store.cases() if c['kind']=='review_cohort'];self.assertEqual(len(cases),7)
        self.assertEqual(sum(c['event_count'] for c in cases),8)
        small=self.store.events('IR-2841',1)['items'];large=self.store.events('IR-2841',2)['items']
        self.assertEqual(small,large[:1])

    def test_case_scope(self):
        sid=self.session()
        with self.assertRaises(Problem):Engine(self.store,sid).call('get_event',{'id':3})

    def test_read_only_denies_write(self):
        sid=self.session()
        with self.assertRaises(Problem):Engine(self.store,sid).call('save_case_note',{'content':'No'})
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM relay_notes').fetchone()[0],0)

    def test_approval_executes_exactly_once(self):
        sid=self.session(permission='supervised');engine=Engine(self.store,sid)
        aid=engine.call('save_case_note',{'content':'Evidence reviewed'})['pending_approval']
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM relay_notes').fetchone()[0],0)
        engine.approve(aid,'approve')
        with self.assertRaises(Problem):engine.approve(aid,'approve')
        self.assertEqual(self.store.db.execute('SELECT content FROM relay_notes').fetchone()[0],'Evidence reviewed')

    def test_missing_and_cross_session_approval(self):
        sid=self.session(permission='supervised');engine=Engine(self.store,sid)
        with self.assertRaises(Problem):engine.approve('missing','approve')
        aid=engine.call('save_case_note',{'content':'private'})['pending_approval']
        with self.assertRaises(Problem):Engine(self.store,self.session()).approve(aid,'approve')

    def test_denial_has_no_side_effect(self):
        sid=self.session(permission='supervised');engine=Engine(self.store,sid)
        aid=engine.call('save_case_note',{'content':'No'})['pending_approval'];engine.approve(aid,'deny')
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM relay_notes').fetchone()[0],0)

    def test_disabled_tool(self):
        sid=self.session(disabled_tools=['query_case_evidence'])
        with self.assertRaises(Problem):Engine(self.store,sid).call('query_case_evidence',{})

    def test_ask_all_gates_reads(self):
        sid=self.session(permission='ask_all');engine=Engine(self.store,sid)
        aid=engine.call('query_case_evidence',{'limit':1})['pending_approval']
        self.assertFalse(any(t['kind']=='tool.result' for t in self.store.traces(sid)))
        self.assertEqual(engine.approve(aid,'approve')['items'][0]['id'],1)

    def test_replay_and_checkpoint_branch(self):
        sid=self.session();self.store.begin(sid);Engine(self.store,sid).run('Review')
        trace=self.store.traces(sid);self.assertEqual(trace[-1]['kind'],'run.completed')
        cp=next(t for t in trace if t['kind']=='checkpoint');child=self.store.fork(sid,cp['seq'])
        self.assertEqual(child['parent_id'],sid);self.assertIsNone(child['sdk_session'])
        self.store.compact(sid);self.assertEqual(self.store.session(sid)['context_after'],cp['seq'])
        self.assertTrue(self.store.traces(sid))

    def test_session_run_lock(self):
        sid=self.session();self.store.begin(sid)
        with self.assertRaises(Problem):self.store.begin(sid)

    def test_cancel_before_tool(self):
        sid=self.session();stop=threading.Event();stop.set()
        Engine(self.store,sid,cancelled=stop).run('Review')
        self.assertEqual(self.store.traces(sid)[-1]['kind'],'run.cancelled')
        self.assertFalse(any(t['kind']=='tool.result' for t in self.store.traces(sid)))

    def test_recovery(self):
        sid=self.session();self.store.begin(sid);self.store.recover()
        self.assertEqual(self.store.session(sid)['status'],'idle')
        self.assertEqual(self.store.traces(sid)[-1]['kind'],'run.interrupted')

    def test_invalid_config(self):
        for c in ({'max_turns':0},{'budget_usd':-1},{'permission':'bypassPermissions'},{'runtime':'pi'},{'disabled_tools':['Bash']}):
            with self.assertRaises(Problem):self.session(**c)

    def test_http_security_validation_stream(self):
        dbpath=self.path
        with patch('app.Store',lambda:Store(dbpath)):
            server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            base='http://127.0.0.1:'+str(server.server_port)
            def request(path,data=None,headers=None):
                req=urllib.request.Request(base+path,data=None if data is None else json.dumps(data).encode(),headers=headers or {'Content-Type':'application/json'})
                return urllib.request.urlopen(req)
            try:
                with request('/api/sessions',{'case_id':'IR-2841'}) as r:s=json.load(r)
                with request('/api/sessions/'+s['id']+'/messages',{'message':'Review'}) as r:
                    self.assertIn('application/x-ndjson',r.headers['Content-Type']);lines=[json.loads(line) for line in r]
                self.assertEqual(lines[-1]['kind'],'run.completed')
                with request('/api/sessions',{'case_id':'IR-2841','config':{'permission':'ask_all'}}) as r: gated=json.load(r)
                with request('/api/sessions/'+gated['id']+'/messages',{'message':'Review with approval'}) as r:
                    gated_lines=[]
                    for line in r:
                        event=json.loads(line);gated_lines.append(event)
                        if event['kind']=='approval.waiting':
                            with request('/api/sessions/'+gated['id']) as snapshot: pending=json.load(snapshot)['approvals']
                            aid=next(a['id'] for a in pending if a['status']=='pending')
                            with request('/api/sessions/'+gated['id']+'/approval',{'id':aid,'decision':'approve'}) as decision:
                                self.assertEqual(decision.status,200)
                    self.assertEqual(gated_lines[-1]['kind'],'run.completed')
                    self.assertTrue(any(e['kind']=='approval.resumed' for e in gated_lines))
                for path,body,headers,status in [
                    ('/api/sessions',[],None,400),('/api/events?case_id=IR-2841&limit=-1',None,None,400),
                    ('/api/sessions',{}, {'Content-Type':'application/json','Origin':'https://evil.example'},403),
                    ('/api/health',None,{'Host':'evil.example'},403),('/api/sessions/nope',None,None,404)]:
                    with self.assertRaises(urllib.error.HTTPError) as cm:request(path,body,headers)
                    self.assertEqual(cm.exception.code,status)
            finally:server.shutdown();server.server_close();thread.join()

if __name__=='__main__':unittest.main()
