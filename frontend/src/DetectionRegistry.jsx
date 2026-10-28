import React, { useEffect, useState } from "react";
import { Alert, AlertIcon, Badge, Box, Button, Flex, FormControl, FormLabel, Grid, Heading, Input, Select, Stack, Text, Textarea } from "@chakra-ui/react";
import { api } from "./api";
import { ui } from "./theme";
import CreateDetectionRule from "./CreateDetectionRule";

const fields = ["name", "description", "severity", "execution_mode", "enabled", "query", "schedule", "lookback_window", "routing", "mitre_techniques"];
const Panel = ({ children, ...props }) => <Box bg="white" border="1px solid" borderColor={ui.line} rounded="5px" minW="0" {...props}>{children}</Box>;
const Status = ({ rule }) => <Badge colorScheme={rule.enabled ? "green" : "gray"}>{rule.enabled ? "Enabled" : "Disabled"}</Badge>;
const when = value => value ? new Date(value).toLocaleString() : "No received alerts";

export function RuleWorkspace({ id, onClose, onChanged, onSelect, standalone = false }) {
  const [rule, setRule] = useState(null);
  const [draft, setDraft] = useState(null);
  const [tab, setTab] = useState("Overview");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setRule(null); setError(""); setEditing(false); setConfirmDelete(false); setTab("Overview");
    api.get("detection-rules", id).then(result => { if (active) { setRule(result); setDraft(result); } }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [id, revision]);
  const act = async work => {
    setBusy(true); setError("");
    try { await work(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const save = async e => {
    e.preventDefault();
    await act(async () => {
      await api.update("detection-rules", id, { ...Object.fromEntries(fields.map(key => [key, draft[key]])), mitre_techniques: (draft.techniques_text ?? draft.mitre_techniques.join(",")).split(",").map(v => v.trim()).filter(Boolean), expected_version: rule.version });
      setRule(await api.get("detection-rules", id)); setEditing(false); onChanged();
    });
  };
  const update = (key, value) => setDraft(current => ({ ...current, [key]: value }));
  return <Panel className="rule-workspace" aria-label="Rule details" p="16px" overflowWrap="anywhere">
    <Flex align="center" gap="8px" mb="12px"><Text color={ui.muted} fontSize="10px" letterSpacing=".08em" flex="1">{standalone ? "DETECTION RULE" : "RULE INSPECTOR"}</Text><Button variant="ghost" isDisabled={busy} onClick={onClose}>{standalone ? "Back to registry" : "Close"}</Button></Flex>
    {error && <Alert status="error" mb="12px"><AlertIcon /><Box flex="1">{error}</Box><Button variant="outline" isDisabled={busy} onClick={() => setRevision(v => v + 1)}>Reload</Button></Alert>}
    {!rule ? <Text role="status">{error ? "Rule unavailable." : "Loading rule…"}</Text> : <>
      <Flex gap="8px" align="center" wrap="wrap"><Status rule={rule} /><Badge>{rule.severity}</Badge><Text color={ui.muted} fontSize="11px">Version {rule.version}</Text></Flex>
      <Heading fontSize="20px" mt="12px">{rule.name}</Heading><Text color={ui.muted} fontSize="10px" mt="6px">{rule.id}</Text>
      <Grid templateColumns="repeat(3, minmax(0, 1fr))" gap="8px" my="16px">{[[rule.detections, "Received alerts"], [rule.investigations, "Linked cases"], ["—", "FPR · Not assessed"]].map(([value, label]) => <Box bg={ui.soft} rounded="4px" p="10px" key={label}><Text fontSize="22px" fontWeight="700">{value}</Text><Text fontSize="10px" color={ui.muted}>{label}</Text></Box>)}</Grid>
      <Flex gap="6px" wrap="wrap" mb="14px"><Button isDisabled={busy || editing} variant="outline" onClick={() => act(async () => { await api.update("detection-rules", id, { enabled: !rule.enabled, expected_version: rule.version }); setRule(await api.get("detection-rules", id)); onChanged(); })}>{rule.enabled ? "Disable" : "Enable"}</Button><Button isDisabled={busy || editing} variant="outline" onClick={() => act(async () => { const clone = await api.action("detection-rules", id, "clone"); onChanged(); onSelect(clone.id); })}>Clone rule</Button><Button isDisabled={busy || editing} onClick={() => { setDraft(rule); setEditing(true); setConfirmDelete(false); }}>Edit rule</Button>{!standalone && <Button as="a" variant="ghost" href={`/detect/rules/${encodeURIComponent(id)}`}>Full page ↗</Button>}</Flex>
      {editing ? <Box as="form" onSubmit={save}><Stack spacing="12px">
        <FormControl isRequired><FormLabel>Rule name</FormLabel><Input maxLength={200} value={draft.name} onChange={e => update("name", e.target.value)} /></FormControl>
        <FormControl><FormLabel>Description</FormLabel><Textarea maxLength={4000} value={draft.description} onChange={e => update("description", e.target.value)} /></FormControl>
        <Grid templateColumns="repeat(2, minmax(0, 1fr))" gap="10px"><FormControl><FormLabel>Severity</FormLabel><Select value={draft.severity} onChange={e => update("severity", e.target.value)}>{["low", "medium", "high", "critical"].map(v => <option key={v}>{v}</option>)}</Select></FormControl><FormControl><FormLabel>Execution mode</FormLabel><Select value={draft.execution_mode} onChange={e => update("execution_mode", e.target.value)}>{["scheduled", "realtime"].map(v => <option key={v}>{v}</option>)}</Select></FormControl></Grid>
        <FormControl><FormLabel>MITRE techniques (comma separated)</FormLabel><Input value={draft.techniques_text ?? draft.mitre_techniques.join(", ")} onChange={e => update("techniques_text", e.target.value)} /></FormControl>
        <FormControl><FormLabel>Detection query</FormLabel><Textarea rows={8} maxLength={20000} fontFamily="mono" value={draft.query} onChange={e => update("query", e.target.value)} /></FormControl>
        <Grid templateColumns="repeat(2, minmax(0, 1fr))" gap="10px"><FormControl isRequired><FormLabel>Schedule</FormLabel><Input maxLength={120} value={draft.schedule} onChange={e => update("schedule", e.target.value)} /></FormControl><FormControl isRequired><FormLabel>Lookback window</FormLabel><Input maxLength={120} value={draft.lookback_window} onChange={e => update("lookback_window", e.target.value)} /></FormControl></Grid>
        <FormControl><FormLabel>Alert routing</FormLabel><Select value={draft.routing} onChange={e => update("routing", e.target.value)}>{["Investigate", "Sample (10%)", "Suppress", "Escalate"].map(v => <option key={v}>{v}</option>)}</Select></FormControl>
        <Text fontSize="11px" color={ui.muted}>Query and schedule are registry configuration. Enabling permits local alert intake; it does not start an external query engine.</Text>
        <Flex gap="8px"><Button type="submit" isLoading={busy} isDisabled={!draft.name.trim()}>Save changes</Button><Button variant="outline" isDisabled={busy} onClick={() => setEditing(false)}>Cancel</Button></Flex>
      </Stack></Box> : <>
        <Flex role="tablist" aria-label="Rule sections" borderBottom="1px solid" borderColor={ui.line} overflowX="auto" mb="16px">{["Overview", "Logic", "Versions", "History"].map(value => <Button key={value} role="tab" aria-selected={tab === value} flexShrink={0} variant="ghost" borderRadius="0" borderBottom="2px solid" borderColor={tab === value ? ui.ink : "transparent"} onClick={() => setTab(value)}>{value}</Button>)}</Flex>
        {tab === "Overview" && <Stack spacing="14px"><Text>{rule.description || "No description recorded."}</Text><Box><Text fontSize="10px" color={ui.muted}>ATT&CK TECHNIQUES</Text><Flex gap="6px" wrap="wrap" mt="6px">{rule.mitre_techniques.length ? rule.mitre_techniques.map(v => <Badge key={v}>{v}</Badge>) : <Text>No techniques mapped.</Text>}</Flex></Box><Box><Text fontSize="10px" color={ui.muted}>SOURCES</Text>{rule.bindings.map(s => <Text key={s.id} mt="4px">{s.name} <Badge>{s.provider}</Badge></Text>)}{rule.sources.map(s => <Text key={s} color={ui.muted} fontSize="11px" mt="4px">{s}</Text>)}{!rule.sources.length && !rule.bindings.length && <Text>No source connected.</Text>}</Box><Box><Text fontSize="10px" color={ui.muted}>INVESTIGATION OUTCOMES · ALL TIME</Text><Flex gap="8px" wrap="wrap" mt="6px">{rule.outcomes.map(o => <Badge key={o.determination}>{o.determination}: {o.count}</Badge>)}{!rule.outcomes.length && <Text>No linked cases yet.</Text>}</Flex></Box><Text fontSize="12px">Routing: <b>{rule.routing}</b> · Suppressed alerts: {rule.suppressed}</Text><Text fontSize="11px" color={ui.muted}>Last received: {when(rule.last_activity_at)}</Text><Text fontSize="11px" color={ui.muted}>Counts use stored alerts and linked investigations, across all time. Unknown outcomes and benign determinations are not treated as explicit false-positive labels.</Text></Stack>}
        {tab === "Logic" && <Stack spacing="12px"><Text>{rule.execution_mode} · {rule.schedule} · Lookback: {rule.lookback_window}</Text><Box as="pre" bg={ui.nav} color="white" p="14px" rounded="4px" whiteSpace="pre-wrap" overflowWrap="anywhere" fontSize="12px">{rule.query || "No query configured."}</Box><Text color={ui.muted} fontSize="11px">Stored configuration only. No external detection engine executes this query.</Text></Stack>}
        {tab === "Versions" && <Stack spacing="10px">{rule.versions.map((v, index) => <Box as="details" key={v.version} border="1px solid" borderColor={ui.line} rounded="4px" p="12px"><Box as="summary" cursor="pointer" fontWeight="600">Version {v.version} {index === 0 ? "· Current" : ""}<Text as="span" display="block" color={ui.muted} fontWeight="400" fontSize="10px">{when(v.created_at)}</Text></Box><Box as="pre" whiteSpace="pre-wrap" overflowWrap="anywhere" fontSize="11px" mt="12px">{JSON.stringify(v.snapshot, null, 2)}</Box></Box>)}</Stack>}
        {tab === "History" && <Stack spacing="0">{rule.history.length ? rule.history.map(h => <Box key={h.id} py="12px" borderBottom="1px solid" borderColor={ui.line}><Text fontWeight="600">{h.action.replaceAll("_", " ")}</Text><Text color={ui.muted} fontSize="11px">{h.details.fields?.filter(f => f !== "expected_version").join(", ") || h.details.source_rule_id || "Registry change"}</Text><Text color={ui.muted} fontSize="10px">{when(h.created_at)}</Text></Box>) : <Text color={ui.muted}>No recorded changes.</Text>}</Stack>}
        <Box mt="24px" pt="14px" borderTop="1px solid" borderColor={ui.line}>{confirmDelete ? <><Text mb="10px">Delete this rule? Rules referenced by alerts or API sources cannot be deleted.</Text><Flex gap="8px"><Button colorScheme="red" isLoading={busy} onClick={() => act(async () => { await api.remove("detection-rules", id); onChanged(); onClose(); })}>Confirm delete</Button><Button variant="outline" isDisabled={busy} onClick={() => setConfirmDelete(false)}>Cancel</Button></Flex></> : <Button variant="ghost" color="red.600" isDisabled={busy} onClick={() => setConfirmDelete(true)}>Delete rule</Button>}</Box>
      </>}
    </>}
  </Panel>;
}

export default function DetectionRegistry({ setView, templates }) {
  const [filters, setFilters] = useState({ search: "", severity: "", enabled: "", source: "", sort: "updated_at", direction: "desc", limit: 25, offset: 0 });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision(v => v + 1);
  const filter = (key, value) => setFilters(current => ({ ...current, [key]: value, offset: 0 }));
  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => api.list("detection-registry", filters).then(result => {
      if (!active) return;
      if (result.total && filters.offset >= result.total) { setFilters(current => ({ ...current, offset: 0 })); return; }
      setData(result); setError("");
    }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); }), 200);
    return () => { active = false; clearTimeout(timer); };
  }, [filters, revision]);
  const select = id => {
    if (window.matchMedia("(max-width: 1199px)").matches) setView("detectionRuleDetail", id);
    else setSelected(id);
  };
  return <Box className="page-enter detection-registry" p={{ base: "12px", md: "20px" }}>
    <Flex align="center" gap="12px" wrap="wrap" mb="16px"><Box flex="1" minW="200px"><Text fontSize="10px" color={ui.muted} letterSpacing=".1em">DETECT / RULE REGISTRY</Text><Heading fontSize="26px" mt="4px">Detection rules</Heading><Text color={ui.muted} fontSize="12px" mt="6px">Manage detection logic, alert routing, and the evidence behind each rule.</Text></Box><Button variant="outline" onClick={() => setView("detectionIntelligence")}>Intelligence</Button><Button variant="outline" onClick={() => setView("apiSources")}>API sources</Button><Button onClick={() => setCreating(true)}>Create rule</Button></Flex>
    <Grid templateColumns={{ base: "minmax(0, 1fr)", xl: selected ? "minmax(0, 1fr) minmax(390px, 36%)" : "minmax(0, 1fr)" }} alignItems="start" gap="16px">
      <Panel overflow="hidden">
        <Flex gap="8px" p="12px" wrap="wrap" borderBottom="1px solid" borderColor={ui.line}>
          <Input flex="1 1 220px" aria-label="Search detection rules" placeholder="Search name, description or rule ID" value={filters.search} onChange={e => filter("search", e.target.value)} maxLength={200} />
          <Select w="auto" aria-label="Filter severity" value={filters.severity} onChange={e => filter("severity", e.target.value)}><option value="">All severities</option>{["critical", "high", "medium", "low"].map(v => <option key={v}>{v}</option>)}</Select>
          <Select w="auto" aria-label="Filter status" value={filters.enabled} onChange={e => filter("enabled", e.target.value)}><option value="">All statuses</option><option value="true">Enabled</option><option value="false">Disabled</option></Select>
          <Select maxW="240px" w="auto" aria-label="Filter source" value={filters.source} onChange={e => filter("source", e.target.value)}><option value="">All sources</option>{data?.sources.map(v => <option key={v}>{v}</option>)}</Select>
          <Select w="auto" aria-label="Sort rules" value={filters.sort} onChange={e => filter("sort", e.target.value)}>{[["updated_at", "Last edited"], ["name", "Rule name"], ["severity", "Severity"], ["detections", "Received alerts"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>
          <Button variant="outline" aria-label="Reverse sort direction" onClick={() => filter("direction", filters.direction === "asc" ? "desc" : "asc")}>{filters.direction === "asc" ? "↑ Ascending" : "↓ Descending"}</Button>
          <Button variant="ghost" onClick={() => setFilters({ search: "", severity: "", enabled: "", source: "", sort: "updated_at", direction: "desc", limit: 25, offset: 0 })}>Reset</Button>
        </Flex>
        <Flex p="12px" justify="space-between" gap="8px"><Text fontSize="11px" color={ui.muted}>{data?.total ?? "—"} matching rules · Counts from received alerts, all time</Text><Button size="xs" variant="ghost" onClick={refresh} isDisabled={loading}>Refresh</Button></Flex>
        {error && <Alert status="error"><AlertIcon />{error}. Refresh to retry.</Alert>}
        {loading ? <Text p="24px" role="status">Loading registry…</Text> : !error && <>
          <Box className="registry-row registry-head"><Text>Rule / source</Text><Text>Status</Text><Text>Severity</Text><Text>Alerts / cases</Text><Text>Routing</Text></Box>
          {data?.items.map(rule => <Box className="registry-row" key={rule.id} bg={selected === rule.id ? "#f0f2fa" : "white"}>
            <Box minW="0"><Button variant="link" color={ui.ink} textAlign="left" whiteSpace="normal" justifyContent="start" h="auto" lineHeight="1.5" onClick={() => select(rule.id)}>{rule.name}</Button><Text fontSize="10px" color={ui.muted} mt="5px" overflowWrap="anywhere">{[...new Set([...rule.bindings.map(s => s.provider), ...rule.sources.filter(s => !s.startsWith("api-source:"))])].join(" · ") || "No source connected"}</Text><Text color={ui.muted} fontSize="10px" mt="3px">{rule.mitre_techniques.join(" · ") || "No ATT&CK mapping"} · v{rule.version}</Text></Box>
            <Box data-label="Status"><Status rule={rule} /></Box><Box data-label="Severity"><Badge colorScheme={["high", "critical"].includes(rule.severity) ? "red" : "yellow"}>{rule.severity}</Badge></Box><Text data-label="Alerts / cases" fontSize="13px">{rule.detections} / {rule.investigations}</Text><Text data-label="Routing" fontSize="11px">{rule.routing}</Text>
          </Box>)}
          {!data?.items.length && <Box p="32px"><Heading fontSize="16px">No matching rules</Heading><Text color={ui.muted} mt="8px">Adjust the filters or create a detection rule.</Text></Box>}
        </>}
        <Flex p="12px" gap="10px" align="center" wrap="wrap" borderTop="1px solid" borderColor={ui.line}><Text flex="1" fontSize="11px" color={ui.muted}>{data?.total ? `${data.offset + 1}–${Math.min(data.offset + data.limit, data.total)} of ${data.total}` : "0 rules"}</Text><Select w="auto" aria-label="Rules per page" value={filters.limit} onChange={e => filter("limit", Number(e.target.value))}>{[10,25,50,100].map(v => <option key={v} value={v}>{v} / page</option>)}</Select><Button variant="outline" isDisabled={loading || !!error || filters.offset === 0} onClick={() => setFilters(f => ({ ...f, offset: Math.max(0, f.offset - f.limit) }))}>Previous</Button><Button variant="outline" isDisabled={loading || !!error || !data || filters.offset + filters.limit >= data.total} onClick={() => setFilters(f => ({ ...f, offset: f.offset + f.limit }))}>Next</Button></Flex>
      </Panel>
      {selected && <RuleWorkspace key={selected} id={selected} onClose={() => setSelected(null)} onChanged={refresh} onSelect={select} />}
    </Grid>
    {creating && <CreateDetectionRule templates={templates} onClose={() => setCreating(false)} onCreated={rule => { refresh(); select(rule.id); }} />}
  </Box>;
}
