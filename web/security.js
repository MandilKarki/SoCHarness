'use strict';
const securityStatus=document.getElementById('security-status'),keyList=document.getElementById('passkey-list'),addButton=document.getElementById('add-passkey-button'),removeDialog=document.getElementById('remove-dialog');
let selectedKey=null,securityBusy=false;
function node(tag,value,cls){const e=document.createElement(tag);e.textContent=value;if(cls)e.className=cls;return e;}
async function loadSecurity(){
  const auth=await fetch('/api/auth').then(r=>r.json());
  if(auth.mode==='local'){keyList.textContent='Passkeys are available on the HTTPS Fly pilot. Local mode has no login.';document.getElementById('add-passkey').hidden=true;return;}
  const response=await fetch('/api/passkeys');if(response.status===401){location.assign('/login?next=security');return;}
  const data=await response.json();if(!response.ok)throw Error(data.error);keyList.replaceChildren();
  if(!data.passkeys.length)keyList.append(node('p','No passkeys yet. Add your first one below.','no-keys'));
  for(const key of data.passkeys){
    const row=node('div','','passkey-row'),info=node('div','');info.append(node('strong',key.label),node('small','Added '+new Date(key.created_at).toLocaleDateString()+' · '+(key.last_used_at?'Last used '+new Date(key.last_used_at).toLocaleString():'Not used to sign in yet')));
    const remove=node('button','Remove','secondary');remove.disabled=!data.recent_auth;remove.setAttribute('aria-label','Remove '+key.label);remove.onclick=()=>{selectedKey=key;document.getElementById('remove-description').textContent=key.label;removeDialog.showModal();};row.append(info,remove);keyList.append(row);
  }
  document.getElementById('fresh-login').hidden=data.recent_auth;addButton.disabled=!data.recent_auth||data.passkeys.length>=data.max_keys||!relayPasskeys.available();
  if(data.passkeys.length>=data.max_keys)securityStatus.textContent='Maximum of '+data.max_keys+' passkeys reached.';
}
document.getElementById('add-passkey').onsubmit=async event=>{
  event.preventDefault();if(securityBusy)return;securityBusy=true;addButton.disabled=true;securityStatus.textContent='Follow your device’s secure passkey prompt…';
  try{await relayPasskeys.register(document.getElementById('passkey-label').value.trim());securityStatus.textContent='Passkey registered. You can now use it to sign in.';document.getElementById('passkey-label').value='';}
  catch(error){securityStatus.textContent=relayPasskeys.errorMessage(error);}
  finally{securityBusy=false;await loadSecurity().catch(error=>securityStatus.textContent=error.message);}
};
document.getElementById('remove-cancel').onclick=()=>removeDialog.close();
document.getElementById('remove-confirm').onclick=async()=>{
  if(securityBusy||!selectedKey)return;securityBusy=true;document.getElementById('remove-confirm').disabled=true;
  try{await relayPasskeys.post('/api/passkeys/remove',{id:selectedKey.id});location.assign('/login?next=security');}
  catch(error){removeDialog.close();securityStatus.textContent=relayPasskeys.errorMessage(error);securityBusy=false;document.getElementById('remove-confirm').disabled=false;}
};
loadSecurity().catch(error=>securityStatus.textContent=error.message);
