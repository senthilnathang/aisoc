import React, { useEffect, useMemo, useState } from "react";
import { Alert, AlertIcon, Badge, Box, Button, Flex, Grid, Heading, Select, Stack, Text } from "@chakra-ui/react";
import { api } from "./api";
import { ui } from "./theme";

const colors = { critical: "#a41d32", high: "#e55255", medium: "#edaa40", low: "#75a8b8" };
const dispositionColor = { investigate: ui.green, suppressed: ui.steel, not_sampled: ui.amber };
const Panel = ({ children, ...props }) => <Box bg="white" border="1px solid" borderColor={ui.line} rounded="5px" minW="0" {...props}>{children}</Box>;
const integer = value => Number(value || 0).toLocaleString();

export default function DetectionIntelligence({ setView }) {
  const [days, setDays] = useState(7);
  const [source, setSource] = useState("");
  const [severity, setSeverity] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    api.request(`/detection-intelligence?${new URLSearchParams({ days: String(days), ...(source ? { source } : {}), ...(severity ? { severity } : {}) })}`)
      .then(result => { if (active) { setData(result); setError(""); } })
      .catch(e => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [days, source, severity, revision]);
  const series = useMemo(() => {
    const rows = new Map((data?.daily || []).map(row => [row.date, row]));
    return Array.from({ length: Number(days) }, (_, index) => {
      const date = new Date(); date.setUTCHours(0, 0, 0, 0); date.setUTCDate(date.getUTCDate() - Number(days) + 1 + index);
      const key = date.toISOString().slice(0, 10);
      return rows.get(key) || { date: key, total: 0, critical: 0, high: 0, medium: 0, low: 0 };
    });
  }, [data, days]);
  const maxDaily = Math.max(1, ...series.map(row => Number(row.total)));
  const bySeverity = data?.by_severity || [];
  const totalSeverity = bySeverity.reduce((sum, row) => sum + Number(row.count), 0);
  return <Box className="page-enter detection-intelligence" p={{ base: "12px", md: "20px" }} w="100%" minW="0">
    <Flex align="center" gap="12px" wrap="wrap" mb="14px"><Box flex="1" minW="200px"><Text fontSize="10px" color={ui.muted} letterSpacing=".1em">DETECT / INTELLIGENCE</Text><Heading fontSize="26px" mt="4px">Detection intelligence</Heading><Text color={ui.muted} fontSize="12px" mt="6px">Alert inventory and linked investigations from your connected sources.</Text></Box><Button variant="outline" onClick={() => setView("detect")}>Rule registry</Button><Button variant="outline" isDisabled={loading} onClick={() => setRevision(v => v + 1)}>Refresh</Button></Flex>
    <Flex gap="8px" wrap="wrap" mb="14px"><Select aria-label="Time range" w="auto" value={days} onChange={e => setDays(Number(e.target.value))}>{[[7,"Last 7 days"],[30,"Last 30 days"],[90,"Last 90 days"]].map(([value,label])=><option key={value} value={value}>{label}</option>)}</Select><Select aria-label="Source filter" maxW="260px" w="auto" value={source} onChange={e=>setSource(e.target.value)}><option value="">All sources</option>{data?.sources.map(value=><option key={value}>{value}</option>)}</Select><Select aria-label="Severity filter" w="auto" value={severity} onChange={e=>setSeverity(e.target.value)}><option value="">All severities</option>{["critical","high","medium","low"].map(value=><option key={value}>{value}</option>)}</Select><Text alignSelf="center" fontSize="11px" color={ui.muted}>UTC · Metrics use received alerts for the selected period</Text></Flex>
    {error && <Alert status="error" mb="12px"><AlertIcon />{error}<Button ml="auto" variant="outline" onClick={()=>setRevision(v=>v+1)}>Retry</Button></Alert>}
    <Grid templateColumns={{base:"repeat(2,minmax(0,1fr))",lg:"repeat(4,minmax(0,1fr))"}} gap="10px" mb="12px">{[[data?.totals.total_alerts,"Received alerts"],[data?.totals.investigated,"Linked investigations"],[data?.totals.pending_review,"Pending analyst review"],[data?.totals.suppressed,"Suppressed by rule"]].map(([value,label])=><Panel key={label} p={{base:"12px",md:"16px"}}><Text color={ui.muted} fontSize="11px">{label}</Text><Text fontSize={{base:"24px",md:"30px"}} fontWeight="700" mt="4px">{loading?"—":integer(value)}</Text></Panel>)}</Grid>
    <Grid templateColumns={{base:"minmax(0,1fr)",xl:"minmax(0,1.55fr) minmax(300px,.75fr)"}} gap="12px" alignItems="stretch" mb="12px">
      <Panel p={{base:"14px",md:"18px"}}><Flex justify="space-between" gap="8px" align="start"><Box><Heading fontSize="15px">Alert activity</Heading><Text color={ui.muted} fontSize="11px" mt="4px">{days}-day volume, grouped by severity</Text></Box><Badge>{integer(data?.totals.total_alerts)} total</Badge></Flex>
        <Flex className="intel-chart" align="end" gap={{base:"2px",md:"5px"}} h={{base:"170px",md:"220px"}} mt="16px" borderBottom="1px solid" borderColor={ui.line}>
          {series.map(row=><Box key={row.date} className="intel-day" title={`${row.date}: ${row.total} alerts`} flex="1" h="100%" display="flex" alignItems="end" minW="0"><Flex direction="column" justify="end" w="100%" h={`${Math.max(2,Number(row.total)/maxDaily*100)}%`} overflow="hidden" roundedTop="2px">{["critical","high","medium","low"].map(key=>Number(row[key])>0&&<Box key={key} h={`${Number(row[key])/Number(row.total)*100}%`} minH="2px" bg={colors[key]} />)}</Flex></Box>)}
        </Flex><Flex justify="space-between" mt="8px"><Text fontSize="9px" color={ui.muted}>{series[0]?.date}</Text><Text fontSize="9px" color={ui.muted}>{series.at(-1)?.date}</Text></Flex><Flex gap="12px" wrap="wrap" mt="12px">{["critical","high","medium","low"].map(key=><Flex key={key} align="center" gap="5px"><Box w="8px" h="8px" bg={colors[key]} rounded="1px"/><Text color={ui.muted} fontSize="10px" textTransform="capitalize">{key} · {integer(bySeverity.find(row=>row.name===key)?.count)}</Text></Flex>)}</Flex>
      </Panel>
      <Panel p={{base:"14px",md:"18px"}}><Heading fontSize="15px">Connected source inventory</Heading><Text color={ui.muted} fontSize="11px" mt="4px">Alert volume and share for this period</Text><Stack spacing="12px" mt="16px">{(data?.by_source||[]).map(item=><Box key={item.name} cursor="pointer" onClick={()=>setSource(item.name)}><Flex justify="space-between" gap="8px" mb="5px"><Text fontSize="11px" fontWeight="600" overflowWrap="anywhere">{item.name}</Text><Text fontSize="11px" color={ui.muted} flexShrink="0">{integer(item.count)} · {totalSeverity?Math.round(Number(item.count)/totalSeverity*100):0}%</Text></Flex><Box bg={ui.soft} h="6px" rounded="full" overflow="hidden"><Box bg={ui.violet} h="100%" w={`${totalSeverity?Math.max(1,Number(item.count)/totalSeverity*100):0}%`}/></Box></Box>)}{!loading&&!data?.by_source.length&&<Text color={ui.muted} fontSize="12px">No alerts received in this period.</Text>}</Stack>
        <Box mt="20px" pt="14px" borderTop="1px solid" borderColor={ui.line}><Text fontSize="11px" fontWeight="600" mb="10px">Routing outcomes</Text>{(data?.by_disposition||[]).map(item=><Flex key={item.name} align="center" gap="8px" mb="8px"><Box w="8px" h="8px" rounded="full" bg={dispositionColor[item.name]||ui.steel}/><Text flex="1" fontSize="11px" textTransform="capitalize">{item.name.replaceAll("_"," ")}</Text><Text fontSize="11px" color={ui.muted}>{integer(item.count)}</Text></Flex>)}</Box>
      </Panel>
    </Grid>
    <Grid templateColumns={{base:"minmax(0,1fr)",lg:"minmax(0,1.2fr) minmax(280px,.8fr)"}} gap="12px" alignItems="start">
      <Panel overflow="hidden"><Box p="14px 16px" borderBottom="1px solid" borderColor={ui.line}><Heading fontSize="15px">Recent alerts</Heading><Text color={ui.muted} fontSize="11px" mt="4px">Latest 50 matching alerts · Click a rule or investigation to inspect</Text></Box>{data?.recent.map(alert=><Flex key={alert.id} className="intel-alert-row" p="12px 16px" gap="10px" align="center" borderBottom="1px solid" borderColor={ui.line} wrap="wrap"><Box flex="1" minW="180px"><Text fontSize="12px" fontWeight="600" overflowWrap="anywhere">{alert.title}</Text><Text color={ui.muted} fontSize="10px" mt="4px">{alert.source_provider || alert.source} · {new Date(alert.created_at).toLocaleString()}</Text></Box><Badge colorScheme={["critical","high"].includes(alert.severity)?"red":"yellow"}>{alert.severity}</Badge><Badge colorScheme={alert.investigation_id?"blue":"gray"}>{alert.disposition.replaceAll("_"," ")}</Badge><Button variant="link" fontSize="10px" onClick={()=>setView("detectionRuleDetail",alert.rule_id)}>{alert.rule_name}</Button>{alert.investigation_id&&<Button variant="outline" onClick={()=>setView("investigationDetail",alert.investigation_id)}>Open investigation</Button>}</Flex>)}{!loading&&!data?.recent.length&&<Text p="24px" color={ui.muted}>No matching alerts yet. Connect an API source or submit an alert through the registry workflow.</Text>}</Panel>
      <Panel p="16px"><Heading fontSize="15px">Investigation outcomes</Heading><Text color={ui.muted} fontSize="11px" mt="4px">Current determinations for cases linked to matching alerts.</Text><Stack mt="14px" spacing="10px">{["malicious","suspicious","benign","unknown","mitigated"].map(name=>{const count=data?.outcomes.find(item=>item.name===name)?.count||0;return <Flex key={name} justify="space-between" align="center"><Flex align="center" gap="8px"><Box w="8px" h="8px" rounded="full" bg={name==="malicious"?ui.red:name==="suspicious"?ui.amber:name==="benign"?ui.green:ui.steel}/><Text fontSize="11px" textTransform="capitalize">{name}</Text></Flex><Text fontSize="12px" fontWeight="600">{integer(count)}</Text></Flex>})}</Stack><Text fontSize="10px" color={ui.muted} mt="12px">Outcome counts cover all matching linked cases in the selected period. Unknown means no analyst conclusion has been recorded.</Text><Button mt="14px" w="100%" variant="outline" onClick={()=>setView("investigations")}>View investigations</Button></Panel>
    </Grid>
  </Box>;
}
