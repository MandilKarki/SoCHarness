import asyncio
import uuid
from pathlib import Path
from unittest.mock import patch, Mock
from test_lab import LabFixture
from engine import Engine, ACTIVE
from store import Problem
import workspace

class WorkspaceTest(LabFixture):
    def setUp(self):
        super().setUp()
        self.base_patch=patch.object(workspace,'BASE',Path(self.temp.name)/'native')
        self.base_patch.start()
    def tearDown(self):
        self.base_patch.stop();super().tearDown()

    def test_scoped_path_validation(self):
        sid=self.session(file_workspace=True)
        self.assertEqual(workspace.checked_path(sid,'note.md').name,'note.md')
        for value in ('../other.md','C:\\Windows\\system.ini','nested/file.md','CON.txt','NUL.json','run.ps1','keys.env'):
            with self.assertRaises(Problem):workspace.checked_path(sid,value)

    def test_native_writes_obey_read_only_policy(self):
        sid=self.session(file_workspace=True)
        with self.assertRaises(Problem):workspace.validate_tool(sid,'Write',{'file_path':'note.md','content':'test'},self.store.session(sid)['config'])

    def test_native_permission_waits_for_authorization(self):
        sid=self.session(file_workspace=True,permission='supervised');engine=Engine(self.store,sid)
        async def scenario():
            pending=asyncio.create_task(engine.native_permission('Write',{'file_path':'note.md','content':'test'}))
            await asyncio.sleep(.01)
            row=self.store.db.execute('SELECT * FROM relay_approvals WHERE session_id=?',(sid,)).fetchone()
            self.assertEqual(row['status'],'pending')
            result=engine.approve(row['id'],'approve')
            self.assertEqual(result['status'],'approved')
            return await pending
        aid,args=asyncio.run(scenario())
        self.assertEqual(args['content'],'test')
        self.assertEqual(self.store.db.execute('SELECT status FROM relay_approvals WHERE id=?',(aid,)).fetchone()[0],'executing')
        self.assertFalse(workspace.checked_path(sid,'note.md').exists())

    def test_rewind_requires_owned_sdk_checkpoint(self):
        sid=self.session(file_workspace=True)
        with self.assertRaises(Problem):workspace.rewind(self.store,sid,999)

    def test_rewind_calls_bundled_cli_with_fixed_identity(self):
        import importlib.util
        if not importlib.util.find_spec('claude_agent_sdk'):self.skipTest('SDK not installed')
        sid=self.session(file_workspace=True)
        sdk_id,checkpoint=str(uuid.uuid4()),str(uuid.uuid4())
        event=self.store.trace(sid,'sdk.file_checkpoint',{'uuid':checkpoint,'sdk_session':sdk_id})
        with patch('workspace.subprocess.run',return_value=Mock(returncode=0,stdout='Files rewound',stderr='')) as run:
            result=workspace.rewind(self.store,sid,event['seq'])
            self.assertTrue(result['rewound']);args=run.call_args.args[0]
            self.assertEqual(args[-4:],['--resume',sdk_id,'--rewind-files',checkpoint])
            self.assertEqual(run.call_args.kwargs['cwd'],workspace.directory(sid))
        ACTIVE[sid]=object()
        try:
            with self.assertRaises(Problem):workspace.rewind(self.store,sid,event['seq'])
        finally:ACTIVE.pop(sid,None)
