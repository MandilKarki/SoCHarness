"""Deep Agents graph with pinned SQLite checkpoints and bounded SOC specialists."""
from adapters.common import SYSTEM, FINDINGS, definitions, dispatch, finish, cancellable
from adapters.state import load, turn_prompt, directory
from store import Problem, uid


async def run_deep(engine, prompt, model_override=None):
    import anthropic_budget
    if model_override is None and anthropic_budget.guarded('deepagents'):
        from langchain_anthropic import ChatAnthropic
        config = engine.store.session(engine.sid)['config']
        async with anthropic_budget.MeterProxy(engine) as meter:
            model = ChatAnthropic(model=anthropic_budget.MODEL, max_tokens=config['max_output_tokens'], max_retries=0, timeout=120,
                                  base_url=meter.base_url, api_key=meter.token)
            return await _run_deep(engine, prompt, model)
    return await _run_deep(engine, prompt, model_override)


async def _run_deep(engine, prompt, model_override=None):
    from deepagents import create_deep_agent
    from langchain.agents import create_agent
    from langchain_core.tools import StructuredTool
    from langchain_core.messages import ToolMessage
    from langchain.agents.middleware import wrap_tool_call, wrap_model_call, TodoListMiddleware, AgentMiddleware
    from langchain.agents.structured_output import ToolStrategy
    from langchain_anthropic import ChatAnthropic
    from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
    from langsmith import tracing_context
    config = engine.store.session(engine.sid)['config']
    specs = definitions(config)
    tools = []
    for spec in specs:
        def handler(name):
            async def call(**args): return await dispatch(engine, name, args)
            return call
        tools.append(StructuredTool(name=spec['name'], description=spec['description'], args_schema=spec['schema'], coroutine=handler(spec['name'])))
    allowed = {t.name for t in tools}
    counts = {'models':0, 'delegations':0}
    specialist_names = {'evidence-reviewer', 'hypothesis-checker'}

    class RelayCompaction(AgentMiddleware):
        # Replace the native summarizer by its supported middleware name. Relay
        # compacts between turns; hidden summarizer calls must not evade budgets.
        @property
        def name(self): return 'SummarizationMiddleware'

    @wrap_model_call
    async def budget(request, handler):
        engine.check()
        counts['models'] += 1
        if counts['models'] > config['max_turns']:
            raise Problem('Deep Agents shared model-call budget exhausted', 409)
        response = await handler(request)
        for message in response.result:
            u = getattr(message, 'usage_metadata', None) or {}
            for key in ('input_tokens', 'output_tokens'): usage[key] = usage.get(key, 0) + u.get(key, 0)
        return response

    @wrap_tool_call
    async def boundary(request, handler):
        engine.check()
        name = request.tool_call['name']
        if name in allowed: return await handler(request)
        if name == 'write_todos':
            engine.record('adapter.plan', {'runtime':'deepagents', 'todos':request.tool_call.get('args', {})})
            return await handler(request)
        if name == 'task' and config['specialists']:
            args = request.tool_call.get('args', {})
            if args.get('subagent_type') in specialist_names and counts['delegations'] < 2:
                counts['delegations'] += 1
                engine.record('agent.delegated', {'runtime':'deepagents', 'name':args['subagent_type']})
                return await handler(request)
        engine.record('tool.denied', {'tool':name, 'reason':'Native tool outside Relay boundary'})
        return ToolMessage(content='Denied: use the approved Relay case tools.', tool_call_id=request.tool_call['id'], status='error')

    model = model_override or ChatAnthropic(model=config['model'], max_tokens=config['max_output_tokens'], max_retries=0, timeout=120)
    readonly = {s['name'] for s in specs if s['effect'] == 'read' and s['name'] != 'ask_human'}
    subagents = []
    usage = {}
    if config['specialists']:
        for name, instruction in [('evidence-reviewer','Inspect cited evidence. Report facts and gaps.'),
                                  ('hypothesis-checker','Challenge hypotheses. Find alternative explanations and contradicting records.')]:
            # Compiled read-only agents have no filesystem, shell or further delegation tool.
            child = create_agent(model=model, tools=[t for t in tools if t.name in readonly],
                                 system_prompt=SYSTEM+'\n'+instruction, middleware=[budget])
            subagents.append({'name':name, 'description':instruction, 'runnable':child})
    prior = load(engine)
    graph_config = {'configurable':prior['checkpoint'] if prior else {'thread_id':uid('deep')},
                    'recursion_limit':config['max_turns']*4+10}
    engine.record('adapter.lifecycle', {'runtime':'deepagents','event':'session.resumed' if prior else 'session.created'})

    async def execute():
        answer = ''; structured = None
        # Never enable remote LangSmith export through inherited environment settings.
        with tracing_context(enabled=False):
            async with AsyncSqliteSaver.from_conn_string(str(directory(engine)/'deep-checkpoints.sqlite3')) as saver:
                agent = create_deep_agent(model=model, tools=tools, system_prompt=SYSTEM, subagents=subagents,
                    middleware=[TodoListMiddleware(), RelayCompaction(), boundary, budget], checkpointer=saver,
                    response_format=ToolStrategy({**FINDINGS,'title':'Findings'},handle_errors=False) if config['structured_output'] else None)
                async for mode, data in agent.astream({'messages':[{'role':'user','content':turn_prompt(engine,prompt,prior)}]},
                        config=graph_config, stream_mode=['messages','updates']):
                    engine.check()
                    if mode == 'messages':
                        message, _ = data
                        if getattr(message,'type','') == 'AIMessageChunk':
                            content = message.content
                            if isinstance(content,str) and content: engine.record('message.delta',{'text':content})
                            elif isinstance(content,list):
                                for part in content:
                                    if isinstance(part,dict) and part.get('type')=='text':engine.record('message.delta',{'text':part.get('text','')})
                    else:
                        for update in data.values():
                            if not isinstance(update,dict):continue
                            if 'structured_response' in update: structured = update['structured_response']
                            for message in update.get('messages',[]):
                                if getattr(message,'type',None)!='ai':continue
                                if not getattr(message,'tool_calls',[]):
                                    answer=message.content if isinstance(message.content,str) else ''.join(p.get('text','') for p in message.content if isinstance(p,dict))
                latest = await agent.aget_state({'configurable':{'thread_id':graph_config['configurable']['thread_id']}})
                if latest.next: raise Problem('Deep Agents stopped with unfinished graph tasks', 502)
                finish(engine,answer,'deepagents',usage,structured,native_state={'checkpoint':latest.config['configurable']})
    await cancellable(engine,execute())
