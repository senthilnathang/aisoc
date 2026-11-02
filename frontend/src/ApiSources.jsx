import WorkspaceHeader from "./WorkspaceHeader";
import RecordsTable from "./components/RecordsTable";
import React, { useEffect, useState } from "react";
import { Alert, AlertIcon, Badge, Box, Button, Flex, FormControl, FormLabel, Grid, Heading, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Select, Stack, Text, Textarea, useToast } from "@chakra-ui/react";
import { api } from "./api";
import { ui } from "./theme";

export default function ApiSources({ setView }) {
  const [sources, setSources] = useState([]);
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: "", provider: "custom", rule_id: "", expires_in_days: 30 });
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [mappingSource, setMappingSource] = useState(null);
  const [mappingText, setMappingText] = useState("");
  const [sampleText, setSampleText] = useState("");
  const [mappingPreview, setMappingPreview] = useState(null);
  const [mappingBusy, setMappingBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [total, setTotal] = useState(0);
  const [listError, setListError] = useState("");
  const [offset,setOffset]=useState(0),[limit,setLimit]=useState(25),[ruleSearch,setRuleSearch]=useState(""),[ruleOffset,setRuleOffset]=useState(0),[ruleOptions,setRuleOptions]=useState([]),[ruleLoading,setRuleLoading]=useState(false),[ruleError,setRuleError]=useState("");
  const toast = useToast();
  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([api.list("api-sources",{limit,offset}), api.detectionRules()]).then(([result, registry]) => {
      if (!active) return;
      setRules(registry.items); setListError("");
      // A changed result set can leave the offset past the last page; return to the first page.
      if (offset > 0 && result.total <= offset) { setOffset(0); return; }
      setSources(result.items); setTotal(result.total);
    }).catch(e => { if (active) { setSources([]); setTotal(0); setListError(e.message); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [version,offset,limit]);
  useEffect(()=>{if(!creating)return;let active=true;setRuleLoading(true);setRuleError("");api.detectionRules({search:ruleSearch,limit:25,offset:ruleOffset}).then(result=>{if(active)setRuleOptions(result.items)}).catch(e=>{if(active){setRuleOptions([]);setRuleError(e.message)}}).finally(()=>{if(active)setRuleLoading(false)});return()=>{active=false}},[creating,ruleSearch,ruleOffset]);
  const create = async event => {
    event.preventDefault(); setBusy(true); setError("");
    try { setReceipt(await api.create("api-sources", draft)); setCreating(false); setVersion(v => v + 1); setDraft({ name: "", provider: "custom", rule_id: "", expires_in_days: 30 }); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const changeKey = async () => {
    setBusy(true);
    try {
      const result = await api.action("api-sources", confirm.source.id, confirm.action === "rotate" ? "rotate-key" : "revoke", confirm.action === "rotate" ? { expires_in_days: 30 } : undefined);
      if (confirm.action === "rotate") setReceipt(result);
      else toast({ title: "Source key revoked", status: "success", duration: 2500 });
      setConfirm(null); setVersion(v => v + 1); setError("");
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const openMapping = source => {
    const initial = Object.keys(source.mapping?.fields || {}).length ? source.mapping : {
      fields: { external_id: "event.id", title: "event.name", severity: "event.severity", category: "event.category", primary_entity: "event.host", evidence: "event.indicators" },
      severity_map: { sev1: "critical", sev2: "high", sev3: "medium", sev4: "low" }
    };
    setMappingSource(source); setMappingText(JSON.stringify(initial, null, 2));
    setSampleText(JSON.stringify({ event: { id: "evt-001", name: "Suspicious process execution", severity: "Sev2", category: "endpoint", host: "workstation-01", indicators: [{ type: "file", value: "sample.exe", label: "Image name" }] } }, null, 2));
    setMappingPreview(null);
  };
  const previewMapping = async () => {
    setMappingBusy(true); setMappingPreview(null);
    try {
      const mapping = JSON.parse(mappingText), sample = JSON.parse(sampleText);
      const result = await api.request(`/api-sources/${encodeURIComponent(mappingSource.id)}/mapping/preview`, { method: "POST", body: { mapping, sample } });
      setMappingPreview(result);
    } catch (e) { setMappingPreview({ valid: false, errors: [e instanceof SyntaxError ? "Mapping and sample must be valid JSON." : e.message] }); }
    finally { setMappingBusy(false); }
  };
  const saveMapping = async () => {
    setMappingBusy(true);
    try {
      const result = await api.request(`/api-sources/${encodeURIComponent(mappingSource.id)}/mapping`, { method: "PATCH", body: { mapping: JSON.parse(mappingText) } });
      setMappingSource(result); setVersion(v => v + 1); setError("");
      toast({ title: "Event mapping saved", status: "success", duration: 2500 });
    } catch (e) { setError(e instanceof SyntaxError ? "Mapping must be valid JSON." : e.message); }
    finally { setMappingBusy(false); }
  };
  const columns = [
    { id: "name", header: "Source", render: source => <><Text fontWeight="600">{source.name}</Text><Text fontSize="11px" color={ui.muted} mt="4px">{source.provider}</Text></> },
    { id: "rule", header: "Detection rule", render: source => <Text whiteSpace="normal">{rules.find(rule => rule.id === source.rule_id)?.name || source.rule_id}</Text> },
    { id: "mapping", header: "Mapping", render: source => <Flex align="center" gap="8px" wrap="wrap"><Badge colorScheme={Object.keys(source.mapping?.fields || {}).length ? "green" : "gray"}>{Object.keys(source.mapping?.fields || {}).length ? "Configured" : "Not set"}</Badge><Button size="xs" variant="outline" onClick={() => openMapping(source)}>Map events</Button></Flex> },
    { id: "status", header: "Key status", render: source => <Badge colorScheme={source.status === "active" ? "green" : "gray"}>{source.status}</Badge> },
    { id: "expires", header: "Expires", render: source => <Text fontSize="11px">{new Date(source.expires_at).toLocaleString()}</Text> },
    { id: "actions", header: "Actions", render: source => <Flex gap="8px" wrap="wrap"><Button variant="outline" onClick={() => setConfirm({ action: "rotate", source })}>Rotate key</Button><Button variant="ghost" isDisabled={source.status === "revoked"} onClick={() => setConfirm({ action: "revoke", source })}>Revoke</Button></Flex> },
  ];
  const example = receipt ? JSON.stringify({ external_id: "provider-event-001", title: "Unusual outbound connection", severity: "high", primary_entity: "workstation-01", evidence: [{ type: "domain", value: "example.test" }] }, null, 2) : "";
  return <Box p={{ base: "16px", md: "28px" }} maxW="1400px" mx="auto" className="page-enter">
    <WorkspaceHeader align="center" gap="12px" wrap="wrap" mb="24px"><Box flex="1"><Text color={ui.muted} fontSize="10px" letterSpacing=".1em">BUILD / PROVIDER-NEUTRAL INTAKE</Text><Heading as="h1" fontSize="26px" mt="6px">API sources</Heading><Text color={ui.muted} mt="8px">Connect cloud, on-premises, and custom systems through a shared alert API.</Text></Box><Button variant="outline" onClick={() => setView("streamOperations")}>Stream operations</Button><Button variant="outline" onClick={() => setView("investigations")}>Investigations</Button><Button isDisabled={loading} onClick={() => { setError(""); setRuleSearch(""); setRuleOffset(0); setCreating(true); }}>Add API source</Button></WorkspaceHeader>
    <Box p="20px" rounded="6px" bg="white" border="1px solid" borderColor={ui.line} mb="20px"><Heading fontSize="15px">One source. One rule. One scoped key.</Heading><Text mt="8px" color={ui.muted}>Each key can submit alerts only to its own endpoint. It cannot read cases or change workspace settings. Configure and preview a native event mapping here, or keep sending normalized alerts directly.</Text></Box>
    {error && !creating && <Alert status="error" mb="16px"><AlertIcon />{error}</Alert>}
    <RecordsTable
      caption="API sources"
      recordLabel="sources"
      pageSizeLabel="API sources per page"
      columns={columns}
      records={sources}
      rowKey="id"
      total={total}
      offset={offset}
      limit={limit}
      onPageChange={setOffset}
      onPageSizeChange={size => { setLimit(size); setOffset(0); }}
      loading={loading}
      error={listError}
      onRetry={() => setVersion(v => v + 1)}
      paginationDisabled={busy}
      emptyContent="No API sources yet. Add a source to issue its first ingestion key."
    />
    {mappingSource && <Box mt="18px" p={{ base: "14px", md: "20px" }} bg="white" border="1px solid" borderColor={ui.line} rounded="6px" minW="0">
      <Flex justify="space-between" gap="12px" wrap="wrap" align="start" mb="14px"><Box><Text color={ui.muted} fontSize="10px" letterSpacing=".08em">NATIVE EVENT MAPPING</Text><Heading fontSize="17px" mt="4px">{mappingSource.name}</Heading><Text mt="5px" color={ui.muted} fontSize="12px">Map dot paths from the provider event to normalized alert fields. Preview does not save or ingest the sample.</Text></Box><Button size="sm" variant="ghost" onClick={() => { setMappingSource(null); setMappingPreview(null); }}>Close</Button></Flex>
      <Grid templateColumns={{ base: "minmax(0, 1fr)", xl: "repeat(2, minmax(0, 1fr))" }} gap="12px">
        <FormControl minW="0"><FormLabel fontSize="11px" fontWeight="600">Field mapping JSON</FormLabel><Textarea aria-label="Field mapping JSON" value={mappingText} onChange={e => { setMappingText(e.target.value); setMappingPreview(null); }} minH="290px" fontFamily="mono" fontSize="11px" spellCheck={false} /></FormControl>
        <FormControl minW="0"><FormLabel fontSize="11px" fontWeight="600">Sample native event JSON</FormLabel><Textarea aria-label="Sample native event JSON" value={sampleText} onChange={e => { setSampleText(e.target.value); setMappingPreview(null); }} minH="290px" fontFamily="mono" fontSize="11px" spellCheck={false} /></FormControl>
      </Grid>
      <Flex gap="8px" wrap="wrap" mt="12px"><Button variant="outline" isLoading={mappingBusy} onClick={previewMapping}>Validate and preview</Button><Button isLoading={mappingBusy} isDisabled={!mappingPreview?.valid} onClick={saveMapping}>Save mapping</Button></Flex>
      {mappingPreview && <Box mt="14px"><Alert status={mappingPreview.valid ? "success" : "error"} alignItems="start"><AlertIcon mt="2px" /><Stack spacing="5px"><Text fontWeight="600">{mappingPreview.valid ? "Sample maps successfully" : "Mapping needs changes"}</Text>{mappingPreview.errors?.map((message, index) => <Text key={index} fontSize="12px">{message}</Text>)}</Stack></Alert>{mappingPreview.normalized_alert && <Box as="pre" mt="10px" p="12px" bg={ui.nav} color="white" rounded="4px" fontSize="11px" whiteSpace="pre-wrap" overflowWrap="anywhere">{JSON.stringify(mappingPreview.normalized_alert, null, 2)}</Box>}</Box>}
      <Text mt="12px" color={ui.muted} fontSize="11px">Required mappings: external_id, title, severity. Optional fields include summary, category, alert_type, primary_entity, evidence and insight_refs. Map unrecognized provider severities with severity_map.</Text>
    </Box>}
    <Text color={ui.muted} fontSize="11px" mt="12px">Key values are shown only when issued; they cannot be retrieved later.</Text>
    <Modal isOpen={creating} onClose={() => setCreating(false)} closeOnOverlayClick={!busy} closeOnEsc={!busy}><ModalOverlay /><ModalContent as="form" onSubmit={create}><ModalHeader>Add API source</ModalHeader><ModalCloseButton isDisabled={busy} /><ModalBody><Stack spacing="16px">
      <FormControl isRequired><FormLabel>Source name</FormLabel><Input maxLength={200} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></FormControl>
      <FormControl isRequired><FormLabel>Provider label</FormLabel><Input maxLength={100} value={draft.provider} onChange={e => setDraft({ ...draft, provider: e.target.value })} placeholder="Custom, Sentinel, Splunk…" /></FormControl>
      <FormControl><FormLabel>Search detection rules</FormLabel><Input aria-label="Search detection rules" value={ruleSearch} onChange={e=>{setRuleSearch(e.target.value);setRuleOffset(0);setDraft(current=>({...current,rule_id:""}));}} /></FormControl>
      {ruleError && <Alert status="error"><AlertIcon />{ruleError}</Alert>}
      <FormControl isRequired><FormLabel>Detection rule</FormLabel><Select isDisabled={ruleLoading} value={draft.rule_id} onChange={e => setDraft({ ...draft, rule_id: e.target.value })}><option value="">Select a rule</option>{ruleOptions.map(rule => <option key={rule.id} value={rule.id}>{rule.name}{rule.enabled ? "" : " (disabled)"}</option>)}</Select></FormControl>
      <Flex gap="8px"><Button variant="outline" isDisabled={ruleLoading||!ruleOffset} onClick={()=>{setRuleOffset(Math.max(0,ruleOffset-25));setDraft(current=>({...current,rule_id:""}));}}>Previous rules</Button><Button variant="outline" isDisabled={ruleLoading||ruleOptions.length<25} onClick={()=>{setRuleOffset(ruleOffset+25);setDraft(current=>({...current,rule_id:""}));}}>Next rules</Button></Flex>
      <FormControl><FormLabel>Key validity (days)</FormLabel><Input type="number" min={1} max={365} value={draft.expires_in_days} onChange={e => setDraft({ ...draft, expires_in_days: Number(e.target.value) })} /></FormControl>
      {error && <Alert status="error"><AlertIcon />{error}</Alert>}
    </Stack></ModalBody><ModalFooter gap="12px"><Button variant="outline" isDisabled={busy} onClick={() => setCreating(false)}>Cancel</Button><Button type="submit" isLoading={busy} isDisabled={ruleLoading || !!ruleError || !draft.name.trim() || !draft.provider.trim() || !draft.rule_id}>Create source</Button></ModalFooter></ModalContent></Modal>
    <Modal isOpen={!!confirm} onClose={() => setConfirm(null)} closeOnOverlayClick={!busy} closeOnEsc={!busy}><ModalOverlay /><ModalContent><ModalHeader>{confirm?.action === "rotate" ? "Rotate ingestion key?" : "Revoke ingestion key?"}</ModalHeader><ModalCloseButton isDisabled={busy} /><ModalBody><Text>The current key for <b>{confirm?.source.name}</b> will stop working immediately.{confirm?.action === "rotate" ? " A replacement key valid for 30 days will be shown once. Update your sender to use it." : " Existing alerts and investigations are retained."}</Text>{error && <Alert status="error" mt="12px"><AlertIcon />{error}</Alert>}</ModalBody><ModalFooter gap="12px"><Button variant="outline" isDisabled={busy} onClick={() => setConfirm(null)}>Cancel</Button><Button isLoading={busy} onClick={changeKey}>Confirm {confirm?.action}</Button></ModalFooter></ModalContent></Modal>
    <Modal isOpen={!!receipt} onClose={() => setReceipt(null)} size="xl"><ModalOverlay /><ModalContent><ModalHeader>Save the ingestion key</ModalHeader><ModalCloseButton /><ModalBody><Stack spacing="14px"><Text>This key is shown once. Store it in your sender's secret manager. Closing this window removes it from the page.</Text><FormControl><FormLabel>Ingestion key</FormLabel><Input type="password" value={receipt?.api_key || ""} isReadOnly autoComplete="off" /></FormControl><Button variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(receipt.api_key); toast({ title: "Key copied", status: "success", duration: 2000 }); } catch { setError("Clipboard unavailable. Select and copy the key field directly."); } }}>Copy key</Button><Text fontSize="12px" fontWeight="600">POST {receipt?.source.intake_path} (normalized alerts)</Text><Text fontSize="12px">Authorization: Bearer &lt;ingestion-key&gt;<br />Content-Type: application/json</Text><Box as="pre" bg={ui.nav} color="white" p="16px" rounded="5px" fontSize="11px" whiteSpace="pre-wrap">{example}</Box><Text fontSize="12px" fontWeight="600">POST {receipt?.source.native_intake_path} (after saving a mapping)</Text><Text fontSize="11px" color={ui.muted}>Native event payloads are mapped server-side. Preview and save a mapping from the source list before using this endpoint.</Text><Text fontSize="11px" color={ui.muted}>Use the same external_id for retries. The source's tenant and rule are determined by the key, not by payload fields.</Text></Stack></ModalBody><ModalFooter><Button onClick={() => setReceipt(null)}>I have saved the key</Button></ModalFooter></ModalContent></Modal>
  </Box>;
}
