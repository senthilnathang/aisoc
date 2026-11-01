import { HuntOrigin } from "./IntelHuntFlow";
import React, { useEffect, useRef, useState } from "react";
import { Alert, AlertIcon, Badge, Box, Button, Flex, FormControl, FormLabel, Grid, Heading, HStack, Input, Portal, Select, Stack, Text, Textarea, useToast } from "@chakra-ui/react";
import { CaseRunbooks } from "./ResponsePlans";
import { api } from "./api";
import { ui } from "./theme";
import InvestigationReview from "./InvestigationReview";
import {SummaryExperience,ReportExperience,ArtifactExperience,EvidenceCopilot} from './InvestigationExperience';
import {caseTabs,useCaseTab} from './investigationNavigation';
const loadCase=async id=>{const w=await api.request(`/investigations/${encodeURIComponent(id)}/workspace`);return {...w.case,workspace:w};};

const Card = ({ children, ...props }) => <Box bg="white" border="1px solid" borderColor={ui.line} rounded="6px" minW="0" overflowWrap="anywhere" p={{ base: "14px", md: "16px" }} {...props}>{children}</Box>;
const Json = ({ value }) => <Box as="pre" bg="#151820" color="#e6edf3" p="16px" rounded="5px" overflowX="auto" fontSize="11px" whiteSpace="pre-wrap" overflowWrap="anywhere">{JSON.stringify(value, null, 2)}</Box>;
const Empty = ({ children }) => <Text color={ui.muted} py="24px">{children}</Text>;

export default function InvestigationCase({ id, setView }) {
  const [record, setRecord] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useCaseTab();
 const [selectedNode,setSelectedNode]=useState(null),[chatOpen,setChatOpen]=useState(false);
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState("");
  const [artifact, setArtifact] = useState({ type: "entity", value: "", label: "" });
  const [pollError, setPollError] = useState("");
  const generation = useRef(0);
  const toast = useToast();
  const caseId = id || "INV-4819";
  const currentJob = record?.jobs?.[0];
  const running = ["queued", "running"].includes(currentJob?.status);
  useEffect(() => {
    const current = ++generation.current;
    setRecord(null); setError(""); setComment(""); setBusy(false);setSelectedNode(null);setChatOpen(false);
    loadCase(caseId).then(result => { if (current === generation.current) setRecord(result); })
      .catch(e => { if (current === generation.current) setError(e.message); });
    return () => { generation.current = current + 1; };
  }, [caseId]);
  useEffect(() => {
    if (!running || busy) return;
    let active = true;
    let timer;
    const refresh = async () => {
      try {
        const updated = await loadCase(caseId);
        if (active) { setRecord(updated); setPollError(""); }
      } catch (e) { if (active) setPollError(e.message); }
      finally { if (active) timer = setTimeout(refresh, 1000); }
    };
    timer = setTimeout(refresh, 1000);
    return () => { active = false; clearTimeout(timer); };
  }, [caseId, running, busy]);
  const mutate = async (work, message, clear) => {
    const current = generation.current;
    setBusy(true);
    try {
      await work();
      const updated = await loadCase(caseId);
      if (current !== generation.current) return;
      setRecord(updated); clear?.();
      toast({ title: message, status: "success", duration: 2500 });
    } catch (e) {
      if (current === generation.current) toast({ title: "Could not save", description: e.message, status: "error", duration: 4000 });
    } finally { if (current === generation.current) setBusy(false); }
  };
  if (error) return <Alert status="error" m="20px" w="auto"><AlertIcon />{error}<Button ml="auto" onClick={() => window.location.reload()}>Retry</Button></Alert>;
  if (!record) return <Box p="40px" role="status">Loading investigation…</Box>;
  const inspectNode=ref=>{setSelectedNode(ref);setTab('Artifacts');};
  const openCitation=ref=>{if(ref.startsWith('step:')){if(!record.steps.some(s=>s.id===ref.slice(5))){toast({title:'Source outside the current report window',description:'The conversation retains the excerpt captured when this lookup ran.',status:'info'});return false;}setTab('Report');setTimeout(()=>document.getElementById('report-'+ref.slice(5))?.scrollIntoView({block:'center'}),0);}else if(ref.startsWith('case:'))setTab('Summary');else {if(!record.workspace.nodes.some(n=>n.id===ref)){toast({title:'Source outside the current artifact window',description:'The conversation retains its captured excerpt.',status:'info'});return false;}inspectNode(ref);}return true;};
  return <Box className="page-enter investigation-case">
    <Flex className="case-header" px={{ base: "12px", md: "20px" }} py="12px" align="center" gap="12px" wrap="wrap" borderBottom="1px solid" borderColor={ui.line}>
      <Box mr="auto" minW="0" flex={{ base: "1 1 100%", xl: "1 1 400px" }} overflowWrap="anywhere"><Text fontSize="10px" color={ui.muted}>{record.id} / {record.source}</Text><Heading fontSize="18px" mt="4px">{record.title}</Heading></Box>
      <Button variant="outline" onClick={() => setTab("History")}>Investigation History</Button>
      <Button variant="outline" onClick={() => setTab("Feedback")}>Add Feedback</Button>
      <Button variant="outline" onClick={()=>setTab("Artifacts")}>Add Alert Insight</Button>
      <Button isDisabled={busy || running} onClick={() => mutate(() => api.reinvestigate(caseId), record.alerts?.length ? "Investigation queued" : "Case reopened for review")}>{currentJob?.status === "failed" ? "Retry investigation" : "Reinvestigate"}</Button>
      <Badge>{record.status}</Badge>
    </Flex>
    <Flex bg="white" px="24px" gap="4px" overflowX="auto" role="tablist" aria-label="Investigation sections">
      {caseTabs.map(name => <Button key={name} flexShrink={0} role="tab" aria-selected={tab === name} variant="ghost" borderRadius="0" borderBottom="2px solid" borderColor={tab === name ? ui.ink : "transparent"} color={tab === name ? ui.ink : ui.muted} onClick={() => setTab(name)}>{name}</Button>)}
    </Flex>
    <Box w="100%" minW="0" p={{ base: "12px", md: "20px" }}>
      <Text fontSize="11px" color={ui.muted} mb="12px">Local workspace · Supplied evidence and local indicators only. No external tools are connected. Outcomes require analyst review.</Text>
      {pollError && <Alert status="warning" mb="16px"><AlertIcon />Progress refresh failed: {pollError}. Retrying…</Alert>}
      {currentJob && (running || currentJob.status === "failed" || tab === "Review") && <Card mb="12px" role="status" aria-live="polite">
        <Flex gap="12px" wrap="wrap" align="center"><Box flex="1"><Text fontSize="10px" color={ui.muted} letterSpacing=".08em">LOCAL INVESTIGATION WORKER</Text><Heading fontSize="16px" mt="6px">{currentJob.status === "completed" ? "Processing complete · Analyst review required" : currentJob.status === "failed" ? "Processing failed" : currentJob.status === "queued" ? "Queued for processing" : "Investigation in progress"}</Heading></Box><Badge colorScheme={currentJob.status === "completed" ? "green" : currentJob.status === "failed" ? "red" : "blue"}>{currentJob.status} · {currentJob.phase}/3</Badge></Flex>
        <Grid templateColumns={{ base: "1fr", md: "repeat(3, 1fr)" }} gap="12px" mt="12px">{["Record supplied evidence", "Compare local indicators", "Record review outcome"].map((label, i) => <Box key={label} borderTop="3px solid" borderColor={currentJob.phase > i ? ui.green : ui.line} pt="10px"><Text fontSize="12px">{currentJob.phase > i ? "✓" : `${i + 1}.`} {label}</Text></Box>)}</Grid>
        {currentJob.error && <Text color="red.600" mt="14px">{currentJob.error}</Text>}
        {record.alerts?.[0] && <Flex gap="12px" mt="16px" align="center" wrap="wrap"><Text color={ui.muted} fontSize="11px" minW="0" maxW="100%" overflowWrap="anywhere">Source alert: {record.alerts[0].external_id} · Routing: {record.alerts[0].routing}</Text><Button as="a" href={`/detect/rules/${encodeURIComponent(record.alerts[0].rule_id)}`} variant="outline">View detection rule</Button></Flex>}
      </Card>}
      {tab === "Summary" && <HuntOrigin key={caseId} caseID={caseId} setView={setView}/>}
      {tab === "Summary" && <SummaryExperience record={record} nodes={record.workspace.nodes} onArtifact={inspectNode} busy={busy} running={running} onTab={setTab} onDetermination={v=>mutate(()=>api.setDetermination(caseId,v),"Determination saved")}/>}
      {(tab === "Summary" || tab === "Review") && <Box mt="24px"><InvestigationReview key={caseId} caseId={caseId} setView={setView}/></Box>}
      {tab === "Report" && <ReportExperience record={record} onArtifact={inspectNode}/>}
      {tab === "Artifacts" && <Stack spacing="18px"><ArtifactExperience workspace={record.workspace} selected={selectedNode} onSelect={setSelectedNode}/>
        <Card as="form" onSubmit={e => { e.preventDefault(); mutate(() => api.action("investigations", caseId, "artifacts", artifact), "Artifact attached", () => setArtifact({ type: "entity", value: "", label: "" })); }}><Heading fontSize="14px" mb="16px">Attach evidence</Heading><Grid templateColumns={{ base: "1fr", md: "140px 1fr 1fr" }} gap="12px"><FormControl><FormLabel>Type</FormLabel><Select value={artifact.type} onChange={e => setArtifact({ ...artifact, type: e.target.value })}>{["entity", "ip", "domain", "file", "email", "url"].map(type => <option key={type}>{type}</option>)}</Select></FormControl><FormControl isRequired><FormLabel>Value</FormLabel><Input maxLength={2000} value={artifact.value} onChange={e => setArtifact({ ...artifact, value: e.target.value })} /></FormControl><FormControl><FormLabel>Label</FormLabel><Input maxLength={200} value={artifact.label} onChange={e => setArtifact({ ...artifact, label: e.target.value })} /></FormControl></Grid><Button type="submit" mt="16px" isDisabled={busy || !artifact.value.trim()}>Attach artifact</Button></Card>
      </Stack>}
      {tab === "Transcript" && <Stack spacing="18px">{record.skill_applications?.length > 0 && <Card><Heading fontSize="16px" mb="14px">Applied Skills</Heading><Stack spacing="12px">{record.skill_applications.map(application => <Box key={application.id} p="12px" bg={ui.soft} borderRadius="5px"><Flex justify="space-between" gap="8px" wrap="wrap"><Text fontWeight="600">{application.snapshot.name} · v{application.skill_version}</Text><Text fontSize="10px" color={ui.muted}>{new Date(application.created_at).toLocaleString()}</Text></Flex><Text mt="7px" fontSize="11px">{application.reason}</Text>{application.snapshot.description && <Text mt="7px" color={ui.muted} fontSize="11px">{application.snapshot.description}</Text>}{application.snapshot.content_markdown && <Box mt="10px" whiteSpace="pre-wrap" fontSize="11px">{application.snapshot.content_markdown}</Box>}{application.snapshot.materials?.length > 0 && <Text mt="8px" fontSize="10px" color={ui.muted}>References: {application.snapshot.materials.map(material => material.name).join(", ")}</Text>}{application.snapshot.insight_refs?.length > 0 && <Text mt="4px" fontSize="10px" color={ui.muted}>Enterprise context: {application.snapshot.insight_refs.join(", ")}</Text>}<HStack mt="10px"><Text fontSize="10px" color={ui.muted}>Was this skill useful?</Text><Button size="xs" variant="outline" isDisabled={busy} onClick={() => mutate(() => api.request(`/skills/applications/${encodeURIComponent(application.id)}/feedback`, { method: "POST", body: { rating: "helpful" } }), "Skill feedback saved")}>Helpful</Button><Button size="xs" variant="outline" isDisabled={busy} onClick={() => mutate(() => api.request(`/skills/applications/${encodeURIComponent(application.id)}/feedback`, { method: "POST", body: { rating: "not_helpful" } }), "Skill feedback saved")}>Not helpful</Button>{application.feedback?.length > 0 && <Text fontSize="9px" color={ui.muted}>{application.feedback.length} rating(s) saved</Text>}</HStack></Box>)}</Stack></Card>}{record.steps.length ? record.steps.map((step, i) => <Card key={step.id}><Text fontSize="10px" color={ui.muted}>STEP {i + 1} / {step.tool}</Text><Heading fontSize="18px" mt="8px">{step.title}</Heading><Text mt="16px">{step.conclusion}</Text><Box as="details" mt="20px"><Box as="summary" cursor="pointer" fontWeight="600">Inspect tool request and response</Box><Text mt="16px" mb="8px">Request</Text><Json value={step.request} /><Text mt="16px" mb="8px">Response</Text><Json value={step.response} /></Box></Card>) : <Card><Empty>No tool steps recorded yet. Queued local runs will appear here as they progress.</Empty></Card>}</Stack>}
      {tab === "I/O" && <Card><Heading fontSize="16px" mb="16px">Recorded tool I/O</Heading><Box as="details" mb="20px"><Box as="summary" cursor="pointer">Source alert cards</Box><Json value={record.alerts}/></Box>{record.steps.length ? record.steps.map(step => <Box key={step.id} mb="12px"><Text mb="8px">{step.tool}</Text><Json value={{ request: step.request, response: step.response }} /></Box>) : <Empty>No tool I/O recorded.</Empty>}</Card>}
      {tab === "Runbooks" && <CaseRunbooks key={caseId} caseId={caseId} onChange={async () => { const current = generation.current; const updated = await loadCase(caseId); if (current === generation.current) setRecord(updated); }} />}
      {tab === "Remediation" && <Box className="case-remediation"><Flex justify="space-between" align="center"><Heading fontSize="20px" fontWeight="500">Remediation</Heading><Button variant="link" onClick={()=>setTab('History')}>View Audit Log</Button></Flex><Text className="case-section-subtitle">Recorded response recommendations · local simulation only</Text>{record.remediations.length ? record.remediations.map(action=><article className="case-report-step" key={action.id}><div className="case-step-heading"><span className="case-node-icon small">ϟ</span><b>{action.title}</b></div><div className="case-step-content"><small>PROVIDER / TARGET</small><div className="case-input-box"><Text fontSize="12px">{action.connector||'No provider configured'}</Text><Text fontSize="11px">{action.target||'Target not recorded'}</Text></div><small>REASON</small><Text py="18px" fontSize="12px">{action.description||'No recommendation rationale recorded.'}</Text><Flex className="case-tool-result" justify="space-between" align="center"><Text fontSize="12px">{action.status==='completed'?'Local simulation recorded':'Action not executed'}</Text><Button variant="outline" isDisabled={busy||action.status==='completed'} onClick={()=>mutate(()=>api.executeRemediation(action.id),'Local simulation recorded')}>{action.status==='completed'?'Simulated':'Simulate action'}</Button></Flex></div></article>):<Empty>No response actions attached to this case.</Empty>}<Text fontSize="11px" color={ui.muted} mt="18px">Simulation changes local records only. Real containment requires the separate response policy and approval workflow.</Text></Box>}
      {tab === "History" && <Card><Heading fontSize="16px">Investigation history</Heading><Text fontSize="11px" color={ui.muted} mt="8px">Most recent 100 recorded changes</Text>{record.history.length ? record.history.map(event => <Box key={event.id} py="16px" borderBottom="1px solid" borderColor={ui.line}><Flex justify="space-between" gap="8px" wrap="wrap"><Text fontWeight="600">{event.action.replaceAll("_", " ")}</Text><Text fontSize="11px" color={ui.muted}>{new Date(event.created_at).toLocaleString()}</Text></Flex><Text mt="4px" color={ui.muted}>{event.details.fields?.join(", ") || event.details.record_id}</Text></Box>) : <Empty>No changes recorded yet.</Empty>}</Card>}
      {tab === "Feedback" && <Card><Heading fontSize="16px" mb="16px">Analyst feedback</Heading><Box as="form" onSubmit={e => { e.preventDefault(); mutate(() => api.action("investigations", caseId, "feedback", { comment }), "Feedback saved", () => setComment("")); }}><FormControl><FormLabel>Review note</FormLabel><Textarea maxLength={4000} value={comment} onChange={e => setComment(e.target.value)} placeholder="Record your findings or explain a determination…" /></FormControl><Button type="submit" mt="12px" isDisabled={busy || !comment.trim()}>Save feedback</Button></Box>{record.feedback.map(item => <Box key={item.id} mt="20px" p="16px" bg={ui.soft}><Text whiteSpace="pre-wrap">{item.comment}</Text><Text mt="6px" color={ui.muted} fontSize="10px">{new Date(item.created_at).toLocaleString()}</Text></Box>)}</Card>}
    </Box>
    <Portal><Button className="case-copilot-launcher" position="fixed" bottom="22px" right="24px" zIndex="20" onClick={()=>setChatOpen(true)}>Case copilot</Button></Portal>
    <EvidenceCopilot key={caseId} caseId={caseId} isOpen={chatOpen} onClose={()=>setChatOpen(false)} onCitation={openCitation}/>
  </Box>;
}
