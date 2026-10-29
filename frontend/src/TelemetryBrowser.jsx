import React, { useEffect, useState } from "react";
import { Alert, AlertIcon, Badge, Box, Button, Flex, Heading, Table, TableContainer, Tbody, Td, Text, Th, Thead, Tr } from "@chakra-ui/react";
import { api } from "./api";
import { ui } from "./theme";

export default function TelemetryBrowser({ scope, refresh }) {
  const [after, setAfter] = useState(""), [page, setPage] = useState(null), [error, setError] = useState("");
  useEffect(() => { setAfter(""); setPage(null); }, [scope]);
  useEffect(() => {
    const controller = new AbortController();
    setPage(null); setError("");
    api.request(`/stream-operations/${encodeURIComponent(scope)}/events?after=${encodeURIComponent(after)}`, { signal: controller.signal })
      .then(setPage).catch(e => { if (e.name !== "AbortError") setError(e.message); });
    return () => controller.abort();
  }, [scope, after, refresh]);
  return <Box bg="white" border="1px solid" borderColor={ui.line} borderRadius="6px" overflow="hidden">
    <Box p="18px"><Heading size="sm">Retained telemetry</Heading><Text mt="4px" color={ui.muted}>Source evidence stored in PostgreSQL, served by the Go API. Demo sources contain synthetic events.</Text></Box>
    {error && <Alert status="error"><AlertIcon />{error}</Alert>}
    <TableContainer><Table size="sm"><Thead bg={ui.soft}><Tr><Th>Event / UTC time</Th><Th>Identity / source IP</Th><Th>Activity</Th><Th>Processing</Th><Th>Evidence</Th></Tr></Thead><Tbody>
      {page?.items.map(({ event_key, event, disposition }) => <Tr key={event_key}>
        <Td><Text fontFamily="mono">{event.source_event_id}</Text><Text color={ui.muted}>{event.event_time}</Text></Td>
        <Td>{event.projection.principal_ref}<Text color={ui.muted}>{event.projection.source_ip}</Text></Td>
        <Td><Badge colorScheme={event.event_type.endsWith("failed") ? "orange" : "teal"}>{event.event_type}</Badge></Td>
        <Td>{disposition}</Td><Td><details><summary style={{ cursor: "pointer" }}>View JSON</summary><Box as="pre" maxW="420px" whiteSpace="pre-wrap" fontSize="11px" p="10px">{JSON.stringify(event, null, 2)}</Box></details></Td>
      </Tr>)}
      {!page?.items.length && <Tr><Td colSpan={5} py="20px" color={ui.muted}>{page ? "No retained events on this page." : error ? "Events unavailable." : "Loading telemetry…"}</Td></Tr>}
    </Tbody></Table></TableContainer>
    <Flex p="12px" gap="8px" align="center"><Button size="sm" variant="ghost" isDisabled={!after} onClick={() => setAfter("")}>First events</Button><Button size="sm" variant="ghost" isDisabled={!page?.next_after} onClick={() => setAfter(page.next_after)}>Next 50 events</Button><Text color={ui.muted} fontSize="12px">Ordered by stable event key; refresh to update processing state.</Text></Flex>
  </Box>;
}
