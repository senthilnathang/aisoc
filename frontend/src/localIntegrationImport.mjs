// File import is convenience parsing only; Go remains the authoritative validator.
export function parseIntegrationImport(text) {
 const value=JSON.parse(text);
 if(Array.isArray(value))return {events:value};
 if(!value||typeof value!=='object'||value.schema_version!=='1'||!Array.isArray(value.events)||Object.keys(value).some(k=>!['schema_version','events','context'].includes(k)))throw Error('Use an events array or a schema_version "1" bundle containing events and optional context.');
 return {events:value.events,context:value.context??null};
}
export function processingLabel(status) {
 if(status?.profile?.state==='archived')return 'Archived · retained evidence';
 if(status?.profile?.state==='draft')return 'Draft · not imported';
 const cases=status?.cases||[];
 if(cases.length&&cases.every(c=>c.state==='synced'))return 'Complete · mock write-back recorded';
 if(cases.some(c=>c.state==='awaiting_review'))return 'Analyst approval required';
 if(status?.intake?.accepted_events===0)return 'Import incomplete · retry import';
 if(status?.worker?.status==='retrying')return 'Worker retrying · refresh for progress';
 if(status?.worker?.status==='stale')return 'Worker heartbeat stale · check local services';
 if(status?.intake?.processed_events<status?.intake?.accepted_events)return 'Queued · waiting for stream processing';
 return 'Processing · awaiting investigation';
}
