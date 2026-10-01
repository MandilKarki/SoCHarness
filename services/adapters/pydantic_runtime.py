"""PydanticAI native tool loop with explicit schemas and Relay tool execution."""
from adapters.common import SYSTEM, definitions, dispatch, context, finish, cancellable
from adapters.state import load, save, turn_prompt

async def run_pydantic(engine,prompt,model_override=None):
    from pydantic_ai import Agent
    from pydantic_ai.tools import Tool
    from pydantic_ai.usage import UsageLimits
    from pydantic_ai.messages import ModelMessagesTypeAdapter
    from pydantic import BaseModel
    config=engine.store.session(engine.sid)['config']
    tools=[]
    for spec in definitions(config):
        def handler(name):
            async def call(**args):return await dispatch(engine,name,args)
            return call
        tools.append(Tool.from_schema(handler(spec['name']),spec['name'],spec['description'],spec['schema'],sequential=True))
    class Findings(BaseModel):
        observations:list[str]
        evidence_ids:list[int]
        hypotheses:list[str]
        next_steps:list[str]
        limitations:str
    agent=Agent(model_override or 'anthropic:'+config['model'],instructions=SYSTEM,tools=tools,
                output_type=Findings if config['structured_output'] else str,retries=1,
                model_settings={'max_tokens':config['max_output_tokens'],'timeout':120})
    async def events(ctx,stream):
        async for event in stream:
            engine.check()
            if getattr(event,'event_kind',None)=='part_delta' and hasattr(event.delta,'content_delta'):
                engine.record('message.delta',{'text':event.delta.content_delta})
            elif getattr(event,'event_kind',None) in ('function_tool_call','function_tool_result'):
                engine.record('adapter.lifecycle',{'runtime':'pydantic','event':event.event_kind})
    prior=load(engine)
    history=ModelMessagesTypeAdapter.validate_python(prior['messages']) if prior else None
    engine.record('adapter.lifecycle',{'runtime':'pydantic','event':'session.resumed' if prior else 'session.created'})
    result=await cancellable(engine,agent.run(turn_prompt(engine,prompt,prior),message_history=history,event_stream_handler=events,
        usage_limits=UsageLimits(request_limit=config['max_turns'],tool_calls_limit=config['max_turns']*4)))
    usage=result.usage
    structured=result.output.model_dump() if config['structured_output'] else None
    import json
    finish(engine,str(result.output),'pydantic',{'input_tokens':usage.input_tokens,'output_tokens':usage.output_tokens},structured,
           native_state={'messages':json.loads(result.all_messages_json())})
