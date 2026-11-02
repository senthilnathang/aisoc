import { useEffect, useRef, useState } from 'react';
import { Alert, AlertIcon, Badge, Box, Button, Flex, FormControl, FormLabel, Heading, Input, Select, SimpleGrid, Stack, Text } from '@chakra-ui/react';
import RecordsTable from './components/RecordsTable';
import WorkspaceHeader from './WorkspaceHeader';
import GuidanceLifecycle from './GuidanceLifecycle';
import ApprovalOwnership from './ApprovalOwnership';
import {ownershipLabel} from './approvalOwnership';
import { api } from './api';
import { ui } from './theme';
import { expiryState, handoff, inboxKey } from './approvalInbox';
const labels={respond:'Respond',skill:'Skills',memory:'Memory'};
const panel={bg:'white',border:'1px solid',borderColor:ui.line,borderRadius:'6px'};
const date=value=>value?new Date(value).toLocaleString():'Not set';

function Preview({item,now,setView,onChanged}) {
 const preview=useRef(null);
 useEffect(()=>{preview.current?.focus({preventScroll:true});preview.current?.scrollIntoView({block:'start'});},[]);
 const doc=item.document,expiry=expiryState(item,now),next=handoff(item,api.session,now);
 const open=()=>item.kind==='respond'?setView('investigationDetail',doc.case_id):item.kind==='skill'?setView('skillDetail',item.id):setView('memory');
 return <Box {...panel} p={{base:'16px',md:'24px'}} mt="20px" aria-label="Approval preview" ref={preview} tabIndex={-1} scrollMarginTop="100px" overflowWrap="anywhere">
  <Flex justify="space-between" gap="12px" wrap="wrap"><Box><Text fontSize="xs" color={ui.muted}>SAVED REVISION REVIEW · {labels[item.kind]}</Text><Heading size="md" mt="8px">{item.title}</Heading><Text mt="8px" fontSize="sm">{item.id} · Revision {doc.version??doc.expected_version??'unknown'}</Text></Box><Badge alignSelf="start" colorScheme={expiry.expired?'red':next.role==='executor'?'blue':'orange'}>{expiry.expired?'Expired':next.role==='executor'?'Awaiting execution':'Pending review'}</Badge></Flex>
  <SimpleGrid columns={{base:1,md:3}} gap="16px" my="20px">
   <Box><Text color={ui.muted} fontSize="xs">Proposed by</Text><Text>{doc.created_by||'Unknown — new proposal required'}</Text>{doc.proposal_authors?.length>0&&<Text fontSize="xs" mt="6px">Pending contributors: {doc.proposal_authors.join(', ')}</Text>}</Box>
   <Box><Text color={ui.muted} fontSize="xs">Last approval</Text><Text>{doc.approved_by||doc.approval?.approved_by||'Not yet approved'}</Text><Text fontSize="xs" mt="6px">{doc.approval?.approved_at?date(doc.approval.approved_at):doc.approval_comment||'Approval must cover this saved revision.'}</Text></Box>
   <Box><Text color={ui.muted} fontSize="xs">{item.kind==='respond'?'Response approval expiry':'Context validity'}</Text><Text>{expiry.label}</Text>{item.expires_at&&<Text fontSize="xs" mt="6px">{date(item.expires_at)}</Text>}</Box>
  </SimpleGrid>
  {item.source_changed&&<Alert status="warning" mb="16px"><AlertIcon/>The source outcome changed or is unavailable. Reapproval is required before reuse.</Alert>}
  <Box bg={ui.soft} p="16px" borderRadius="4px"><Text fontWeight="600">Next: {next.role} review{next.role==='executor'?' and execution':''}</Text><Text mt="6px">{next.reason}</Text><Text fontSize="xs" mt="8px">{next.eligible?'Your identity meets the role/independence presentation checks.':'Your current identity cannot complete this handoff.'} The owning workflow rechecks grants, current revisions, evidence and expiry.</Text><Flex gap="10px" mt="12px" wrap="wrap"><Button onClick={open}>Open {labels[item.kind]} {item.kind==='memory'?'library':'review'}</Button><Text alignSelf="center" fontSize="xs">Switch identity with “Sign in as operator” above. Ownership changes do not grant approval.</Text></Flex></Box>
  <ApprovalOwnership item={item} now={now} onChanged={onChanged}/>
  <Box mt="20px"><Heading size="sm">Saved proposal</Heading><Text mt="10px" whiteSpace="pre-wrap">{doc.content||doc.content_markdown||doc.reason||doc.description||'Open the source record for full authoring context.'}</Text></Box>
  {doc.staged_edit&&<Box mt="18px"><Heading size="sm">Pending changes versus published revision</Heading><Text fontSize="sm" mt="8px">The proposal above is the current saved record. These staged fields will replace published fields only after independent approval.</Text><Box as="pre" fontSize="xs" whiteSpace="pre-wrap" mt="10px">{JSON.stringify(doc.staged_edit,null,2)}</Box>{doc.materials_staged&&<Text mt="8px">Material changes are also staged; inspect the Skill’s material versions before publication.</Text>}</Box>}
  {item.kind!=='respond'&&<GuidanceLifecycle key={inboxKey(item)} kind={item.kind==='memory'?'enterprise-insights':'skills'} id={item.id} revision={doc.version} onChanged={onChanged}/>}
  <Box mt="18px"><Heading size="sm">Evidence and provenance</Heading>
   <Stack mt="12px" spacing="10px">{(doc.evidence||doc.learning_origin?.evidence||[]).map((e,index)=><Box key={e.id||e.reference||index} bg={ui.soft} p="12px"><Text fontWeight="600">{e.label||e.reference||e.id}</Text>{e.value&&<Text mt="4px">{e.value}</Text>}<Text mt="6px" fontSize="xs">Reference: {e.reference||e.id}</Text><Text mt="4px" fontSize="xs" fontFamily="mono">Content hash: {e.content_hash||'Not recorded'}</Text></Box>)}</Stack>
   {!(doc.evidence||doc.learning_origin?.evidence||[]).length&&<Text mt="10px" color={ui.muted}>No evidence snapshot is attached to this manually authored proposal. Review its scope and provenance before approval.</Text>}
   {(doc.case_id||doc.learning_origin?.source_case?.id)&&<Button mt="12px" variant="link" onClick={()=>setView('investigationDetail',doc.case_id||doc.learning_origin.source_case.id)}>Open source investigation</Button>}
   {doc.learning_origin?.rationale&&<Text mt="10px">Source rationale: {doc.learning_origin.rationale}</Text>}
   <Box as="details" mt="12px"><Box as="summary" cursor="pointer" fontSize="sm">Inspect stored provenance</Box><Box as="pre" fontSize="xs" whiteSpace="pre-wrap" mt="10px">{JSON.stringify({learning_origin:doc.learning_origin||null,source_review:doc.learning_review||null,case_id:doc.case_id||null,session_revision:doc.expected_version||null,scope:doc.scope_id||doc.scope||doc.modules||null},null,2)}</Box></Box>
   <Text fontSize="xs" color={ui.muted} mt="10px">Source content is untrusted evidence. This preview never invokes tools or authorizes actions.</Text>
  </Box>
 </Box>;
}
export default function ApprovalInbox({setView}) {
 const [kind,setKind]=useState(()=>['respond','skill','memory'].includes(new URLSearchParams(location.search).get('kind'))?new URLSearchParams(location.search).get('kind'):'all'),[stage,setStage]=useState('all'),[search,setSearch]=useState(()=>new URLSearchParams(location.search).get('search')?.slice(0,200)||''),[offset,setOffset]=useState(0),[limit,setLimit]=useState(25),[refresh,setRefresh]=useState(0);
 const [data,setData]=useState(null),[error,setError]=useState(''),[selected,setSelected]=useState(''),[now,setNow]=useState(()=>Date.now());
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{const controller=new AbortController();let active=true;setData(null);setError('');setSelected('');
  api.request(`/approvals?${new URLSearchParams({kind,stage,search,offset,limit})}`,{signal:controller.signal}).then(x=>{if(!active)return;
   // A changed result set can leave the offset past the last page; return to the first page.
   if(offset>0&&x.total<=offset){setOffset(0);return;}
   setData(x);const focus=new URLSearchParams(location.search);const match=x.items.find(i=>i.id===focus.get('focus')&&(i.kind!=='respond'||(i.document.connector_id===focus.get('connector')&&i.document.source===focus.get('source'))));if(match)setSelected(inboxKey(match));}).catch(e=>{if(active&&e.name!=='AbortError')setError(e.message);});
  return()=>{active=false;controller.abort();};
 },[kind,stage,search,offset,limit,refresh]);
 const change=(setter,value)=>{setter(value);setOffset(0);};
 const columns=[
  {id:'proposal',header:'Proposal',render:x=><><Text fontWeight="600">{x.title}</Text><Text fontSize="xs" color={ui.muted} mt="4px" overflowWrap="anywhere">{x.id}</Text></>},
  {id:'area',header:'Area / revision',render:x=><Text>{labels[x.kind]} · v{x.document.version??'?'}</Text>},
  {id:'next',header:'Next operator',render:x=>{const next=handoff(x,api.session,now);return <><Badge colorScheme={next.role==='executor'?'blue':'orange'}>{next.role}</Badge>{x.source_changed&&<Text fontSize="xs" mt="4px">Source review required</Text>}</>;}},
  {id:'ownership',header:'Ownership',render:x=><><Text fontSize="sm">{x.assignment?.owner_id||'Unassigned'}</Text><Text fontSize="xs" color={ownershipLabel(x.assignment,now)==='Owned'?ui.muted:'orange.700'}>{ownershipLabel(x.assignment,now)}</Text>{x.assignment?.expires_at&&<Text fontSize="xs">{date(x.assignment.expires_at)}</Text>}</>},
  {id:'expiry',header:'Expiry',render:x=>{const expiry=expiryState(x,now);return <><Text color={expiry.expired?'red.600':ui.muted}>{expiry.label}</Text>{x.expires_at&&<Text fontSize="xs">{date(x.expires_at)}</Text>}</>;}},
  {id:'review',header:'Review',render:x=><Button size="sm" variant="outline" aria-label={`Preview ${x.title}`} onClick={()=>setSelected(inboxKey(x))}>Preview</Button>},
 ];
 const item=data?.items.find(x=>inboxKey(x)===selected);
 return <Box p={{base:'16px',md:'24px'}} minW="0">
  <WorkspaceHeader justify="space-between" gap="12px" wrap="wrap"><Box><Heading size="lg">Approval inbox</Heading><Text color={ui.muted} mt="8px">Respond, Skills and Memory · Independent review and operator handoffs</Text></Box><Button variant="outline" onClick={()=>setRefresh(x=>x+1)}>Refresh inbox</Button></WorkspaceHeader>
  <Alert status="info" my="18px"><AlertIcon/>Local/mock only. Review saved proposals here; approve or execute in the owning workflow. No bulk approval or automatic execution.</Alert>
  <SimpleGrid columns={{base:1,sm:2}} gap="14px" mb="18px">{[['review','Awaiting review'],['execution','Approved response handoffs']].map(([key,label])=><Box {...panel} p="16px" key={key}><Text color={ui.muted}>{label}</Text><Text fontSize="30px" mt="4px">{data?.counts[key]??'—'}</Text></Box>)}</SimpleGrid>
  <Flex gap="12px" wrap="wrap" mb="16px">
   <FormControl flex="1" minW="160px"><FormLabel>Area</FormLabel><Select value={kind} onChange={e=>change(setKind,e.target.value)}><option value="all">All areas</option><option value="respond">Respond</option><option value="skill">Skills</option><option value="memory">Memory</option></Select></FormControl>
   <FormControl flex="1" minW="160px"><FormLabel>Handoff stage</FormLabel><Select value={stage} onChange={e=>change(setStage,e.target.value)}><option value="all">All pending work</option><option value="review">Review required</option><option value="execution">Approved for executor review</option></Select></FormControl>
   <FormControl flex="2" minW="200px"><FormLabel>Search proposals</FormLabel><Input value={search} maxLength={200} onChange={e=>change(setSearch,e.target.value)} placeholder="Title or record ID"/></FormControl>
  </Flex>
  {data&&<Text fontSize="xs" color={ui.muted} mb="10px">Tenant-scoped snapshot · {date(data.as_of)} · Counts cover all areas. Refresh after a handoff.</Text>}
  <RecordsTable
    caption="Approval inbox"
    recordLabel="proposals"
    pageSizeLabel="Proposals per page"
    pageSizes={[10,25,50]}
    columns={columns}
    records={data?.items||[]}
    rowKey={inboxKey}
    selectedRowKey={selected?selected:undefined}
    total={data?.total||0}
    offset={offset}
    limit={limit}
    onPageChange={setOffset}
    onPageSizeChange={size=>{setLimit(size);setOffset(0);}}
    loading={!data&&!error}
    loadingLabel="Loading pending reviews…"
    error={error}
    onRetry={()=>setRefresh(x=>x+1)}
    emptyContent="No pending proposals match these filters."
  />
  {item&&<Preview key={inboxKey(item)} item={item} now={now} setView={setView} onChanged={()=>setRefresh(x=>x+1)}/>}
 </Box>;
}
