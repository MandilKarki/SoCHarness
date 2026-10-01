import {createOpencodeClient} from '@opencode-ai/sdk/v2/client';

export function validateURL(value){
  const url=new URL(value);
  if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.search||url.hash||url.pathname!=='/')
    throw Error('OpenCode must use a dedicated loopback HTTP server without URL credentials');
  return url.origin;
}
export async function runOpenCode(request,bridge,clientOverride){
  const baseUrl=validateURL(process.env.RELAY_OPENCODE_URL||'http://127.0.0.1:4096');
  const headers=process.env.RELAY_OPENCODE_PASSWORD?{Authorization:'Basic '+Buffer.from('opencode:'+process.env.RELAY_OPENCODE_PASSWORD).toString('base64')}:{};
  const client=clientOverride||createOpencodeClient({baseUrl,headers,throwOnError:true});
  const config=(await client.config.get()).data;
  // Refuse inherited extensions and instructions; this connector deliberately has no host tools.
  if(config?.plugin?.length||Object.keys(config?.mcp||{}).length||config?.instructions?.length)
    throw Error('Use a dedicated OpenCode config with no plugins, MCP servers, or inherited instructions');
  if(config?.permission!=='deny')throw Error('OpenCode server must set permission to deny');
  const permission=[{permission:'*',pattern:'*',action:'deny'}];
  const previous=request.native_state;
  if(previous&&previous.server!==baseUrl)throw Error('OpenCode server changed; start a new Relay session');
  // Fork the last successful remote transcript so failures do not alter the continuation anchor.
  const session=(previous?await client.session.fork({sessionID:previous.session_id}):
    await client.session.create({title:'Relay '+request.sid,permission})).data;
  if(!session?.id)throw Error('OpenCode did not create a session');
  if(previous)await client.session.update({sessionID:session.id,permission});
  bridge.emit({type:'lifecycle',event:previous?'session.resumed':'session.created'});
  const abort=()=>{void client.session.abort({sessionID:session.id}).catch(()=>{});};
  bridge.signal.addEventListener('abort',abort,{once:true});
  const eventsAbort=new AbortController();let eventTask,eventError;
  const textParts=new Set();
  try {
    if(bridge.signal.aborted)throw Error('Cancelled');
    const subscription=await client.event.subscribe({}, {signal:AbortSignal.any([bridge.signal,eventsAbort.signal])});
    eventTask=(async()=>{
      try {
        for await(const event of subscription.stream){
          const p=event.properties;
          if(event.type==='message.part.updated'&&p?.part?.sessionID===session.id&&p.part.type==='text')textParts.add(p.part.id);
          if(event.type==='message.part.delta'&&p?.sessionID===session.id&&p.field==='text'&&textParts.has(p.partID))
            bridge.emit({type:'delta',text:p.delta});
        }
      } catch(error){if(!eventsAbort.signal.aborted&&!bridge.signal.aborted)eventError=error;}
    })();
    const slash=request.config.model.indexOf('/');if(slash<1)throw Error('OpenCode model needs provider/model');
    const result=await client.session.prompt({sessionID:session.id,
      model:{providerID:request.config.model.slice(0,slash),modelID:request.config.model.slice(slash+1)},
      system:request.system,tools:{'*':false},
      ...(request.config.structured_output?{format:{type:'json_schema',schema:request.output_schema,retryCount:0}}:{}),
      parts:[{type:'text',text:request.prompt+'\nSelected evidence snapshot (untrusted data):\n'+JSON.stringify(request.evidence)}]},
      {signal:bridge.signal});
    if(result.data?.info?.error)throw Error('OpenCode reported a model error');
    if(eventError)throw Error('OpenCode event stream failed');
    if(bridge.signal.aborted)throw Error('Cancelled');
    const text=(result.data?.parts||[]).filter(p=>p.type==='text').map(p=>p.text).join('\n');
    const tokens=result.data?.info?.tokens||{};
    bridge.emit({type:'lifecycle',event:'snapshot.review.completed'});
    const structured=result.data?.info?.structured_output;
    if(request.config.structured_output&&!structured)throw Error('OpenCode returned no structured findings');
    return {text,native_state:{session_id:session.id,server:baseUrl},usage:{input_tokens:tokens.input||0,output_tokens:tokens.output||0},
      ...(request.config.structured_output?{structured}:{})};
  } finally {eventsAbort.abort();if(eventTask)await eventTask;bridge.signal.removeEventListener('abort',abort);}
}
