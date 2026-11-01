import { useEffect, useRef, useState } from "react";
import {
  Alert,
  AlertIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Flex,
  FormControl,
  FormLabel,
  Heading,
  Input,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Stack,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { api } from "./api";
import { ui } from "./theme";
const example = {
  schema_version: "1",
  source: "local-demo",
  external_id: "intel-login-001",
  title: "Local suspicious-login indicators",
  summary: "Synthetic intelligence for local evidence review.",
  severity: "medium",
  published_at: "2026-11-01T00:00:00Z",
  tags: ["demo"],
  indicators: [
    { type: "ip", value: "203.0.113.77" },
    { type: "domain", value: "EXAMPLE.TEST." },
    { type: "domain", value: "example.test" },
  ],
};
function useActive() {
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  return active;
}
export function IntelJSONImport({ onClose, onImported }) {
  const [text, setText] = useState(JSON.stringify(example, null, 2)),
    [preview, setPreview] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const active = useActive();
  const change = (value) => {
    setText(value);
    setPreview(null);
    setError("");
  };
  const file = async (event) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    setPreview(null);
    setBusy(true);
    setError("");
    try {
      if (selected.size > 1048576)
        throw new Error("JSON files must be at most 1 MiB.");
      const value = await selected.text();
      if (active.current) change(value);
    } catch (e) {
      if (active.current) setError(e.message);
    } finally {
      if (active.current) setBusy(false);
    }
  };
  const submit = async (importing) => {
    setBusy(true);
    setError("");
    try {
      if (new TextEncoder().encode(text).length > 1048576)
        throw new Error("JSON must be at most 1 MiB.");
      const result = await api.request(
        `/threat-intel/import${importing ? "" : "/preview"}`,
        { method: "POST", body: JSON.parse(text) },
      );
      if (active.current) {
        if (importing) onImported(result.report_id);
        else setPreview(result);
      }
    } catch (e) {
      if (active.current) setError(e.message);
    } finally {
      if (active.current) setBusy(false);
    }
  };
  return (
    <Modal isOpen onClose={onClose} size="3xl">
      <ModalOverlay />
      <ModalContent mx="12px">
        <ModalHeader>Import intelligence JSON</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Stack spacing="16px">
            <Text color={ui.muted}>
              Local data only. Validate up to 200 IP, domain, URL, SHA-256 or
              MD5 indicators. URLs are never fetched. The source and external ID
              identify an import; changed content requires a new external ID.
            </Text>
            <FormControl>
              <FormLabel>JSON file</FormLabel>
              <Input
                type="file"
                accept=".json,application/json"
                onChange={file}
                isDisabled={busy}
              />
            </FormControl>
            <FormControl>
              <FormLabel>Intelligence JSON</FormLabel>
              <Textarea
                fontFamily="mono"
                rows={12}
                value={text}
                onChange={(e) => change(e.target.value)}
                isDisabled={busy}
              />
            </FormControl>
            {error && (
              <Alert status="error">
                <AlertIcon />
                {error}
              </Alert>
            )}
            {preview && (
              <Box p="16px" bg={ui.soft} borderRadius="6px">
                <Heading size="sm">Validation passed</Heading>
                <Text mt="8px">
                  {preview.received} submitted · {preview.unique} unique ·{" "}
                  {preview.duplicates} duplicates removed
                </Text>
                <Text fontSize="xs" mt="8px">
                  Normalized indicators
                </Text>
                {preview.document.indicators.map((i) => (
                  <Text key={`${i.type}:${i.value}`} overflowWrap="anywhere">
                    {i.type}: {i.value} · {i.severity}
                  </Text>
                ))}
                <Text mt="8px" fontSize="xs">
                  Identical imports reuse the existing report. Indicators from
                  different reports retain their own provenance.
                </Text>
              </Box>
            )}
          </Stack>
        </ModalBody>
        <ModalFooter gap="10px" flexWrap="wrap">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={() => submit(false)}
            isDisabled={busy}
          >
            Validate JSON
          </Button>
          <Button
            onClick={() => submit(true)}
            isDisabled={busy || !preview}
            isLoading={busy}
          >
            Import validated JSON
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
export function PromoteFinding({
  huntID,
  runID,
  finding,
  promotions = [],
  setView,
  onSaved,
}) {
  const [open, setOpen] = useState(false),
    [comment, setComment] = useState(""),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(null);
  const active = useActive();
  const prior =
    saved ||
    promotions.find(
      (p) =>
        p.run_id === runID &&
        p.finding.kind === finding.kind &&
        p.finding.record_id === finding.record_id,
    );
  const promote = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await api.action("hunts", huntID, "promote", {
        run_id: runID,
        record_id: finding.record_id,
        kind: finding.kind,
        comment,
        confirm,
      });
      if (active.current) {
        setSaved(result);
        setOpen(false);
        onSaved?.();
      }
    } catch (e) {
      if (active.current) setError(e.message);
    } finally {
      if (active.current) setBusy(false);
    }
  };
  if (prior)
    return (
      <Box mt="12px">
        {prior.available ? (
          <Button
            size="sm"
            onClick={() =>
              setView("investigationDetail", prior.investigation_id)
            }
          >
            Open promoted investigation →
          </Button>
        ) : (
          <Text>
            Promoted investigation was deleted. This finding will not create a
            duplicate.
          </Text>
        )}
      </Box>
    );
  return (
    <>
      <Button
        size="sm"
        mt="12px"
        ml={{ base: 0, md: "8px" }}
        onClick={() => setOpen(true)}
      >
        Promote to investigation
      </Button>
      <Modal isOpen={open} onClose={() => setOpen(false)}>
        <ModalOverlay />
        <ModalContent mx="12px">
          <ModalHeader>Review and promote finding</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Stack spacing="14px">
              <Badge alignSelf="start">Local evidence · analyst review</Badge>
              <Text>{finding.label}</Text>
              <Text fontSize="sm">
                Create an open investigation with an unknown determination. The
                stored hunt query and evidence snapshot will be retained. This
                does not confirm a threat, run AI, or execute a response.
              </Text>
              <FormControl isRequired>
                <FormLabel>Promotion review comment</FormLabel>
                <Textarea
                  value={comment}
                  maxLength={2000}
                  onChange={(e) => setComment(e.target.value)}
                  isDisabled={busy}
                />
              </FormControl>
              <Checkbox
                isChecked={confirm}
                onChange={(e) => setConfirm(e.target.checked)}
                isDisabled={busy}
              >
                I reviewed this saved finding and want to investigate it.
              </Checkbox>
              {error && (
                <Alert status="error">
                  <AlertIcon />
                  {error}
                </Alert>
              )}
            </Stack>
          </ModalBody>
          <ModalFooter>
            <Button
              onClick={promote}
              isLoading={busy}
              isDisabled={!confirm || comment.trim().length < 10}
            >
              Confirm promotion
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
export function HuntOrigin({ caseID, setView }) {
  const [items, setItems] = useState([]),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api
      .request(`/investigations/${encodeURIComponent(caseID)}/hunt-origin`)
      .then((r) => {
        if (active) {
          setItems(r.items);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [caseID]);
  if (error)
    return (
      <Alert status="warning">
        <AlertIcon />
        Hunt provenance could not be loaded: {error}
      </Alert>
    );
  return items.map((p) => (
    <Box
      key={p.run_id}
      p="18px"
      mb="20px"
      border="1px solid"
      borderColor={ui.line}
      bg="white"
      borderRadius="6px"
      overflowWrap="anywhere"
    >
      <Badge colorScheme="blue">Hunt evidence provenance</Badge>
      <Heading size="sm" mt="10px">
        Analyst-promoted local match
      </Heading>
      <Text mt="8px">Query: {p.query}</Text>
      <Text mt="8px" whiteSpace="pre-wrap">
        {p.finding.excerpt}
      </Text>
      <Text mt="10px">Review: {p.comment}</Text>
      <Text mt="6px" fontSize="xs" color={ui.muted}>
        {p.actor} · {new Date(p.created_at).toLocaleString()} · Run {p.run_id}
      </Text>
      <Flex gap="10px" mt="14px" wrap="wrap">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setView("huntDetail", p.hunt_id)}
        >
          Source hunt
        </Button>
        {p.report_id && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setView("threatIntelDetail", p.report_id)}
          >
            Source intelligence report
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => setView("investigationDetail", p.finding.case_id)}
        >
          Original evidence case
        </Button>
      </Flex>
      <Text fontSize="xs" mt="12px" color={ui.muted}>
        Snapshot retained at promotion. A literal match requires investigation
        and is not a confirmed threat. Source records may later change or be
        deleted.
      </Text>
    </Box>
  ));
}
