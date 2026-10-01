"""Google ADK Runner, schema tools, SSE and native event/session continuation."""
import os
from shared import Findings, typed, lifecycle


async def run(request, bridge, model_override=None):
    from google import genai
    from google.genai import types
    from google.adk import Runner
    from google.adk.agents import LlmAgent
    from google.adk.agents.run_config import RunConfig, StreamingMode
    from google.adk.models import Gemini
    from google.adk.tools import BaseTool
    from google.adk.sessions import InMemorySessionService
    from google.adk.events import Event
    config = request['config']
    class RelayTool(BaseTool):
        def __init__(self, spec):
            super().__init__(name=spec['name'],description=spec['description'])
            self.schema = spec['schema']
        def _get_declaration(self):
            return types.FunctionDeclaration(name=self.name,description=self.description,parameters_json_schema=self.schema)
        async def run_async(self, *, args, tool_context):
            return await bridge.call(self.name,args)
    client = None
    if model_override is None:
        client = genai.Client(api_key=os.environ['GOOGLE_API_KEY'],vertexai=False,
            http_options=types.HttpOptions(timeout=120000,retry_options=types.HttpRetryOptions(attempts=1)))
    model = model_override or Gemini(model=config['model'],client=client)
    agent = LlmAgent(name='relay_soc',model=model,instruction=request['system'],
        tools=[RelayTool(t) for t in request['tools']],
        output_schema=Findings if config['structured_output'] else None,
        disallow_transfer_to_parent=True,disallow_transfer_to_peers=True,
        generate_content_config=types.GenerateContentConfig(max_output_tokens=config['max_output_tokens']))
    # One service per single-run worker; finalized state is committed by the parent
    # to SQLite. No shared in-memory service or hosted session identifiers.
    service = InMemorySessionService()
    prior = request.get('native_state')
    session = await service.create_session(app_name='relay',user_id='operator',session_id=request['sid'],
                                           state=prior['state'] if prior else {})
    if prior:
        for raw in prior['events']: await service.append_event(session=session,event=Event.model_validate(raw))
    runner = Runner(app_name='relay',agent=agent,session_service=service)
    text = ''; usage = {'input_tokens':0,'output_tokens':0}
    lifecycle(request,bridge)
    try:
        async for event in runner.run_async(user_id='operator',session_id=session.id,
                new_message=types.Content(role='user',parts=[types.Part(text=request['prompt'])]),
                run_config=RunConfig(streaming_mode=StreamingMode.SSE,max_llm_calls=config['max_turns'])):
            if event.error_code: raise RuntimeError('ADK model response failed')
            if event.finish_reason not in (None,types.FinishReason.STOP): raise RuntimeError('Incomplete Google model result')
            content = ''.join(p.text or '' for p in (event.content.parts or []) if not p.thought) if event.content else ''
            if event.partial and content: bridge.emit({'type':'delta','text':content})
            if event.is_final_response() and content: text = content
            if event.usage_metadata and not event.partial:
                usage['input_tokens'] += event.usage_metadata.prompt_token_count or 0
                usage['output_tokens'] += event.usage_metadata.candidates_token_count or 0
        if not text: raise RuntimeError('ADK produced no final answer')
        session = await service.get_session(app_name='relay',user_id='operator',session_id=session.id)
        return {'text':text,'structured':typed(text,config['structured_output']),'usage':usage,
                'native_state':{'state':session.state,'events':[e.model_dump(mode='json',exclude_none=True) for e in session.events]}}
    finally:
        await runner.close()
        if client is not None: await client.aio.aclose()
