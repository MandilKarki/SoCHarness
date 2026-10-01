"""Real SDK multi-agent, guardrail, approval and session contracts; no network."""
import asyncio
import json
from uuid import uuid4
import os
from unittest.mock import patch
from agents import Model
from openai.types.responses import Response,ResponseCompletedEvent,ResponseOutputMessage,ResponseOutputText,ResponseFunctionToolCall
from test_lab import LabFixture
from adapters.openai_runtime import run_openai
from adapters.state import load
from engine import Engine
from store import TOOLS,Problem

FINDINGS={'observations':['Record #1 reviewed.'],'evidence_ids':[1],'hypotheses':[],'next_steps':['Verify account owner activity.'],'limitations':'Fixture model, not a verdict.'}
class SequenceModel(Model):
    def __init__(self,steps):self.steps=list(steps);self.inputs=[];self.instructions=[];self.schemas=[]
    async def get_response(self,*args,**kwargs):raise AssertionError('Streaming required')
    async def stream_response(self,system_instructions,input,model_settings,tools,output_schema,handoffs,tracing,**kwargs):
        assert tracing.is_disabled()
        self.inputs.append(input)
        self.instructions.append(system_instructions)
        self.schemas.append({t.name:t.params_json_schema for t in tools})
        step=self.steps.pop(0)
        if isinstance(step,tuple):
            name,args=step
            unique=uuid4().hex
            output=[ResponseFunctionToolCall(type='function_call',id='fc'+unique,call_id='call'+unique,name=name,arguments=json.dumps(args))]
        else:
            text=json.dumps(step) if isinstance(step,dict) else step
            output=[ResponseOutputMessage(type='message',id='message',role='assistant',status='completed',content=[ResponseOutputText(type='output_text',text=text,annotations=[])])]
        from openai.types.responses.response_usage import ResponseUsage,InputTokensDetails,OutputTokensDetails
        usage=ResponseUsage(input_tokens=100,output_tokens=70,total_tokens=170,input_tokens_details=InputTokensDetails(cached_tokens=0,cache_write_tokens=0),output_tokens_details=OutputTokensDetails(reasoning_tokens=0))
        yield ResponseCompletedEvent(type='response.completed',sequence_number=1,response=Response.model_construct(id='fixture',output=output,status='completed',usage=usage))

class PatternTest(LabFixture):
    def make(self,experiment,**kwargs):
        sid=self.session(runtime='openai',openai_experiment=experiment,structured_output=True,accept_no_usd_cap=True,max_turns=4 if experiment=='manager' else 3,
            disabled_tools=[t['name'] for t in TOOLS if t['name'] not in ('query_case_evidence','get_event')],**kwargs)
        return Engine(self.store,sid)
    def test_native_manager_returns_to_owner_and_shared_count(self):
        engine=self.make('manager')
        models={'Investigation manager':SequenceModel([('consult_evidence_specialist',{'input':'Read three records.'}),FINDINGS]),
            'Evidence specialist':SequenceModel([('query_case_evidence',{'limit':1,'search':''}),FINDINGS])}
        asyncio.run(run_openai(engine,'Review',models))
        trace=self.store.traces(engine.sid)
        self.assertTrue(any(t['kind']=='agent.delegated' for t in trace))
        self.assertTrue(any(t['kind']=='agent.returned' for t in trace))
        self.assertEqual([t['payload']['call'] for t in trace if t['kind']=='model.request'],[1,2,3,4])
        self.assertEqual(load(engine)['last_agent'],'Investigation manager')
        self.assertIn('{"limit":3,"search":""}',models['Evidence specialist'].instructions[0])
        self.assertIn('not a query language',models['Evidence specialist'].schemas[0]['query_case_evidence']['properties']['search']['description'])
    def test_native_handoff_persists_specialist_ownership(self):
        engine=self.make('handoff')
        models={'Triage agent':SequenceModel([('transfer_to_evidence_specialist',{})]),
            'Evidence specialist':SequenceModel([('query_case_evidence',{'limit':1,'search':''}),FINDINGS,FINDINGS])}
        asyncio.run(run_openai(engine,'Review',models))
        self.assertEqual(load(engine)['last_agent'],'Evidence specialist')
        asyncio.run(run_openai(engine,'Follow-up without tools',models))
        self.assertEqual(len(models['Triage agent'].inputs),1)
        self.assertTrue(any(t['kind']=='agent.handoff' for t in self.store.traces(engine.sid)))
    def test_blocking_input_guard_spends_no_model_calls(self):
        engine=self.make('guardrails');model=SequenceModel([])
        with self.assertRaises(Problem):asyncio.run(run_openai(engine,'Isolate FINANCE-07.',model))
        self.assertEqual(model.inputs,[])
        self.assertIsNone(load(engine))
        self.assertTrue(any(t['kind']=='guardrail.blocked' for t in self.store.traces(engine.sid)))
    def test_output_guard_rejects_unknown_citation(self):
        engine=self.make('guardrails')
        model=SequenceModel([('query_case_evidence',{'limit':1,'search':''}),{**FINDINGS,'evidence_ids':[999]}])
        with self.assertRaises(Problem):asyncio.run(run_openai(engine,'Review evidence.',model))
        self.assertIsNone(load(engine))
        self.assertFalse(any(t['kind']=='message.assistant' for t in self.store.traces(engine.sid)))
    def test_output_guard_accepts_returned_citation(self):
        engine=self.make('guardrails');model=SequenceModel([('query_case_evidence',{'limit':1,'search':''}),FINDINGS])
        asyncio.run(run_openai(engine,'Review evidence.',model))
        self.assertIsNotNone(load(engine))
    def test_sdk_session_protocol_carries_tool_results(self):
        engine=self.make('sessions');model=SequenceModel([('query_case_evidence',{'limit':1,'search':''}),FINDINGS,FINDINGS])
        asyncio.run(run_openai(engine,'Review.',model));asyncio.run(run_openai(engine,'Continue.',model))
        self.assertTrue(any(i.get('type')=='function_call_output' for i in model.inputs[-1]))
        self.assertEqual(sum(i.get('role')=='user' for i in model.inputs[-1]),2)
        self.assertTrue(any(t['kind']=='session.staged' for t in self.store.traces(engine.sid)))
    def test_native_approval_precedes_exactly_one_execution(self):
        engine=self.make('review');model=SequenceModel([('query_case_evidence',{'limit':1,'search':''}),FINDINGS])
        def decide(event):
            if event['kind']=='approval.requested':
                self.assertFalse(any(t['kind']=='tool.result' for t in self.store.traces(engine.sid)))
                engine.approve(event['payload']['id'],'approve')
        engine.emit=decide
        asyncio.run(run_openai(engine,'Review.',model))
        self.assertEqual(sum(t['kind']=='tool.result' for t in self.store.traces(engine.sid)),1)
        self.assertEqual(self.store.db.execute('SELECT status FROM relay_approvals').fetchone()[0],'executed')
    def test_native_denial_does_not_execute_tool(self):
        engine=self.make('review');model=SequenceModel([('query_case_evidence',{'limit':1,'search':''}),{**FINDINGS,'evidence_ids':[],'observations':[]}])
        engine.emit=lambda t:engine.approve(t['payload']['id'],'deny') if t['kind']=='approval.requested' else None
        asyncio.run(run_openai(engine,'Review.',model))
        self.assertFalse(any(t['kind']=='tool.result' for t in self.store.traces(engine.sid)))
    def test_shared_cap_blocks_extra_manager_request(self):
        engine=self.make('manager')
        config=self.store.session(engine.sid)['config'];config['max_turns']=3
        self.store.db.execute('UPDATE relay_sessions SET config=? WHERE id=?',(json.dumps(config),engine.sid));self.store.db.commit()
        models={'Investigation manager':SequenceModel([('consult_evidence_specialist',{'input':'Review.'}),FINDINGS]),
            'Evidence specialist':SequenceModel([('query_case_evidence',{'limit':1,'search':''}),FINDINGS])}
        with self.assertRaises(Problem):asyncio.run(run_openai(engine,'Review.',models))
        self.assertEqual(sum(len(m.inputs) for m in models.values()),3)
        self.assertIsNone(load(engine))
    def test_multiple_native_read_tools(self):
        engine=self.make('multi_tool');model=SequenceModel([('query_case_evidence',{'limit':1,'search':''}),('get_event',{'id':1}),FINDINGS])
        asyncio.run(run_openai(engine,'Review.',model))
        self.assertEqual([t['payload']['tool'] for t in self.store.traces(engine.sid) if t['kind']=='tool.result'],['query_case_evidence','get_event'])

    def test_nested_calls_each_reserve_and_settle_shared_money_ledger(self):
        from trial_budget import MODEL,TrialBudget
        engine=self.make('manager',model=MODEL,max_output_tokens=1000)
        models={'Investigation manager':SequenceModel([('consult_evidence_specialist',{'input':'Review.'}),FINDINGS]),
            'Evidence specialist':SequenceModel([('query_case_evidence',{'limit':1,'search':''}),FINDINGS])}
        with patch.dict(os.environ,{'RELAY_TRIAL_ENABLED':'1','RELAY_TRIAL_UNTIL':'2099-01-01T00:00:00Z'}):
            asyncio.run(run_openai(engine,'Review.',models))
            snapshot=TrialBudget(self.store).snapshot()
        self.assertEqual(snapshot['requests'],4)
        self.assertEqual(snapshot['unsettled_requests'],0)
        self.assertGreater(snapshot['accounted_usd'],0)
        trace=self.store.traces(engine.sid)
        self.assertEqual(sum(t['kind']=='budget.settled' for t in trace),4)
        result=next(t['payload'] for t in trace if t['kind']=='sdk.result')
        self.assertEqual(result['usage']['input_tokens'],400)
