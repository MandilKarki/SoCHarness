"""Actual SDK options/decorators + fake transport: no credentials or paid calls."""
import asyncio
import importlib.util
import types
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch
from test_lab import LabFixture
from engine import Engine
from claude_runtime import run_claude

@unittest.skipUnless(importlib.util.find_spec('claude_agent_sdk'),'Optional SDK is not installed')
class ClaudeContractTest(LabFixture):
    def test_real_sdk_options_with_fake_transport(self):
        import claude_agent_sdk as sdk
        sid=self.session(runtime='claude',structured_output=True)
        seen={}
        class Client:
            def __init__(self,options):seen['options']=options
            async def __aenter__(self):return self
            async def __aexit__(self,*args):pass
            async def query(self,prompt):seen['prompt']=prompt
            async def interrupt(self):seen['interrupted']=True
            async def receive_response(self):
                yield sdk.SystemMessage(subtype='init',data={'session_id':'sdk-test-session'})
                yield sdk.AssistantMessage(content=[sdk.TextBlock(text='Observed event 1. No verdict.')],model='test-model')
                yield sdk.ResultMessage(subtype='success',duration_ms=1,duration_api_ms=1,is_error=False,num_turns=1,
                    session_id='sdk-test-session',total_cost_usd=.01,usage={'input_tokens':10,'output_tokens':5},result='Reviewed',
                    structured_output={'observations':['#1'],'evidence_ids':[1],'hypotheses':[],'next_steps':[],'limitations':'test'})
        with patch.object(sdk,'ClaudeSDKClient',Client):
            asyncio.run(run_claude(Engine(self.store,sid),'Review case'))
        options=seen['options']
        self.assertEqual(options.tools,[])
        self.assertTrue(options.strict_mcp_config)
        self.assertEqual(options.setting_sources,[])
        self.assertIsNotNone(options.output_format)
        self.assertIn('PreToolUse',options.hooks)
        self.assertEqual(len(options.allowed_tools),7)
        self.assertIn('IR-2841',seen['prompt'])
        session=self.store.session(sid)
        self.assertEqual(session['sdk_session'],'sdk-test-session')
        self.assertAlmostEqual(session['cost_usd'],.01)
        self.assertEqual(session['input_tokens'],10)
        self.assertTrue(any(t['kind']=='checkpoint' for t in self.store.traces(sid)))

    def test_specialists_skills_and_hook_boundary(self):
        import claude_agent_sdk as sdk
        sid=self.session(runtime='claude',specialists=True,skills=True,memory=True,artifacts=True)
        seen={}
        class Client:
            def __init__(self,options):seen['options']=options
            async def __aenter__(self):return self
            async def __aexit__(self,*args):pass
            async def query(self,prompt):seen['prompt']=prompt
            async def interrupt(self):pass
            async def receive_response(self):
                yield sdk.ResultMessage(subtype='success',duration_ms=1,duration_api_ms=1,is_error=False,num_turns=1,session_id='test',result='Reviewed')
        with patch.object(sdk,'ClaudeSDKClient',Client):asyncio.run(run_claude(Engine(self.store,sid),'Review'))
        options=seen['options']
        self.assertEqual(options.tools,['Agent','Skill'])
        self.assertEqual(set(options.agents),{'evidence-reviewer','hypothesis-checker'})
        self.assertEqual(options.env['CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH'],'1')
        self.assertEqual(len(options.plugins),1)
        for agent in options.agents.values():
            self.assertNotIn('mcp__relay__write_artifact',agent.tools)
            self.assertNotIn('Agent',agent.tools)
        hook=options.hooks['PreToolUse'][0].hooks[0]
        for name,args in [('Bash',{}),('Agent',{'subagent_type':'general-purpose'}),('Agent',{'subagent_type':'evidence-reviewer','run_in_background':True}),('Skill',{'skill':'untrusted:skill'})]:
            result=asyncio.run(hook({'hook_event_name':'PreToolUse','tool_name':name,'tool_input':args},'test',{}))
            self.assertEqual(result['hookSpecificOutput']['permissionDecision'],'deny')
        allowed=asyncio.run(hook({'hook_event_name':'PreToolUse','tool_name':'Agent','tool_input':{'subagent_type':'evidence-reviewer'}},'test',{}))
        self.assertEqual(allowed,{})

    def test_thinking_and_missing_terminal_fail_closed(self):
        import claude_agent_sdk as sdk
        from store import Problem
        sid=self.session(runtime='claude',thinking='medium')
        seen={}
        class Client:
            def __init__(self,options):seen['options']=options
            async def __aenter__(self):return self
            async def __aexit__(self,*args):pass
            async def query(self,prompt):pass
            async def interrupt(self):pass
            async def receive_response(self):
                yield sdk.AssistantMessage(content=[sdk.TextBlock(text='Partial answer')],model='test')
        with patch.object(sdk,'ClaudeSDKClient',Client),self.assertRaises(Problem):
            asyncio.run(run_claude(Engine(self.store,sid),'Review'))
        self.assertEqual(seen['options'].thinking,{'type':'enabled','budget_tokens':2048})
        self.assertFalse(any(t['kind']=='checkpoint' for t in self.store.traces(sid)))

    def test_native_file_permissions_and_checkpoint_capture(self):
        import claude_agent_sdk as sdk
        sid=self.session(runtime='claude',file_workspace=True,permission='supervised')
        owner=self;seen={};sdk_id=str(uuid.uuid4());checkpoint=str(uuid.uuid4())
        engine=Engine(self.store,sid)
        class Client:
            def __init__(self,options):self.options=options;seen['options']=options
            async def __aenter__(self):return self
            async def __aexit__(self,*args):pass
            async def interrupt(self):pass
            async def query(self,prompt):
                request=asyncio.create_task(self.options.can_use_tool('Write',{'file_path':'report.md','content':'Report'},sdk.ToolPermissionContext(tool_use_id='native-test')))
                await asyncio.sleep(.01)
                row=owner.store.db.execute('SELECT * FROM relay_approvals WHERE session_id=?',(sid,)).fetchone()
                owner.assertEqual(row['status'],'pending')
                engine.approve(row['id'],'approve')
                permission=await request;owner.assertEqual(permission.behavior,'allow')
                hook=self.options.hooks['PostToolUse'][0].hooks[0]
                await hook({'hook_event_name':'PostToolUse','tool_name':'Write','tool_input':permission.updated_input},'native-test',{})
                owner.assertEqual(owner.store.db.execute('SELECT status FROM relay_approvals WHERE id=?',(row['id'],)).fetchone()[0],'executed')
            async def receive_response(self):
                yield sdk.SystemMessage(subtype='init',data={'session_id':sdk_id})
                yield sdk.UserMessage(content='Review',uuid=checkpoint)
                yield sdk.ResultMessage(subtype='success',duration_ms=1,duration_api_ms=1,is_error=False,num_turns=1,session_id=sdk_id,result='Reviewed')
        with patch('workspace.BASE',Path(self.temp.name)/'native'),patch.object(sdk,'ClaudeSDKClient',Client):
            asyncio.run(run_claude(engine,'Write a report'))
        options=seen['options']
        self.assertTrue(options.enable_file_checkpointing)
        self.assertIn('Write',options.tools);self.assertNotIn('Write',options.allowed_tools)
        self.assertIn('Read',options.allowed_tools)
        checkpoints=[e for e in self.store.traces(sid) if e['kind']=='sdk.file_checkpoint']
        self.assertEqual(checkpoints[0]['payload']['uuid'],checkpoint)

if __name__=='__main__':unittest.main()
