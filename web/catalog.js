/* Read-only inventory + intentional navigation. All user/source strings use textContent. */
const catalogUI=(()=>{
  let data, deployment, current='matrix';
  const sections={matrix:['SDK coverage','Explore the integration, not just the SDK label.'],tools:['Tool library','Small, scoped capabilities. One shared policy boundary.'],deployment:['Deployment readiness','A protected pilot first. Explicit gates before production.']};
  const labels={native:'Native',shared:'Relay',partial:'Partial',gap:'Not integrated'};
  const views={};
  for(const id of Object.keys(sections)){
    const el=text('div','','view catalog-view');el.id=id+'-view';el.hidden=true;
    document.querySelector('.investigation').insertBefore(el,document.querySelector('.provenance'));views[id]=el;
  }
  function download(name,value,type='application/json'){
    const url=URL.createObjectURL(new Blob([typeof value==='string'?value:JSON.stringify(value,null,2)],{type}));const a=text('a','Download');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function detail(title,...nodes){$('catalog-detail-title').textContent=title;$('catalog-detail-body').replaceChildren(...nodes);$('catalog-detail').showModal();}
  function link(label,url){const a=text('a',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}
  function heading(title,subtitle){const box=text('div','','catalog-heading');box.append(text('h2',title),text('p',subtitle,'hint'));return box;}
  function select(label,options){const wrap=text('label','','catalog-filter');wrap.append(text('span',label));const field=document.createElement('select');for(const [value,name] of options){const o=text('option',name);o.value=value;field.append(o);}wrap.append(field);return [wrap,field];}
  function search(label){const input=document.createElement('input');input.type='search';input.placeholder=label;input.setAttribute('aria-label',label);return input;}
  function metrics(){
    const m=data.metrics;$('overview-metrics').replaceChildren();
    for(const [value,label,help] of [[m.records,'Evidence records','Imported benchmark corpus'],[m.hosts,'Observed hosts','Distinct names in the corpus'],[m.sdk_adapters,'SDK adapters','Contract-tested · not live-verified'],[m.tools,'Registered tools','Policy-controlled access'],[m.sessions,'Saved sessions',m.completed_runs+' completed run events · includes replay']]){
      const card=text('div','','metric');card.append(text('span',label),text('strong',value.toLocaleString()),text('small',help));$('overview-metrics').append(card);
    }
  }
  function matrix(){
    const root=views.matrix;root.replaceChildren(heading('A clear view of what works','Native = SDK implementation · Relay = shared platform feature · Partial = restricted subset. Click any cell for its boundary.'));
    const toolbar=text('div','','catalog-toolbar'),query=search('Find a capability…');
    const [catWrap,cat]=select('Category',[['all','All categories'],...[...new Set(data.rows.map(r=>r.category))].map(c=>[c,c])]);
    const [scopeWrap,scope]=select('Show',[['all','All tracked frameworks'],['integrated','Integrated adapters']]);
    const [statusWrap,status]=select('Coverage',[['all','All capabilities'],['covered','Has implemented coverage'],['missing','Has integration gaps']]);
    toolbar.append(query,catWrap,scopeWrap,statusWrap,button('Export JSON',()=>download('relay-capability-inventory.json',data)));root.append(toolbar);
    const legend=text('div','','matrix-legend');for(const [key,value] of Object.entries(labels))legend.append(text('span',value,'status-tag '+key));legend.append(text('span','? Upstream not assessed ≠ unsupported','hint'));root.append(legend);
    const wrap=text('div','','matrix-scroll');wrap.tabIndex=0;wrap.setAttribute('aria-label','Scrollable SDK coverage matrix');root.append(wrap);
    const count=text('p','','catalog-foot');root.append(count,text('p',data.scope+' Reviewed '+data.reviewed+'. No live provider run verified.','catalog-foot'));
    function render(){
      const frameworks=data.frameworks.filter(f=>scope.value==='all'||f.integrated),rows=data.rows.filter(r=>(cat.value==='all'||r.category===cat.value)&&r.label.toLowerCase().includes(query.value.toLowerCase())&&(status.value==='all'||frameworks.some(f=>status.value==='covered'?r.cells[f.id].status!=='gap':r.cells[f.id].status==='gap')));
      const table=document.createElement('table'),thead=document.createElement('thead'),tr=document.createElement('tr');
      tr.append(text('th','Capability / family'));for(const f of frameworks){const th=text('th',f.name);th.append(text('small',f.integrated?(f.version||'Not installed'):'Not integrated'));tr.append(th);}thead.append(tr);table.append(thead);
      const tbody=document.createElement('tbody');for(const row of rows){const tr=document.createElement('tr'),th=text('th',row.label);th.scope='row';th.append(text('small',row.category));tr.append(th);
        for(const f of frameworks){const cell=row.cells[f.id],td=document.createElement('td');const b=button(labels[cell.status],()=>detail(f.name+' · '+row.label,text('span',labels[cell.status],'status-tag '+cell.status),text('p',cell.note),text('p','Upstream: '+cell.upstream+'. A documented capability is not evidence of Relay implementation.','hint'),text('p','Verification: '+f.verification+'.','hint'),link('Official documentation ↗',cell.source)),'matrix-cell '+cell.status);b.setAttribute('aria-label',f.name+', '+row.label+': '+labels[cell.status]+'. Upstream '+cell.upstream);td.append(b,text('small',cell.upstream==='documented'?'SDK documented':cell.upstream==='extension pattern'?'Extension pattern':'? Not assessed'));tr.append(td);}tbody.append(tr);}
      table.append(tbody);wrap.replaceChildren(table);count.textContent=rows.length+' capability families × '+frameworks.length+' frameworks. Cell counts are not a completeness or quality score.';
    }
    for(const field of [query,cat,scope,status])field.addEventListener('input',render);render();
  }
  function tools(){
    const root=views.tools;root.replaceChildren(heading('Built for an analyst, callable by an agent','Every registered tool below comes from the live server registry. Read tools can still require approval under ask-every-tool policy.'));
    const toolbar=text('div','','catalog-toolbar'),query=search('Find tools, memory, reports…');
    const [effectWrap,effect]=select('Effect',[['all','All tools'],['read','Read / analyst input'],['write','Approved writes'],['simulation','Simulation only']]);
    toolbar.append(query,effectWrap,button('Export tool catalog',()=>download('relay-tool-catalog.json',{tools:data.tools,features:data.features})));root.append(toolbar);
    const grid=text('div','','tool-grid');root.append(grid);
    function render(){grid.replaceChildren();const found=data.tools.filter(t=>(effect.value==='all'||t.effect===effect.value)&&(t.name+' '+t.description+' '+(t.feature||'')).toLowerCase().includes(query.value.toLowerCase()));
      for(const t of found){const card=text('article','','tool-card'),top=text('div','','tool-card-top');top.append(text('span',t.effect==='read'?'⌕':t.effect==='write'?'↗':'◇','tool-icon'),text('span',t.effect==='simulation'?'Dry-run only':t.effect==='write'?'Approval required':'Read / input','status-tag '+(t.effect==='read'?'shared':'partial')));card.append(top,text('h3',t.name.replaceAll('_',' ')),text('p',t.description),text('small',t.feature?'Requires '+t.feature.replaceAll('_',' ')+' enabled':'Available in standard sessions'));
        card.append(button('Explore tool →',()=>detail(t.name,text('p',t.description),text('p',t.boundary,'hint'),text('p','Runtimes: '+t.runtimes.map(id=>id==='simulator'?'Replay':data.frameworks.find(f=>f.id===id)?.name).join(', ')),text('p',t.feature?'Enable '+t.feature+' when creating the session.':'Session policy and tool enable switches always apply.','notice'),button(t.name==='rewind_workspace'?'Open laboratory':'Draft a request',()=>{
          $('catalog-detail').close();tab(t.name==='rewind_workspace'?'lab':'evidence');if(t.name!=='rewind_workspace'){document.dispatchEvent(new CustomEvent('relay:agent'));$('prompt').value='Use '+t.name+' for this case. Ask me for any required details, cite evidence, and respect the session permission policy.';$('prompt').focus();toast('Draft only. Review the prompt and click Run when ready.');}
        },'primary'))));grid.append(card);
      }
      const features=(data.features||[]).filter(f=>effect.value==='all'&&(f.name+' '+f.description).toLowerCase().includes(query.value.toLowerCase()));
      for(const f of features){const card=text('article','','tool-card feature-card');card.append(text('span','Workspace feature','status-tag native'),text('h3',f.name),text('p',f.description),button('Open workspace →',()=>tab(f.view)));grid.append(card);}
      if(!found.length&&!features.length)grid.append(text('p','No matches. Clear the search or change the filter.','empty'));
    }query.oninput=render;effect.onchange=render;render();
  }
  function deploy(){
    const root=views.deployment;root.replaceChildren(heading('Deployment is a sequence of gates',deployment.mode==='pilot'?'Protected pilot mode. Single operator, persistent evidence, explicit production gaps.':'Local development mode. The cloud pilot has a separate database and login.'));
    const banner=text('div','','deployment-banner');banner.append(text('span','CURRENT MODE / '+deployment.mode.toUpperCase(),'eyebrow'),text('h2','One operator. One machine. Explicit boundaries.'),text('p','Pilot: HTTPS edge → authenticated Relay → bounded SDK subprocesses → persistent SQLite volume. Team deployment: Supabase Auth + Postgres + durable workers, after isolation and migration tests.'));root.append(banner);
    const grid=text('div','','tool-grid');for(const gate of deployment.gates){const card=text('article','','tool-card');card.append(text('span',gate.status,'status-tag '+(['implemented','configured'].includes(gate.status)?'shared':gate.status==='blocked'?'gap':'partial')),text('h3',gate.name),text('p',gate.detail));grid.append(card);}root.append(grid);
    const sources=text('div','','catalog-foot');sources.append(link('Fly volumes ↗','https://fly.io/docs/volumes/overview/'),text('span',' · '),link('Supabase Auth ↗','https://supabase.com/docs/guides/auth/jwts'),text('span',' · '),link('Postgres RLS ↗','https://supabase.com/docs/guides/database/postgres/row-level-security'));root.append(sources,button('Export readiness matrix',()=>download('relay-deployment-readiness.json',deployment)));
  }
  let refreshing=null;
  function refresh(){if(refreshing)return refreshing;refreshing=(async()=>{[data,deployment]=await Promise.all([api('/api/inventory'),api('/api/deployment')]);metrics();matrix();tools();deploy();})().finally(()=>refreshing=null);return refreshing;}
  async function show(name){current=name;if(!data)await refresh();}
  const commands=[['Investigations','evidence'],['SDK coverage matrix','matrix'],['Search the tool library','tools'],['Deployment readiness','deployment'],['Framework configuration','frameworks'],['Execution trace','trace'],['Pending approvals','approvals'],['Saved sessions','sessions'],['Advanced laboratory','lab']];
  function renderCommands(){const q=$('command-search').value.toLowerCase();$('command-results').replaceChildren();for(const [label,id] of commands.filter(([label])=>label.toLowerCase().includes(q)))$('command-results').append(button(label+' →',()=>{$('commands').close();tab(id);},'command-result'));}
  $('command-open').onclick=()=>{renderCommands();$('commands').showModal();$('command-search').focus();};$('command-search').oninput=renderCommands;
  document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();if(!$('commands').open)$('command-open').click();}if((event.ctrlKey||event.metaKey)&&event.key==='Enter'&&document.activeElement===$('prompt')){event.preventDefault();$('chat-form').requestSubmit();}});
  document.querySelectorAll('[data-workspace]').forEach(b=>b.onclick=()=>tab(b.dataset.workspace));
  $('sign-out').onclick=()=>safe(async()=>{if(state.busy)throw Error('Stop the active run before signing out.');await api('/api/logout',{});location.assign('/login');});
  window.addEventListener('DOMContentLoaded',()=>safe(async()=>{const auth=await api('/api/auth');$('sign-out').hidden=auth.mode!=='pilot';await refresh();}));
  return {show,refresh,sections};
})();
