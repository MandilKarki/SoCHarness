/* Workspace navigation and presentation only. Agent actions remain in the shared harness. */
(() => {
  'use strict';
  const make=(tag,value,cls)=>{const el=document.createElement(tag);el.textContent=value;if(cls)el.className=cls;return el;};
  document.body.classList.add('relay-v2');
  const originalTab=tab;
  tab=function(name){originalTab(name);document.dispatchEvent(new CustomEvent('relay:view',{detail:name}));};
  let theme='light';try{theme=localStorage.getItem('relay-theme')||'light';}catch(_){}
  document.documentElement.dataset.theme=theme==='dark'?'dark':'light';
  const sidebar=make('aside','','workspace-sidebar');sidebar.id='workspace-sidebar';sidebar.setAttribute('aria-label','Main navigation');
  const brand=make('a','','workspace-brand');brand.href='/';brand.append(make('span','r↗','brand-symbol'),make('strong','Relay'),make('span','LAB','brand-badge'));sidebar.append(brand);
  const environment=make('div','','workspace-environment');environment.append(make('span','◈','environment-icon'),make('div','Security research'),make('small','Private workspace'));sidebar.append(environment);
  const sections=[['Investigate',[['evidence','Case queue','▤'],['trace','Execution trace','⌁'],['approvals','Approvals','◇'],['sessions','Sessions','◷']]],['Agent Lab',[['lab','Playground','✳'],['frameworks','Runtimes','⊞'],['matrix','SDK coverage','▦'],['tools','Tool library','⌘']]],['Operate',[['deployment','Deployment','↗']]]];
  for(const [title,items] of sections){const group=make('nav','','sidebar-group');group.setAttribute('aria-label',title);group.append(make('p',title,'sidebar-label'));for(const [id,label,icon] of items){const b=button('',()=>{tab(id);setMenu(false);},'sidebar-item');b.dataset.route=id;b.append(make('span',icon,'nav-symbol'),make('span',label));if(id==='approvals'){const badge=make('span','0','nav-count');badge.id='nav-approval-count';badge.hidden=true;b.append(badge);}group.append(b);}sidebar.append(group);}
  const architecture=make('a','Architecture atlas ↗','sidebar-link');architecture.href='/architecture';sidebar.append(architecture);
  const bottom=make('div','','sidebar-bottom'),account=make('a','','account-link');account.href='/security';account.append(make('span','MK','avatar'),make('div','Account & security'),make('span','↗'));bottom.append(account);
  const themeButton=button('',()=>{const next=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;try{localStorage.setItem('relay-theme',next);}catch(_){}updateTheme();},'theme-switch');
  function updateTheme(){themeButton.textContent=document.documentElement.dataset.theme==='dark'?'☼  Light appearance':'◐  Dark appearance';}updateTheme();bottom.append(themeButton,make('p','Evidence first. Human controlled.','sidebar-caption'));sidebar.append(bottom);document.body.prepend(sidebar);
  const mobileToggle=button('☰',()=>setMenu(!document.body.classList.contains('menu-open')),'mobile-menu');mobileToggle.id='menu-toggle';mobileToggle.setAttribute('aria-label','Toggle workspace navigation');mobileToggle.setAttribute('aria-controls',sidebar.id);mobileToggle.setAttribute('aria-expanded','false');document.querySelector('header>div').prepend(mobileToggle);
  const scrim=button('',()=>setMenu(false),'navigation-scrim');scrim.setAttribute('aria-label','Close navigation');scrim.tabIndex=-1;document.body.append(scrim);
  const mobileMedia=matchMedia('(max-width:760px)');
  const menuClose=button('Close navigation ✕',()=>setMenu(false),'mobile-menu-close');sidebar.prepend(menuClose);
  function setMenu(open){
    open=!!open&&mobileMedia.matches;
    document.body.classList.toggle('menu-open',open);mobileToggle.setAttribute('aria-expanded',String(open));
    sidebar.inert=mobileMedia.matches&&!open;document.querySelector('.shell').inert=open;
    if(open)menuClose.focus();else if(sidebar.contains(document.activeElement)&&mobileMedia.matches)mobileToggle.focus();
  }
  mobileMedia.addEventListener('change',()=>setMenu(false));setMenu(false);
  const agentToggle=button('✳ Agent console',()=>openAgent(!document.body.classList.contains('agent-open')),'agent-toggle');agentToggle.setAttribute('aria-controls','agent-console');agentToggle.setAttribute('aria-expanded','false');document.querySelector('.header-right').append(agentToggle);
  const agent=document.querySelector('.agent');agent.id='agent-console';agent.setAttribute('aria-label','Investigation agent console');
  const closeAgent=button('✕',()=>openAgent(false),'close-agent');closeAgent.setAttribute('aria-label','Close agent console');document.querySelector('.agent-heading').append(closeAgent);
  function openAgent(open){document.body.classList.toggle('agent-open',open);agentToggle.setAttribute('aria-expanded',String(open));if(open){tab(['matrix','tools','deployment','frameworks'].includes(state.tab)?'evidence':state.tab);$('prompt').focus();}else if(agent.contains(document.activeElement))agentToggle.focus();}
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!document.querySelector('dialog[open]')){setMenu(false);openAgent(false);}});
  document.addEventListener('relay:view',event=>{
    const name=event.detail;document.body.dataset.workspace=['lab','frameworks','matrix','tools'].includes(name)?'lab':name==='deployment'?'operate':'investigate';
    for(const b of sidebar.querySelectorAll('[data-route]'))b.setAttribute('aria-current',b.dataset.route===name?'page':'false');
    const titles={evidence:'Investigations',trace:'Execution trace',approvals:'Human approvals',sessions:'Session history',lab:'Agent playground',frameworks:'Agent runtimes',matrix:'SDK coverage',tools:'Tool library',deployment:'Deployment'};
    const title=$('page-title').querySelector('.page-title-text');if(title)title.textContent=titles[name];
    const count=$('page-title').querySelector('span:not(.page-title-text)');if(count)count.hidden=name!=='evidence';
    const descriptions={trace:'Follow the message, tool and permission lifecycle.',approvals:'Review the exact operation before it executes.',sessions:'Continue an investigation with its saved context.',lab:'Explore planning, memory, skills and human decisions.',frameworks:'Independent runtimes. One shared evidence and policy layer.'};
    if(descriptions[name])$('page-description').textContent=descriptions[name];
    $('page-eyebrow').textContent=({lab:'AGENT LAB',operate:'OPERATE',investigate:'INVESTIGATE'})[document.body.dataset.workspace]+' / RELAY';
    if(['matrix','tools','deployment','frameworks'].includes(name))openAgent(false);
  });
  const syncApproval=()=>{const count=$('approval-count').textContent,badge=$('nav-approval-count');badge.textContent=count;badge.hidden=count==='0';};new MutationObserver(syncApproval).observe($('approval-count'),{childList:true,characterData:true,subtree:true});
  // Compact, persistent onboarding entry; no automatic model calls or session creation.
  const welcome=document.querySelector('.welcome-guide');if(welcome){welcome.querySelector('h2').textContent='A clear path from evidence to insight.';welcome.querySelector('p').textContent='Six guided steps. No provider key needed to explore.';}
  document.querySelectorAll('.icon-btn[data-close]').forEach(b=>{if(!b.hasAttribute('aria-label'))b.setAttribute('aria-label','Close dialog');});
  document.querySelectorAll('.table-scroll').forEach(el=>{el.tabIndex=0;el.setAttribute('aria-label','Scrollable evidence records');});
  $('prompt').placeholder='Ask a question about this case…';
  document.addEventListener('relay:agent',()=>openAgent(true));
  $('settings-form').addEventListener('submit',()=>openAgent(true));
  document.dispatchEvent(new CustomEvent('relay:view',{detail:state.tab}));
})();
