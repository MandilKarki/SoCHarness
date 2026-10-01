"""OpenHands native Conversation and events; only Relay tools and FinishTool."""
import json
import os
from shared import lifecycle
from pydantic import Field
from openhands.sdk import Action, Observation, ToolDefinition
from openhands.sdk.tool import ToolExecutor


class RelayAction(Action):
    tool_name: str = Field(description='Exact Relay tool name from the advertised catalog')
    arguments: dict = Field(description='Arguments matching that tool JSON schema')


class RelayObservation(Observation):
    pass


class RelayExecutor(ToolExecutor):
    def __init__(self,bridge,allowed): self.bridge=bridge; self.allowed=allowed
    def __call__(self,action,conversation=None):
        if action.tool_name not in self.allowed: raise ValueError('Tool is not enabled')
        return RelayObservation.from_text(json.dumps(self.bridge.call_sync(action.tool_name,action.arguments)))


class RelayCaseTool(ToolDefinition):
    @classmethod
    def create(cls,conv_state,**params):
        raise RuntimeError('Use the explicitly registered worker-local instance')


async def run(request, bridge, llm_override=None):
    from pydantic import Field, SecretStr
    from openhands.sdk import Agent, Conversation, LLM, Action, Observation, ToolDefinition
    from openhands.sdk.tool import Tool, ToolExecutor, register_tool
    from openhands.sdk.event import ActionEvent
    from openhands.sdk.event.base import Event
    from openhands.sdk.conversation.state import ConversationExecutionStatus
    from openhands.sdk.tool.builtins.finish import FinishAction
    config = request['config']; allowed = {t['name'] for t in request['tools']}
    tool = RelayCaseTool(description='Execute one case-scoped Relay tool. Catalog: '+json.dumps(request['tools']),
        action_type=RelayAction,observation_type=RelayObservation,executor=RelayExecutor(bridge,allowed))
    register_tool(RelayCaseTool.name,tool)
    llm = llm_override or LLM(model=config['model'],api_key=SecretStr(os.environ['OPENAI_API_KEY']),
        base_url='https://api.openai.com/v1',num_retries=0,timeout=120,
        max_output_tokens=config['max_output_tokens'],stream=False,log_completions=False,
        disable_vision=True,usage_id='relay')
    agent = Agent(llm=llm,tools=[Tool(name=RelayCaseTool.name)],include_default_tools=['FinishTool'],
                  system_prompt=request['system'],condenser=None,mcp_config={},tool_concurrency_limit=1)
    final = []
    def event_received(event):
        bridge.emit({'type':'lifecycle','event':type(event).__name__})
        if isinstance(event,ActionEvent) and isinstance(event.action,FinishAction): final.append(event.action.message)
    conversation = Conversation(agent=agent,workspace=request['cwd'],persistence_dir=None,
        plugins=[],hook_config=None,callbacks=[event_received],visualizer=None,
        max_iteration_per_run=config['max_turns'],stuck_detection=True)
    try:
        prior = request.get('native_state')
        if prior:
            with conversation.state:
                for raw in prior['events']: conversation.state.append_event(Event.model_validate(raw))
        lifecycle(request,bridge)
        conversation.send_message(request['prompt'])
        conversation.run()
        if conversation.state.execution_status != ConversationExecutionStatus.FINISHED or not final:
            raise RuntimeError('OpenHands did not complete the turn')
        usage = llm.metrics.accumulated_token_usage
        return {'text':final[-1],
                'usage':{'input_tokens':usage.prompt_tokens if usage else 0,'output_tokens':usage.completion_tokens if usage else 0},
                'native_state':{'events':[e.model_dump(mode='json',exclude_none=True) for e in conversation.state.events]}}
    finally: conversation.close()
