'use strict';
document.getElementById('login-form').onsubmit=async event=>{
  event.preventDefault();const input=document.getElementById('operator-token'),status=document.getElementById('login-status'),submit=event.target.querySelector('button');
  submit.disabled=true;status.textContent='Signing in…';
  try{const response=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:input.value})});input.value='';const result=await response.json();if(!response.ok)throw Error(result.error);location.assign('/');}
  catch(error){status.textContent=error.message;}finally{submit.disabled=false;}
};
