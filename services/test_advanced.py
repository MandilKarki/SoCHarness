import asyncio
import json
from advanced import Advanced, otlp_export
from engine import Engine
from store import Problem
from test_lab import LabFixture

class AdvancedTest(LabFixture):
    def configured(self,**extra):
        return self.session(permission='supervised',memory=True,artifacts=True,skills=True,**extra)

    def execute(self,sid,name,args):
        engine=Engine(self.store,sid);result=engine.call(name,args)
        return engine.approve(result['pending_approval'],'approve') if 'pending_approval' in result else result

    def test_memory_is_case_scoped_and_evidence_linked(self):
        sid=self.configured();self.execute(sid,'remember_finding',{'content':'Observed login, not a threat verdict','evidence_ids':[1]})
        second=self.configured()
        self.assertEqual(len(self.execute(second,'search_memory',{'query':'login'})['items']),1)
        third=self.store.create('IR-2840',{'memory':True})['id']
        self.assertEqual(self.execute(third,'search_memory',{'query':''})['items'],[])

    def test_memory_rejects_cross_case_references(self):
        sid=self.configured()
        with self.assertRaises(Problem):self.execute(sid,'remember_finding',{'content':'Invalid reference','evidence_ids':[3]})
        self.assertEqual(Advanced(self.store,sid).snapshot()['memory'],[])

    def test_memory_requires_references(self):
        sid=self.configured()
        with self.assertRaises(Problem):self.execute(sid,'remember_finding',{'content':'Unsupported','evidence_ids':[]})

    def test_feature_disable_is_enforced(self):
        sid=self.session(permission='supervised')
        for tool,args in [('search_memory',{'query':''}),('write_artifact',{'name':'test.md','content':'test'}),('get_playbook',{'name':'triage'})]:
            with self.assertRaises(Problem):Engine(self.store,sid).call(tool,args)

    def test_tasks_persist_and_reject_other_sessions(self):
        sid=self.configured();task=self.execute(sid,'set_task',{'title':'Inspect login','status':'pending','id':''})
        self.execute(sid,'set_task',{'id':task['id'],'title':'Inspect login','status':'done'})
        self.assertEqual(self.execute(sid,'list_tasks',{})['tasks'][0]['status'],'done')
        other=self.configured()
        with self.assertRaises(Problem):self.execute(other,'set_task',{'id':task['id'],'title':'Hijack','status':'done'})

    def test_artifact_rollback_preserves_history(self):
        sid=self.configured()
        first=self.execute(sid,'write_artifact',{'name':'handoff.md','content':'Version one'})
        self.execute(sid,'write_artifact',{'name':'handoff.md','content':'Version two'})
        restored=self.execute(sid,'restore_artifact',{'name':'handoff.md','version':first['version']})
        self.assertEqual(restored['content'],'Version one')
        self.assertGreater(restored['version'],first['version'])
        self.assertEqual(len(Advanced(self.store,sid).snapshot()['artifacts'][0]['versions']),3)

    def test_artifacts_do_not_accept_filesystem_paths(self):
        sid=self.configured()
        for filename in ('../notes.md','C:\\secrets.txt','/tmp/notes.md','report.exe','a..md'):
            with self.assertRaises(Problem):self.execute(sid,'write_artifact',{'name':filename,'content':'test'})
        self.assertEqual(Advanced(self.store,sid).snapshot()['artifacts'],[])

    def test_artifact_cannot_restore_another_artifact_version(self):
        sid=self.configured();first=self.execute(sid,'write_artifact',{'name':'one.md','content':'one'})
        self.execute(sid,'write_artifact',{'name':'two.md','content':'two'})
        with self.assertRaises(Problem):self.execute(sid,'restore_artifact',{'name':'two.md','version':first['version']})

    def test_active_approval_resumes_receipt_without_reexecution(self):
        sid=self.configured();engine=Engine(self.store,sid)
        aid=engine.call('save_case_note',{'content':'One note'})['pending_approval']
        async def scenario():
            wait=asyncio.create_task(engine.wait_approval(aid,timeout=2))
            await asyncio.sleep(.01);engine.approve(aid,'approve')
            return await wait
        self.assertTrue(asyncio.run(scenario())['saved'])
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM relay_notes').fetchone()[0],1)

    def test_approval_timeout_expires_request(self):
        sid=self.configured();engine=Engine(self.store,sid)
        aid=engine.call('save_case_note',{'content':'Do not execute'})['pending_approval']
        with self.assertRaises(Problem):asyncio.run(engine.wait_approval(aid,timeout=.001))
        with self.assertRaises(Problem):engine.approve(aid,'approve')
        self.assertEqual(self.store.db.execute('SELECT count(*) FROM relay_notes').fetchone()[0],0)

    def test_human_input_resumes_once(self):
        sid=self.configured();engine=Engine(self.store,sid)
        async def scenario():
            wait=asyncio.create_task(engine.ask_human('Which host?',timeout=2))
            await asyncio.sleep(.01)
            qid=Advanced(self.store,sid).snapshot()['questions'][0]['id']
            Advanced(self.store,sid).answer(qid,'host-1')
            with self.assertRaises(Problem):Advanced(self.store,sid).answer(qid,'changed')
            return await wait
        self.assertEqual(asyncio.run(scenario()),{'answer':'host-1'})

    def test_question_scope(self):
        sid=self.configured();qid=Advanced(self.store,sid).ask('Case question')
        other=self.configured()
        with self.assertRaises(Problem):Advanced(self.store,other).answer(qid,'Other session')

    def test_otlp_export_excludes_payloads(self):
        sid=self.configured();self.store.trace(sid,'message.user',{'text':'sensitive secret'})
        data=otlp_export(self.store,sid)
        self.assertNotIn('sensitive secret',json.dumps(data))
        span=data['resourceSpans'][0]['scopeSpans'][0]['spans'][0]
        self.assertEqual(len(span['traceId']),32);self.assertEqual(len(span['spanId']),16)

    def test_playbook_is_vetted_catalog(self):
        sid=self.configured();result=self.execute(sid,'get_playbook',{'name':'triage'})
        self.assertEqual(len(result['steps']),4)
        with self.assertRaises(Problem):self.execute(sid,'get_playbook',{'name':'../../untrusted'})
