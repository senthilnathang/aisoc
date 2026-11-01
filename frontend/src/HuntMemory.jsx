import React from 'react';
import {LearningProvenance} from './OutcomeLearning';
import {Badge,Box,Button,Flex,Heading,Stack,Text} from '@chakra-ui/react';
import {ui} from './theme';
import {memoryFreshness} from './huntMemory.mjs';
const date=value=>value?new Date(value).toLocaleString():'Not configured';

export default function HuntMemory({snapshots,policy,truncated=false,setView}) {
 return <Box border="1px solid" borderColor={ui.line} borderRadius="6px" p="16px" my="16px" aria-label="Hunt Memory snapshots">
  <Flex justify="space-between" gap="10px" wrap="wrap"><Heading size="sm">Memory captured for this run</Heading><Badge colorScheme="blue">Historical context · advisory only</Badge></Flex>
  <Text fontSize="12px" color={ui.muted} mt="10px">Exact entity matches with approved context, validity dates and source outcome checked at capture. Later changes never rewrite this snapshot or determine the hunt verdict. Current approval may have changed.</Text>
  {!policy&&<Text mt="10px">This older run did not capture Memory eligibility. Run a new local search to evaluate current context.</Text>}
  {policy&&!snapshots?.length&&<Text mt="10px">No eligible Memory matched this run. Missing context does not establish safety.</Text>}
  {truncated&&<Text role="status" color="orange.700" mt="10px">Context snapshot limit reached (20 entries / 64 KiB). Review Memory for additional context.</Text>}
  <Stack mt="12px" spacing="12px">{snapshots?.map(s=>{
   const source=s.learning_review?.source_case||s.learning_origin?.source_case;
   return <Box key={`${s.id}:${s.version}`} bg={ui.soft} p="12px" borderRadius="5px" overflowWrap="anywhere">
    <Flex gap="8px" wrap="wrap"><Text fontWeight="600">{s.artifact}</Text><Badge>v{s.version}</Badge><Badge>{memoryFreshness(s)}</Badge></Flex>
    <Text mt="8px" whiteSpace="pre-wrap">{s.content}</Text>
    <Text mt="8px" fontSize="12px">Advisory hint: {s.hint||'none'} · Origin: {s.origin}</Text>
    <Text fontSize="12px" color={ui.muted}>Approved/authored by {s.learning_review?.actor||s.learning_origin?.approved_by||s.created_by} · Captured {date(s.captured_at)}</Text>
    <Text fontSize="12px" color={ui.muted}>Valid from {date(s.valid_from)} · Until {date(s.valid_until)}</Text>
    <Text fontSize="11px" color={ui.muted}>Memory {s.id} · Exact match: {s.matched_entity}</Text>
    <LearningProvenance value={s.learning_origin} setView={setView}/>
    {s.learning_review&&<Text fontSize="12px" mt="8px">Reapproval: {s.learning_review.rationale} · {date(s.learning_review.reviewed_at)}</Text>}
    {source?.id&&<Button size="xs" variant="link" mt="8px" onClick={()=>setView('investigationDetail',source.id)}>Source investigation {source.id}</Button>}
   </Box>;
  })}</Stack>
  <Button size="sm" variant="outline" mt="12px" onClick={()=>setView('memory')}>Open current Memory</Button>
 </Box>;
}
