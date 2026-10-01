"""Inspectable public model I/O. Never records transport credentials or reasoning."""
import json
import re
from importlib.metadata import version
from adapters.common import SYSTEM, FINDINGS, definitions


def tool_specs(config):
    specs = definitions(config)
    for spec in specs:
        if spec['name'] == 'query_case_evidence':
            spec['description'] += ' The server already scopes results to the selected case. For an initial sample use limit=3 and search=""; do not put a case ID in search.'
            spec['schema']['properties']['search']['description']='Literal substring filter on event text, not a query language or case selector. Leave empty to sample the selected case; never use case:IR-... here.'
            spec['schema']['properties']['limit'].update(minimum=1, maximum=25,
                description='Maximum evidence records to return, from 1 to 25. Start with 3.')
    return specs


def contract(config):
    return {'sdk':'openai-agents', 'version':version('openai-agents'),
        'agent':'Relay SOC analyst', 'instructions':SYSTEM,
        'tools':tool_specs(config), 'output_schema':FINDINGS,
        'context_strategy':'Successful SDK input history, persisted by Relay; no provider conversation storage.',
        'boundaries':['Read-only evidence in the selected case', 'No sensor control or shell',
            'No hosted trace export', 'Model output requires analyst verification']}


def visible(value):
    """Bound public transcript excerpts; omit private reasoning and unknown fields."""
    if hasattr(value, 'model_dump'): value=value.model_dump(mode='json')
    if isinstance(value, dict):
        if value.get('type') in ('reasoning','reasoning_text','reasoning_summary_text'):
            return {'type':'reasoning', 'omitted':True}
        allowed=('role','type','content','text','name','arguments','call_id','output','id','status')
        return {k:visible(v) for k,v in value.items() if k in allowed}
    if isinstance(value, (list,tuple)): return [visible(v) for v in value[-32:]]
    if isinstance(value, str):
        value=re.sub(r'\bsk-[A-Za-z0-9_-]{8,}', '[REDACTED]', value)
        value=re.sub(r'(?i)\bBearer\s+\S+', 'Bearer [REDACTED]', value)
        return value[:6000]
    if value is None or isinstance(value,(bool,int,float)): return value
    return '[unsupported public item]'


def snapshot(value):
    result=visible(value)
    text=json.dumps(result,ensure_ascii=False)
    if len(text)>24000:
        return {'excerpt':text[:24000], 'truncated':True}
    return result


def observe_model(delegate, engine, model_name, agent_name='Relay SOC analyst', counter=None):
    from agents import Model
    class ObservedModel(Model):
        def __init__(self): self.calls=0
        async def get_response(self,*args,**kwargs):
            return await delegate.get_response(*args,**kwargs)
        async def stream_response(self,system_instructions,input,model_settings,tools,output_schema,handoffs,tracing,**kwargs):
            self.calls+=1
            call=counter['calls'] if counter is not None else self.calls
            engine.record('model.request', {'call':call,'model':model_name,'agent':agent_name,
                'instructions':snapshot(system_instructions),'input':snapshot(input),
                'input_items':len(input) if isinstance(input,list) else 1,
                'tools':[{'name':t.name,'description':t.description,'schema':t.params_json_schema} for t in tools if hasattr(t,'params_json_schema')],
                'handoffs':[{'name':h.tool_name,'description':h.tool_description,'schema':h.input_json_schema} for h in handoffs],
                'settings':{'max_output_tokens':model_settings.max_tokens,'parallel_tool_calls':model_settings.parallel_tool_calls,'store':model_settings.store},
                'capture':'Public context excerpt, up to 32 items / 24k characters; individual strings capped at 6k. Reasoning and transport excluded.'})
            async for event in delegate.stream_response(system_instructions=system_instructions,input=input,model_settings=model_settings,
                    tools=tools,output_schema=output_schema,handoffs=handoffs,tracing=tracing,**kwargs):
                if event.type=='response.completed':
                    response=event.response;usage=response.usage
                    engine.record('model.response',{'call':call,'response_id':response.id,'agent':agent_name,
                        'output':snapshot(response.output),'status':response.status,
                        'usage':{'input_tokens':getattr(usage,'input_tokens',None),'output_tokens':getattr(usage,'output_tokens',None)},
                        'capture':'Public output only; private reasoning omitted.'})
                yield event
    return ObservedModel()
