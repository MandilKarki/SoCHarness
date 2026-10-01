'use strict';
// WebAuthn transports only public credential material. Private keys stay on the authenticator.
window.relayPasskeys=(()=>{
  const decode=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  const encode=value=>btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  async function post(path,body={}){const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw Error(result.error||'Request failed');return result;}
  function options(value){const result={...value,challenge:decode(value.challenge)};if(value.user)result.user={...value.user,id:decode(value.user.id)};for(const key of ['allowCredentials','excludeCredentials'])if(value[key])result[key]=value[key].map(c=>({...c,id:decode(c.id)}));return result;}
  function serialize(c){
    if(!c)throw Error('No passkey was selected. Please try again.');
    const r=c.response,response={clientDataJSON:encode(r.clientDataJSON)};
    if(r.attestationObject){response.attestationObject=encode(r.attestationObject);if(r.getTransports)response.transports=r.getTransports();}
    else {response.authenticatorData=encode(r.authenticatorData);response.signature=encode(r.signature);response.userHandle=r.userHandle?encode(r.userHandle):null;}
    return {id:c.id,rawId:encode(c.rawId),type:c.type,response,clientExtensionResults:c.getClientExtensionResults()};
  }
  function available(){return window.isSecureContext&&!!window.PublicKeyCredential&&!!navigator.credentials;}
  async function ceremony(kind,body={}){
    if(!available())throw Error('Use an up-to-date browser on the HTTPS pilot to use passkeys.');
    const start=await post('/api/passkeys/'+kind+'/options',body);
    const credential=kind==='registration'?await navigator.credentials.create({publicKey:options(start.publicKey)}):await navigator.credentials.get({publicKey:options(start.publicKey)});
    return post('/api/passkeys/'+kind+'/verify',{ceremony_id:start.ceremony_id,credential:serialize(credential)});
  }
  function errorMessage(error){return ({NotAllowedError:'Passkey request cancelled or timed out. Try again, choose your nearby iPhone, or use the recovery token.',InvalidStateError:'That passkey may already be registered. Try signing in instead.',SecurityError:'The browser could not verify this site. Open the official HTTPS Relay address.',NotSupportedError:'This browser or authenticator does not support the required passkey options.'})[error.name]||error.message||'Passkey request failed.';}
  return {available,post,register:label=>ceremony('registration',{label}),login:()=>ceremony('authentication'),errorMessage};
})();
