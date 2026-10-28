import React, { useEffect, useState } from "react";
import { Alert, AlertIcon, Badge, Box, Button, Flex, FormControl, FormLabel, Grid, Heading, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Select, Stack, Table, TableContainer, Tbody, Td, Text, Textarea, Th, Thead, Tr, useToast } from "@chakra-ui/react";
import { api } from "./api";
import { ui } from "./theme";

function AlertIntake({ rules, onClose, onIngested }) {
  const [draft, setDraft] = useState(() => ({ source: "Local demo", external_id: `demo-${crypto.randomUUID()}`, rule_id: rules.find(r => r.enabled)?.id || "", title: "", severity: "high", primary_entity: "", summary: "" }));
  const [evidenceType, setEvidenceType] = useState("domain");
  const [evidenceValue, setEvidenceValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const field = (key, value) => setDraft(current => ({ ...current, [key]: value }));
  const submit = async event => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await api.create("alerts", { ...draft, evidence: evidenceValue.trim() ? [{ type: evidenceType, value: evidenceValue.trim() }] : [] });
      onIngested(result);
    } catch (e) { setError(e.message); setBusy(false); }
  };
  return <Modal isOpen onClose={onClose} size="xl" closeOnOverlayClick={!busy} closeOnEsc={!busy}><ModalOverlay /><ModalContent as="form" onSubmit={submit}>
    <ModalHeader>Submit an alert</ModalHeader><ModalCloseButton isDisabled={busy} />
    <ModalBody><Stack spacing="16px">
      <Text fontSize="12px" color={ui.muted}>The local worker records supplied evidence and checks local indicators. It does not query external security tools.</Text>
      <Button alignSelf="start" variant="outline" onClick={() => { setDraft(current => ({ ...current, title: "Unusual outbound connection", primary_entity: "workstation-demo-01", summary: "Demo sensor reported an outbound domain connection." })); setEvidenceValue("crx-update.cloudgateway.cc"); setEvidenceType("domain"); }}>Use example alert</Button>
      <FormControl isRequired><FormLabel>Detection rule</FormLabel><Select value={draft.rule_id} onChange={e => field("rule_id", e.target.value)}><option value="">Select an enabled rule</option>{rules.filter(r => r.enabled).map(rule => <option key={rule.id} value={rule.id}>{rule.name} · {rule.routing}</option>)}</Select></FormControl>
      <Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap="12px">
        <FormControl isRequired><FormLabel>Source</FormLabel><Input maxLength={120} value={draft.source} onChange={e => field("source", e.target.value)} /></FormControl>
        <FormControl isRequired><FormLabel>Source alert ID</FormLabel><Input maxLength={200} value={draft.external_id} onChange={e => field("external_id", e.target.value)} /></FormControl>
      </Grid>
      <Text fontSize="11px" color={ui.muted}>Reuse the source alert ID for retries. Identical alerts return the original result.</Text>
      <FormControl isRequired><FormLabel>Alert title</FormLabel><Input maxLength={300} value={draft.title} onChange={e => field("title", e.target.value)} /></FormControl>
      <Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap="12px">
        <FormControl><FormLabel>Severity</FormLabel><Select value={draft.severity} onChange={e => field("severity", e.target.value)}>{["low", "medium", "high", "critical"].map(s => <option key={s}>{s}</option>)}</Select></FormControl>
        <FormControl><FormLabel>Primary entity</FormLabel><Input maxLength={500} value={draft.primary_entity} onChange={e => field("primary_entity", e.target.value)} /></FormControl>
      </Grid>
      <Grid templateColumns="140px 1fr" gap="12px"><FormControl><FormLabel>Evidence type</FormLabel><Select value={evidenceType} onChange={e => setEvidenceType(e.target.value)}>{["domain", "ip", "url", "email", "file", "entity"].map(type => <option key={type}>{type}</option>)}</Select></FormControl><FormControl><FormLabel>Evidence value</FormLabel><Input maxLength={2000} value={evidenceValue} onChange={e => setEvidenceValue(e.target.value)} /></FormControl></Grid>
      <FormControl><FormLabel>Source summary</FormLabel><Textarea maxLength={4000} value={draft.summary} onChange={e => field("summary", e.target.value)} /></FormControl>
      {error && <Alert status="error"><AlertIcon />{error}</Alert>}
    </Stack></ModalBody>
    <ModalFooter gap="12px"><Button variant="outline" isDisabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" isLoading={busy} isDisabled={!draft.rule_id || !draft.title.trim() || !draft.source.trim() || !draft.external_id.trim()}>Ingest alert</Button></ModalFooter>
  </ModalContent></Modal>;
}

export default function InvestigationQueue({ setView }) {
  const [queue, setQueue] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [rules, setRules] = useState([]);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("cases");
  const [search, setSearch] = useState("");
  const [intake, setIntake] = useState(false);
  const [version, setVersion] = useState(0);
  const toast = useToast();
  useEffect(() => {
    let active = true;
    let timer;
    const refresh = async () => {
      try {
        const [cases, received, registry] = await Promise.all([api.request("/investigation-queue"), api.list("alerts"), api.detectionRules()]);
        if (!active) return;
        setQueue(cases); setAlerts(received.items); setRules(registry.items); setError("");
      } catch (e) { if (active) setError(e.message); }
      finally { if (active) timer = setTimeout(refresh, 2000); }
    };
    refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [version]);
  const records = (tab === "cases" ? queue?.items || [] : alerts).filter(item => `${item.title} ${item.source} ${item.id} ${item.external_id || ""}`.toLowerCase().includes(search.toLowerCase()));
  return <Box p={{ base: "12px", md: "20px" }} w="100%" minW="0" className="page-enter investigation-queue">
    <Flex gap="16px" align="center" wrap="wrap" mb="14px"><Box flex="1" minW="200px"><Text color={ui.muted} fontSize="10px" letterSpacing=".1em">SECURITY OPERATIONS / ALERT INTAKE</Text><Heading fontSize="26px" mt="6px">Investigations</Heading><Text color={ui.muted} mt="8px">Follow every received alert from intake to an evidence-backed review.</Text></Box><Button isDisabled={!queue || !!error} onClick={() => setIntake(true)}>Submit alert</Button></Flex>
    <Grid templateColumns="repeat(3, minmax(0, 1fr))" gap={{ base: "6px", md: "12px" }} mb="12px">{[[queue?.summary.alerts, "Received alerts"], [queue?.summary.active_runs, "Active local runs"], [queue?.summary.open_cases, "Open investigations"]].map(([value, label]) => <Box key={label} bg="white" border="1px solid" borderColor={ui.line} p={{ base: "10px", md: "12px 16px" }} rounded="6px"><Text color={ui.muted} fontSize="11px">{label}</Text><Text fontFamily="heading" fontWeight="700" fontSize="24px" mt="2px">{value ?? "—"}</Text></Box>)}</Grid>
    <Text fontSize="11px" color={ui.muted} mb="16px">Local deterministic processing · No external tools · Outcomes require analyst review · Refreshes every 2 seconds</Text>
    {error && <Alert status="error" mb="16px"><AlertIcon />{error}. Displayed records may be stale.<Button ml="auto" variant="outline" onClick={() => setVersion(v => v + 1)}>Retry</Button></Alert>}
    <Box bg="white" border="1px solid" borderColor={ui.line} rounded="6px" overflow="hidden">
      <Flex className="queue-toolbar" p="12px" gap="8px" wrap="wrap" align="center"><Button variant={tab === "cases" ? "solid" : "ghost"} onClick={() => setTab("cases")}>Investigations</Button><Button variant={tab === "alerts" ? "solid" : "ghost"} onClick={() => setTab("alerts")}>Received alerts</Button><Input ml={{ md: "auto" }} maxW={{ base: "none", md: "300px" }} placeholder="Search title, source or ID" aria-label="Search investigations and alerts" value={search} onChange={e => setSearch(e.target.value)} /></Flex>
      <TableContainer className="queue-table"><Table size="sm"><Thead><Tr>{["Title / source", "Severity", tab === "cases" ? "Processing" : "Routing", tab === "cases" ? "Determination" : "Source alert ID", "Received", ""].map((heading, index) => <Th key={index}>{heading}</Th>)}</Tr></Thead><Tbody>{records.map(item => <Tr key={item.id}>
        <Td py="12px" maxW="440px" whiteSpace="normal" overflowWrap="anywhere"><Text fontWeight="600" whiteSpace="normal">{item.title}</Text><Text color={ui.muted} fontSize="11px" mt="5px">{item.source}</Text></Td>
        <Td data-label="Severity"><Badge colorScheme={["critical", "high"].includes(item.severity) ? "red" : "yellow"}>{item.severity}</Badge></Td>
        <Td data-label={tab === "cases" ? "Processing" : "Routing"}><Badge colorScheme={item.run_status === "completed" ? "green" : item.run_status === "failed" ? "red" : "gray"}>{tab === "cases" ? item.run_status || "Manual case" : item.disposition.replaceAll("_", " ")}</Badge>{item.run_status && <Text fontSize="10px" mt="4px" color={ui.muted}>{item.run_phase}/3 steps</Text>}</Td>
        <Td data-label={tab === "cases" ? "Determination" : "Source alert ID"} whiteSpace="normal" overflowWrap="anywhere" fontSize="12px">{tab === "cases" ? item.determination : item.external_id}</Td><Td data-label="Received" fontSize="11px" color={ui.muted}>{new Date(item.created_at).toLocaleString()}</Td>
        <Td>{(tab === "cases" || item.investigation_id) && <Button variant="outline" onClick={() => setView("investigationDetail", tab === "cases" ? item.id : item.investigation_id)}>Open case</Button>}</Td>
      </Tr>)}</Tbody></Table></TableContainer>
      {!records.length && <Text p="30px" color={ui.muted}>{queue ? "No matching records." : "Loading investigations…"}</Text>}
      <Text px="16px" py="12px" bg={ui.soft} fontSize="11px" color={ui.muted}>Showing {records.length} records from the latest 100 {tab === "cases" ? "investigations" : "alerts"}.</Text>
    </Box>
    {intake && <AlertIntake rules={rules} onClose={() => setIntake(false)} onIngested={result => {
      setIntake(false); setVersion(v => v + 1);
      toast({ title: result.duplicate ? "Existing alert returned" : "Alert received", description: result.alert.investigation_id ? "Opening the investigation." : `Routing outcome: ${result.alert.disposition.replaceAll("_", " ")}`, status: "success", duration: 3000 });
      if (result.alert.investigation_id) setView("investigationDetail", result.alert.investigation_id);
    }} />}
  </Box>;
}
