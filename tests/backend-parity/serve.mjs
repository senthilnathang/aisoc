import { argumentsFor,target } from "./harness.mjs";
const options=argumentsFor();
if(options.url)throw Error("serve starts its own disposable Node backend; --url is not supported.");
const server=await target(options);
console.log(JSON.stringify({url:server.url,pid:server.pid,auth:options.auth||"local",worker_interval_ms:server.worker_interval_ms,note:"Disposable comparison backend. The active application is unchanged. Ctrl-C stops this server and deletes its database."},null,2));
let closing=false;
async function close(){if(closing)return;closing=true;await server.close();process.exit(0);}
process.on("SIGINT",close);process.on("SIGTERM",close);
await new Promise(()=>{});
