import {useSyncExternalStore} from 'react';
export const caseTabs=['Summary','Report','Remediation','Artifacts','Review','Runbooks','Transcript','I/O','History','Feedback'];
export function parseCaseTab(search){const v=new URLSearchParams(search).get('tab');return caseTabs.find(t=>t.toLowerCase()===v)||'Summary';}
const subscribe=f=>{window.addEventListener('popstate',f);return()=>window.removeEventListener('popstate',f);};
export function useCaseTab(){const search=useSyncExternalStore(subscribe,()=>window.location.search,()=> '');return [parseCaseTab(search),tab=>{const p=new URLSearchParams(window.location.search);p.set('tab',tab.toLowerCase());window.history.pushState({},'',window.location.pathname+'?'+p.toString());window.dispatchEvent(new PopStateEvent('popstate'));}];}
