import {useEffect,useRef,useState} from 'react';
import {Alert,AlertIcon,Badge,Box,Button,Flex,FormControl,FormLabel,Select,Text,Textarea} from '@chakra-ui/react';
import {api} from './api';
import {ui} from './theme';
import {ownershipLabel} from './approvalOwnership';
export default function ApprovalOwnership({item,now,onChanged}) {
 const [data,setData]=useState(null),[error,setError]=useState(''),[reason,setReason]=useState(''),[owner,setOwner]=useState(''),[minutes,setMinutes]=useState(60),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0);
 const request=useRef(crypto.randomUUID()),active=useRef(false);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 const key={kind:item.kind,id:item.id,connector_id:item.kind==='respond'?item.document.connector_id:'',source:item.kind==='respond'?item.document.source:''};
 const query=new URLSearchParams(key).toString();
 useEffect(()=>{let alive=true;setData(null);setError('');api.request('/approvals/assignment?'+query).then(x=>{if(alive){setData(x);setOwner(x.eligible_operators[0]?.id||'');request.current=crypto.randomUUID();}}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[query,item.work_token,refresh]);
 const change=(setter,value)=>{setter(value);request.current=crypto.randomUUID();};
 const stale=Boolean(data&&data.work_token!==item.work_token);
 const submit=async operation=>{setBusy(true);setError('');try{await api.request('/approvals/assignment',{method:'POST',body:{...key,operation,owner_id:operation==='reassign'?owner:'',work_token:data.work_token,expected_version:data.assignment.version,request_id:request.current,reason,minutes}});if(active.current){setReason('');window.dispatchEvent(new Event('aisoc:notifications-changed'));onChanged();}}catch(e){if(active.current)setError(e.message);}finally{if(active.current)setBusy(false);}};
 const a=data?.assignment;
 return <Box border="1px solid" borderColor={ui.line} borderRadius="6px" p="16px" mt="18px" aria-label="Approval ownership">
 <Flex justify="space-between" gap="12px" wrap="wrap"><Text fontWeight="600">Review ownership</Text><Button size="xs" variant="outline" isDisabled={busy} onClick={()=>setRefresh(x=>x+1)}>Refresh ownership</Button></Flex>
 {error&&<Alert status="error" mt="10px"><AlertIcon/>{error}</Alert>}
 {!data&&!error&&<Text mt="10px">Loading ownership…</Text>}
 {data&&<><Badge mt="10px" colorScheme={ownershipLabel(a,now)==='Owned'?'blue':'orange'}>{ownershipLabel(a,now)}</Badge><Text mt="8px">Owner: {a.owner_id||'Unassigned'} · Ownership version {a.version}</Text>{a.expires_at&&<Text mt="6px" fontSize="xs">Ownership expires {new Date(a.expires_at).toLocaleString()}</Text>}{a.reason&&<Text mt="6px" fontSize="sm">Last handoff: {a.assigned_by} · {a.reason}</Text>}
 <Text fontSize="xs" color={ui.muted} mt="10px">Ownership coordinates work; it never grants approval or execution permission. Eligible independent operators can still complete the underlying workflow. Assignment changes notify the affected operators in this app only.</Text>
 {stale&&<Alert status="warning" mt="10px"><AlertIcon/>The proposal changed. Refresh the inbox before assigning this revision.</Alert>}
 {!data.can_manage&&<Text mt="10px" fontSize="sm">Only an eligible reviewer/executor or the proposing operator can coordinate this handoff.</Text>}
 {data.can_manage&&!stale&&<>
 <FormControl mt="12px"><FormLabel>Ownership reason</FormLabel><Textarea value={reason} maxLength={1000} isDisabled={busy} onChange={e=>change(setReason,e.target.value)} placeholder="Explain the review or handoff (at least 10 characters)"/></FormControl>
 <Flex gap="12px" wrap="wrap" mt="12px"><FormControl flex="1" minW="180px"><FormLabel>Eligible next operator</FormLabel><Select value={owner} isDisabled={busy} onChange={e=>change(setOwner,e.target.value)}>{!data.eligible_operators.length&&<option value="">No eligible operator configured</option>}{data.eligible_operators.map(x=><option key={x.id} value={x.id}>{x.id} · {x.role}</option>)}</Select></FormControl><FormControl flex="1" minW="160px"><FormLabel>Ownership period</FormLabel><Select value={minutes} isDisabled={busy} onChange={e=>change(setMinutes,Number(e.target.value))}><option value={15}>15 minutes</option><option value={60}>1 hour</option><option value={240}>4 hours</option></Select></FormControl></Flex>
 <Flex mt="14px" gap="8px" wrap="wrap"><Button isDisabled={busy||reason.trim().length<10||!data.can_claim} onClick={()=>submit('claim')}>Claim for me</Button><Button variant="outline" isDisabled={busy||reason.trim().length<10||!owner} onClick={()=>submit('reassign')}>{a.owner_id?'Reassign review':'Assign review'}</Button><Button variant="outline" isDisabled={busy||reason.trim().length<10||!a.owner_id} onClick={()=>submit('release')}>Release ownership</Button></Flex>
 {!data.can_claim&&<Text mt="8px" fontSize="xs">You cannot claim this work: an independent eligible operator is required, or another active owner holds it.</Text>}
 </>}
 </>}
 </Box>;
}
