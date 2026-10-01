import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {MockLanguageModelV4} from 'ai/test';
import {runVercel} from '../vercel.mjs';
import {runOpenCode,validateURL} from '../opencode.mjs';

const schema={type:'object',properties:{limit:{type:'integer'},search:{type:'string'}},required:['limit','search'],additionalProperties:false};
const request={sid:'test-session',system:'Defensive evidence review only.',prompt:'Review record #1.',tools:[{name:'query_case_evidence',description:'Read selected case',schema}],
  config:{model:'claude-sonnet-4-5',max_turns:3,max_output_tokens:500,structured_output:false,thinking:'off'}};
const bridge=()=>({events:[],calls:[],signal:new AbortController().signal,emit(e){this.events.push(e);},async call(name,args){this.calls.push({name,args});return {items:[{id:1}],total:1};}});
const usage={inputTokens:{total:10,noCache:10,cacheRead:0,cacheWrite:0},outputTokens:{total:5,text:5,reasoning:0}};
const stream=events=>({stream:new ReadableStream({start(c){for(const e of events)c.enqueue(e);c.close();}})});

test('Vercel real ToolLoopAgent executes gateway tool and streams final text',async()=>{
  const model=new MockLanguageModelV4({doStream:[
    stream([{type:'stream-start',warnings:[]},{type:'tool-call',toolCallId:'q1',toolName:'query_case_evidence',input:'{"limit":1,"search":""}'},
      {type:'finish',finishReason:{unified:'tool-calls'},usage}]),
    stream([{type:'stream-start',warnings:[]},{type:'text-start',id:'t1'},{type:'text-delta',id:'t1',delta:'Reviewed #1.'},{type:'text-end',id:'t1'},
      {type:'finish',finishReason:{unified:'stop'},usage}])
  ]});
  const b=bridge();const result=await runVercel(request,b,model);
  assert.equal(result.text,'Reviewed #1.');assert.equal(b.calls.length,1);assert.equal(model.doStreamCalls.length,2);
  assert.equal(model.doStreamCalls[0].maxOutputTokens,500);assert.equal(result.usage.input_tokens,20);
});
test('Vercel does not claim success at a truncated response',async()=>{
  const model=new MockLanguageModelV4({doStream:stream([{type:'stream-start',warnings:[]},{type:'finish',finishReason:{unified:'length'},usage}])});
  await assert.rejects(runVercel(request,bridge(),model),/before a final answer/);
});
test('OpenCode rejects non-loopback and URL credentials',()=>{
  for(const url of ['https://example.com','http://127.0.0.1.evil.test','http://user:pass@localhost:4096','http://localhost:4096/private'])assert.throws(()=>validateURL(url));
  assert.equal(validateURL('http://127.0.0.1:4096'),'http://127.0.0.1:4096');
});
test('OpenCode requires deny-all server before creating a session',async()=>{
  const client={config:{get:async()=>({data:{permission:'allow'}})}};
  await assert.rejects(runOpenCode(request,bridge(),client),/permission to deny/);
});
test('OpenCode v2 SDK serializes restrictive session and selected snapshot',async()=>{
  const {createOpencodeClient}=await import('@opencode-ai/sdk/v2/client');const calls=[];
  const client=createOpencodeClient({baseUrl:'http://127.0.0.1:4096',throwOnError:true,fetch:async req=>{
    const body=req.method==='POST'?await req.json():null;calls.push({url:req.url,body});
    const data=req.url.endsWith('/config')?{permission:'deny'}:req.url.endsWith('/session')?{id:'session1'}:{info:{tokens:{input:12,output:4}},parts:[{type:'text',text:'Review complete.'}]};
    return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
  }});
  const result=await runOpenCode({...request,config:{...request.config,model:'anthropic/test'},evidence:{items:[{id:1}]}},bridge(),client);
  assert.equal(result.text,'Review complete.');assert.deepEqual(calls[1].body.permission,[{permission:'*',pattern:'*',action:'deny'}]);
  assert.equal(calls[2].body.tools['*'],false);assert.match(calls[2].body.parts[0].text,/"id":1/);
});
test('Pi native session has only Relay tools and performs a two-turn tool loop',async()=>{
  const {runPi,resources}=await import('../pi.mjs');
  const {ModelRuntime}=await import('@earendil-works/pi-coding-agent');
  const ai=await import('@earendil-works/pi-ai');
  const cwd=await mkdtemp(join(tmpdir(),'relay-pi-test-'));let calls=0;
  try {
    const runtime=await ModelRuntime.create({authPath:join(cwd,'auth.json'),modelsPath:null,modelsStorePath:join(cwd,'cache.json'),allowModelNetwork:false,refreshOnCreate:false});
    await runtime.setRuntimeApiKey('anthropic','local-test-placeholder-not-a-credential');
    runtime.stream=runtime.streamSimple=()=>{throw Error('Network transport forbidden in this test');};
    const fake=(model,ctx,options)=>{
      calls++;assert.equal(options.maxTokens,500);
      const declared=ctx.messages.filter(m=>m.role==='system').flatMap(m=>m.toolsAdded||[]);
      assert.deepEqual(declared.map(t=>t.name),['query_case_evidence']);
      const events=ai.createAssistantMessageEventStream();
      const message={role:'assistant',api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),
        content:calls===1?[{type:'toolCall',id:'q1',name:'query_case_evidence',arguments:{limit:1,search:''}}]:[{type:'text',text:'Pi reviewed #1.'}],
        stopReason:calls===1?'toolUse':'stop',usage:{input:10,output:5,cacheRead:0,cacheWrite:0,totalTokens:15,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
      queueMicrotask(()=>{events.push({type:'done',reason:message.stopReason,message});events.end(message);});return events;
    };
    const b=bridge();const result=await runPi({...request,cwd},b,{runtime,stream:fake});
    assert.equal(calls,2);assert.equal(b.calls.length,1);assert.equal(result.text,'Pi reviewed #1.');
    assert.deepEqual(resources('safe').getSkills().skills,[]);
  } finally {await rm(cwd,{recursive:true,force:true});}
});
