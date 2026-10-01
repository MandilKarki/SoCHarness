"""OpenAI Agents SDK runner, streamed events, typed findings and native input history.

Only Relay function tools are exposed. No hosted shell/browser, external MCP or
remote trace export. Credentials remain on the server, never in transcripts.
"""
import json
import os
from adapters.common import SYSTEM, definitions, dispatch, finish, cancellable
from adapters.state import load, turn_prompt


async def run_openai(engine, prompt, model_override=None):
    from agents import Agent, Runner, FunctionTool, ModelSettings, RunConfig, OpenAIResponsesModel
    from openai import AsyncOpenAI
    from pydantic import BaseModel
    config = engine.store.session(engine.sid)['config']
    tools = []
    for spec in definitions(config):
        def handler(name):
            async def call(_ctx, arguments):
                return json.dumps(await dispatch(engine, name, json.loads(arguments)))
            return call
        tools.append(FunctionTool(name=spec['name'], description=spec['description'],
                                  params_json_schema=spec['schema'], on_invoke_tool=handler(spec['name'])))

    class Findings(BaseModel):
        observations: list[str]
        evidence_ids: list[int]
        hypotheses: list[str]
        next_steps: list[str]
        limitations: str

    client = None
    if model_override is None:
        # Explicit base URL: do not silently forward telemetry to an inherited proxy endpoint.
        client = AsyncOpenAI(api_key=os.environ['OPENAI_API_KEY'], base_url='https://api.openai.com/v1', max_retries=0, timeout=120)
    model = model_override or OpenAIResponsesModel(model=config['model'], openai_client=client)
    agent = Agent(name='Relay SOC analyst', instructions=SYSTEM, model=model, tools=tools,
                  model_settings=ModelSettings(max_tokens=config['max_output_tokens'], parallel_tool_calls=False, store=False),
                  output_type=Findings if config['structured_output'] else None)
    prior = load(engine)
    items = list(prior['messages']) if prior else []
    items.append({'role':'user', 'content':turn_prompt(engine, prompt, prior)})
    engine.record('adapter.lifecycle', {'runtime':'openai', 'event':'session.resumed' if prior else 'session.created'})
    result = Runner.run_streamed(agent, input=items, max_turns=config['max_turns'],
                                run_config=RunConfig(tracing_disabled=True))

    async def consume():
        async for event in result.stream_events():
            engine.check()
            if event.type == 'raw_response_event' and event.data.type == 'response.output_text.delta':
                engine.record('message.delta', {'text':event.data.delta})
            elif event.type == 'run_item_stream_event':
                engine.record('adapter.lifecycle', {'runtime':'openai', 'event':event.name})
        structured = result.final_output.model_dump() if config['structured_output'] else None
        usage = result.context_wrapper.usage
        finish(engine, str(result.final_output or ''), 'openai',
               {'input_tokens':usage.input_tokens, 'output_tokens':usage.output_tokens}, structured,
               native_state={'messages':result.to_input_list()})
    try:
        await cancellable(engine, consume())
    finally:
        if not result.is_complete: result.cancel()
        if client is not None: await client.close()
