import React, { useEffect, useState } from 'react';
import { Box, Breadcrumb, BreadcrumbItem, BreadcrumbLink, Text } from '@chakra-ui/react';
import { api } from './api';
import { breadcrumbModel } from './breadcrumbs';
import { pathForView } from './navigation';
import { ui } from './theme';

export default function Breadcrumbs({ view, ids, setView }) {
 const model=breadcrumbModel(view,ids);
 const resource=model.lookup?.resource, id=model.lookup?.id;
 const key=resource&&id?`${resource}:${id}`:'';
 const [result,setResult]=useState(null);
 const [revision,setRevision]=useState(0);
 useEffect(()=>{
  const updated=event=>{if(event.detail?.resource===resource&&event.detail?.id===id)setRevision(value=>value+1);};
  window.addEventListener('aisoc:resource-updated',updated);
  return ()=>window.removeEventListener('aisoc:resource-updated',updated);
 },[resource,id]);
 useEffect(()=>{
  if(!key)return;
  const controller=new AbortController();let active=true;
  api.request(`/navigation/breadcrumb?${new URLSearchParams({resource,id})}`,{signal:controller.signal})
   .then(value=>{if(active)setResult({key,revision,label:value.label});})
   .catch(error=>{if(active&&error.name!=='AbortError')setResult({key,revision,error:true});});
  return ()=>{active=false;controller.abort();};
 },[key,resource,id,revision]);
 const current=result?.key===key&&result.revision===revision?result:null;
 return <Box px={{base:'16px',md:'24px'}} py="14px" minW="0">
  <Breadcrumb aria-label="Breadcrumb" separator={<Text color={ui.quiet} aria-hidden="true">›</Text>} fontSize="12px" sx={{'ol':{flexWrap:'wrap',rowGap:'6px'},'li':{minWidth:0,maxWidth:'100%'}}}>
   {model.items.map((item,index)=>{
    const last=index===model.items.length-1;
    const label=last&&key?(current?.label||item.label):item.label;
    return <BreadcrumbItem key={`${index}:${item.view||'resource'}`} isCurrentPage={last}>
     {!last&&item.view!==view?<BreadcrumbLink href={pathForView[item.view]} color={ui.muted} onClick={event=>{
      if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
      event.preventDefault();setView(item.view);
     }}>{label}</BreadcrumbLink>:<Text as="span" aria-current={last?'page':undefined} color={last?ui.ink:ui.muted} fontWeight={last?'600':'400'} maxW={{base:'270px',md:'600px'}} isTruncated title={label}>{label}</Text>}
    </BreadcrumbItem>;
   })}
  </Breadcrumb>
  {key&&current?.error&&<Text fontSize="10px" color={ui.muted} mt="4px">Resource name unavailable</Text>}
 </Box>;
}
