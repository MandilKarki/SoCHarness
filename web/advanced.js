/* Advanced controls use the same session, policy gateway and audit as the agent. */
const advancedUI = (() => {
  let snapshot = null;
  let timer = null;
  let fingerprint = '';
  const labels = {
    specialists: 'Named read-only specialists (Claude)', skills: 'SOC playbooks (Claude: bundled plugin)',
    memory: 'Case-scoped memory', artifacts: 'Versioned report workspace',
    await_approvals: 'Pause active run for decisions', file_workspace: 'Native SDK text-file checkpoints'
  };
  function settingFields() {
    const box = $('advanced-settings');
    for (const [key, label] of Object.entries(labels)) {
      const row = text('label', '', 'tool-option');
      const check = document.createElement('input');
      check.type = 'checkbox'; check.id = 'advanced-' + key;
      check.checked = key === 'await_approvals';
      row.append(check, text('span', label)); box.append(row);
    }
  }
  function config() {
    return Object.fromEntries(Object.keys(labels).map(key => [key, $('advanced-' + key).checked]));
  }
  async function refresh() {
    if (!state.session) {
      $('lab-content').replaceChildren(text('p', 'Create a session to explore plans, memory, skills and versioned artifacts.', 'muted'));
      return;
    }
    const sid = state.session.id;
    const data = await api('/api/sessions/' + sid + '/advanced');
    if (state.session?.id !== sid) return;
    const nextFingerprint = sid + JSON.stringify(data) + state.trace.filter(t=>t.kind.startsWith('agent.')).length;
    snapshot = data;if(nextFingerprint !== fingerprint){fingerprint=nextFingerprint;render();}
  }
  function section(title, description) {
    const card = text('section', '', 'lab-card');
    card.append(text('h3', title), text('p', description, 'hint'));
    $('lab-content').append(card); return card;
  }
  function render() {
    $('lab-content').replaceChildren();
    const c = snapshot.configuration;
    const capabilities = section('Session capabilities', 'Configuration is fixed per session. SDK wiring is contract-tested; live delegation and skill loading need credentials.');
    const flags = text('div', '', 'capability-grid');
    for (const [key, label] of Object.entries(labels)) flags.append(text('span', (c[key] ? '● ' : '○ ') + label, 'capability ' + (c[key] ? 'enabled' : '')));
    capabilities.append(flags);
    const questions = section('Human input', 'Pending questions resume the active SDK tool after you answer.');
    if (!snapshot.questions.length) questions.append(text('p', 'No questions pending.', 'hint'));
    for (const q of snapshot.questions) {
      const item = text('div', '', 'lab-item'); item.append(text('strong', q.question));
      if (q.status === 'pending') {
        const form = document.createElement('form'), input = document.createElement('input');
        input.placeholder = 'Your answer'; input.setAttribute('aria-label', 'Answer: ' + q.question); input.required = true;
        const submit = text('button', 'Send answer', 'primary'); submit.type = 'submit';
        form.append(input, submit); form.onsubmit = event => {event.preventDefault(); safe(async () => {
          await api('/api/sessions/' + state.session.id + '/answer', {id:q.id, answer:input.value}); await refresh();
        });}; item.append(form);
      } else item.append(text('p', q.status + (q.answer ? ': ' + q.answer : ''), 'hint'));
      questions.append(item);
    }
    const tasks = section('Investigation plan', 'Task state persists with this session. Changes pass through approval.');
    tasks.append(button('＋ Add task', () => openTool('set_task')));
    for (const task of snapshot.tasks) {
      const row = text('div', '', 'lab-item');row.append(text('strong', task.title), text('small', task.status, 'hint'));
      if (task.status !== 'done') row.append(button('Mark done', () => propose('set_task', {id:task.id, title:task.title, status:'done'})));
      tasks.append(row);
    }
    const memory = section('Evidence-linked memory', 'Shared only across this case’s sessions. Analyst-approved notes are not ground truth.');
    memory.append(button('＋ Remember finding', () => openTool('remember_finding')));
    for (const m of snapshot.memory) {
      const row = text('div', '', 'lab-item');row.append(text('p', m.content), text('small', 'Evidence: ' + m.evidence_ids.map(id => '#' + id).join(', '), 'hint'));memory.append(row);
    }
    const artifacts = section('Versioned reports', 'Virtual SQLite workspace. Restores create a new version; no files or sensor actions are undone.');
    artifacts.append(button('＋ Write report', () => openTool('write_artifact')));
    for (const a of snapshot.artifacts) {
      const row = text('div', '', 'lab-item');row.append(text('strong', a.name),button('Inspect latest', async () => {
        const data = await api('/api/sessions/' + state.session.id + '/artifact?' + new URLSearchParams({name:a.name}));
        $('record-title').textContent = a.name + ' · version ' + data.id;$('raw-record').textContent = data.content;$('record-dialog').showModal();
      }));
      for (const v of a.versions) {
        const version = text('div', '', 'version-row');version.append(text('span', 'v' + v.id + ' · ' + v.chars + ' characters' + (v.restored_from ? ' · restored from v' + v.restored_from : '')));
        if (v.id !== a.versions[0].id) version.append(button('Propose restore', () => propose('restore_artifact', {name:a.name, version:v.id})));
        row.append(version);
      }
      artifacts.append(row);
    }
    const skills = section('SOC skills', 'The same vetted procedures are available as MCP playbooks and a native Claude plugin.');
    for (const [name, skill] of Object.entries(snapshot.playbooks)) skills.append(button(skill.title, async () => {
      const result = await api('/api/sessions/' + state.session.id + '/tool', {tool:'get_playbook', arguments:{name}});
      if (result.pending_approval) {await sync();tab('approvals');return;}
      $('record-title').textContent = result.title;$('raw-record').textContent = result.steps.map((s,i) => (i+1) + '. ' + s).join('\n\n');$('record-dialog').showModal();await sync();
    }));
    const workspace = section('Native SDK workspace', 'Separate from SQLite reports. Scoped text files only; every edit requires approval. Native rewind needs a real SDK checkpoint.');
    const ws = snapshot.workspace || {enabled:false, files:[], checkpoints:[]};
    if (!ws.enabled) workspace.append(text('p', 'Disabled for this session. Enable Native SDK text-file checkpoints in a new session.', 'hint'));
    else {
      workspace.append(text('p', ws.files.length + ' file(s) · ' + ws.checkpoints.length + ' checkpoint(s)', 'hint'));
      for (const f of ws.files) workspace.append(button(f.name + ' · ' + f.bytes + ' bytes', async () => {
        const file=await api('/api/sessions/'+state.session.id+'/workspace-file?'+new URLSearchParams({name:f.name}));
        $('record-title').textContent=file.name;$('raw-record').textContent=file.content;$('record-dialog').showModal();
      }));
      for (const cp of ws.checkpoints) workspace.append(button('Propose native rewind · ' + cp.uuid.slice(0,8), () => propose('rewind_workspace', {checkpoint_seq:cp.seq})));
      if (!ws.checkpoints.length) workspace.append(text('p', 'No live SDK file checkpoint recorded. Replay cannot fabricate one.', 'hint'));
    }
    const delegation = section('Specialist activity', 'evidence-reviewer and hypothesis-checker · depth 1 · concurrency 2 · read-only tools');
    const events = state.trace.filter(t => t.kind.startsWith('agent.'));
    if (!events.length) delegation.append(text('p', 'No live delegation has been recorded. Replay mode does not simulate LLM specialists.', 'hint'));
    for (const e of events) delegation.append(text('pre', JSON.stringify(e.payload, null, 2)));
    const telemetry = section('Observability', 'Export audit event spans as OTLP/JSON. Prompts, record contents and secrets are excluded. Nothing is sent to an external collector.');
    telemetry.append(button('Download OTLP trace', async () => download(await api('/api/sessions/' + state.session.id + '/otel'), 'relay-otlp.json')));
  }
  function download(data, name) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type:'application/json'}));
    const anchor = document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  async function sync() {
    if (!state.session) return;
    const sid = state.session.id, data = await api('/api/sessions/' + sid);
    if (state.session?.id !== sid) return;
    state.session=data.session;state.trace=data.trace;state.approvals=data.approvals;
    renderTrace();renderApprovals();if (!state.busy) renderMessages();await refresh();
  }
  async function propose(tool, args) {
    if (state.busy) throw Error('Wait for this run before proposing a separate action. You can still answer its questions and approvals.');
    await ensureSession();const result = await api('/api/sessions/' + state.session.id + '/tool', {tool, arguments:args});
    await sync();if (result.pending_approval) {tab('approvals');toast('Review the exact proposal before approving.');} else toast('Tool completed; audit saved.');
  }
  const forms = {
    set_task: {title:'Add an investigation task', fields:[['title','Task title'], ['status','Status (pending, in_progress, done)']]},
    remember_finding: {title:'Remember an evidence-linked finding', fields:[['content','Finding'], ['evidence_ids','Evidence IDs, comma-separated']]},
    write_artifact: {title:'Write a versioned report', fields:[['name','Filename (.md, .txt, .json)'], ['content','Report content']]},
    question: {title:'Demonstrate human input (replay)', fields:[['question','Question for the analyst']]}
  };
  function openTool(name) {
    if (!state.session) throw Error('Create a session first.');
    const spec = forms[name];$('lab-action-title').textContent=spec.title;$('lab-fields').replaceChildren();
    for (const [key,labelText] of spec.fields) {
      const label=text('label',labelText),input=document.createElement(key==='content'?'textarea':'input');input.name=key;input.required=true;
      if (key==='content') input.rows=5;if(key==='status')input.value='pending';if(key==='name')input.value='handoff.md';
      label.append(input);$('lab-fields').append(label);
    }
    $('lab-action-form').onsubmit=event=>{event.preventDefault();safe(async()=>{
      const args=Object.fromEntries(new FormData($('lab-action-form')).entries());
      if(name==='remember_finding')args.evidence_ids=args.evidence_ids.split(',').map(x=>Number(x.trim()));
      if(name==='set_task')args.id='';
      if(name==='question'){await api('/api/sessions/'+state.session.id+'/question',args);await refresh();}
      else await propose(name,args);
      $('lab-action-dialog').close();
    });};$('lab-action-dialog').showModal();
  }
  function startPolling() {
    if(timer)return;
    timer=setInterval(()=>{if(state.busy)safe(sync);},2000);
  }
  settingFields();startPolling();
  $('advanced-demo').onclick=()=>safe(async()=>{
    if(state.busy)throw Error('Finish the active run first.');
    await createSession({runtime:'simulator',permission:'supervised',memory:true,skills:true,artifacts:true,await_approvals:true});
    tab('lab');await refresh();toast('Advanced replay session created. No LLM call made.');
  });
  $('lab-question').onclick=()=>safe(()=>openTool('question'));
  return {config,refresh,sync};
})();
