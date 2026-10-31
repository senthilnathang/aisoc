import { useSyncExternalStore } from 'react';
const subscribe = listener => { window.addEventListener('popstate', listener); return () => window.removeEventListener('popstate', listener); };
const snapshot = () => window.location.search;
export function parseRuleLocation(search) {
 const p=new URLSearchParams(search), text=(key)=>p.get(key)||'';
 const choice=(key,values,fallback)=>values.includes(text(key))?text(key):fallback;
 const bounded=(key,min,max,fallback)=>{const n=Number(text(key));return text(key)&&Number.isInteger(n)&&n>=min&&n<=max?n:fallback;};
 return {selected:text('rule').slice(0,256)||null, tab:choice('tab',['details','recommendations','history','versions'],'details'), catalog:text('catalog')==='true', filters:{
 search:text('search').slice(0,200),severity:choice('severity',['low','medium','high','critical'],''),enabled:choice('enabled',['true','false'],''),source:text('source').slice(0,200),sort:choice('sort',['name','updated_at','severity','detections'],'updated_at'),direction:choice('direction',['asc','desc'],'desc'),limit:bounded('limit',1,100,25),offset:bounded('offset',0,1000000000,0),days:Number(choice('days',['7','30','90'],'30'))
 }};
}
export function ruleLocation(search,changes) {
 const p=new URLSearchParams(search);
 for(const [key,value] of Object.entries(changes)) {if(value===null||value===undefined||value==='')p.delete(key);else p.set(key,String(value));}
 return p.toString();
}
export function useRuleNavigation() {
 const search=useSyncExternalStore(subscribe,snapshot,()=> '');
 const navigate=(changes,replace=false)=>{
  const query=ruleLocation(window.location.search,changes);
  const next=window.location.pathname+(query?'?'+query:'');
  if(next===window.location.pathname+window.location.search)return;
  window.history[replace?'replaceState':'pushState']({},'',next);
  window.dispatchEvent(new PopStateEvent('popstate'));
 };
 return {...parseRuleLocation(search),navigate};
}
