import React, { useEffect, useRef, useState } from 'react';
import { Alert, AlertIcon, Badge, Box, Button, Checkbox, Flex, FormControl, FormLabel, Heading, Input, Select, Stack, Text, Textarea } from '@chakra-ui/react';
import { api } from './api';
import { ui } from './theme';

function ResponseCard({ item, caseId, allowed, act, busy, setView }) {
 const [comment,setComment]=useState(''),[confirmed,setConfirmed]=useState(false),[preview,setPreview]=useState(null);
 const [now,setNow]=useState(()=>Date.now());
 useEffect(()=>{const remaining=Date.parse(item.approval_expires_at)-Date.now();if(!Number.isFinite(remaining))return;const timer=setTimeout(()=>setNow(Date.now()),Math.max(0,Math.min(remaining+10,2147483647)));return()=>clearTimeout(timer);},[item.approval_expires_at]);
 const canApprove=api.can("approver")&&api.session?.operator_id!==item.requested_by;
 const canExecute=api.can("executor")&&api.session?.operator_id!==item.requested_by&&api.session?.operator_id!==item.approved_by;
 const fresh=item.approval_fresh&&Date.parse(item.approval_expires_at)>now;
 const execute=async operation=>{setPreview(null);const value=await act({operation,id:item.id,scope_id:allowed.id,comment,confirm:confirmed});setConfirmed(false);if(operation==='dry_run'&&value)setPreview(value);};
 return <Box border="1px solid" borderColor={ui.line} borderRadius="6px" p="16px" minW="0">
  <Flex gap="8px" wrap="wrap"><Badge colorScheme={item.state==='executed'?'green':'orange'}>{item.state==='approved'&&!fresh?'Approval expired':item.state}</Badge><Badge>Mock session revocation</Badge></Flex>
  <Heading size="sm" mt="12px" overflowWrap="anywhere">{item.principal_ref} · {item.session_id}</Heading>
  <Text mt="6px" fontSize="12px" overflowWrap="anywhere">Action {item.id} · Review {item.ticket}</Text><Text mt="8px" whiteSpace="pre-wrap">{item.reason}</Text>
  <Text mt="8px" fontSize="12px" color={ui.muted}>Proposed by {item.requested_by} · Scope {item.scope_id} · Session revision {item.expected_version}</Text>
  <Box as="details" mt="10px"><Box as="summary" cursor="pointer">Evidence snapshot ({item.evidence?.length||0})</Box><Stack mt="8px">{(item.evidence||[]).map(e=><Box key={e.reference} overflowWrap="anywhere"><Text fontSize="12px">{e.reference}</Text><Text fontFamily="mono" fontSize="11px" color={ui.muted}>SHA-256: {e.content_hash}</Text></Box>)}</Stack></Box>
  {item.approved_by&&<Text mt="10px" fontSize="12px">Approved by {item.approved_by} until {new Date(item.approval_expires_at).toLocaleString()}. {item.approval_comment}</Text>}
  {item.receipt&&<Box mt="12px" p="14px" bg="green.50" role="status"><Text fontWeight="600">Sandbox revocation recorded · Mock SOAR note saved</Text><Text mt="6px" fontSize="12px" overflowWrap="anywhere">Note {item.receipt.note_id} · {item.receipt.soar_connector}/{item.receipt.soar_external_id}</Text><Text mt="6px" fontSize="12px">Executed by {item.receipt.executed_by}. External calls: {item.receipt.external_calls}. {item.receipt.compensation}</Text><Text mt="6px" fontSize="12px">This action does not close the investigation or change analyst disposition.</Text></Box>}
  {!caseId?<Button mt="12px" variant="outline" onClick={()=>setView('investigationDetail',item.case_id)}>Review in investigation</Button>:item.state!=='executed'&&allowed&&<Stack spacing="10px" mt="14px">
   <Text fontSize="12px">Execution gate: {item.stopped?'Stopped by kill switch':'Enabled for this sandbox scope'}. Revocation approval is separate from mock-note approval.</Text>
   {!fresh&&<FormControl><FormLabel>Response approval comment</FormLabel><Textarea value={comment} maxLength={2000} isDisabled={busy} onChange={e=>setComment(e.target.value)} placeholder="Explain the evidence and target reviewed (at least 10 characters)"/></FormControl>}
   <Checkbox isChecked={confirmed} isDisabled={busy} onChange={e=>setConfirmed(e.target.checked)}>I reviewed this exact mock session, evidence and scope</Checkbox>
   <Flex gap="8px" wrap="wrap">
    {!fresh&&<Button isDisabled={busy||!canApprove||!confirmed||comment.trim().length<10} onClick={()=>execute('approve')}>{item.state==='approved'?'Renew sandbox approval':'Approve sandbox revocation'}</Button>}
    <Button variant="outline" isDisabled={busy||!canExecute} onClick={()=>execute('dry_run')}>Preview revocation</Button>
    <Button isDisabled={busy||!canExecute||!confirmed||!fresh||item.stopped||!preview?.would_execute} onClick={()=>execute('execute')}>Execute mock revocation</Button>
   </Flex>
   {preview&&<Alert status={preview.would_execute?'info':'warning'}><AlertIcon/>{preview.would_execute?'Preview permits mock execution. Confirm the target again before executing.':'Preview blocked. Check approval expiry and the sandbox kill switch.'}</Alert>}
  </Stack>}
  {caseId&&!allowed&&item.state!=='executed'&&<Text mt="10px" color={ui.muted}>Read-only: your operator has no grant for this response scope.</Text>}
 </Box>;
}

export default function CaseSandboxResponses({ caseId, review, setView, mode }) {
 const [data,setData]=useState(null),[error,setError]=useState(''),[revision,refresh]=useState(0),[busy,setBusy]=useState(false);
 const [draft,setDraft]=useState(()=>({id:crypto.randomUUID(),scope_id:'',session_id:'',principal_ref:'',ticket:'',reason:'',evidence_refs:[]}));
 const [policyConfirmed,setPolicyConfirmed]=useState(false);
 const active=useRef(false);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 useEffect(()=>{let current=true;setError('');api.request(caseId?`/investigations/${encodeURIComponent(caseId)}/sandbox-responses`:'/sandbox-responses').then(x=>{if(current)setData(x);}).catch(e=>{if(current)setError(e.message);});return()=>{current=false;};},[caseId,revision]);
 const scope=draft.scope_id||data?.scopes?.[0]?.id||'';
 const change=(key,value)=>setDraft(d=>({...d,[key]:value}));
 const act=async body=>{setBusy(true);setError('');try{const value=await api.request(`/investigations/${encodeURIComponent(caseId)}/sandbox-responses`,{method:'POST',body});if(active.current){refresh(x=>x+1);return value;}}catch(e){if(active.current)setError(e.message+' Refresh responses to inspect any stored result before retrying. Source revision conflicts require a new reviewed proposal.');}finally{if(active.current)setBusy(false);}return null;};
 const propose=async()=>{if(await act({...draft,scope_id:scope,operation:'propose'}))setDraft(d=>({...d,id:crypto.randomUUID(),session_id:'',reason:'',evidence_refs:[]}));};
 const ready=review?.mode==='mock-v1'&&review?.result_status==='verified'&&review?.sync_state==='synced';
 const items=(data?.items||[]).filter(x=>mode==='responseApprovals'?x.state!=='executed':mode==='responseActivity'?x.state==='executed':true);
 return <Box as="section" id="case-sandbox-responses" scrollMarginTop="110px" aria-label="Case-linked sandbox responses" bg="white" border="1px solid" borderColor={ui.line} borderRadius="6px" p={{base:'16px',md:'20px'}} my="20px">
  <Flex justify="space-between" gap="12px" wrap="wrap"><Box><Heading size="md">{caseId?'Respond to this investigation':'Investigation response handoffs'}</Heading><Text color={ui.muted} mt="6px">Local identity simulation · Different proposer, approver and executor · No live provider calls</Text></Box><Button variant="outline" isDisabled={busy} onClick={()=>refresh(x=>x+1)}>Refresh responses</Button></Flex>
  {error&&<Alert status="error" mt="12px"><AlertIcon/>{error}</Alert>}
  {!data&&!error&&<Text role="status" mt="12px">Loading sandbox responses…</Text>}
  {data&&caseId&&!data.scopes.length&&<Text mt="14px">No sandbox response grant configured for your operator. Import and mock-note approval permissions do not authorize revocation.</Text>}
  {caseId&&data?.scopes.length>0&&<Box mt="18px">
   {!ready&&<Alert status="info" mb="12px"><AlertIcon/>A verified mock L1 result and a synced mock SOAR note are required before proposing a response. Approve the note in L1 review first if required.</Alert>}
   <Box as="details"><Box as="summary" cursor="pointer" fontWeight="600">Propose a mock session revocation</Box><Stack spacing="12px" mt="14px">
    <Text fontSize="12px">This creates or inspects a local simulated session and stores an immutable evidence snapshot. It does not infer a live session from the evidence or grant execution approval.</Text>
    <FormControl><FormLabel>Sandbox response scope</FormLabel><Select value={scope} isDisabled={busy} onChange={e=>change('scope_id',e.target.value)}>{data.scopes.map(s=><option value={s.id} key={s.id}>{s.id} · {s.connector_id}</option>)}</Select></FormControl>
    <Flex gap="12px" wrap="wrap">{[['session_id','Mock session ID'],['principal_ref','Mock principal reference'],['ticket','Response review reference']].map(([key,label])=><FormControl key={key} flex="1" minW="200px"><FormLabel>{label}</FormLabel><Input value={draft[key]} maxLength={128} isDisabled={busy} onChange={e=>change(key,e.target.value)}/></FormControl>)}</Flex>
    <FormControl><FormLabel>Response rationale</FormLabel><Textarea value={draft.reason} maxLength={2000} isDisabled={busy} onChange={e=>change('reason',e.target.value)}/></FormControl>
    <Text fontWeight="600">Evidence to include</Text>{(review?.evidence||[]).map(e=><Checkbox key={e.reference} isChecked={draft.evidence_refs.includes(e.reference)} isDisabled={busy} onChange={event=>change('evidence_refs',event.target.checked?[...draft.evidence_refs,e.reference]:draft.evidence_refs.filter(r=>r!==e.reference))}><Text fontSize="12px" overflowWrap="anywhere">{e.reference}</Text></Checkbox>)}
    <Button alignSelf="start" isDisabled={busy||!api.can("proposer")||!ready||!scope||!draft.session_id||!draft.principal_ref||!draft.ticket||draft.reason.trim().length<10||!draft.evidence_refs.length||!!error} onClick={propose}>Save response proposal</Button>
   </Stack></Box>
   <Box as="details" mt="16px"><Box as="summary" cursor="pointer">Sandbox execution gate</Box><Text mt="10px" fontSize="12px">This switch affects all mock sessions in scope {scope}. It does not grant action approval. Record a response review reference in the proposal fields above.</Text><Checkbox mt="10px" isChecked={policyConfirmed} isDisabled={busy} onChange={e=>setPolicyConfirmed(e.target.checked)}>I confirm this sandbox scope policy change</Checkbox><Flex gap="8px" wrap="wrap" mt="10px">{[[false,'Enable sandbox execution'],[true,'Stop sandbox execution']].map(([stopped,label])=><Button key={label} variant="outline" isDisabled={busy||!api.can("approver")||!policyConfirmed||!draft.ticket||!scope} onClick={async()=>{await act({operation:'policy',scope_id:scope,ticket:draft.ticket,stopped,confirm:true});setPolicyConfirmed(false);}}>{label}</Button>)}</Flex></Box>
  </Box>}
  <Stack mt="18px" spacing="14px">{items.map(item=><ResponseCard key={`${item.scope_id}:${item.id}`} item={item} caseId={caseId} allowed={data.scopes.find(s=>s.connector_id===item.connector_id&&s.source===item.source)} act={act} busy={busy} setView={setView}/>)}</Stack>
  {data&&!items.length&&<Text mt="16px" color={ui.muted}>No case-linked sandbox responses in this view.</Text>}
  {!caseId&&data&&<Text mt="12px" fontSize="12px" color={ui.muted}>Latest {data.limit} case-linked proposals at most. Open an investigation to review, approve or execute; generic remediation controls cannot execute these actions.</Text>}
  {caseId&&setView&&<Button mt="14px" variant="outline" onClick={()=>setView('responseApprovals')}>View Respond approvals</Button>}
 </Box>;
}
