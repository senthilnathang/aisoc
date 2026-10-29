import { fork, spawn } from 'node:child_process';
import { mkdir, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { once } from 'node:events';
import { argumentsFor, root } from './harness.mjs';

const options=argumentsFor();
if(!options.database)throw Error('Use --database with a new private SQLite fixture path');
const database=resolve(options.database);
if(!database.startsWith(resolve(root,'.run')+'/'))throw Error('Use a private .run path');
try {await access(database);throw Error('Refusing to overwrite an existing fixture');}catch(error){if(error.code!=='ENOENT')throw error;}
process.umask(0o077);await mkdir(dirname(database),{recursive:true});
const child=fork(resolve(root,'tests/backend-parity/server.mts'),[],{execArgv:['--import',resolve(root,'backend/node_modules/tsx/dist/loader.mjs')],env:{...process.env,NODE_ENV:'test',AISOC_TEST_DB:database,AISOC_TEST_AUTH:'local',AUTH_OPERATORS_FILE:''},stdio:['ignore','ignore','inherit','ipc']});
try {
 const info=await Promise.race([once(child,'message').then(([info])=>info),once(child,'exit').then(()=>{throw Error('Fixture server exited')})]);
 const runner=spawn(process.execPath,[resolve(root,'tests/backend-parity/run.mjs'),'--url',info.url,'--allow-fixture-writes','--label','migration-fixture','--output','output/migration/fixture-scenarios.json'],{cwd:root,stdio:'inherit'});
 const [code]=await once(runner,'exit');if(code!==0)throw Error('Fixture scenarios failed');
} finally {child.kill('SIGTERM');await once(child,'exit');}
console.log('Populated fixture retained in private .run storage');
