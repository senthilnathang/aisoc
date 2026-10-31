import React, { useEffect, useState } from 'react';
import { Alert, AlertIcon, Badge, Button, Flex, Text } from '@chakra-ui/react';
import { api } from './api';
export default function RuleCatalog({ search, onUse }) {
 const [data,setData]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();setData(null);setError('');
  const timer=setTimeout(()=>api.request('/detection-catalog?'+new URLSearchParams({search}),{signal:controller.signal}).then(result=>{if(!controller.signal.aborted)setData(result);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}),200);
  return()=>{clearTimeout(timer);controller.abort();};
 },[search,retry]);
 if(error)return <Alert status="error"><AlertIcon/>{error}<Button onClick={()=>setRetry(n=>n+1)}>Retry catalog</Button></Alert>;
 if(!data)return <Text p="24px" role="status">Loading catalog…</Text>;
 return <div className="rules-catalog"><Text fontSize="11px" color="gray.500" mb="16px">Local starter catalog v{data.version} · metadata only. Add and validate query logic before enabling a rule.</Text>{data.items.map(item=><article key={item.id}><Flex justify="space-between" align="start" gap="12px"><div><h3>{item.name}</h3><p>{item.description}</p><Flex gap="6px" wrap="wrap" mt="10px"><Badge>{item.severity}</Badge>{item.techniques.map(t=><Badge key={t}>{t}</Badge>)}</Flex></div><Button size="sm" variant="outline" onClick={()=>onUse(item)}>Use template</Button></Flex></article>)}{!data.items.length&&<Text>No matching catalog templates.</Text>}</div>;
}
