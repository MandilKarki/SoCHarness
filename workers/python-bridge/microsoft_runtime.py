"""Microsoft Agent Framework native tool loop and serialized AgentSession."""
import os
from shared import Findings, typed, lifecycle


async def run(request, bridge, transport=None):
    import httpx
    from openai import AsyncOpenAI
    from agent_framework import Agent, AgentSession, FunctionTool
    from agent_framework.openai import OpenAIChatCompletionClient
    config = request['config']; calls = 0
    async def limit(_request):
        nonlocal calls
        calls += 1
        if calls > config['max_turns']: raise RuntimeError('Model-call budget exhausted')
        bridge.emit({'type':'lifecycle','event':'model.request'})
    async with httpx.AsyncClient(transport=transport,event_hooks={'request':[limit]}) as http:
        async with AsyncOpenAI(api_key=os.environ.get('OPENAI_API_KEY','contract-test') if transport else os.environ['OPENAI_API_KEY'],
                base_url='https://api.openai.com/v1',http_client=http,max_retries=0,timeout=120) as sdk:
            client = OpenAIChatCompletionClient(async_client=sdk,model=config['model'])
            client.function_invocation_configuration.update(max_iterations=config['max_turns'],
                max_function_calls=config['max_turns']*4,allow_concurrent_invocation=False,terminate_on_unknown_calls=True)
            tools = []
            for spec in request['tools']:
                def handler(name):
                    async def call(**kwargs): return await bridge.call(name,kwargs)
                    return call
                tools.append(FunctionTool(name=spec['name'],description=spec['description'],
                    func=handler(spec['name']),input_model=spec['schema']))
            options = {'max_tokens':config['max_output_tokens'],'store':False,'parallel_tool_calls':False}
            if config['structured_output']: options['response_format'] = Findings
            agent = Agent(client,name='relay_soc',instructions=request['system'],tools=tools,default_options=options)
            prior = request.get('native_state')
            session = AgentSession.from_dict(prior['session']) if prior else agent.create_session()
            lifecycle(request,bridge)
            stream = agent.run(request['prompt'],session=session,stream=True)
            async for update in stream:
                if update.text: bridge.emit({'type':'delta','text':update.text})
            response = await stream.get_final_response()
            if response.finish_reason not in (None,'stop'): raise RuntimeError('Incomplete Microsoft model result')
            if not response.text: raise RuntimeError('No final answer')
            usage = response.usage_details or {}
            return {'text':response.text,'structured':typed(response.text,config['structured_output']),
                    'usage':{'input_tokens':usage.get('input_token_count',0),'output_tokens':usage.get('output_token_count',0)},
                    'native_state':{'session':session.to_dict()}}
