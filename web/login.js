'use strict';
const loginStatus=document.getElementById('login-status'),passkeyButton=document.getElementById('passkey-login');
const destination=()=>{const next=new URLSearchParams(location.search).get('next');return ['architecture','security'].includes(next)?'/'+next:'/';};
let signingIn=false,passkeyReady=false;
async function signIn(action){
  if(signingIn)return;signingIn=true;
  document.querySelectorAll('button').forEach(b=>b.disabled=true);loginStatus.textContent='Waiting for secure sign-in…';
  try{await action();location.assign(destination());}
  catch(error){loginStatus.textContent=relayPasskeys.errorMessage(error);}
  finally{signingIn=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);passkeyButton.disabled=!passkeyReady;}
}
passkeyButton.onclick=()=>signIn(()=>relayPasskeys.login());
document.getElementById('login-form').onsubmit=event=>{
  event.preventDefault();const input=document.getElementById('operator-token'),token=input.value;input.value='';signIn(()=>relayPasskeys.post('/api/login',{token}));
};
fetch('/api/auth').then(r=>r.json()).then(auth=>{
  if(auth.mode==='local'){loginStatus.textContent='Local mode does not require login.';location.replace('/');return;}
  passkeyReady=auth.passkeys_available&&relayPasskeys.available();passkeyButton.disabled=!passkeyReady;
  if(!passkeyReady){loginStatus.textContent='Passkeys need a supported browser and HTTPS. Token login remains available.';document.getElementById('recovery').open=true;}
}).catch(()=>{loginStatus.textContent='Unable to check passkey availability. Try refreshing or use token login.';});
