import assert from "node:assert/strict";
import { argumentsFor,target,output } from "./harness.mjs";
const options=argumentsFor(),server=await target({...options,auth:"token"});
// Public test-only credentials, installed solely in the disposable fixture server.
const token="parity_fixture_"+"a".repeat(40), other="parity_fixture_"+"b".repeat(40);
const checks=[];
async function call(method,path,status,headers={},body) {
  const response=await fetch(server.url+path,{method,headers:{...(body===undefined?{}:{"content-type":"application/json"}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});
  const text=await response.text(),data=text?JSON.parse(text):null;
  assert.equal(response.status,status,method+" "+path);
  checks.push({method,path,status});
  return {response,data,text};
}
try {
  await call("GET","/health",200);
  assert.equal((await call("GET","/api/v1/auth/session",200)).data.authenticated,false);
  for(const path of ["/api/v1/dashboard","/api/v1/response-plans","/api/v1/investigations","/api/v1/skills","/api/v1/api-sources"]) {
    await call("GET",path,401);
    await call("GET",path,401,{authorization:"Bearer "+"x".repeat(50)});
    await call("GET",path,403,{authorization:"Bearer "+token,"x-tenant-id":"auth-b"});
    await call("GET",path,200,{authorization:"Bearer "+token});
  }
  const created=await call("POST","/api/v1/investigations",201,{authorization:"Bearer "+token},{title:"Authenticated case",source:"Parity",severity:"high"});
  await call("GET","/api/v1/investigations/"+created.data.id,404,{authorization:"Bearer "+other});
  const login=await call("POST","/api/v1/auth/login",200,{authorization:"Bearer "+token,origin:"http://localhost:8080"});
  assert.ok(!login.text.includes(token));
  const cookieHeader=login.response.headers.get("set-cookie");
  assert.match(cookieHeader,/HttpOnly/);assert.match(cookieHeader,/SameSite=Strict/);
  const cookie=cookieHeader.split(";")[0],csrf=login.data.csrf_token;
  const session=await call("GET","/api/v1/auth/session",200,{cookie});
  assert.equal(session.data.tenant_id,"auth-a");assert.equal(session.response.headers.get("cache-control"),"no-store");
  await call("POST","/api/v1/auth/logout",403,{cookie});
  await call("POST","/api/v1/auth/logout",403,{cookie,"x-csrf-token":"wrong"});
  await call("POST","/api/v1/auth/logout",403,{cookie,"x-csrf-token":csrf,origin:"https://untrusted.example"});
  await call("POST","/api/v1/auth/logout",204,{cookie,"x-csrf-token":csrf});
  await call("GET","/api/v1/dashboard",401,{cookie});
  await output(options.output||"output/backend-parity/node-auth.json",{transport:"real HTTP",passed:true,check_count:checks.length,checks});
  console.log("PASS authentication, tenant binding, session cookies, CSRF, origin checks, logout");
}finally{await server.close();}
