import React, { useState } from "react";
import { Button, FormControl, FormLabel, Input, Modal, ModalBody, ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalOverlay, Select, Stack, Text, Textarea } from "@chakra-ui/react";
import { api } from "./api";

export default function CreateDetectionRule({ onClose, onCreated, templates = [] }) {
  const [draft, setDraft] = useState({ name: "", description: "", severity: "medium", query: "", execution_mode: "scheduled", enabled: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async e => {
    e.preventDefault(); setBusy(true); setError("");
    try { const rule = await api.create("detection-rules", draft); onCreated(rule); onClose(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <Modal isOpen onClose={onClose} closeOnOverlayClick={!busy} closeOnEsc={!busy} size="xl"><ModalOverlay /><ModalContent as="form" onSubmit={submit}><ModalHeader>Create detection rule</ModalHeader><ModalCloseButton isDisabled={busy} /><ModalBody><Stack spacing="16px">
    <Text fontSize="12px" color="gray.600">Save a rule to the local registry. Query execution requires a connected detection engine.</Text>
    {!!templates.length && <FormControl><FormLabel>Start from a catalog template</FormLabel><Select defaultValue="" onChange={e => { const template = templates.find(t => t.id === e.target.value); if (template) setDraft(current => ({ ...current, name: template.name, description: template.description, severity: template.severity.toLowerCase(), mitre_techniques: template.techniques, query: "" })); }}><option value="" disabled>Select an optional template</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</Select><Text fontSize="11px" color="gray.600" mt="4px">Templates supply metadata; add and validate your own query logic.</Text></FormControl>}
    <FormControl isRequired><FormLabel>Name</FormLabel><Input maxLength={200} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></FormControl>
    <FormControl><FormLabel>Description</FormLabel><Textarea maxLength={4000} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></FormControl>
    <FormControl><FormLabel>Severity</FormLabel><Select value={draft.severity} onChange={e => setDraft({ ...draft, severity: e.target.value })}>{["low", "medium", "high", "critical"].map(s => <option key={s}>{s}</option>)}</Select></FormControl>
    <FormControl><FormLabel>Detection query</FormLabel><Textarea rows={5} maxLength={20000} fontFamily="mono" value={draft.query} onChange={e => setDraft({ ...draft, query: e.target.value })} /></FormControl>
    {error && <Text role="alert" color="red.600">{error}</Text>}
  </Stack></ModalBody><ModalFooter gap="10px"><Button variant="outline" isDisabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" isLoading={busy} isDisabled={!draft.name.trim()}>Create disabled rule</Button></ModalFooter></ModalContent></Modal>;
}
