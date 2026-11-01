import { useEffect, useRef, useState } from "react";
import { Alert, AlertIcon, Badge, Box, Button, Checkbox, Flex, FormControl, FormLabel, Text, Textarea } from "@chakra-ui/react";
import { api } from "./api";
import { ui } from "./theme";
const labels={approve:"Approve Memory proposal",reapprove:"Reapprove guidance",archive:"Archive guidance","publish-staged":"Publish saved staged edits","discard-staged":"Discard staged edits"};
export default function GuidanceLifecycle({kind,id,revision,onChanged}) {
 const [data,setData]=useState(null),[error,setError]=useState(""),[operation,setOperation]=useState(""),[rationale,setRationale]=useState(""),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0);
 const active=useRef(false);useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 useEffect(()=>{let current=true;setData(null);setConfirm(false);api.request(`/${kind}/${encodeURIComponent(id)}/lifecycle`).then(x=>{if(current)setData(x);}).catch(e=>{if(current)setError(e.message);});return()=>{current=false;};},[kind,id,revision,refresh]);
 const submit=async()=>{setBusy(true);setError("");try{const item=await api.request(`/${kind}/${encodeURIComponent(id)}/lifecycle`,{method:"POST",body:{operation,expected_version:data.version,expected_source_version:data.source?.updated_at||"",confirm,rationale}});if(active.current){setOperation("");setConfirm(false);setRationale("");setRefresh(x=>x+1);onChanged?.(item);}}catch(e){if(active.current)setError(e.message);}finally{if(active.current)setBusy(false);}};
 const stale=Boolean(data&&revision!=null&&Number(revision)!==Number(data.version));
 const mayApprove=!stale&&api.can("approver")&&api.independent(data);
 const choose=op=>{setOperation(op);setConfirm(false);setRationale("");setError("");};
 return <Box border="1px solid" borderColor={ui.line} rounded="6px" p="14px" my="14px" overflowWrap="anywhere">
 <Flex gap="10px" justify="space-between" wrap="wrap"><Text fontWeight="600">Guidance lifecycle</Text><Button size="xs" variant="outline" isDisabled={busy} onClick={()=>setRefresh(x=>x+1)}>Refresh lifecycle</Button></Flex>
 {error&&<Alert status="error" mt="10px"><AlertIcon/>{error}</Alert>}
 {!data?<Text mt="8px">Loading lifecycle…</Text>:<>
 {stale&&<Alert status="warning" mt="10px"><AlertIcon/>The saved revision changed after this preview loaded. Refresh the owning page or inbox before reviewing.</Alert>}
 <Badge mt="10px" colorScheme={data.archived?"gray":data.current?"green":"orange"}>{data.archived?"Archived":data.approval_state==="pending"?"Pending approval":data.current?"Source current":"Source review required"}</Badge>
 {data.approval_state==="pending"&&<Text mt="8px">Pending independent approval. This context is excluded from matching and new hunt snapshots.</Text>}
 {!data.current&&data.approval_state!=="pending"&&!data.archived&&<Text mt="8px">Future matching is blocked until the changed source is reviewed and reapproved. Existing investigation snapshots are preserved.</Text>}
 <Text fontSize="xs" mt="8px">Original proposer: {data.created_by||"Unknown — save a new proposal"}{data.proposal_authors?.length ? ` · Pending contributors: ${data.proposal_authors.join(", ")}` : ""}</Text>
 {data.approval&&<Text fontSize="xs" mt="6px">Approved by {data.approval.approved_by} · revision {data.approval.version} · {data.approval.approved_at}</Text>}
 {data.approved_source&&<Box fontSize="sm" mt="10px"><Text>Originally approved: {data.approved_source.status} · {data.approved_source.determination}</Text><Text>Current source: {data.source?`${data.source.status} · ${data.source.determination} · ${data.source.updated_at}`:"Unavailable or deleted"}</Text>{data.review&&<Text mt="6px">Last reapproval: {data.review.actor} · {data.review.rationale}</Text>}</Box>}
 {!mayApprove&&<Text fontSize="xs" mt="8px">Approval requires an approver who did not author this guidance or its pending edits.</Text>}
 {data.staged_edit&&<Box as="details" mt="12px"><Box as="summary" cursor="pointer">Saved staged changes</Box>{data.materials_staged&&<Text mt="8px">Material changes are staged too. Publish releases the saved material versions; discard restores the published materials.</Text>}<Text fontSize="xs" mt="8px" whiteSpace="pre-wrap">{JSON.stringify(data.staged_edit,null,2)}</Text><Text fontSize="xs">Publication uses these saved changes only. Unsaved editor text is not included.</Text></Box>}
 {!data.archived&&!stale&&<Flex gap="8px" wrap="wrap" mt="12px">
 {kind==="enterprise-insights"&&data.approval_state==="pending"&&<Button size="sm" isDisabled={busy||!mayApprove} onClick={()=>choose("approve")}>Approve Memory proposal</Button>}
 {data.approved_source&&<Button size="sm" variant="outline" isDisabled={busy||!data.source_eligible||!mayApprove} onClick={()=>choose("reapprove")}>Reapprove guidance</Button>}
 {data.staged_edit&&<><Button size="sm" isDisabled={busy||!data.current||!mayApprove} onClick={()=>choose("publish-staged")}>Publish saved staged edits</Button><Button size="sm" variant="outline" isDisabled={busy} onClick={()=>choose("discard-staged")}>Discard staged edits</Button></>}
 <Button size="sm" variant="outline" isDisabled={busy} onClick={()=>choose("archive")}>Archive guidance</Button></Flex>}
 {operation&&!data.archived&&!stale&&<Box mt="14px" p="12px" bg={ui.soft}>
 <Text fontWeight="600">{labels[operation]}</Text><Text fontSize="sm" mt="6px">Review the saved guidance, evidence and scope before confirming. Archive stops future use and cannot be undone by enabling the resource.</Text>
 <FormControl mt="10px"><FormLabel htmlFor={`lifecycle-${id}`}>Review rationale</FormLabel><Textarea id={`lifecycle-${id}`} value={rationale} onChange={e=>setRationale(e.target.value)} isDisabled={busy}/></FormControl>
 <Checkbox mt="12px" isChecked={confirm} isDisabled={busy} onChange={e=>setConfirm(e.target.checked)}>I reviewed this guidance and explicitly approve this operation.</Checkbox>
 <Flex gap="8px" mt="12px"><Button isLoading={busy} isDisabled={!confirm||rationale.trim().length<10} onClick={submit}>Confirm {labels[operation].toLowerCase()}</Button><Button variant="outline" isDisabled={busy} onClick={()=>setOperation("")}>Cancel lifecycle review</Button></Flex>
 </Box>}
 </>}
 </Box>;
}
