export const BULK_MAX_BYTES=512*1024;
export function parseBulkImport(text) {
 if(new TextEncoder().encode(text).length>BULK_MAX_BYTES)throw Error('Batch JSON exceeds 512 KiB.');
 let value;try{value=JSON.parse(text);}catch{throw Error('Batch file must contain valid JSON.');}
 if(!value||Array.isArray(value)||value.schema_version!=='1'||!Array.isArray(value.cases)||(value.name!==undefined&&(typeof value.name!=='string'||value.name.length>120))||value.cases.length<1||value.cases.length>10||Object.keys(value).some(k=>!['schema_version','name','cases'].includes(k)))throw Error('Use schema_version 1 with 1–10 cases and an optional name.');
 const keys=new Set();
 for(const item of value.cases){if(!item||typeof item!=='object'||!Object.hasOwn(item,'document')||typeof item.name!=='string'||typeof item.key!=='string'||!/^[-a-zA-Z0-9._]{1,64}$/.test(item.key)||! /^[a-zA-Z0-9]/.test(item.key)||keys.has(item.key)||Object.keys(item).some(k=>!['key','name','document'].includes(k)))throw Error('Each case needs a unique key, name and document.');keys.add(item.key);}
 return value;
}
export function batchProgress(counts={}) {
 return `${counts.accepted||0} / ${counts.total||0} cases accepted · ${counts.synced||0} mock notes synced · ${(counts.invalid||0)+(counts.failed||0)} need attention`;
}
