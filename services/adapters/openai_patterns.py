"""Small native SDK experiments. No external tools, shell, or trace exporter."""
import json
import re
from copy import deepcopy
from agents import Agent, RunHooks, RunConfig, InputGuardrail, OutputGuardrail, GuardrailFunctionOutput, handoff, Model
from store import Problem, now, uid
from adapters.common import SYSTEM

LIMITS={'core':3,'manager':4,'handoff':3,'guardrails':3,'review':3,'sessions':3,'multi_tool':3}

def capped_model(delegate,engine,counter):
    class Capped(Model):
        async def get_response(self,*args,**kwargs):raise Problem('Only audited streaming model requests are supported',409)
        async def stream_response(self,*args,**kwargs):
            engine.check()
            if counter['calls'] >= counter['limit']:
                engine.record('orchestration.limit',{'maximum':counter['limit'],'used':counter['calls']})
                raise Problem('Shared model-call limit reached across all agents and resumes',409)
            counter['calls']+=1
            async for event in delegate.stream_response(*args,**kwargs):yield event
    return Capped()

class VisualHooks(RunHooks):
    def __init__(self,engine):self.engine=engine;self.approved=[]
    async def on_agent_start(self,context,agent):self.engine.record('agent.started',{'agent':agent.name})
    async def on_agent_end(self,context,agent,output):self.engine.record('agent.finished',{'agent':agent.name})
    async def on_handoff(self,context,from_agent,to_agent):
        self.engine.record('agent.handoff',{'from':from_agent.name,'to':to_agent.name,'ownership':'transferred'})
    async def on_tool_start(self,context,agent,tool):
        self.engine.record('sdk.tool.started',{'agent':agent.name,'tool':tool.name,'call_id':getattr(context,'tool_call_id',None)})
        if tool.name=='consult_evidence_specialist':
            self.engine.record('agent.delegated',{'from':agent.name,'to':'Evidence specialist','ownership':'manager retains final answer'})
    async def on_tool_end(self,context,agent,tool,result):
        self.engine.record('sdk.tool.finished',{'agent':agent.name,'tool':tool.name})
        if tool.name=='query_case_evidence':
            for aid in self.approved:
                self.engine.store.db.execute("UPDATE relay_approvals SET status='executed' WHERE id=? AND status='executing'",(aid,))
            self.engine.store.db.commit()
        if tool.name=='consult_evidence_specialist':
            self.engine.record('agent.returned',{'from':'Evidence specialist','to':agent.name})

class StagedSession:
    """SDK Session protocol, staged until a successful result is committed by Relay."""
    session_settings=None
    def __init__(self,engine,messages):self.engine=engine;self.session_id=engine.sid;self.items=deepcopy(messages)
    async def get_items(self,limit=None):
        items=self.items if limit is None else self.items[-limit:] if limit else []
        self.engine.record('session.loaded',{'session_id':self.session_id,'items':len(items),'storage':'SDK Session protocol / Relay commit-on-success adapter'})
        return deepcopy(items)
    async def add_items(self,items):
        self.items.extend(deepcopy(items));self.engine.record('session.staged',{'added':len(items),'total':len(self.items),'durable':False})
    async def pop_item(self):return self.items.pop() if self.items else None
    async def clear_session(self):self.items=[]

def build_agents(engine,prompt,tools,model_factory,settings,output_type,experiment):
    hooks=VisualHooks(engine)
    run_config=RunConfig(tracing_disabled=True)
    def create(name,instructions,local_tools,**kwargs):
        return Agent(name=name,instructions=SYSTEM+'\n'+instructions,tools=local_tools,
            model=model_factory(name),model_settings=settings,**kwargs)
    if experiment in ('manager','handoff'):
        specialist=create('Evidence specialist','You are the evidence specialist. For a fresh investigation call query_case_evidence exactly once with {"limit":3,"search":""}. The server already applies the case boundary. Never put the case ID or case: syntax in search; that field is only a literal text filter, not a case selector. Return concise findings citing the returned IDs. No other action. If the input explicitly requests a follow-up without tools, use only supplied prior evidence.',tools,output_type=output_type)
        if experiment=='manager':
            async def observe_nested(payload):
                # on_stream selects the SDK's streamed nested runner. Model
                # receipts and hooks do the audit; never duplicate text deltas.
                event=payload['event']
                if event.type=='run_item_stream_event':
                    engine.record('adapter.lifecycle',{'runtime':'openai','agent':payload['agent'].name,'event':event.name})
            delegated=specialist.as_tool(tool_name='consult_evidence_specialist',tool_description='Ask the evidence specialist to retrieve three records and return evidence-grounded findings.',
                max_turns=2,run_config=run_config,hooks=hooks,on_stream=observe_nested,failure_error_function=None)
            root=create('Investigation manager','For a new investigation call consult_evidence_specialist exactly once. Pass the analyst request to it. Then synthesize its returned findings; preserve cited IDs and uncertainty. You own the final answer. For a follow-up explicitly requesting no tools, use prior findings without delegation.',[delegated],output_type=output_type)
        else:
            root=create('Triage agent','For a new investigation transfer control to the evidence specialist using transfer_to_evidence_specialist. Do not attempt an evidence query or final answer yourself.',[],handoffs=[handoff(specialist,tool_name_override='transfer_to_evidence_specialist')])
        return root,{root.name:root,specialist.name:specialist},hooks,run_config
    kwargs={}
    if experiment=='guardrails':
        async def input_check(context,agent,input):
            # Deliberately narrow teaching policy, not a complete security classifier.
            blocked=bool(re.search(r'\b(isolate|disable|delete|execute shell)\b',prompt,re.I))
            engine.record('guardrail.checked',{'phase':'input','name':'Read-only request policy','agent':agent.name,'passed':not blocked,'blocking':True,
                'rule':'Reject requests containing isolate, disable, delete or execute shell. Deterministic demonstration, not comprehensive threat detection.'})
            return GuardrailFunctionOutput(output_info={'read_only':not blocked},tripwire_triggered=blocked)
        async def output_check(context,agent,output):
            value=output.model_dump() if hasattr(output,'model_dump') else {}
            known=set()
            for t in engine.store.traces(engine.sid):
                if t['kind']=='tool.result':
                    result=t['payload'].get('result',{})
                    known.update(r['id'] for r in result.get('items',[]) if 'id' in r)
                    if 'id' in result:known.add(result['id'])
            cited=value.get('evidence_ids',[]);passed=bool(cited) and set(cited)<=known
            engine.record('guardrail.checked',{'phase':'output','name':'Returned citation IDs','agent':agent.name,'passed':passed,'cited':cited,'known_ids':sorted(known),
                'rule':'Require at least one citation and reject IDs not returned to this session. Checks provenance, not factual correctness.'})
            return GuardrailFunctionOutput(output_info={'citation_check':passed},tripwire_triggered=not passed)
        kwargs={'input_guardrails':[InputGuardrail(input_check,name='Read-only request policy',run_in_parallel=False)],
            'output_guardrails':[OutputGuardrail(output_check,name='Returned citation IDs')]}
    if experiment=='review':
        for tool in tools:tool.needs_approval=True
    agent=create('Relay SOC analyst','Stay within the selected case. Use only the enabled read tools. Keep findings concise.',tools,output_type=output_type,**kwargs)
    return agent,{agent.name:agent},hooks,run_config

async def resolve_interruptions(engine,result):
    """Native RunState approve/reject; never execute a tool before SDK approval."""
    state=result.to_state();approved=[]
    for item in result.interruptions:
        raw=item.raw_item
        name=raw.get('name') if isinstance(raw,dict) else raw.name
        arguments=raw.get('arguments','{}') if isinstance(raw,dict) else raw.arguments
        if name!='query_case_evidence':raise Problem('Unexpected approval tool; no action executed',403)
        args=json.loads(arguments)
        aid=uid('apr')
        engine.store.db.execute('INSERT INTO relay_approvals VALUES(?,?,?,?,?,?)',(aid,engine.sid,'sdk:'+name,json.dumps(args),'pending',now()));engine.store.db.commit()
        engine.record('approval.requested',{'id':aid,'tool':'sdk:'+name,'arguments':args,'native':'OpenAI RunState','agent':item.agent.name})
        try:
            await engine.wait_approval(aid,native=True)
            state.approve(item);approved.append(aid)
            engine.record('sdk.approval.resumed',{'id':aid,'decision':'approve','tool':name})
        except Problem as exc:
            if str(exc)!='Approval denied':raise
            state.reject(item)
            engine.record('sdk.approval.resumed',{'id':aid,'decision':'deny','tool':name})
    return state,approved
