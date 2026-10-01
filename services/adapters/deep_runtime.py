"""Native Deep Agents graph, with built-in host tools denied by middleware."""
from adapters.common import SYSTEM, definitions, dispatch, context, finish, cancellable

async def run_deep(engine,prompt,model_override=None):
    from deepagents import create_deep_agent
    from langchain_core.tools import StructuredTool
    from langchain_core.messages import ToolMessage
    from langchain.agents.middleware import wrap_tool_call, ModelCallLimitMiddleware
    from langchain_anthropic import ChatAnthropic
    from langsmith import tracing_context
    config=engine.store.session(engine.sid)['config']
    tools=[]
    for spec in definitions(config):
        def handler(name):
            async def call(**args):return await dispatch(engine,name,args)
            return call
        tools.append(StructuredTool(name=spec['name'],description=spec['description'],args_schema=spec['schema'],coroutine=handler(spec['name'])))
    allowed={t.name for t in tools}
    @wrap_tool_call
    async def boundary(request,handler):
        engine.check();name=request.tool_call['name']
        if name in allowed:return await handler(request)
        if name=='write_todos':
            # Native scratch planning lives only in this graph run, never on the host.
            engine.record('adapter.plan',{'runtime':'deepagents','todos':request.tool_call.get('args',{})})
            return await handler(request)
        engine.record('tool.denied',{'tool':name,'reason':'Native tool outside Relay boundary'})
        return ToolMessage(content='Denied: use the approved Relay case tools.',tool_call_id=request.tool_call['id'],status='error')
    model=model_override or ChatAnthropic(model=config['model'],max_tokens=config['max_output_tokens'],max_retries=0,timeout=120)
    agent=create_deep_agent(model=model,tools=tools,system_prompt=SYSTEM,subagents=[],
        middleware=[boundary,ModelCallLimitMiddleware(run_limit=config['max_turns'],exit_behavior='error')])
    async def execute():
        answer='';usage={}
        # Never opt into remote LangSmith telemetry through inherited environment settings.
        with tracing_context(enabled=False):
            async for mode,data in agent.astream({'messages':[{'role':'user','content':context(engine,prompt)}]},
                    config={'recursion_limit':config['max_turns']*4+10},stream_mode=['messages','updates']):
                engine.check()
                if mode=='messages':
                    message,_=data
                    if getattr(message,'type','')=='AIMessageChunk':
                        content=message.content
                        if isinstance(content,str) and content:engine.record('message.delta',{'text':content})
                        elif isinstance(content,list):
                            for part in content:
                                if isinstance(part,dict) and part.get('type')=='text':engine.record('message.delta',{'text':part.get('text','')})
                else:
                    for update in data.values():
                        if not isinstance(update,dict):continue
                        for message in update.get('messages',[]):
                            if getattr(message,'type',None)!='ai':continue
                            u=getattr(message,'usage_metadata',None) or {}
                            for key in ('input_tokens','output_tokens'):usage[key]=usage.get(key,0)+u.get(key,0)
                            if not getattr(message,'tool_calls',[]):
                                answer=message.content if isinstance(message.content,str) else ''.join(p.get('text','') for p in message.content if isinstance(p,dict))
        finish(engine,answer,'deepagents',usage)
    await cancellable(engine,execute())
