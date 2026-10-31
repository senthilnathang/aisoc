import React, { useEffect, useRef, useState } from "react";
import { Alert, AlertIcon, Badge, Box, Button, Flex, FormControl, FormLabel, Grid, Heading, Input, Select, Stack, Text, Textarea } from "@chakra-ui/react";
import { api } from "./api";
import { ui } from "./theme";
import CreateDetectionRule from "./CreateDetectionRule";
import RuleMetrics from "./RuleMetrics";
import RuleCatalog from "./RuleCatalog";
import { useRuleNavigation } from "./ruleNavigation";
import './detection-rules.css';

const fields = ["name", "description", "severity", "execution_mode", "enabled", "query", "schedule", "lookback_window", "routing", "mitre_techniques"];
const Panel = React.forwardRef(function Panel({ children, ...props }, ref) { return <Box ref={ref} bg="white" border="1px solid" borderColor={ui.line} rounded="5px" minW="0" {...props}>{children}</Box>; });
const Status = ({ rule }) => <Badge colorScheme={rule.enabled ? "green" : "gray"}>{rule.enabled ? "Enabled" : "Disabled"}</Badge>;
const when = value => value ? new Date(value).toLocaleString() : "No received alerts";

export function RuleWorkspace({ id, onClose, onChanged, onSelect, standalone = false }) {
  const [rule, setRule] = useState(null);
  const [draft, setDraft] = useState(null);
  const { tab, filters: { days }, navigate } = useRuleNavigation();
  const [metrics, setMetrics] = useState(null);
  const [metricsError,setMetricsError]=useState(""), [metricsRetry,setMetricsRetry]=useState(0);
  const panelRef=useRef(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setRule(null); setError(""); setEditing(false); setConfirmDelete(false);
    api.get("detection-rules", id).then(result => { if (active) { setRule(result); setDraft(result); } }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [id, revision]);
  useEffect(()=>{
    const controller=new AbortController();setMetrics(null);setMetricsError("");
    api.request(`/detection-rules/${encodeURIComponent(id)}/metrics?days=${days}`,{signal:controller.signal}).then(stats=>{if(!controller.signal.aborted)setMetrics(stats.items[0]);}).catch(e=>{if(!controller.signal.aborted)setMetricsError(e.message);});
    return()=>controller.abort();
  },[id,revision,days,metricsRetry]);
  useEffect(()=>{if(!standalone && window.matchMedia('(max-width:1199px)').matches){panelRef.current?.scrollIntoView({block:'start'});panelRef.current?.focus({preventScroll:true});}},[id,standalone]);
  const act = async work => {
    setBusy(true); setError("");
    try { await work(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const save = async e => {
    e.preventDefault();
    await act(async () => {
      await api.update("detection-rules", id, { ...Object.fromEntries(fields.map(key => [key, draft[key]])), mitre_techniques: (draft.techniques_text ?? draft.mitre_techniques.join(",")).split(",").map(v => v.trim()).filter(Boolean), expected_version: rule.version });
      setRevision(v => v + 1); setEditing(false); onChanged();
    });
  };
  const update = (key, value) => setDraft(current => ({ ...current, [key]: value }));
  return <Panel ref={panelRef} tabIndex={-1} className="rule-workspace" aria-label="Rule details" p="16px" overflowWrap="anywhere">
    <Flex align="center" gap="8px" mb="12px"><Text color={ui.muted} fontSize="10px" letterSpacing=".08em" flex="1">{standalone ? "DETECTION RULE" : "RULE INSPECTOR"}</Text><Button variant="ghost" isDisabled={busy} onClick={onClose}>{standalone ? "Back to registry" : "Close"}</Button></Flex>
    {error && <Alert status="error" mb="12px"><AlertIcon /><Box flex="1">{error}</Box><Button variant="outline" isDisabled={busy} onClick={() => setRevision(v => v + 1)}>Reload</Button></Alert>}
    {!rule ? <Text role="status">{error ? "Rule unavailable." : "Loading rule…"}</Text> : <>
      <Flex gap="8px" align="center" wrap="wrap"><Status rule={rule} /><Badge>{rule.severity}</Badge><Text color={ui.muted} fontSize="11px">Version {rule.version}</Text></Flex>
      <Heading fontSize="20px" mt="12px">{rule.name}</Heading><Text color={ui.muted} fontSize="10px" mt="6px">{rule.id}</Text>
      <RuleMetrics metrics={metrics} days={days} />
      {metricsError && <Alert status="error"><AlertIcon/><Box flex="1">{metricsError}</Box><Button onClick={()=>setMetricsRetry(v=>v+1)}>Retry metrics</Button></Alert>}

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
        <Flex role="tablist" aria-label="Rule sections" borderBottom="1px solid" borderColor={ui.line} overflowX="auto" mb="16px">{[["details","Rule Details"],["recommendations","Recommendations"],["history","History"],["versions","Versions"]].map(([value,label]) => <Button key={value} role="tab" aria-selected={tab === value} flexShrink={0} variant="ghost" borderRadius="0" borderBottom="2px solid" borderColor={tab === value ? ui.ink : "transparent"} onClick={() => navigate({tab:value})}>{label}</Button>)}</Flex>
        {tab === "details" && <Stack spacing="14px"><Text>{rule.description || "No description recorded."}</Text><Box><Text fontSize="10px" color={ui.muted}>ATT&CK TECHNIQUES</Text><Flex gap="6px" wrap="wrap" mt="6px">{rule.mitre_techniques.length ? rule.mitre_techniques.map(v => <Badge key={v}>{v}</Badge>) : <Text>No techniques mapped.</Text>}</Flex></Box><Box><Text fontSize="10px" color={ui.muted}>SOURCE BINDINGS / HISTORY · ALL TIME</Text>{rule.bindings.map(s => <Text key={s.id} mt="4px">{s.name} <Badge>{s.provider}</Badge></Text>)}{rule.sources.map(s => <Text key={s} color={ui.muted} fontSize="11px" mt="4px">{s}</Text>)}{!rule.sources.length && !rule.bindings.length && <Text>No source connected.</Text>}</Box><Box><Text fontSize="10px" color={ui.muted}>INVESTIGATION OUTCOMES · SELECTED PERIOD</Text><Flex gap="8px" wrap="wrap" mt="6px">{(metrics?.outcomes || []).map(o => <Badge key={o.determination}>{o.determination}: {o.count}</Badge>)}{!metrics?.outcomes?.length && <Text>No linked cases yet.</Text>}</Flex></Box><Text fontSize="12px">Routing: <b>{rule.routing}</b> · Suppressed alerts: {metrics?.suppressed ?? "—"}</Text><Text fontSize="11px" color={ui.muted}>Last received: {when(metrics?.last_activity_at)}</Text><Text fontSize="11px" color={ui.muted}>Counts use stored alerts received within the selected period and distinct linked investigations. Unknown outcomes and benign determinations are not treated as explicit false-positive labels.</Text></Stack>}
        {tab === "details" && <Stack spacing="12px"><Text>{rule.execution_mode} · {rule.schedule} · Lookback: {rule.lookback_window}</Text><Box as="pre" bg={ui.nav} color="white" p="14px" rounded="4px" whiteSpace="pre-wrap" overflowWrap="anywhere" fontSize="12px">{rule.query || "No query configured."}</Box><Text color={ui.muted} fontSize="11px">Stored configuration only. No external detection engine executes this query.</Text></Stack>}
        {tab === "recommendations" && <Box bg={ui.soft} p="16px" rounded="4px"><Heading fontSize="14px">Not assessed</Heading><Text fontSize="12px" mt="10px">No validated tuning recommendation is available. False-positive rate requires explicit analyst labels and a defined evaluation set; benign determinations alone are not false positives.</Text><Text fontSize="11px" color={ui.muted} mt="10px">Query validation, replay and evidence-backed recommendations are a separate planned workflow. No automatic rule changes are enabled.</Text></Box>}
        {tab === "versions" && <Stack spacing="10px">{rule.versions.map((v, index) => <Box as="details" key={v.version} border="1px solid" borderColor={ui.line} rounded="4px" p="12px"><Box as="summary" cursor="pointer" fontWeight="600">Version {v.version} {index === 0 ? "· Current" : ""}<Text as="span" display="block" color={ui.muted} fontWeight="400" fontSize="10px">{when(v.created_at)}</Text></Box><Box as="pre" whiteSpace="pre-wrap" overflowWrap="anywhere" fontSize="11px" mt="12px">{JSON.stringify(v.snapshot, null, 2)}</Box></Box>)}</Stack>}
        {tab === "history" && <Stack spacing="0">{rule.history.length ? rule.history.map(h => <Box key={h.id} py="12px" borderBottom="1px solid" borderColor={ui.line}><Text fontWeight="600">{h.action.replaceAll("_", " ")}</Text><Text color={ui.muted} fontSize="11px">{h.details.fields?.filter(f => f !== "expected_version").join(", ") || h.details.source_rule_id || "Registry change"}</Text><Text color={ui.muted} fontSize="10px">{when(h.created_at)}</Text></Box>) : <Text color={ui.muted}>No recorded changes.</Text>}</Stack>}
      <Flex gap="6px" wrap="wrap" mb="14px"><Button isDisabled={busy || editing} variant="outline" onClick={() => act(async () => { await api.update("detection-rules", id, { enabled: !rule.enabled, expected_version: rule.version }); setRevision(v => v + 1); onChanged(); })}>{rule.enabled ? "Disable" : "Enable"}</Button><Button isDisabled={busy || editing} variant="outline" onClick={() => act(async () => { const clone = await api.action("detection-rules", id, "clone"); onChanged(); onSelect(clone.id); })}>Clone rule</Button><Button isDisabled={busy || editing} onClick={() => { setDraft(rule); setEditing(true); setConfirmDelete(false); }}>Edit rule</Button>{!standalone && <Button as="a" variant="ghost" href={`/detect/rules/${encodeURIComponent(id)}?days=${days}&tab=${tab}`}>Full page ↗</Button>}</Flex>
        <Box mt="24px" pt="14px" borderTop="1px solid" borderColor={ui.line}>{confirmDelete ? <><Text mb="10px">Delete this rule? Rules referenced by alerts or API sources cannot be deleted.</Text><Flex gap="8px"><Button colorScheme="red" isLoading={busy} onClick={() => act(async () => { await api.remove("detection-rules", id); onChanged(); onClose(); })}>Confirm delete</Button><Button variant="outline" isDisabled={busy} onClick={() => setConfirmDelete(false)}>Cancel</Button></Flex></> : <Button variant="ghost" color="red.600" isDisabled={busy} onClick={() => setConfirmDelete(true)}>Delete rule</Button>}</Box>
      </>}
    </>}
  </Panel>;
}

export default function DetectionRegistry({ setView }) {
  const { filters, selected, catalog, navigate } = useRuleNavigation();
  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [creating, setCreating] = useState(false), [template, setTemplate] = useState(null), [revision, setRevision] = useState(0);
  const refresh = () => setRevision(v => v + 1);
  const filter = (key, value) => navigate({ [key]: value, offset: 0 }, true);
  const query = new URLSearchParams(Object.entries(filters).filter(([,value])=>value!=="")).toString();
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setData(null); setError("");
    const timer = setTimeout(() => api.request(`/detection-registry?${query}`, {signal:controller.signal}).then(result => {
      if(controller.signal.aborted)return;
      if(result.total && result.offset >= result.total) { const url=new URL(window.location.href);url.searchParams.set('offset','0');window.history.replaceState({},'',url.pathname+url.search);window.dispatchEvent(new PopStateEvent('popstate'));return; }
      setData(result);
    }).catch(e => {if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);}),200);
    return () => {controller.abort();clearTimeout(timer);};
  }, [query, revision]);
  const select = id => navigate({rule:id,tab:'details',catalog:null});
  const summary=data?.summary;
  return <Box className="page-enter detection-registry rules-screen" p={{base:'12px',md:'20px'}}>
    <Flex align="center" gap="10px" wrap="wrap" mb="16px"><Heading fontSize="20px" flex="1">Detection Rules</Heading><Select aria-label="Rule metrics period" w="auto" size="sm" value={filters.days} onChange={e=>filter('days',Number(e.target.value))}>{[7,30,90].map(n=><option key={n} value={n}>Last {n} days</option>)}</Select><Button size="sm" variant="outline" onClick={()=>setView('apiSources')}>API sources</Button><Button size="sm" onClick={()=>{setTemplate(null);setCreating(true);}}>Create rule</Button></Flex>
    <div className={selected?'rules-layout rules-selected':'rules-layout'}>
      <div className="rules-primary">
        <div className="rules-kpis">{[[summary?.registry_rules,'Registry Rules'],[summary?.triggered_alerts,'Triggered Alerts'],[summary?.registry_rules ? `${Math.round(summary.mapped_rules/summary.registry_rules*100)}%` : '—','Rules with MITRE mappings']].map(([value,label])=><div key={label}><span>{label}</span><strong>{loading?'—':value??'—'}</strong></div>)}</div>
        <Text fontSize="10px" color={ui.muted} my="10px">Matching rules · Alerts from the last {filters.days} days · Mapping percentage is not assessed ATT&CK coverage.</Text>
        <Flex gap="8px" mb="12px" align="center" wrap="wrap"><Input size="sm" flex="1 1 220px" aria-label="Search detection rules" placeholder={catalog?'Search catalog templates':'Search detection rules'} value={filters.search} onChange={e=>filter('search',e.target.value)} maxLength={200}/><Box as="details" className="rules-filter-menu"><Box as="summary">Filters</Box><Stack p="12px" spacing="10px"><Select aria-label="Filter severity" value={filters.severity} onChange={e=>filter('severity',e.target.value)}><option value="">All severities</option>{['critical','high','medium','low'].map(v=><option key={v}>{v}</option>)}</Select><Select aria-label="Filter status" value={filters.enabled} onChange={e=>filter('enabled',e.target.value)}><option value="">All statuses</option><option value="true">Enabled</option><option value="false">Disabled</option></Select><Select aria-label="Filter source" value={filters.source} onChange={e=>filter('source',e.target.value)}><option value="">All sources</option>{[...new Set([filters.source,...(data?.sources||[])])].filter(Boolean).map(v=><option key={v}>{v}</option>)}</Select></Stack></Box><Select aria-label="Sort rules" w="auto" size="sm" value={filters.sort} onChange={e=>filter('sort',e.target.value)}>{[['updated_at','Last edited'],['name','Rule name'],['severity','Severity'],['detections','Detections']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</Select><Button size="sm" variant="ghost" aria-label="Reverse sort direction" onClick={()=>filter('direction',filters.direction==='asc'?'desc':'asc')}>{filters.direction==='asc'?'↑':'↓'}</Button><Button size="sm" variant="ghost" onClick={()=>navigate({search:null,severity:null,enabled:null,source:null,offset:null,sort:null,direction:null},true)}>Reset</Button></Flex>
        <Panel overflow="hidden"><Flex className="rules-tabs" role="tablist" aria-label="Registry sections"><Button role="tab" aria-selected={!catalog} variant="ghost" onClick={()=>navigate({catalog:null})}>Detection Rules</Button><Button role="tab" aria-selected={catalog} variant="ghost" onClick={()=>navigate({catalog:true,rule:null})}>Catalog</Button><Button size="xs" ml="auto" variant="ghost" onClick={refresh} isDisabled={loading}>Refresh</Button></Flex>
        {catalog ? <RuleCatalog search={filters.search} onUse={item=>{setTemplate(item);setCreating(true);}}/> : <>
          {error&&<Alert status="error"><AlertIcon/><Box flex="1">{error}</Box><Button onClick={refresh}>Retry</Button></Alert>}
          {loading?<Text p="24px" role="status">Loading registry…</Text>:!error&&<div className="rules-table-scroll"><table className="rules-table"><thead><tr>{['Name','MITRE','Execution','Status','Detections','Investigations','FPR'].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{data?.items.map(rule=><tr key={rule.id} className={selected===rule.id?'is-selected':''}><td><Button variant="link" color={ui.ink} whiteSpace="normal" textAlign="left" justifyContent="start" h="auto" lineHeight="1.5" onClick={()=>select(rule.id)}>{rule.name}</Button><small>{rule.id} · v{rule.version}</small></td><td>{rule.mitre_techniques?.length?<span title={rule.mitre_techniques.join(', ')}>{rule.mitre_techniques.length===1?rule.mitre_techniques[0]:`${rule.mitre_techniques.length} techniques`}</span>:'Not mapped'}</td><td><span>{rule.execution_mode||'Not configured'}</span><small>{[...new Set(rule.bindings.map(s=>s.provider))].join(' · ')||'Local intake'}</small></td><td><Status rule={rule}/></td><td>{rule.detections}</td><td>{rule.investigations}</td><td title="Explicit false-positive labels are not available">—<small>Not assessed</small></td></tr>)}</tbody></table>{!data?.items.length&&<Box p="28px"><Heading fontSize="16px">No matching rules</Heading><Text color={ui.muted} mt="8px">Adjust filters or create a detection rule.</Text></Box>}</div>}
          <Flex className="rules-pagination" p="12px" gap="10px" align="center" wrap="wrap"><Text flex="1" fontSize="11px">{data?.total?`Showing ${data.offset+1}–${Math.min(data.offset+data.limit,data.total)} of ${data.total} Detection Rules`:'0 rules'}</Text><Select aria-label="Rules per page" w="auto" size="sm" value={filters.limit} onChange={e=>filter('limit',Number(e.target.value))}>{[10,25,50,100].map(v=><option key={v} value={v}>{v} / page</option>)}</Select><Button size="xs" variant="outline" isDisabled={loading||!!error||filters.offset===0} onClick={()=>navigate({offset:Math.max(0,filters.offset-filters.limit)})}>Previous</Button><Button size="xs" variant="outline" isDisabled={loading||!!error||!data||filters.offset+filters.limit>=data.total} onClick={()=>navigate({offset:filters.offset+filters.limit})}>Next</Button></Flex>
        </>}
        </Panel>
      </div>
      {selected&&<RuleWorkspace key={selected} id={selected} onClose={()=>navigate({rule:null,tab:null})} onChanged={refresh} onSelect={select}/>}
    </div>
    {creating&&<CreateDetectionRule initialTemplate={template} onClose={()=>setCreating(false)} onCreated={rule=>{refresh();select(rule.id);}}/>}
  </Box>;
}
