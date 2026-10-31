import React,{useEffect,useState} from 'react';
import { Alert,AlertIcon,Button,FormControl,FormLabel,Input,Modal,ModalBody,ModalCloseButton,ModalContent,ModalFooter,ModalHeader,ModalOverlay,Select,Stack,Text,Textarea } from '@chakra-ui/react';
import {api} from './api';
import {coverageStates,stateLabel} from './coverageModel';
export default function CoverageAssessment({technique,reference,onClose,onSaved}) {
 const previous=technique.assessment;
 const [state,setState]=useState(previous?.state||'gap');
 const [evidence,setEvidence]=useState(previous?.evidence_ref||''),[notes,setNotes]=useState(previous?.notes||'');
 const [ruleID,setRuleID]=useState(previous?.rule_id||''),[expiry,setExpiry]=useState(() => previous?.expires_at ? new Date(previous.expires_at).toISOString().slice(0,10) : new Date(Date.now()+90*86400000).toISOString().slice(0,10));
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[history,setHistory]=useState(null),[historyError,setHistoryError]=useState(''),[conflict,setConflict]=useState(false);
 const rules=technique.rules.filter(r=>r.enabled);
 useEffect(()=>{const controller=new AbortController();api.request(`/detection-coverage/${encodeURIComponent(technique.id)}/history`,{signal:controller.signal}).then(d=>setHistory(d.items)).catch(e=>{if(!controller.signal.aborted)setHistoryError(e.message);});return()=>controller.abort();},[technique.id]);
 const submit=async e=>{
  e.preventDefault();setBusy(true);setError('');setConflict(false);
  try {const rule=rules.find(r=>r.id===ruleID);await api.request(`/detection-coverage/${encodeURIComponent(technique.id)}`,{method:'PUT',body:{reference_version:reference,state,evidence_ref:evidence,notes,rule_id:state==='covered'?ruleID:'',rule_version:state==='covered'?(rule?.version||0):0,expected_version:previous?.version||0,expires_at:previous?.expires_at && expiry===new Date(previous.expires_at).toISOString().slice(0,10) ? previous.expires_at : expiry+'T23:59:59Z'}});onSaved();onClose();}
  catch(e){setError(e.message);setConflict(e.status===409);}finally{setBusy(false);}
 };
 return <Modal isOpen onClose={onClose} closeOnEsc={!busy} closeOnOverlayClick={!busy} size="xl"><ModalOverlay/><ModalContent as="form" onSubmit={submit}><ModalHeader>Assess {technique.id} · {technique.name}</ModalHeader><ModalCloseButton isDisabled={busy}/><ModalBody><Stack spacing="14px"><Text fontSize="12px">Record an analyst assessment against ATT&CK {reference}. Evidence references are recorded, not automatically fetched or verified. Accepted risk and alternative controls do not count as detection coverage.</Text>
 {error&&<Alert status="error"><AlertIcon/>{error}</Alert>}{conflict&&<Button variant="outline" onClick={()=>{onSaved();onClose();}}>Reload latest assessment</Button>}
 <FormControl><FormLabel>Assessment state</FormLabel><Select value={state} onChange={e=>setState(e.target.value)}>{coverageStates.map(v=><option key={v} value={v}>{stateLabel(v)}</option>)}</Select></FormControl>
 {state==='covered'&&<FormControl isRequired><FormLabel>Validated rule version</FormLabel><Select value={ruleID} onChange={e=>setRuleID(e.target.value)}><option value="">Choose an enabled mapped rule</option>{rules.map(rule=><option key={rule.id} value={rule.id}>{rule.name} · v{rule.version}</option>)}</Select>{!rules.length&&<Text color="orange.700" fontSize="12px" mt="6px">No enabled rule maps this exact technique. Create or update a rule before verifying coverage.</Text>}</FormControl>}
 <FormControl isRequired={['covered','accepted_risk','alternative_control','not_applicable'].includes(state)}><FormLabel>Evidence or approval reference</FormLabel><Input maxLength={1000} value={evidence} onChange={e=>setEvidence(e.target.value)} placeholder="Test report, evidence ID, or approval reference"/></FormControl>
 <FormControl isRequired={state!=='unassessed'}><FormLabel>Assessment rationale</FormLabel><Textarea maxLength={4000} value={notes} onChange={e=>setNotes(e.target.value)}/></FormControl>
 <FormControl isRequired><FormLabel>Review expires (UTC)</FormLabel><Input type="date" value={expiry} onChange={e=>setExpiry(e.target.value)}/></FormControl>
 {previous&&<Text fontSize="11px" color="gray.600">Last reviewed by {previous.reviewer} · {new Date(previous.reviewed_at).toLocaleString()} · v{previous.version}</Text>}
 <details><summary>Assessment history</summary>{historyError&&<Text color="red.600">{historyError}</Text>}{history?.map(item=><Text key={item.id} fontSize="11px" my="8px">{stateLabel(item.details.state)} · {item.details.reviewer} · v{item.details.version} · {new Date(item.created_at).toLocaleString()}</Text>)}{history?.length===0&&<Text fontSize="11px">No previous assessments.</Text>}</details>
 </Stack></ModalBody><ModalFooter gap="10px"><Button variant="outline" isDisabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" isLoading={busy} isDisabled={state==='covered'&&!rules.some(r=>r.id===ruleID)}>Save assessment</Button></ModalFooter></ModalContent></Modal>;
}
