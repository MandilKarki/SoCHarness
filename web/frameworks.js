/* Registry-driven controls. Secrets are configured only in the server environment. */
const frameworkUI=(()=>{
  function selection(){
    const adapter=state.capabilities.runtimes.find(r=>r.id===$('runtime').value);
    if(!adapter)return;
    $('runtime-detail').textContent=adapter.detail+' · '+adapter.budget;
    $('model').value=adapter.default_model;
    $('budget').disabled=adapter.id!=='claude';
    $('output-tokens').disabled=adapter.id==='opencode';$('max-turns').disabled=adapter.id==='opencode';
    $('budget-ack-row').hidden=['claude','simulator'].includes(adapter.id);
    $('budget-ack').checked=false;
    $('thinking').disabled=!adapter.features.includes('thinking');$('thinking').value='off';
    for(const option of $('thinking').options)option.disabled=adapter.id==='claude'&&option.value==='minimal';
    for(const feature of ['specialists','file_workspace','memory','skills','artifacts']){
      const input=$('advanced-'+feature);
      input.disabled=!adapter.features.includes(feature);if(input.disabled)input.checked=false;
    }
    $('structured').disabled=!adapter.features.includes('structured_output');
    if($('structured').disabled)$('structured').checked=false;
    $('permission').disabled=adapter.id==='opencode';
    if(adapter.id==='opencode')$('permission').value='read_only';
  }
  async function refresh(){
    const adapters=await api('/api/adapters');
    state.capabilities.runtimes=adapters;
    const root=$('framework-content');root.replaceChildren();
    root.append(text('p','Adapters are installed locally; credentials and live validation are separate steps. Shared memory, skills and reports use Relay tools—not identical native features in every SDK.','framework-intro'));
    for(const a of adapters){
      const card=text('section','','framework-card'),head=text('div','','framework-heading');
      const badge=text('span',a.available?'Ready to configure':a.enabled?'Setup needed':'Disabled','framework-status'+(a.available?' ready':''));
      head.append(text('h3',a.name),badge);card.append(head);
      card.append(text('p',(a.version?'Installed '+a.version:'Not installed')+' · '+a.verification,'hint'),text('p',a.detail,'hint'));
      const chips=text('div','','capability-grid');
      for(const feature of a.features)chips.append(text('span',feature.replaceAll('_',' '),'capability enabled'));
      card.append(chips);
      const details=document.createElement('details');details.append(text('summary','Coverage & setup'));
      details.append(text('p','Budget: '+a.budget,'hint'));
      if(a.key)details.append(text('p','Server environment: '+a.key+' (never paste it into chat or the UI).','hint'));
      details.append(text('p','Not integrated: '+a.deferred.join(' · '),'hint'));
      if(a.docs){const link=text('a','Official documentation ↗');link.href=a.docs;link.target='_blank';link.rel='noopener noreferrer';details.append(link);}
      card.append(details);
      const actions=text('div','','framework-actions');
      if(a.id!=='simulator')actions.append(button(a.enabled?'Disable adapter':'Enable adapter',async()=>{
        if(state.busy)throw Error('Finish the current run before changing adapter settings.');
        await api('/api/adapters',{id:a.id,enabled:!a.enabled});await refresh();setupSettings();
      }));
      const configure=button('Configure session →',async()=>{setupSettings();$('runtime').value=a.id;selection();await openSettings();},'primary');
      configure.disabled=!a.available;actions.append(configure);card.append(actions);root.append(card);
    }
  }
  $('framework-refresh').onclick=()=>safe(async()=>{await refresh();setupSettings();toast('Dependency and configuration checks refreshed. No model call made.');});
  return {refresh,selection};
})();
