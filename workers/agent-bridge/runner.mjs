import {createInterface} from 'node:readline';

const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
const pending=new Map();let counter=0,started=false;
const controller=new AbortController();
const bridge={emit,signal:controller.signal,call(name,args){
  const id=String(++counter);
  return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});emit({type:'tool',id,name,arguments:args});});
}};
controller.signal.addEventListener('abort',()=>{for(const p of pending.values())p.reject(Error('Cancelled'));pending.clear();});
lines.on('line',line=>{
  try {
    if(line.length>1024*1024)throw Error('Bridge frame too large');
    const message=JSON.parse(line);
    if(message.type==='cancel'){controller.abort();return;}
    if(message.type==='tool_result'){
      const p=pending.get(message.id);if(!p)throw Error('Unknown tool receipt');pending.delete(message.id);
      message.error?p.reject(Error(message.error)):p.resolve(message.result);return;
    }
    if(message.type!=='run'||started)throw Error('Expected one run request');
    started=true;
    const run={pi:async(...args)=>(await import('./pi.mjs')).runPi(...args),vercel:async(...args)=>(await import('./vercel.mjs')).runVercel(...args),opencode:async(...args)=>(await import('./opencode.mjs')).runOpenCode(...args)}[message.runtime];
    if(!run)throw Error('Unknown runtime');
    run(message,bridge).then(result=>emit({type:'final',...result})).catch(error=>{
      emit({type:'error',message:String(error.message).slice(0,1000)});process.exitCode=1;
    }).finally(()=>{lines.close();process.stdin.destroy();});
  } catch(error){emit({type:'error',message:error.message});controller.abort();process.exitCode=1;lines.close();process.stdin.destroy();}
});
lines.on('close',()=>{if(!started)controller.abort();});
