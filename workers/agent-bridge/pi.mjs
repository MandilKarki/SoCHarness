import {createAgentSession,createExtensionRuntime,ModelRuntime,SessionManager,SettingsManager} from '@earendil-works/pi-coding-agent';
import {join,resolve,dirname} from 'node:path';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai';

export function resources(system){
  return {
    getExtensions:()=>({extensions:[],errors:[],runtime:createExtensionRuntime()}),
    getSkills:()=>({skills:[],diagnostics:[]}),getPrompts:()=>({prompts:[],diagnostics:[]}),
    getThemes:()=>({themes:[],diagnostics:[]}),getAgentsFiles:()=>({agentsFiles:[]}),
    getSystemPrompt:()=>system,getSystemPromptSource:()=>undefined,
    getAppendSystemPrompt:()=>[],getAppendSystemPromptSources:()=>[],extendResources:()=>{},reload:async()=>{}
  };
}
export async function runPi(request,bridge,overrides={}){
  const runtime=overrides.runtime||await ModelRuntime.create({authPath:join(request.cwd,'auth.json'),modelsPath:null,
    modelsStorePath:join(request.cwd,'models-cache.json'),allowModelNetwork:false,refreshOnCreate:false});
  if(!overrides.runtime)await runtime.setRuntimeApiKey('anthropic',process.env.ANTHROPIC_API_KEY);
  const model=runtime.getModel('anthropic',request.config.model);
  if(!model)throw Error('Pi model not found in installed catalog: '+request.config.model);
  const customTools=request.tools.map(t=>({name:t.name,label:t.name,description:t.description,parameters:t.schema,
    executionMode:'sequential',execute:async(_id,args)=>({content:[{type:'text',text:JSON.stringify(await bridge.call(t.name,args))}],details:{}})}));
  const sessionDir=join(request.cwd,'sessions');
  const previous=request.native_state?.session_file;
  if(previous&&dirname(resolve(previous))!==resolve(sessionDir))throw Error('Pi session path outside isolated session directory');
  // Fork before each run: a failed/cancelled run cannot alter the last good transcript.
  const manager=previous?SessionManager.forkFrom(previous,request.cwd,sessionDir):SessionManager.create(request.cwd,sessionDir);
  const {session}=await createAgentSession({cwd:request.cwd,agentDir:request.cwd,modelRuntime:runtime,model,
    thinkingLevel:request.config.thinking,resourceLoader:resources(request.system),
    tools:customTools.map(t=>t.name),noTools:'builtin',customTools,
    settingsManager:SettingsManager.inMemory({compaction:{enabled:false},retry:{enabled:false}}),
    sessionManager:manager});
  const initialMessages=session.messages.length;
  bridge.emit({type:'lifecycle',event:previous?'session.resumed':'session.created'});
  let calls=0;const original=overrides.stream||session.agent.streamFunction;
  session.agent.streamFunction=(model,ctx,options)=>{
    if(++calls>request.config.max_turns){
      const stream=createAssistantMessageEventStream();
      const error={role:'assistant',api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),content:[],
        stopReason:'error',errorMessage:'Pi model request limit reached',
        usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
      queueMicrotask(()=>{stream.push({type:'error',reason:'error',error});stream.end(error);});return stream;
    }
    return original(model,ctx,{...options,maxTokens:request.config.max_output_tokens});
  };
  const abort=()=>{void session.abort();};bridge.signal.addEventListener('abort',abort,{once:true});
  const unsubscribe=session.subscribe(event=>{
    if(event.type==='message_update'&&event.assistantMessageEvent.type==='text_delta')
      bridge.emit({type:'delta',text:event.assistantMessageEvent.delta});
    if(['turn_start','turn_end','tool_execution_start','tool_execution_end','auto_compaction_start'].includes(event.type))
      bridge.emit({type:'lifecycle',event:event.type});
  });
  try {
    if(bridge.signal.aborted)throw Error('Cancelled');
    await session.prompt(request.prompt);
    if(bridge.signal.aborted)throw Error('Cancelled');
    const assistants=session.messages.slice(initialMessages).filter(m=>m.role==='assistant');
    const last=assistants.at(-1);
    if(!last||last.stopReason!=='stop')throw Error(last?.errorMessage||'Pi did not finish: '+(last?.stopReason||'no response'));
    return {text:session.getLastAssistantText()||'',native_state:{session_file:manager.getSessionFile()},usage:{
      input_tokens:assistants.reduce((n,m)=>n+(m.usage?.input||0),0),
      output_tokens:assistants.reduce((n,m)=>n+(m.usage?.output||0),0)}};
  } finally {bridge.signal.removeEventListener('abort',abort);unsubscribe();session.dispose();}
}
