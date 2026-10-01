import {ToolLoopAgent,tool,jsonSchema,isStepCount,Output} from 'ai';

export async function runVercel(request,bridge,modelOverride){
  const tools=Object.fromEntries(request.tools.map(t=>[t.name,tool({
    description:t.description,inputSchema:jsonSchema(t.schema),
    execute:args=>bridge.call(t.name,args)
  })]));
  const agent=new ToolLoopAgent({model:modelOverride||request.config.model,instructions:request.system,tools,
    stopWhen:isStepCount(request.config.max_turns),maxOutputTokens:request.config.max_output_tokens,maxRetries:0,
    ...(request.config.structured_output?{output:Output.object({schema:jsonSchema(request.output_schema)})}:{}),
    onStepFinish:()=>bridge.emit({type:'lifecycle',event:'step.completed'})});
  const messages=[...(request.native_state?.messages||[]),{role:'user',content:request.prompt}];
  bridge.emit({type:'lifecycle',event:request.native_state?'session.resumed':'session.created'});
  const result=await agent.stream({messages,abortSignal:bridge.signal});
  for await(const part of result.fullStream){
    if(part.type==='text-delta')bridge.emit({type:'delta',text:part.text});
    if(part.type==='error')throw part.error;
    if(part.type==='tool-error')throw part.error;
  }
  const reason=await result.finishReason;
  if(!['stop'].includes(reason))throw Error('Vercel stopped before a final answer: '+reason);
  const usage=await result.totalUsage;
  const response=await result.response;
  return {text:await result.text,native_state:{messages:[...messages,...response.messages]},usage:{input_tokens:usage.inputTokens,output_tokens:usage.outputTokens},
    ...(request.config.structured_output?{structured:await result.output}:{})};
}
