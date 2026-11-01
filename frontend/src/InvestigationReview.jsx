import CaseSandboxResponses from "./CaseSandboxResponses";
import React, { useEffect, useState, useRef } from "react";
import { Alert, AlertIcon, Badge, Box, Button, Flex, Grid, Heading, Stack, Text, Textarea, Checkbox } from "@chakra-ui/react";
import { api } from "./api";
import { ui } from "./theme";

const label = value => String(value || "Not recorded").replaceAll("_", " ");
const missingLabels = { iam_mfa_context: "Identity and MFA context", endpoint_process_tree: "Endpoint process tree", conflicting_context: "Conflicting source observations", independent_verification: "Independent verification of local fixture evidence" };
const hypothesisLabels = { credential_compromise: "Possible credential compromise", legitimate_user_or_automation: "Possible legitimate user or automation" };
const formatTime = value => value && !value.startsWith("0001-") ? new Date(value).toLocaleString() : "Not recorded";

export default function InvestigationReview({ caseId, setView }) {
  const [review, setReview] = useState(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [confirming,setConfirming]=useState(false),[comment,setComment]=useState(""),[confirmed,setConfirmed]=useState(false),[approving,setApproving]=useState(false),[approvalError,setApprovalError]=useState("");
  const lifecycle=useRef(0);
  useEffect(()=>{const generation=++lifecycle.current;return()=>{lifecycle.current=generation+1}},[caseId]);
  const approve=async()=>{const generation=lifecycle.current;setApproving(true);setApprovalError("");try{
   await api.request(`/stream-operations/${encodeURIComponent(review.review_scope)}/approve-mock-note`,{method:"POST",body:{job_id:review.job_id,comment:comment.trim()}});
   if(generation===lifecycle.current){setConfirming(false);setComment("");setConfirmed(false);setRefresh(v=>v+1)}
  }catch(e){if(generation===lifecycle.current)setApprovalError(e.message)}finally{if(generation===lifecycle.current)setApproving(false)}};
  useEffect(() => {
    let active = true;
    let timer;
    setReview(null); setError("");
    const load = async () => {
      let again = true;
      try {
        const data = await api.request(`/investigations/${encodeURIComponent(caseId)}/l1`);
        if (!active) return;
        setReview(data); setError("");
        again = ["queued", "running", "awaiting_dispatch"].includes(data.state) || ["draft", "awaiting_review"].includes(data.sync_state) || (data.state === "completed" && data.sync_state === "not_started");
      } catch (e) { if (active) setError(e.message); }
      finally { if (active && again) timer = setTimeout(load, 5000); }
    };
    load();
    return () => { active = false; clearTimeout(timer); };
  }, [caseId, refresh]);
  const result = review?.result;
  const evidence = review?.evidence || [];
  const invalid = review?.result_status === "invalid";
  const failed = review?.state === "failed" || review?.state === "cancelled" || invalid;
  const stages = [
    ["Evidence linked", evidence.length > 0],
    ["Python review", review?.state === "completed"],
    ["Go contract checks", review?.result_status === "verified"],
    ...(review?.review_required ? [["Analyst note approval", !!review.reviewed_by]] : []),
    ["SOAR note", review?.sync_state === "synced"],
  ];
  const citations = refs => (refs || []).map(ref => {
    const index = evidence.findIndex(e => e.reference === ref);
    return <Box as="a" href={`#l1-evidence-${index}`} key={ref} color="blue.700" textDecoration="underline" overflowWrap="anywhere" fontSize="12px">{ref}</Box>;
  });
  return <Box as="section" aria-label="L1 investigation review" bg="white" border="1px solid" borderColor={ui.line} borderRadius="6px" mb="16px" overflow="hidden">
    <Flex p={{ base: "14px", md: "20px" }} bg={ui.nav} color="white" align="center" gap="12px" wrap="wrap">
      <Box flex="1"><Text color="#b7c3d5" fontSize="10px" letterSpacing=".12em">EVIDENCE / REVIEW / HANDOFF</Text><Heading fontSize="20px" mt="5px">L1 investigation review</Heading></Box>
      {review?.mode && <Badge colorScheme={review.mode === "mock-v1" ? "orange" : "blue"}>{review.mode === "mock-v1" ? "Mock inference" : "Model inference"}</Badge>}
      <Button as="a" href="#case-sandbox-responses" size="sm" bg="white" color={ui.ink}>Review response handoff</Button>
      <Button size="sm" bg="white" color={ui.ink} isDisabled={approving} onClick={() => setRefresh(v => v + 1)}>Refresh review</Button>
    </Flex>
    <Box p={{ base: "14px", md: "20px" }}>
      {error && <Alert status="warning" mb="12px"><AlertIcon />Review refresh failed: {error}. {review ? "Displayed review may be stale." : "Review data is unavailable."} Retrying automatically.</Alert>}
      {!review && !error && <Text role="status">Loading worker review…</Text>}
      {review?.state === "not_requested" ? <Text color={ui.muted}>No specialist review has been requested for this case. Deterministic processing and analyst findings remain available below.</Text> : review && <>
        <Flex align="center" gap="10px" wrap="wrap"><Badge colorScheme={failed ? "red" : "blue"}>{label(review.state)}</Badge><Text color={ui.muted} fontSize="12px">Attempt {review.attempts} of {review.max_attempts || "—"} · Updated {formatTime(review.updated_at)}</Text></Flex>
        <Grid as="ol" aria-label="L1 review stages" listStyleType="none" m="0" templateColumns={{ base: "1fr 1fr", md: `repeat(${stages.length},minmax(0,1fr))` }} gap="12px" mt="18px" mb="20px">
          {stages.map(([name, complete], i) => <Box as="li" key={name} borderTop="3px solid" borderColor={complete ? ui.green : ui.line} pt="8px"><Text fontSize="12px" fontWeight="600">{i + 1}. {name}</Text><Text fontSize="11px" color={ui.muted}>{complete ? "Recorded" : "Not completed"}</Text></Box>)}
        </Grid>
        {failed && <Alert status="error" mb="14px"><AlertIcon /><Box><Text fontWeight="600">{invalid ? "Result withheld: Go contract checks failed" : `Worker ${review.state}`}</Text><Text fontSize="12px">{review.error_code ? label(review.error_code) + ". " : ""}No usable L1 verdict is available. Review the worker configuration and case history before retrying.</Text></Box></Alert>}
        <Grid templateColumns={{ base: "minmax(0,1fr)", lg: "minmax(0,1fr) minmax(0,1.2fr)" }} gap="20px">
          <Box bg={ui.soft} p="16px" borderRadius="4px" minW="0">
            <Text fontSize="10px" color={ui.muted} letterSpacing=".08em">WORKER VERDICT</Text><Heading fontSize="24px" mt="6px">{result ? label(result.verdict).toLowerCase() : "Awaiting a valid result"}</Heading>
            <Text mt="10px" fontWeight="600">{result ? "Human L2 review required" : "No automated determination"}</Text>
            <Text mt="6px" color={ui.muted} fontSize="12px">{result ? "The evidence does not remove the need for analyst review. This worker verdict does not change the analyst determination or authorize a response." : "Queued, failed or incomplete work must not be treated as a benign outcome."}</Text>
            {result && <><Text fontWeight="600" mt="18px" mb="8px">Missing evidence / escalation reasons</Text><Stack as="ul" pl="18px" spacing="5px">{result.missing_evidence.map(item => <Text as="li" key={item}>{missingLabels[item] || label(item)}</Text>)}</Stack><Text mt="16px" fontSize="11px" color={ui.muted}>Model: {result.model_version} · Contract checks passed; evidence truth is not certified.</Text></>}
            <Text mt="16px" fontSize="12px">SOAR note: <strong>{label(review.sync_state)}</strong></Text>
            {review.review_required && !review.reviewed_by && <Alert status="warning" mt="10px"><AlertIcon/>Mock SOAR write-back is waiting for analyst approval. No note or response action has been sent.</Alert>}
            {review.reviewed_by && <Box mt="12px"><Text fontSize="12px">Mock note approved by {review.reviewed_by} · {formatTime(review.reviewed_at)}</Text><Text fontSize="12px" whiteSpace="pre-wrap" overflowWrap="anywhere">{review.review_comment}</Text></Box>}
            {review.review_required && !review.reviewed_by && review.review_scope && result && !invalid && <Box mt="14px">
             {!confirming?<Button isDisabled={!!error} variant="outline" onClick={()=>setConfirming(true)}>Review mock SOAR note</Button>:<Stack spacing="10px">
              <Text fontSize="12px">Approve only the Go-generated INCONCLUSIVE note with evidence references and missing-context warnings. The source case remains open; no containment or case closure is authorized.</Text>
              <Textarea aria-label="Analyst review comment" value={comment} maxLength={2000} isDisabled={approving} onChange={e=>setComment(e.target.value)} placeholder="Record what you reviewed (at least 10 characters)"/>
              <Checkbox isChecked={confirmed} isDisabled={approving} onChange={e=>setConfirmed(e.target.checked)}>I reviewed the evidence and approve this mock note only</Checkbox>
              {approvalError&&<Alert status="error"><AlertIcon/>{approvalError}</Alert>}
              <Flex gap="8px" wrap="wrap"><Button isLoading={approving} isDisabled={!confirmed||comment.trim().length<10||!!error} onClick={approve}>Approve mock note</Button><Button variant="ghost" isDisabled={approving} onClick={()=>{setConfirming(false);setConfirmed(false)}}>Cancel review</Button></Flex>
             </Stack>}
            </Box>}
            {review.sync_state === "synced" && <Text fontSize="11px" color={ui.muted}>A note was saved to the mock SOAR case. The incident was not closed.</Text>}
            {review.sync_state === "conflict" && <Alert status="warning" mt="10px"><AlertIcon />Analyst changes need reconciliation in Stream operations.</Alert>}
          </Box>
          <Stack spacing="14px" minW="0"><Heading fontSize="15px">Competing hypotheses</Heading>{result ? result.hypotheses.map(h => <Box border="1px solid" borderColor={ui.line} p="14px" borderRadius="4px" key={h.kind}><Text fontWeight="600">{hypothesisLabels[h.kind] || label(h.kind)}</Text><Text fontSize="11px" color={ui.muted} mt="9px">Supporting references</Text><Stack mt="5px" spacing="3px">{citations(h.supporting_refs)}</Stack><Text fontSize="11px" color={ui.muted} mt="10px">Counterevidence</Text><Stack mt="5px" spacing="3px">{h.counterevidence_refs?.length ? citations(h.counterevidence_refs) : <Text fontSize="12px">None recorded; this does not establish the hypothesis.</Text>}</Stack>{h.neutral_refs?.length > 0 && <><Text fontSize="11px" color={ui.muted} mt="10px">Not assessed (stale, unavailable or incomplete context)</Text><Stack mt="5px" spacing="3px">{citations(h.neutral_refs)}</Stack></>}</Box>) : <Text color={ui.muted}>Hypotheses appear only after a validated worker result is recorded.</Text>}</Stack>
        </Grid>
        <Box mt="22px"><Heading fontSize="15px">Evidence used by the worker</Heading><Text fontSize="12px" color={ui.muted} mt="5px">Source references and hashes establish provenance. They do not mean raw telemetry or identity context was available to the model.</Text>
          {evidence.map((e, i) => <Box id={`l1-evidence-${i}`} key={e.reference} tabIndex={-1} borderTop="1px solid" borderColor={ui.line} pt="12px" mt="12px" sx={{ scrollMarginTop: "110px", "&:target": { bg: "yellow.50" } }}><Flex gap="10px" wrap="wrap"><Badge>{label(e.event_type)}</Badge><Text fontSize="12px" fontFamily="mono" overflowWrap="anywhere">{e.reference}</Text></Flex><Text color={ui.muted} fontSize="11px" mt="5px">Event time: {formatTime(e.event_time)}</Text>{e.context && <Box bg={ui.soft} mt="8px" p="10px" borderRadius="4px" overflowWrap="anywhere"><Text fontSize="12px" fontWeight="600">Local JSON context · {e.context.source} · {label(e.context.state)}</Text><Text fontSize="12px">Reported outcome: {e.context.outcome} · Connector: {e.context.connector_id}</Text><Text fontSize="12px">User: {e.context.principal_ref} · Device: {e.context.asset_ref}</Text><Text fontSize="11px" color={ui.muted}>Retrieved: {formatTime(e.context.retrieved_at)}. Freshness is relative to this historical login, not current provider health.</Text>{(e.context.processes || []).map(p => <Text key={p.pid} fontSize="12px" overflowWrap="anywhere">Process {p.pid} (parent {p.parent_pid || 0}): {p.image} · SHA-256 {p.sha256}</Text>)}</Box>}<Box as="details" mt="5px"><Box as="summary" cursor="pointer" fontSize="11px">Content hash</Box><Text fontFamily="mono" fontSize="11px" overflowWrap="anywhere">{e.content_hash}</Text></Box></Box>)}
          {!evidence.length && <Text color={ui.muted} mt="10px">No validated evidence metadata available.</Text>}
        </Box>
      </>}
      <CaseSandboxResponses key={caseId} caseId={caseId} review={review} setView={setView}/>
    </Box>
  </Box>;
}
