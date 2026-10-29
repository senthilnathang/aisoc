import {fork} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {once} from 'node:events';
import {argumentsFor,root} from './harness.mjs';
const options=argumentsFor();
if(!options.database||!options.info)throw Error('Use private --database and --info paths');
const database=resolve(options.database),info=resolve(options.info);
if(![database,info].every(path=>path.startsWith(resolve(root,'.run')+'/')))throw Error('Recovery paths must be private copies');
const child=fork(resolve(root,'tests/backend-parity/server.mts'),[],{execArgv:['--import',resolve(root,'backend/node_modules/tsx/dist/loader.mjs')],env:{...process.env,NODE_ENV:'test',AISOC_TEST_DB:database,AISOC_TEST_AUTH:'local',AISOC_TEST_WORKER:'false',AUTH_OPERATORS_FILE:''},stdio:['ignore','ignore','inherit','ipc']});
const [message]=await once(child,'message');await writeFile(info,JSON.stringify(message),{mode:0o600,flag:'wx'});
let closing=false;
async function stop(){if(closing)return;closing=true;child.kill('SIGTERM');await once(child,'exit');process.exit(0);}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
child.on('exit',code=>{if(!closing)process.exit(code||1);});
