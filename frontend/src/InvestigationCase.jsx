import React, { useEffect, useRef, useState } from "react";
import { Alert, AlertIcon, Badge, Box, Button, Flex, FormControl, FormLabel, Grid, Heading, HStack, Input, Select, Stack, Text, Textarea, useToast } from "@chakra-ui/react";
import { CaseRunbooks } from "./ResponsePlans";
import { api } from "./api";
import { ui } from "./theme";

const Card = ({ children, ...props }) => <Box bg="white" border="1px solid" borderColor={ui.line} rounded="6px" minW="0" overflowWrap="anywhere" p={{ base: "14px", md: "16px" }} {...props}>{children}</Box>;
const Json = ({ value }) => <Box as="pre" bg="#151820" color="#e6edf3" p="16px" rounded="5px" overflowX="auto" fontSize="11px" whiteSpace="pre-wrap" overflowWrap="anywhere">{JSON.stringify(value, null, 2)}</Box>;
const Empty = ({ children }) => <Text color={ui.muted} py="24px">{children}</Text>;

export default function InvestigationCase({ id }) {
  const [record, setRecord] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("Summary");
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState("");
  const [artifact, setArtifact] = useState({ type: "entity", value: "", label: "" });
  const [search, setSearch] = useState("");
  const [pollError, setPollError] = useState("");
  const generation = useRef(0);
  const toast = useToast();
  const caseId = id || "INV-4819";
  const currentJob = record?.jobs?.[0];
  const running = ["queued", "running"].includes(currentJob?.status);
  useEffect(() => {
    const current = ++generation.current;
    setRecord(null); setError(""); setTab("Summary"); setComment(""); setSearch(""); setBusy(false);
    api.investigation(caseId).then(result => { if (current === generation.current) setRecord(result); })
      .catch(e => { if (current === generation.current) setError(e.message); });
    return () => { generation.current++; };
  }, [caseId]);
  useEffect(() => {
    if (!running || busy) return;
    let active = true;
    let timer;
    const refresh = async () => {
      try {
        const updated = await api.investigation(caseId);
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
      const updated = await api.investigation(caseId);
      if (current !== generation.current) return;
      setRecord(updated); clear?.();
      toast({ title: message, status: "success", duration: 2500 });
    } catch (e) {
      if (current === generation.current) toast({ title: "Could not save", description: e.message, status: "error", duration: 4000 });
    } finally { if (current === generation.current) setBusy(false); }
  };
  if (error) return <Alert status="error" m="20px" w="auto"><AlertIcon />{error}<Button ml="auto" onClick={() => window.location.reload()}>Retry</Button></Alert>;
  if (!record) return <Box p="40px" role="status">Loading investigation…</Box>;
  const artifacts = record.artifacts.filter(item => `${item.label} ${item.type} ${item.value}`.toLowerCase().includes(search.toLowerCase()));
  const color = ["malicious", "suspicious"].includes(record.determination) ? ui.red : record.determination === "unknown" ? ui.amber : ui.green;
  return <Box className="page-enter investigation-case">
    <Flex className="case-header" px={{ base: "12px", md: "20px" }} py="12px" align="center" gap="12px" wrap="wrap" borderBottom="1px solid" borderColor={ui.line}>
      <Box mr="auto" minW="0" flex={{ base: "1 1 100%", xl: "1 1 400px" }} overflowWrap="anywhere"><Text fontSize="10px" color={ui.muted}>{record.id} / {record.source}</Text><Heading fontSize="18px" mt="4px">{record.title}</Heading></Box>
      <Button variant="outline" onClick={() => setTab("History")}>Investigation History</Button>
      <Button variant="outline" onClick={() => setTab("Feedback")}>Add Feedback</Button>
      <Button isDisabled={busy || running} onClick={() => mutate(() => api.reinvestigate(caseId), record.alerts?.length ? "Investigation queued" : "Case reopened for review")}>{currentJob?.status === "failed" ? "Retry investigation" : "Reinvestigate"}</Button>
      <Badge>{record.status}</Badge>
    </Flex>
    <Flex bg="white" px="24px" gap="4px" overflowX="auto" role="tablist" aria-label="Investigation sections">
      {["Summary", "Artifacts", "Transcript", "Remediation", "Runbooks", "I/O", "History", "Feedback"].map(name => <Button key={name} flexShrink={0} role="tab" aria-selected={tab === name} variant="ghost" borderRadius="0" borderBottom="2px solid" borderColor={tab === name ? ui.ink : "transparent"} color={tab === name ? ui.ink : ui.muted} onClick={() => setTab(name)}>{name}</Button>)}
    </Flex>
    <Box w="100%" minW="0" p={{ base: "12px", md: "20px" }}>
      <Text fontSize="11px" color={ui.muted} mb="12px">Local workspace · Supplied evidence and local indicators only. No external tools are connected. Outcomes require analyst review.</Text>
      {pollError && <Alert status="warning" mb="16px"><AlertIcon />Progress refresh failed: {pollError}. Retrying…</Alert>}
      {currentJob && <Card mb="12px" role="status" aria-live="polite">
        <Flex gap="12px" wrap="wrap" align="center"><Box flex="1"><Text fontSize="10px" color={ui.muted} letterSpacing=".08em">LOCAL INVESTIGATION WORKER</Text><Heading fontSize="16px" mt="6px">{currentJob.status === "completed" ? "Processing complete · Analyst review required" : currentJob.status === "failed" ? "Processing failed" : currentJob.status === "queued" ? "Queued for processing" : "Investigation in progress"}</Heading></Box><Badge colorScheme={currentJob.status === "completed" ? "green" : currentJob.status === "failed" ? "red" : "blue"}>{currentJob.status} · {currentJob.phase}/3</Badge></Flex>
        <Grid templateColumns={{ base: "1fr", md: "repeat(3, 1fr)" }} gap="12px" mt="12px">{["Record supplied evidence", "Compare local indicators", "Record review outcome"].map((label, i) => <Box key={label} borderTop="3px solid" borderColor={currentJob.phase > i ? ui.green : ui.line} pt="10px"><Text fontSize="12px">{currentJob.phase > i ? "✓" : `${i + 1}.`} {label}</Text></Box>)}</Grid>
        {currentJob.error && <Text color="red.600" mt="14px">{currentJob.error}</Text>}
        {record.alerts?.[0] && <Flex gap="12px" mt="16px" align="center" wrap="wrap"><Text color={ui.muted} fontSize="11px">Source alert: {record.alerts[0].external_id} · Routing: {record.alerts[0].routing}</Text><Button as="a" href={`/detect/rules/${encodeURIComponent(record.alerts[0].rule_id)}`} variant="outline">View detection rule</Button></Flex>}
      </Card>}
      {tab === "Summary" && <Grid templateColumns={{ base: "minmax(0, 1fr)", lg: "minmax(220px, .7fr) minmax(0, 2.3fr)" }} gap="14px" alignItems="start">
        <Card><Text fontSize="10px" color={ui.muted} textTransform="uppercase" letterSpacing=".08em">Source alert</Text><Heading fontSize="16px" mt="12px">{record.source}</Heading><HStack mt="12px" flexWrap="wrap"><Badge>{record.category}</Badge><Badge bg={color} color="white">{record.severity}</Badge></HStack>
          <Text mt="16px" fontSize="11px" color={ui.muted}>PRIMARY ENTITY</Text><Text mt="5px" overflowWrap="anywhere">{record.primary_entity || "Not recorded"}</Text>
          <Text mt="16px" fontSize="11px" color={ui.muted}>ASSIGNED TO</Text><Text mt="5px">{record.owner}</Text>
          <Text mt="16px" fontSize="11px" color={ui.muted}>CREATED</Text><Text mt="5px">{new Date(record.created_at).toLocaleString()}</Text>
          <Text mt="16px" fontSize="11px" color={ui.muted}>REVIEW CYCLES</Text><Text mt="5px">{record.replay_count}</Text>
        </Card>
        <Grid templateColumns={{ base: "minmax(0, 1fr)", xl: "repeat(2, minmax(0, 1fr))" }} gap="14px" alignItems="start"><Card borderTop="3px solid" borderTopColor={color}>
          <Flex justify="space-between" align="center"><Text fontSize="11px" color={ui.muted} letterSpacing=".08em">DETERMINATION</Text><Badge bg={color} color="white">{record.determination}</Badge></Flex>
          <Heading fontSize="20px" mt="16px">{record.summary || "No summary recorded"}</Heading>
          <Text mt="16px" color={ui.muted}>{record.alerts?.length ? "Risk score not assessed" : `Risk score: ${record.risk_score}/100`} · {record.artifacts.length} artifacts · {record.steps.length} recorded steps</Text>
          <FormControl mt="16px"><FormLabel fontSize="11px">Analyst determination</FormLabel><Select aria-label="Analyst determination" value={record.determination} isDisabled={busy || running} onChange={e => mutate(() => api.setDetermination(caseId, e.target.value), "Determination saved")}>
            {["unknown", "benign", "suspicious", "malicious", "mitigated"].map(value => <option key={value} value={value}>{value}</option>)}</Select></FormControl>
        </Card><Card><Heading fontSize="14px" mb="16px">Connected evidence</Heading>{record.artifacts.length ? record.artifacts.map(item => <Flex key={item.id} py="12px" borderBottom="1px solid" borderColor={ui.line} gap="16px"><Badge alignSelf="start">{item.type}</Badge><Box minW="0"><Text fontWeight="600" overflowWrap="anywhere">{item.value}</Text><Text color={ui.muted} fontSize="11px">{item.label}</Text></Box></Flex>) : <Empty>No evidence has been attached to this case.</Empty>}</Card></Grid>
      </Grid>}
      {tab === "Artifacts" && <Stack spacing="18px"><Card><Flex justify="space-between" align="center" gap="12px" wrap="wrap" mb="16px"><Heading fontSize="16px">Case artifacts</Heading><Input w={{ base: "100%", md: "240px" }} aria-label="Search artifacts" placeholder="Search artifacts" value={search} onChange={e => setSearch(e.target.value)} /></Flex>
        {artifacts.length ? artifacts.map(item => <Box key={item.id} py="14px" borderBottom="1px solid" borderColor={ui.line}><HStack align="start" minW="0"><Badge flexShrink={0}>{item.type}</Badge><Text fontWeight="600" overflowWrap="anywhere">{item.value}</Text></HStack><Text mt="5px" color={ui.muted}>{item.label}</Text><Text fontSize="10px" color={ui.muted}>{item.metadata?.provenance || "Analyst supplied evidence"}</Text></Box>) : <Empty>No matching artifacts.</Empty>}</Card>
        <Card as="form" onSubmit={e => { e.preventDefault(); mutate(() => api.action("investigations", caseId, "artifacts", artifact), "Artifact attached", () => setArtifact({ type: "entity", value: "", label: "" })); }}><Heading fontSize="14px" mb="16px">Attach evidence</Heading><Grid templateColumns={{ base: "1fr", md: "140px 1fr 1fr" }} gap="12px"><FormControl><FormLabel>Type</FormLabel><Select value={artifact.type} onChange={e => setArtifact({ ...artifact, type: e.target.value })}>{["entity", "ip", "domain", "file", "email", "url"].map(type => <option key={type}>{type}</option>)}</Select></FormControl><FormControl isRequired><FormLabel>Value</FormLabel><Input maxLength={2000} value={artifact.value} onChange={e => setArtifact({ ...artifact, value: e.target.value })} /></FormControl><FormControl><FormLabel>Label</FormLabel><Input maxLength={200} value={artifact.label} onChange={e => setArtifact({ ...artifact, label: e.target.value })} /></FormControl></Grid><Button type="submit" mt="16px" isDisabled={busy || !artifact.value.trim()}>Attach artifact</Button></Card>
      </Stack>}
      {tab === "Transcript" && <Stack spacing="18px">{record.skill_applications?.length > 0 && <Card><Heading fontSize="16px" mb="14px">Applied Skills</Heading><Stack spacing="12px">{record.skill_applications.map(application => <Box key={application.id} p="12px" bg={ui.soft} borderRadius="5px"><Flex justify="space-between" gap="8px" wrap="wrap"><Text fontWeight="600">{application.snapshot.name} · v{application.skill_version}</Text><Text fontSize="10px" color={ui.muted}>{new Date(application.created_at).toLocaleString()}</Text></Flex><Text mt="7px" fontSize="11px">{application.reason}</Text>{application.snapshot.description && <Text mt="7px" color={ui.muted} fontSize="11px">{application.snapshot.description}</Text>}{application.snapshot.content_markdown && <Box mt="10px" whiteSpace="pre-wrap" fontSize="11px">{application.snapshot.content_markdown}</Box>}{application.snapshot.materials?.length > 0 && <Text mt="8px" fontSize="10px" color={ui.muted}>References: {application.snapshot.materials.map(material => material.name).join(", ")}</Text>}{application.snapshot.insight_refs?.length > 0 && <Text mt="4px" fontSize="10px" color={ui.muted}>Enterprise context: {application.snapshot.insight_refs.join(", ")}</Text>}<HStack mt="10px"><Text fontSize="10px" color={ui.muted}>Was this skill useful?</Text><Button size="xs" variant="outline" isDisabled={busy} onClick={() => mutate(() => api.request(`/skills/applications/${encodeURIComponent(application.id)}/feedback`, { method: "POST", body: { rating: "helpful" } }), "Skill feedback saved")}>Helpful</Button><Button size="xs" variant="outline" isDisabled={busy} onClick={() => mutate(() => api.request(`/skills/applications/${encodeURIComponent(application.id)}/feedback`, { method: "POST", body: { rating: "not_helpful" } }), "Skill feedback saved")}>Not helpful</Button>{application.feedback?.length > 0 && <Text fontSize="9px" color={ui.muted}>{application.feedback.length} rating(s) saved</Text>}</HStack></Box>)}</Stack></Card>}{record.steps.length ? record.steps.map((step, i) => <Card key={step.id}><Text fontSize="10px" color={ui.muted}>STEP {i + 1} / {step.tool}</Text><Heading fontSize="18px" mt="8px">{step.title}</Heading><Text mt="16px">{step.conclusion}</Text><Box as="details" mt="20px"><Box as="summary" cursor="pointer" fontWeight="600">Inspect tool request and response</Box><Text mt="16px" mb="8px">Request</Text><Json value={step.request} /><Text mt="16px" mb="8px">Response</Text><Json value={step.response} /></Box></Card>) : <Card><Empty>No tool steps recorded yet. Queued local runs will appear here as they progress.</Empty></Card>}</Stack>}
      {tab === "I/O" && <Card><Heading fontSize="16px" mb="16px">Recorded tool I/O</Heading>{record.steps.length ? record.steps.map(step => <Box key={step.id} mb="12px"><Text mb="8px">{step.tool}</Text><Json value={{ request: step.request, response: step.response }} /></Box>) : <Empty>No tool I/O recorded.</Empty>}</Card>}
      {tab === "Runbooks" && <CaseRunbooks key={caseId} caseId={caseId} onChange={async () => { const current = generation.current; const updated = await api.investigation(caseId); if (current === generation.current) setRecord(updated); }} />}
      {tab === "Remediation" && <Card><Heading fontSize="16px">Recommended response</Heading><Text color={ui.muted} mt="8px">Simulation only. These actions update local records and do not change external systems.</Text>{record.remediations.length ? record.remediations.map(action => <Flex key={action.id} py="14px" gap="12px" align="center" wrap="wrap" borderBottom="1px solid" borderColor={ui.line}><Box flex="1"><Text fontWeight="600">{action.title}</Text><Text fontSize="12px" mt="4px" color={ui.muted}>{action.description}</Text><Badge mt="8px">{action.connector}</Badge></Box><Button variant="outline" isDisabled={busy || action.status === "completed"} onClick={() => mutate(() => api.executeRemediation(action.id), "Local simulation recorded")}>{action.status === "completed" ? "Simulated" : "Simulate action"}</Button></Flex>) : <Empty>No response actions attached to this case.</Empty>}</Card>}
      {tab === "History" && <Card><Heading fontSize="16px">Investigation history</Heading><Text fontSize="11px" color={ui.muted} mt="8px">Most recent 100 recorded changes</Text>{record.history.length ? record.history.map(event => <Box key={event.id} py="16px" borderBottom="1px solid" borderColor={ui.line}><Flex justify="space-between" gap="8px" wrap="wrap"><Text fontWeight="600">{event.action.replaceAll("_", " ")}</Text><Text fontSize="11px" color={ui.muted}>{new Date(event.created_at).toLocaleString()}</Text></Flex><Text mt="4px" color={ui.muted}>{event.details.fields?.join(", ") || event.details.record_id}</Text></Box>) : <Empty>No changes recorded yet.</Empty>}</Card>}
      {tab === "Feedback" && <Card><Heading fontSize="16px" mb="16px">Analyst feedback</Heading><Box as="form" onSubmit={e => { e.preventDefault(); mutate(() => api.action("investigations", caseId, "feedback", { comment }), "Feedback saved", () => setComment("")); }}><FormControl><FormLabel>Review note</FormLabel><Textarea maxLength={4000} value={comment} onChange={e => setComment(e.target.value)} placeholder="Record your findings or explain a determination…" /></FormControl><Button type="submit" mt="12px" isDisabled={busy || !comment.trim()}>Save feedback</Button></Box>{record.feedback.map(item => <Box key={item.id} mt="20px" p="16px" bg={ui.soft}><Text whiteSpace="pre-wrap">{item.comment}</Text><Text mt="6px" color={ui.muted} fontSize="10px">{new Date(item.created_at).toLocaleString()}</Text></Box>)}</Card>}
    </Box>
  </Box>;
}
