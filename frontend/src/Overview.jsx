import React, { useEffect, useState } from 'react';
import { Alert, AlertIcon, Badge, Box, Button, Flex, Heading, SimpleGrid, Stack, Text } from '@chakra-ui/react';
import { api } from './api';
import { ui } from './theme';

export default function Overview({setView}) {
 const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[revision,reload]=useState(0);
 useEffect(()=>{let active=true;setLoading(true);setError('');api.dashboard().then(value=>{if(active)setData(value)}).catch(e=>{if(active){setData(null);setError(e.message)}}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[revision]);
 const panel={bg:'white',border:'1px solid',borderColor:ui.line,borderRadius:'6px',p:'22px'};
 return <Box p={{base:'14px',md:'24px'}}>
  <Flex justify="space-between" gap="12px" wrap="wrap" mb="22px"><Box><Heading size="lg" fontWeight="500">Security operations overview</Heading><Text mt="8px" color={ui.muted}>Current tenant records across detection, investigation and response.</Text></Box><Button variant="outline" isLoading={loading} onClick={()=>reload(x=>x+1)}>Refresh overview</Button></Flex>
  {error?<Alert status="error"><AlertIcon/>Overview could not be loaded: {error}<Button ml="auto" onClick={()=>reload(x=>x+1)}>Retry</Button></Alert>:loading?<Text>Loading overview…</Text>:data&&<>
   <SimpleGrid columns={{base:1,sm:2,lg:4}} gap="14px" mb="20px">{[[data.queueItems,'Unresolved investigations','investigations'],[data.openInvestigations,'Open / investigating','investigations'],[data.openRemediations,'Pending action simulations','responseApprovals'],[data.enabledDetectionRules,'Enabled detection rules','detect']].map(([count,label,view])=><Box {...panel} key={label}><Text color={ui.muted}>{label}</Text><Text fontSize="38px" my="12px">{count}</Text><Button variant="link" onClick={()=>setView(view)}>View records →</Button></Box>)}</SimpleGrid>
   <SimpleGrid columns={{base:1,lg:3}} gap="14px"><Box {...panel}><Heading size="sm">Detect</Heading><Text mt="12px" color={ui.muted}>Review ATT&amp;CK coverage assessments and rule performance using saved evidence.</Text><Stack align="start" mt="20px"><Button variant="outline" onClick={()=>setView('detectionCoverage')}>Detection coverage</Button><Button variant="outline" onClick={()=>setView('detectionIntelligence')}>Detection intelligence</Button></Stack><Text fontSize="12px" mt="22px" color={ui.muted}>{data.operationalConnectors} connectors have a stored operational status. This is not a live health check.</Text></Box>
   <Box {...panel}><Heading size="sm">Recent investigations</Heading><Stack mt="16px" spacing="14px">{data.recentInvestigations?.length?data.recentInvestigations.map(item=><Box key={item.id}><Button variant="link" whiteSpace="normal" textAlign="left" onClick={()=>setView('investigationDetail',item.id)}>{item.title||item.id}</Button><Flex mt="5px" gap="8px" wrap="wrap"><Badge>{item.status}</Badge><Text fontSize="11px" color={ui.muted}>{item.id}</Text></Flex></Box>):<Text color={ui.muted}>No investigations recorded for this tenant.</Text>}</Stack></Box>
   <Box {...panel}><Heading size="sm">Hunt and build</Heading><Text color={ui.muted} mt="12px">Search available evidence, review intelligence, and configure your SOC workflows.</Text><Stack align="start" mt="20px">{[['Threat hunting','hunt'],['Threat intelligence','threatIntel'],['Build workspace','build']].map(([label,view])=><Button key={view} variant="outline" onClick={()=>setView(view)}>{label}</Button>)}</Stack><Text color={ui.muted} mt="22px" fontSize="12px">Live provider health, watchlist matches and managed-service performance are not measured by this overview.</Text></Box></SimpleGrid>
  </>}
 </Box>;
}
