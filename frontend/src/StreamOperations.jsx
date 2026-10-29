import React, { useEffect, useState } from "react";
import { Alert, AlertIcon, Badge, Box, Button, Flex, FormControl, FormLabel, Grid, Heading, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Select, Stack, Table, TableContainer, Tbody, Td, Text, Textarea, Th, Thead, Tr } from "@chakra-ui/react";
import { api } from "./api";
import { ui } from "./theme";
import TelemetryBrowser from "./TelemetryBrowser";
import SandboxSessionResponse from "./SandboxSessionResponse";

export default function StreamOperations({ setView }) {
  const [scopes, setScopes] = useState([]), [selected, setSelected] = useState("");
  const [data, setData] = useState(null), [error, setError] = useState(""), [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false), [review, setReview] = useState(null), [ticket, setTicket] = useState("");
  const [reason, setReason] = useState("configuration_corrected"), [fixture, setFixture] = useState(""), [receipt, setReceipt] = useState(null);
  const [after, setAfter] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    api.request("/stream-operations", { signal: controller.signal }).then(result => {
      setScopes(result.items); setSelected(result.items[0]?.id || "");
    }).catch(e => { if (e.name !== "AbortError") setError(e.message); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!selected) return undefined;
    const controller = new AbortController(); let pending = false;
    const refresh = async () => {
      if (pending) return; pending = true;
      try { const next = await api.request(`/stream-operations/${encodeURIComponent(selected)}?after=${encodeURIComponent(after)}`, { signal: controller.signal }); setData(next); setError(""); }
      catch (e) { if (e.name !== "AbortError") setError(e.message); }
      finally { pending = false; }
    };
    refresh(); const timer = setInterval(refresh, 5000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [selected, version, after]);
  const retry = async () => {
    setBusy(true); setError("");
    if (review.kind === "soar") {
      try { await api.request(`/stream-operations/${selected}/rebase-soar`, { method: "POST", body: { job_id: review.job_id, expected_version: review.source_version, ticket } }); setReview(null); setVersion(v => v + 1); }
      catch (e) { setError(e.message); } finally { setBusy(false); }
      return;
    }
    const body = { request_id: review.requestId, event_key: review.event_key, expected_attempt_id: review.expected_attempt_id, expected_attempts: review.expected_attempts, expected_recovery_count: review.expected_recovery_count, expected_operator_retries: review.expected_operator_retries, reason, ticket };
    if (review.kind === "consumer") body.processor = review.processor;
    try { await api.request(`/stream-operations/${selected}/retry-${review.kind}`, { method: "POST", body }); setReview(null); setVersion(v => v + 1); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const importFixture = async () => {
    setBusy(true); setError(""); setReceipt(null);
    try {
      const page = JSON.parse(fixture); page.expected_checkpoint = data.checkpoint;
      const result = await api.request(`/stream-operations/${selected}/mock-import`, { method: "POST", body: page });
      setReceipt(result); setVersion(v => v + 1);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const example = async () => {
    try { const value = await api.request(`/stream-operations/${selected}/mock-example`); setFixture(JSON.stringify(value, null, 2)); }
    catch (e) { setError(e.message); }
  };
  const snapshot = data?.snapshot;
  return <Stack spacing="18px" p={{ base: "14px", md: "24px" }}>
    <Flex justify="space-between" align="center" gap="16px" wrap="wrap">
      <Box><Text fontSize="10px" fontWeight="700" letterSpacing=".15em" color={ui.muted}>BUILD / PIPELINE CONTROL</Text><Heading size="lg" mt="5px">Stream operations</Heading><Text color={ui.muted} mt="6px">Inspect delivery, review failures, and test a complete investigation with JSON fixtures.</Text></Box>
      <Flex gap="8px"><Badge colorScheme="teal" alignSelf="center">LOCAL SANDBOX</Badge><Button variant="outline" onClick={() => setView("apiSources")}>API sources</Button></Flex>
    </Flex>
    {error && <Alert status="error" role="alert"><AlertIcon />{error}</Alert>}
    {!scopes.length && !error && <Box bg="white" border="1px solid" borderColor={ui.line} p="24px"><Heading size="sm">No stream access configured</Heading><Text mt="8px" color={ui.muted}>Ask your operator administrator to grant access to a source. Other tenants’ streams are not shown.</Text></Box>}
    {!!scopes.length && <Flex gap="12px" align="end"><FormControl maxW="420px"><FormLabel>Source</FormLabel><Select value={selected} onChange={e => { setSelected(e.target.value); setData(null); setAfter(""); setReceipt(null); setReview(null); setFixture(""); }}>{scopes.map(s => <option key={s.id} value={s.id}>{s.connector_id} · {s.source}</option>)}</Select></FormControl><Button variant="outline" onClick={() => setVersion(v => v + 1)}>Refresh</Button></Flex>}
    {data && <>
      <Grid templateColumns={{ base: "repeat(2,1fr)", md: "repeat(4,1fr)" }} bg={ui.nav} color="white" borderRadius="6px" overflow="hidden">
        {[["Accepted", snapshot.accepted], ["Completed", snapshot.completed], ["Pending", snapshot.pending], ["Oldest pending", `${snapshot.oldest_pending_seconds.toFixed(1)}s`]].map(([label, value]) => <Box p="22px" key={label} borderRight="1px solid #2a2d35"><Text color="#aeb7c6" fontSize="11px" textTransform="uppercase" letterSpacing=".08em">{label}</Text><Text fontSize="30px" fontWeight="600" fontFamily="mono" mt="7px">{value}</Text></Box>)}
      </Grid>
      <Text color={ui.muted} fontSize="12px">{snapshot.archived || 0} events available from verified archives · {snapshot.accepted - (snapshot.archived || 0)} hot events · source capacity {data.scope.max_hot_events || 1000}. Archived events remain browsable.</Text>
      <Flex align="center" gap="10px" wrap="wrap"><Badge colorScheme={data.alerts.length ? "orange" : "green"}>{data.alerts.length ? "Attention required" : "Within queue thresholds"}</Badge><Text color={ui.muted}>{data.alerts.length ? data.alerts.join(" · ").replaceAll("_", " ") : "No queue-age, backlog or failed-work alert."} Refreshes every 5 seconds. Live response execution is disabled.</Text></Flex>
      <Box border="1px solid" borderColor={ui.line} bg="white" borderRadius="6px" overflow="hidden"><Flex p="18px" justify="space-between"><Box><Heading size="sm">Investigation outcomes</Heading><Text color={ui.muted} mt="4px">Mock inference requires human review. Synced means a note was added to the mock SOAR case.</Text></Box><Badge alignSelf="start">Worker: {data.worker?.status || "unknown"}</Badge></Flex><TableContainer><Table size="sm"><Thead bg={ui.soft}><Tr><Th>Investigation</Th><Th>SOAR synchronization</Th><Th>Action</Th></Tr></Thead><Tbody>{(data.cases || []).map(item => <Tr key={item.finding_id}><Td><Button variant="link" onClick={() => setView("investigationDetail", item.investigation_id)}>{item.investigation_id}</Button></Td><Td><Badge colorScheme={item.state === "synced" ? "green" : item.state === "conflict" ? "orange" : "gray"}>{item.state.replaceAll("_", " ")}</Badge></Td><Td>{item.state === "conflict" && data.scope.allow_retry ? <Button size="sm" variant="outline" onClick={() => { setReview({ ...item, kind: "soar" }); setTicket(""); }}>Review current version</Button> : "Human investigation review"}</Td></Tr>)}{!data.cases?.length && <Tr><Td colSpan={3} py="24px" color={ui.muted}>No findings admitted from this source yet.</Td></Tr>}</Tbody></Table></TableContainer></Box>
      <Box border="1px solid" borderColor={ui.line} bg="white" borderRadius="6px" overflow="hidden">
        <Flex p="18px" justify="space-between"><Box><Heading size="sm">Failure review</Heading><Text color={ui.muted} mt="4px">Retries require a review reference and current state. Rejected deliveries cannot be retried.</Text></Box><Badge alignSelf="start">{snapshot.dead_letters} dead-letter records</Badge></Flex>
        <TableContainer><Table size="sm"><Thead bg={ui.soft}><Tr><Th>Work</Th><Th>Event</Th><Th>Reason</Th><Th isNumeric>Attempts</Th><Th>Review</Th></Tr></Thead><Tbody>{data.failures.map(f => <Tr key={`${f.kind}:${f.event_key}`}><Td>{f.kind}</Td><Td fontFamily="mono" title={f.event_key}>{f.event_key.slice(0, 16)}…</Td><Td>{f.reason}</Td><Td isNumeric>{f.expected_attempts}</Td><Td><Button size="sm" variant="outline" isDisabled={!f.retry_allowed} onClick={() => { setReview({ ...f, requestId: crypto.randomUUID() }); setTicket(""); }}>Review retry</Button></Td></Tr>)}{!data.failures.length && <Tr><Td colSpan={5} py="24px" color={ui.muted}>No retryable event failures on this page.</Td></Tr>}</Tbody></Table></TableContainer>
        <Flex p="12px" gap="8px"><Button size="sm" variant="ghost" isDisabled={!after} onClick={() => setAfter("")}>First page</Button><Button size="sm" variant="ghost" isDisabled={!data.next_after} onClick={() => setAfter(data.next_after)}>Next page</Button></Flex>
      </Box>
      {data.scope.allow_mock_import && <Box bg="white" border="1px solid" borderColor={ui.line} borderRadius="6px" p="20px"><Heading size="sm">JSON investigation fixture</Heading><Text color={ui.muted} mt="6px" mb="14px">Synthetic SIEM events feed the sandbox worker, evidence review and mock SOAR notes. Import uses the current source checkpoint.</Text><Stack spacing="12px"><Flex gap="8px" wrap="wrap"><Button size="sm" variant="outline" onClick={example}>Load suspicious-login example</Button><FormControl maxW="340px"><FormLabel>Choose JSON fixture</FormLabel><Input type="file" accept="application/json,.json" p="4px" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 1024 * 1024) { setError("Fixture must be at most 1 MiB"); return; } setFixture(await file.text()); }} /></FormControl></Flex><FormControl><FormLabel>Fixture JSON</FormLabel><Textarea value={fixture} onChange={e => setFixture(e.target.value)} fontFamily="mono" fontSize="11px" minH="180px" spellCheck={false} /></FormControl><Button alignSelf="start" isLoading={busy} isDisabled={!fixture} onClick={importFixture}>Import mock events</Button>{receipt && <Alert status="success"><AlertIcon />Accepted {receipt.accepted.Inserted} new events. Replayed events are deduplicated.</Alert>}</Stack></Box>}
      {data.scope.allow_sandbox_response && <SandboxSessionResponse key={`response-${selected}`} scope={selected} />}
      <TelemetryBrowser key={selected} scope={selected} refresh={version} />
    </>}
    <Modal isOpen={!!review} onClose={() => { if (!busy) setReview(null); }}><ModalOverlay /><ModalContent><ModalHeader>{review?.kind === "soar" ? "Review SOAR version conflict" : "Review a bounded retry"}</ModalHeader><ModalCloseButton isDisabled={busy} /><ModalBody><Stack><Text>{review?.kind === "soar" ? `Rebase the draft note onto current SOAR version ${review.source_version}. Existing analyst updates are preserved. A changed version requires another review.` : "This requeues one failed event and records your review. It does not authorize a response action."}</Text>{error && <Alert status="error"><AlertIcon />{error}</Alert>}<FormControl><FormLabel>Review or incident reference</FormLabel><Input value={ticket} onChange={e => setTicket(e.target.value)} placeholder="INC-123" maxLength={128} /></FormControl>{review?.kind !== "soar" && <FormControl><FormLabel>Reason</FormLabel><Select value={reason} onChange={e => setReason(e.target.value)}><option value="configuration_corrected">Configuration corrected</option><option value="transport_restored">Transport restored</option></Select></FormControl>}</Stack></ModalBody><ModalFooter gap="8px"><Button variant="ghost" onClick={() => setReview(null)} isDisabled={busy}>Cancel</Button><Button onClick={retry} isLoading={busy} isDisabled={!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(ticket)}>{review?.kind === "soar" ? "Record review and rebase" : "Record review and retry"}</Button></ModalFooter></ModalContent></Modal>
  </Stack>;
}
