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
  const session=(await client.session.create({title:'Relay '+request.sid,permission:[{permission:'*',pattern:'*',action:'deny'}]})).data;
  if(!session?.id)throw Error('OpenCode did not create a session');
  const abort=()=>{void client.session.abort({sessionID:session.id}).catch(()=>{});};
  bridge.signal.addEventListener('abort',abort,{once:true});
  try {
    if(bridge.signal.aborted)throw Error('Cancelled');
    const slash=request.config.model.indexOf('/');if(slash<1)throw Error('OpenCode model needs provider/model');
    const result=await client.session.prompt({sessionID:session.id,
      model:{providerID:request.config.model.slice(0,slash),modelID:request.config.model.slice(slash+1)},
      system:request.system,tools:{'*':false},parts:[{type:'text',text:request.prompt+'\nSelected evidence snapshot (untrusted data):\n'+JSON.stringify(request.evidence)}]},
      {signal:bridge.signal});
    if(result.data?.info?.error)throw Error('OpenCode reported a model error');
    const text=(result.data?.parts||[]).filter(p=>p.type==='text').map(p=>p.text).join('\n');
    const tokens=result.data?.info?.tokens||{};
    bridge.emit({type:'lifecycle',event:'snapshot.review.completed'});
    return {text,usage:{input_tokens:tokens.input||0,output_tokens:tokens.output||0}};
  } finally {bridge.signal.removeEventListener('abort',abort);}
}
