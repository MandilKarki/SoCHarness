/* Guided navigation never executes tools, creates sessions, or approves actions. */
(() => {
  'use strict';
  const storageKey = 'relay-guide-v1';
  let reviewed = new Set(), position = 0;
  try { const value = JSON.parse(localStorage.getItem(storageKey) || '[]'); if (Array.isArray(value)) reviewed = new Set(value.filter(x => Number.isInteger(x) && x >= 0 && x < 6)); } catch (_) { /* Private browsing can deny storage. */ }
  const steps = [
    {title:'Choose a review case', area:'evidence', target:'.queue', label:'Show case queue',
      body:'Start with one of the seven review cohorts. Select a case to scope every evidence query and agent session. A critical review priority is not proof of a confirmed attack.',
      task:'Choose the case you want to understand. Read its source and record count.',
      boundary:'The current source is the imported Defense Collective benchmark—not live sensors.'},
    {title:'Inspect the original evidence', area:'evidence', target:'#evidence-view', label:'Show evidence',
      body:'Use Search host or record, then the inspect arrow on a record. Compare the original event with its timestamp, host and source before drawing conclusions.',
      task:'Open a record and note its stable record ID. Findings should cite these IDs.',
      boundary:'Model-facing excerpts are bounded. The original evidence remains available in this view.'},
    {title:'Try a safe replay session', area:'evidence', target:'.agent', label:'Configure safe replay', settings:true,
      body:'Replay demonstrates the loop without a model provider or token charges. This guide prepares the settings; you still choose Create session and then Inspect evidence to run it.',
      task:'Create the prepared read-only Replay session, then click Inspect evidence. Check the runtime label before running.',
      boundary:'Preparing settings does not create a session, run an agent, or change your existing session. Replay output is not an AI threat verdict.'},
    {title:'Follow the execution trace', area:'trace', target:'#trace-view', label:'Show execution trace',
      body:'Expand the persisted events. Follow message.user → run.started → tool.started → tool.result → checkpoint → run.completed. Failed runs have an explicit failure event.',
      task:'Find the evidence tool receipt and the checkpoint. Compare their record IDs with the original evidence.',
      boundary:'A message, a tool call and a checkpoint are different things. Export JSON can contain evidence; handle it carefully.'},
    {title:'Understand human approval', area:'approvals', target:'#approvals-view', label:'Show approvals',
      body:'Read-only sessions cannot propose changes. In a separately created supervised session, Save note proposes exact arguments for review. Nothing pending has executed yet.',
      task:'Review the approval area. Only approve an operation when you understand the exact target and content. This guide never approves anything.',
      boundary:'Containment dry-run only records a simulation. It never isolates a real endpoint.'},
    {title:'Choose your next SDK', area:'matrix', target:'#matrix-view', label:'Explore SDK coverage',
      body:'Compare native, shared Relay, partial and missing features. Then open Frameworks to check installation and credentials before creating a real SDK session.',
      task:'Pick one capability to learn, such as sessions or typed findings. Configure a provider on the server only after approving its evidence handling and cost.',
      boundary:'Registered does not mean fully integrated or live-verified. Strands and Mastra are design additions, not installed adapters.'}
  ];
  const root = document.createElement('dialog'); root.id = 'getting-started'; root.setAttribute('aria-labelledby','guide-title');
  const heading = text('div','','dialog-heading'); const titleBox = text('div'); titleBox.append(text('span','YOUR FIRST INVESTIGATION','eyebrow'),text('h2','Start with confidence'));
  const close = button('Close guide',()=>root.close(),'subtle'); heading.append(titleBox,close);
  const layout=text('div','','guide-layout'), menu=text('nav','','guide-steps'); menu.setAttribute('aria-label','Getting started steps');
  const content=text('div','','guide-content'); const marker=text('p','','guide-marker'),title=text('h3');title.id='guide-title';const body=text('p'),task=text('div','','guide-task'),boundary=text('p','','notice');
  const actions=text('div','','guide-actions'); const open=button('',()=>openArea(),'primary'),done=button('Mark reviewed',()=>{reviewed.add(position);save();render();},'subtle'); actions.append(open,done);
  const progress=text('p','','hint');progress.setAttribute('aria-live','polite');
  const navigation=text('div','','guide-actions');const previous=button('Previous',()=>{position=Math.max(0,position-1);render();}),next=button('Next step',()=>{position=Math.min(steps.length-1,position+1);render();});navigation.append(previous,next);
  content.append(marker,title,body,task,boundary,actions,progress,navigation);layout.append(menu,content);root.append(heading,layout);document.body.append(root);
  const dock=text('aside','','guide-dock');dock.hidden=true;dock.setAttribute('aria-label','Active getting started guide');const dockLabel=text('span');dock.append(dockLabel,button('Open guide',()=>show()),button('End tour',()=>{dock.hidden=true;clearHighlight();}));document.body.append(dock);
  function save(){try{localStorage.setItem(storageKey,JSON.stringify([...reviewed]));}catch(_){}updateWelcome();}
  function clearHighlight(){document.querySelectorAll('.guide-focus').forEach(el=>el.classList.remove('guide-focus'));}
  function render(){
    const step=steps[position];menu.replaceChildren();steps.forEach((s,i)=>{const item=button((reviewed.has(i)?'✓ ':String(i+1)+'. ')+s.title,()=>{position=i;render();},'guide-step');item.setAttribute('aria-current',i===position?'step':'false');menu.append(item);});
    marker.textContent='STEP '+(position+1)+' / '+steps.length;title.textContent=step.title;body.textContent=step.body;task.textContent='Try this: '+step.task;boundary.textContent=step.boundary;open.textContent=step.label;done.disabled=reviewed.has(position);done.textContent=reviewed.has(position)?'Reviewed':'Mark reviewed';previous.disabled=position===0;next.disabled=position===steps.length-1;progress.textContent=reviewed.size+' of '+steps.length+' marked reviewed on this browser. This is your checklist, not a competency score.';dockLabel.textContent='Step '+(position+1)+' · '+step.title;
  }
  async function openArea(){
    if(state.busy||state.starting)throw Error('Finish or stop the active run before using the guide.');
    if(!state.capabilities||!state.caseId)throw Error('Wait for the evidence workspace to connect, then try again.');
    const step=steps[position];root.close();tab(step.area);dock.hidden=false;clearHighlight();
    if(step.settings){
      const runtime=$('runtime');runtime.value='simulator';runtime.dispatchEvent(new Event('change'));
      $('permission').value='read_only';$('max-turns').value='8';$('budget').value='1';$('output-tokens').value='2048';$('thinking').value='off';$('structured').checked=false;$('budget-ack').checked=false;
      document.querySelectorAll('#advanced-settings input[type=checkbox]').forEach(el=>el.checked=false);
      document.querySelectorAll('#tool-settings input[type=checkbox]').forEach(el=>el.checked=true);
      await openSettings();return;
    }
    const target=document.querySelector(step.target);if(target){target.classList.add('guide-focus');target.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});}
  }
  function show(){render();clearHighlight();if(!root.open)root.showModal();}
  const welcome=text('section','','welcome-guide');welcome.setAttribute('aria-label','Getting started');const welcomeText=text('div');const welcomeHeading=text('h2','Your first evidence-backed investigation');const welcomeSub=text('p','Six guided steps. Start in replay, inspect the trace, then explore a real SDK.');welcomeText.append(welcomeHeading,welcomeSub);
  const welcomeActions=text('div','','guide-actions');const start=button('Start guide',show,'primary');const architecture=text('a','Explore architecture ↗','guide-link');architecture.href='/architecture';architecture.target='_blank';architecture.rel='noopener noreferrer';const hide=button('Dismiss',()=>{welcome.hidden=true;},'subtle');welcomeActions.append(start,architecture,hide);welcome.append(welcomeText,welcomeActions);$('overview-metrics').before(welcome);
  function updateWelcome(){start.textContent=reviewed.size?'Continue guide · '+reviewed.size+'/6':'Start guide';}
  const entry=button('Start here',()=>{welcome.hidden=false;show();},'guide-nav');document.querySelector('.workspace-nav').prepend(entry);
  updateWelcome();render();
})();
