import React, { useEffect, useState } from "react";
import { Alert, AlertIcon, Badge, Box, Button, Flex, FormControl, FormLabel, Grid, Heading, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Select, Stack, Table, TableContainer, Tbody, Td, Text, Th, Thead, Tr, useToast } from "@chakra-ui/react";
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
  const [version, setVersion] = useState(0);
  const toast = useToast();
  useEffect(() => {
    let active = true;
    Promise.all([api.list("api-sources"), api.detectionRules()]).then(([result, registry]) => {
      if (active) { setSources(result.items); setRules(registry.items); setError(""); }
    }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [version]);
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
  const example = receipt ? JSON.stringify({ external_id: "provider-event-001", title: "Unusual outbound connection", severity: "high", primary_entity: "workstation-01", evidence: [{ type: "domain", value: "example.test" }] }, null, 2) : "";
  return <Box p={{ base: "16px", md: "28px" }} maxW="1400px" mx="auto" className="page-enter">
    <Flex align="center" gap="12px" wrap="wrap" mb="24px"><Box flex="1"><Text color={ui.muted} fontSize="10px" letterSpacing=".1em">BUILD / PROVIDER-NEUTRAL INTAKE</Text><Heading fontSize="26px" mt="6px">API sources</Heading><Text color={ui.muted} mt="8px">Connect cloud, on-premises, and custom systems through a shared alert API.</Text></Box><Button variant="outline" onClick={() => setView("investigations")}>Investigations</Button><Button isDisabled={loading} onClick={() => { setError(""); setCreating(true); }}>Add API source</Button></Flex>
    <Box p="20px" rounded="6px" bg="white" border="1px solid" borderColor={ui.line} mb="20px"><Heading fontSize="15px">One source. One rule. One scoped key.</Heading><Text mt="8px" color={ui.muted}>Each key can submit alerts only to its own endpoint. It cannot read cases or change workspace settings. Map your provider's native events to the normalized JSON format before sending them.</Text></Box>
    {error && !creating && <Alert status="error" mb="16px"><AlertIcon />{error}</Alert>}
    <TableContainer bg="white" border="1px solid" borderColor={ui.line} rounded="6px"><Table size="sm"><Thead><Tr>{["Source", "Detection rule", "Key status", "Expires", "Actions"].map(label => <Th key={label}>{label}</Th>)}</Tr></Thead><Tbody>{sources.map(source => <Tr key={source.id}>
      <Td py="18px"><Text fontWeight="600">{source.name}</Text><Text fontSize="11px" color={ui.muted} mt="4px">{source.provider}</Text></Td><Td maxW="300px" whiteSpace="normal">{rules.find(rule => rule.id === source.rule_id)?.name || source.rule_id}</Td><Td><Badge colorScheme={source.status === "active" ? "green" : "gray"}>{source.status}</Badge></Td><Td fontSize="11px">{new Date(source.expires_at).toLocaleString()}</Td><Td><Flex gap="8px"><Button variant="outline" onClick={() => setConfirm({ action: "rotate", source })}>Rotate key</Button><Button variant="ghost" isDisabled={source.status === "revoked"} onClick={() => setConfirm({ action: "revoke", source })}>Revoke</Button></Flex></Td>
    </Tr>)}</Tbody></Table>{!sources.length && <Text p="28px" color={ui.muted}>{loading ? "Loading sources…" : "No API sources yet. Add a source to issue its first ingestion key."}</Text>}</TableContainer>
    <Text color={ui.muted} fontSize="11px" mt="12px">Latest 100 sources. Key values are shown only when issued; they cannot be retrieved later.</Text>
    <Modal isOpen={creating} onClose={() => setCreating(false)} closeOnOverlayClick={!busy} closeOnEsc={!busy}><ModalOverlay /><ModalContent as="form" onSubmit={create}><ModalHeader>Add API source</ModalHeader><ModalCloseButton isDisabled={busy} /><ModalBody><Stack spacing="16px">
      <FormControl isRequired><FormLabel>Source name</FormLabel><Input maxLength={200} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></FormControl>
      <FormControl isRequired><FormLabel>Provider label</FormLabel><Input maxLength={100} value={draft.provider} onChange={e => setDraft({ ...draft, provider: e.target.value })} placeholder="Custom, Sentinel, Splunk…" /></FormControl>
      <FormControl isRequired><FormLabel>Detection rule</FormLabel><Select value={draft.rule_id} onChange={e => setDraft({ ...draft, rule_id: e.target.value })}><option value="">Select a rule</option>{rules.map(rule => <option key={rule.id} value={rule.id}>{rule.name}{rule.enabled ? "" : " (disabled)"}</option>)}</Select></FormControl>
      <FormControl><FormLabel>Key validity (days)</FormLabel><Input type="number" min={1} max={365} value={draft.expires_in_days} onChange={e => setDraft({ ...draft, expires_in_days: Number(e.target.value) })} /></FormControl>
      {error && <Alert status="error"><AlertIcon />{error}</Alert>}
    </Stack></ModalBody><ModalFooter gap="12px"><Button variant="outline" isDisabled={busy} onClick={() => setCreating(false)}>Cancel</Button><Button type="submit" isLoading={busy} isDisabled={!draft.name.trim() || !draft.provider.trim() || !draft.rule_id}>Create source</Button></ModalFooter></ModalContent></Modal>
    <Modal isOpen={!!confirm} onClose={() => setConfirm(null)} closeOnOverlayClick={!busy} closeOnEsc={!busy}><ModalOverlay /><ModalContent><ModalHeader>{confirm?.action === "rotate" ? "Rotate ingestion key?" : "Revoke ingestion key?"}</ModalHeader><ModalCloseButton isDisabled={busy} /><ModalBody><Text>The current key for <b>{confirm?.source.name}</b> will stop working immediately.{confirm?.action === "rotate" ? " A replacement key valid for 30 days will be shown once. Update your sender to use it." : " Existing alerts and investigations are retained."}</Text>{error && <Alert status="error" mt="12px"><AlertIcon />{error}</Alert>}</ModalBody><ModalFooter gap="12px"><Button variant="outline" isDisabled={busy} onClick={() => setConfirm(null)}>Cancel</Button><Button isLoading={busy} onClick={changeKey}>Confirm {confirm?.action}</Button></ModalFooter></ModalContent></Modal>
    <Modal isOpen={!!receipt} onClose={() => setReceipt(null)} size="xl"><ModalOverlay /><ModalContent><ModalHeader>Save the ingestion key</ModalHeader><ModalCloseButton /><ModalBody><Stack spacing="14px"><Text>This key is shown once. Store it in your sender's secret manager. Closing this window removes it from the page.</Text><FormControl><FormLabel>Ingestion key</FormLabel><Input type="password" value={receipt?.api_key || ""} isReadOnly autoComplete="off" /></FormControl><Button variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(receipt.api_key); toast({ title: "Key copied", status: "success", duration: 2000 }); } catch { setError("Clipboard unavailable. Select and copy the key field directly."); } }}>Copy key</Button><Text fontSize="12px" fontWeight="600">POST {receipt?.source.intake_path}</Text><Text fontSize="12px">Authorization: Bearer &lt;ingestion-key&gt;<br />Content-Type: application/json</Text><Box as="pre" bg={ui.nav} color="white" p="16px" rounded="5px" fontSize="11px" whiteSpace="pre-wrap">{example}</Box><Text fontSize="11px" color={ui.muted}>Use the same external_id for retries. The source's tenant and rule are determined by the key, not by payload fields.</Text></Stack></ModalBody><ModalFooter><Button onClick={() => setReceipt(null)}>I have saved the key</Button></ModalFooter></ModalContent></Modal>
  </Box>;
}
