import React, { useEffect, useMemo, useState } from 'react';
import { Alert, AlertIcon, Badge, Box, Button, Flex, Heading, Input, Select, Text } from '@chakra-ui/react';
import { api } from './api';
import { coverage, dailySeries, palette, treemap } from './detectionIntelligenceModel';
import './detection-intelligence.css';

const number = value => Number(value || 0).toLocaleString();
const severityColors = { critical: '#7b383f', high: '#a76b6d', medium: '#8aa9a1', low: '#ccd8d4' };
function Breakdown({ title, rows = [], total, onSelect }) {
  return <section className="di-summary"><h2>{title}</h2><strong>{number(total)}</strong>{rows.map(row => <button type="button" disabled={!onSelect} key={row.name || 'unknown'} onClick={() => onSelect?.(row.name)} className="di-breakdown"><span>{row.name || 'Unknown'}</span><b>{number(row.count)}</b><small>{total ? (row.count / total * 100).toFixed(1) : 0}%</small></button>)}</section>;
}
export default function DetectionIntelligence({ setView }) {
  const [days, setDays] = useState(7), [source, setSource] = useState(''), [severity, setSeverity] = useState('');
  const [search, setSearch] = useState(''), [query, setQuery] = useState(''), [rule, setRule] = useState('');
  const [tab, setTab] = useState('coverage'), [table, setTable] = useState(false), [cases, setCases] = useState(false);
  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => { const timer = setTimeout(() => setQuery(search.trim()), 250); return () => clearTimeout(timer); }, [search]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setData(null);
    const params = new URLSearchParams({ days: String(days), ...(source && { source }), ...(severity && { severity }), ...(query && { search: query }), ...(rule && { rule_id: rule }) });
    api.request(`/detection-intelligence?${params}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [days, source, severity, query, rule, revision]);
  const providers = useMemo(() => {
    const map = new Map();
    for (const row of data?.groups || []) {
      if (!map.has(row.source)) map.set(row.source, { source: row.source, count: 0, rows: [] });
      const group = map.get(row.source); group.count += Number(row.count); group.rows.push(row);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [data]);
  const series = useMemo(() => dailySeries(data), [data]);
  const total = data?.totals.total_alerts || 0, maxDaily = Math.max(1, ...series.map(row => row.total));
  const selected = Boolean(source || severity || query || rule);
  const reset = () => { setSource(''); setSeverity(''); setSearch(''); setQuery(''); setRule(''); };
  const chooseSource = value => { setSource(value); setRule(''); };
  const legend = tab === 'coverage' ? ['Full', 'Majority', 'Partial', 'None'] : ['Escalated', 'Not escalated'];
  return <Box className="detection-intelligence page-enter" aria-busy={loading}>
    <Flex align="center" justify="space-between" gap="12px" wrap="wrap" mb="14px"><Heading fontSize="20px">Detection Intelligence</Heading><Text fontSize="11px" color="gray.500">Received alerts · UTC</Text></Flex>
    <Flex className="di-toolbar" gap="8px" wrap="wrap" align="center">
      <Input aria-label="Search alerts" placeholder="Search alerts, rules or sources" value={search} onChange={e => setSearch(e.target.value)} maxW={{base:'100%',md:'260px'}} size="sm" bg="white" />
      <Select aria-label="Time range" value={days} onChange={e => setDays(Number(e.target.value))} w="auto" size="sm">{[7,30,90].map(n => <option key={n} value={n}>Last {n} days</option>)}</Select>
      <Select aria-label="Severity filter" value={severity} onChange={e => setSeverity(e.target.value)} w="auto" size="sm"><option value="">All severities</option>{Object.keys(severityColors).map(s => <option key={s}>{s}</option>)}</Select>
      {selected && <Button size="sm" variant="ghost" onClick={reset}>Clear filters</Button>}
      <Button size="sm" variant="ghost" ml="auto" onClick={() => setRevision(v => v + 1)} isDisabled={loading}>Refresh</Button>
      <Button size="sm" variant="outline" onClick={() => { setCases(v => !v); setTable(true); }}>{cases ? 'Show all alerts' : 'View in Investigations'}</Button>
    </Flex>
    {error && <Alert status="error" mt="12px"><AlertIcon />{error}<Button ml="auto" onClick={() => setRevision(v => v + 1)}>Retry</Button></Alert>}
    {selected && <Flex gap="6px" mt="10px" wrap="wrap">{source && <Badge>Source: {source}</Badge>}{rule && <Badge>Rule: {rule}</Badge>}{query && <Badge>Search: {query}</Badge>}</Flex>}
    <section className="di-workspace">
      <Flex justify="space-between" align="center" gap="8px" wrap="wrap" className="di-tabs"><div role="tablist" aria-label="Intelligence metric"><button role="tab" aria-selected={tab === 'coverage'} onClick={() => setTab('coverage')}>Investigation Coverage</button><button role="tab" aria-selected={tab === 'escalation'} onClick={() => setTab('escalation')}>Escalation</button></div><Button size="xs" variant="ghost" onClick={() => setTable(v => !v)}>{table ? 'Collapse table' : 'Expand table'} ↗</Button></Flex>
      <Flex justify="space-between" wrap="wrap" gap="8px" px="12px" py="10px"><Text fontSize="10px" color="gray.600">{tab === 'coverage' ? 'Coverage = share of alerts linked to an investigation; not completion or detection efficacy.' : 'Escalation = alerts routed to Escalate; not confirmed response execution.'}</Text><Flex gap="10px">{legend.map(key => <Flex key={key} gap="4px" align="center"><Box w="7px" h="7px" rounded="full" bg={palette[key]} /><Text fontSize="10px">{key}</Text></Flex>)}</Flex></Flex>
      {loading ? <div className="di-placeholder" role="status">Loading detection intelligence…</div> : !data || !total ? <div className="di-placeholder">{error ? 'Metrics unavailable.' : 'No alerts match this period and filters.'}</div> : <div className="di-map-layout">
        <aside className="di-inventory" aria-label="Source inventory"><button className="di-source di-all" onClick={() => chooseSource('')} aria-pressed={!source}><span><b>All Alerts</b><small>{source ? 'Selected source' : 'All sources'}</small></span><span><b>{number(total)}</b><small>100%</small></span></button>{data.by_source.map(item => <button key={item.name} className="di-source" onClick={() => chooseSource(item.name)} aria-pressed={source === item.name}><span className="di-source-name"><b>› {item.name}</b><small>{number(item.count)} alerts</small></span><span><b>{(item.count / total * 100).toFixed(1)}%</b><i><em style={{width:`${item.count / total * 100}%`}} /></i></span></button>)}</aside>
        <div className="di-visual"><div className="di-treemap" aria-label="Alert source and rule treemap">{providers.map(provider => <div className="di-provider" key={provider.source} style={{flexGrow:provider.count}}><button className="di-provider-title" title={provider.source} onClick={() => chooseSource(provider.source)}><span>{provider.source}</span><b>{number(provider.count)}</b></button><div className="di-tiles">{treemap(provider.rows,0,0,100,300).map(tile => { const state = tab === 'coverage' ? coverage(tile) : tile.escalated > 0 ? 'Escalated' : 'Not escalated'; return <button key={tile.rule_id} className="di-tile" style={{left:`${tile.x}%`,top:`${tile.y / 3}%`,width:`${tile.width}%`,height:`${tile.height / 3}%`,background:palette[state],color:['None','Partial','Escalated'].includes(state)?'white':'#243f4c'}} title={`${tile.source} · ${tile.rule_name}: ${number(tile.count)} alerts, ${number(tile.linked)} linked, ${number(tile.escalated)} escalated`} onClick={() => { setSource(tile.source); setRule(tile.rule_id); setTable(true); }}><span>{tile.rule_name}</span><b>{number(tile.count)}</b><small>{tab === 'coverage' ? state : `${number(tile.escalated)} escalated`}</small></button>; })}</div></div>)}</div></div>
      </div>}
      {data?.group_count > 200 && <Text fontSize="11px" p="12px">Showing the 200 largest source/rule groups of {number(data.group_count)}. Summary totals cover all matches; narrow filters to see smaller groups.</Text>}
      {table && data && <div className="di-table-scroll"><table className="di-table"><caption>{cases ? 'Linked investigations — up to 50 distinct cases, newest matching alert first' : 'Source and rule coverage — accessible treemap data'}</caption><thead><tr>{(cases ? ['Example matching alert','Matching alerts','Determination','Investigation'] : ['Source / rule','Alerts','Linked','Escalated','Coverage','Rule']).map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{cases ? data.investigations.map(row => <tr key={row.id}><td>{row.alert_title}</td><td>{number(row.alerts)}</td><td>{row.determination || 'Unknown'}</td><td><Button size="xs" variant="link" onClick={() => setView('investigationDetail',row.id)}>Open investigation</Button></td></tr>) : data.groups.map(row => <tr key={`${row.source}:${row.rule_id}`}><td>{row.source}<br/><b>{row.rule_name}</b></td><td>{number(row.count)}</td><td>{number(row.linked)}</td><td>{number(row.escalated)}</td><td>{coverage(row)}</td><td><Button size="xs" variant="link" onClick={() => setView('detectionRuleDetail',row.rule_id)}>Open rule</Button></td></tr>)}</tbody></table>{cases && !data.investigations.length && <Text p="16px">No linked investigations match these filters.</Text>}</div>}
    </section>
    {data && <div className="di-bottom"><Breakdown title="Categories" rows={data.by_category} total={total} /><Breakdown title="Severities" rows={data.by_severity} total={total} onSelect={setSeverity}/><section className="di-summary di-trend"><h2>Daily average · selected period</h2><strong>{number(Math.round(total / days))}</strong><div className="di-trend-content"><div className="di-chart-legend">{Object.entries(severityColors).map(([key,color]) => <span key={key}><i style={{background:color}} />{key}</span>)}</div><div className="di-chart" style={{gap:series.length > 30 ? '1px' : undefined}} role="img" aria-label={`Daily alert volume by severity, ${series.length} UTC dates including partial boundary days`}>{series.map(row => <div className="di-day" key={row.date} title={`${row.date}: ${number(row.total)} alerts`}><div style={{height:`${row.total / maxDaily * 100}%`}}>{Object.keys(severityColors).map(key => row[key] > 0 && <span key={key} style={{background:severityColors[key],height:`${row[key] / row.total * 100}%`}} />)}</div></div>)}</div></div><Flex justify="space-between" fontSize="10px" color="gray.500"><span>{series[0]?.date}</span><span>{series.at(-1)?.date}</span></Flex><details><summary>Daily counts</summary><table className="di-table"><thead><tr><th>UTC date</th><th>Total</th></tr></thead><tbody>{series.map(row => <tr key={row.date}><td>{row.date}</td><td>{number(row.total)}</td></tr>)}</tbody></table></details></section></div>}
    <Text fontSize="10px" color="gray.500" mt="10px">Categories come from rule metadata; missing categories are Unclassified. Imported demo alerts are included when they match the selected period. {data && `Updated ${new Date(data.as_of).toLocaleString()}.`}</Text>
  </Box>;
}
