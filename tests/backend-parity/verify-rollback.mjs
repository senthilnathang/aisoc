import {fork} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {once} from 'node:events';
import {argumentsFor,root,client,output} from './harness.mjs';
const options=argumentsFor();
if(!options.database||!options.fixture)throw Error('Use --database and --fixture private recovery paths');
const database=resolve(options.database),fixturePath=resolve(options.fixture);
if(![database,fixturePath].every(path=>path.startsWith(resolve(root,'.run')+'/')))throw Error('Only private recovery copies are permitted');
const fixture=JSON.parse(await readFile(fixturePath,'utf8'));
const child=fork(resolve(root,'tests/backend-parity/server.mts'),[],{execArgv:['--import',resolve(root,'backend/node_modules/tsx/dist/loader.mjs')],env:{...process.env,NODE_ENV:'test',AISOC_TEST_DB:database,AISOC_TEST_AUTH:'local',AISOC_TEST_WORKER:'false',AUTH_OPERATORS_FILE:''},stdio:['ignore','ignore','inherit','ipc']});
try {
 const info=await Promise.race([once(child,'message').then(([value])=>value),once(child,'exit').then(()=>{throw Error('Rollback Node server exited')})]);
 const request=client(info.url,fixture.tenant);
 const record=await request('GET','/api/v1/investigations/'+fixture.case_id);
 if(record.id!==fixture.case_id)throw Error('Restored case unavailable to Node');
 await request('GET','/api/v1/api-sources/'+fixture.source_id);
 if(fixture.api_key) {
  const result=await request('POST','/api/v1/intake/'+fixture.source_id+'/alerts',fixture.alert,200,{authorization:'Bearer '+fixture.api_key});
  if(result.alert.id!==fixture.alert_id)throw Error('Restored source key/deduplication mismatch');
 }
 await output('output/migration/node-rollback.json',{passed:true,checks:['Node boots restored Go-era data','case and source reads',...(fixture.api_key?['Go-issued source credential accepted','duplicate alert identity preserved']:[])]});
} finally {child.kill('SIGTERM');await once(child,'exit');}
