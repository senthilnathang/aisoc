import { fork } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { once } from "node:events";

export const root = resolve(import.meta.dirname,"../..");
export function argumentsFor(argv=process.argv.slice(2)) {
  const options={};
  for(let i=0;i<argv.length;i++) {
    if(!argv[i].startsWith("--")) throw Error("Expected named option: "+argv[i]);
    const key=argv[i].slice(2);
    options[key]=argv[i+1] && !argv[i+1].startsWith("--") ? argv[++i] : true;
  }
  return options;
}
export async function target(options={}) {
  if(options.url) {
    const url=new URL(options.url);
    if(!["127.0.0.1","localhost","[::1]"].includes(url.hostname) || ["3002","8080"].includes(url.port) || !["http:","https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname!=="/")
      throw Error("Use an isolated loopback backend origin; the active API and frontend ports 3002/8080 are forbidden.");
    if(options["allow-fixture-writes"]!==true) throw Error("External targets require --allow-fixture-writes and a disposable database.");
    return {url:url.origin,pid:options.pid?Number(options.pid):null,close:async()=>{},owned:false};
  }
  const directory=await mkdtemp(join(tmpdir(),"aisoc-parity-"));
  const child=fork(join(root,"tests/backend-parity/server.mts"),[],{
    execArgv:["--import",join(root,"backend/node_modules/tsx/dist/loader.mjs")],
    env:{...process.env,NODE_ENV:"test",AISOC_TEST_DB:join(directory,"test.sqlite"),AISOC_TEST_AUTH:options.auth||"local",AUTH_OPERATORS_FILE:""},
    stdio:["ignore","ignore","inherit","ipc"],
  });
  let exited=false;
  const exitPromise=once(child,"exit").then(()=>{exited=true;});
  const close=async()=>{
    if(!exited) {
      child.kill("SIGTERM");
      let timer;
      await Promise.race([exitPromise,new Promise(resolve=>{timer=setTimeout(resolve,5000);})]);
      clearTimeout(timer);
      if(!exited) {child.kill("SIGKILL");await exitPromise;}
    }
    await rm(directory,{recursive:true,force:true});
  };
  try {
    const info=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error("Isolated backend startup timed out")),20000);
      child.once("message",message=>{clearTimeout(timer);resolve(message);});
      child.once("error",error=>{clearTimeout(timer);reject(error);});
      child.once("exit",code=>{clearTimeout(timer);reject(Error("Backend exited during startup: "+code));});
    });
    return {...info,close,owned:true};
  } catch(error) {await close();throw error;}
}
export function client(url,tenant,events=[]) {
  return async(method,path,body,expected=200,headers={})=>{
    const response=await fetch(url+path,{
      method,headers:{"x-tenant-id":tenant,...(body===undefined?{}:{"content-type":"application/json"}),...headers},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000),
    });
    const raw=await response.text();
    let data; try {data=raw?JSON.parse(raw):null;} catch {throw Error(method+" "+path+" returned non-JSON");}
    events.push({method,path:path.split("?")[0],status:response.status});
    if(response.status!==expected) throw Error(method+" "+path+": expected "+expected+", got "+response.status+" "+JSON.stringify(data));
    return data;
  };
}
export async function output(path,value) {
  const full=resolve(root,path);
  await mkdir(resolve(full,".."),{recursive:true});
  await writeFile(full,JSON.stringify(value,null,2)+"\n");
  console.log("Report: "+full);
}
