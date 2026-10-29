import React, { useState } from "react";
import { Alert, AlertIcon, Box, Button, Flex, FormControl, FormLabel, Heading, Input, Stack, Text } from "@chakra-ui/react";
import { api } from "./api";
import { ui } from "./theme";

export default function SandboxSessionResponse({ scope }) {
  const [session, setSession] = useState("demo-session-01"), [ticket, setTicket] = useState("DEMO-REVIEW-01");
  const [action, setAction] = useState(null), [version, setVersion] = useState(null), [result, setResult] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const run = async operation => {
    setBusy(true); setError("");
    const id = operation === "propose" ? crypto.randomUUID() : action;
    try {
      const value = await api.request(`/stream-operations/${encodeURIComponent(scope)}/sandbox-session`, { method: "POST", body: { operation: operation.startsWith("policy_") ? "policy" : operation, stopped: operation !== "policy_enable", id: id || "", session_id: session, principal_ref: "demo-user", ticket, expected_version: version || 1 } });
      setResult(value);
      if (operation === "create_session") { setVersion(value.version); setAction(null); }
      if (operation === "propose") setAction(id);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <Box bg="white" border="1px solid" borderColor={ui.line} borderRadius="6px" p="20px"><Stack spacing="12px">
    <Heading size="sm">Sandbox session revocation</Heading>
    <Text color={ui.muted}>Local identity simulation. Create a session, propose revocation, approve, preview and execute. The kill switch starts enabled. Revoked sessions stay revoked; use a new session ID to simulate reauthentication.</Text>
    <Flex gap="12px"><FormControl><FormLabel>Session ID</FormLabel><Input value={session} onChange={e => { setSession(e.target.value); setVersion(null); setAction(null); }} /></FormControl><FormControl><FormLabel>Review reference</FormLabel><Input value={ticket} onChange={e => setTicket(e.target.value)} /></FormControl></Flex>
    {error && <Alert status="error"><AlertIcon />{error}</Alert>}
    <Flex gap="8px" wrap="wrap">{[["create_session", "Create / inspect session", false], ["propose", "Propose revocation", !version], ["approve", "Approve for 5 minutes", !action], ["dry_run", "Preview decision", !action], ["execute", "Execute sandbox revocation", !action], ["policy_enable", "Enable sandbox execution", false], ["policy_stop", "Stop sandbox execution", false]].map(([op, label, disabled]) => <Button key={op} size="sm" variant="outline" isDisabled={busy || disabled || !ticket || !session} onClick={() => run(op)}>{label}</Button>)}</Flex>
    {action && <Text fontFamily="mono" fontSize="12px">Action: {action}</Text>}
    {result && <Box as="pre" bg={ui.soft} p="12px" whiteSpace="pre-wrap" fontSize="12px">{JSON.stringify(result, null, 2)}</Box>}
  </Stack></Box>;
}
