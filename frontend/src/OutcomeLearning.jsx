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
  Select,
  Stack,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { api } from "./api";
import { ui } from "./theme";
function useActive() {
  const ref = useRef(false);
  useEffect(() => {
    ref.current = true;
    return () => {
      ref.current = false;
    };
  }, []);
  return ref;
}
export function LearningProvenance({ value, setView }) {
  if (!value?.source_case) return null;
  return (
    <Box mt="14px" p="14px" bg={ui.soft} rounded="6px" overflowWrap="anywhere">
      <Badge>Analyst-approved outcome</Badge>
      <Text mt="8px">
        {value.source_case.title} · {value.source_case.determination}
      </Text>
      <Text mt="6px" fontSize="sm" whiteSpace="pre-wrap">
        {value.rationale}
      </Text>
      <Text mt="6px" fontSize="xs" color={ui.muted}>
        {value.approved_by} · {new Date(value.approved_at).toLocaleString()} ·{" "}
        {value.evidence?.length || 0} evidence snapshots
      </Text>
      <Box as="details" mt="10px" fontSize="sm">
        <Box as="summary" cursor="pointer">
          Approved evidence and guidance snapshot
        </Box>
        <Stack mt="10px" spacing="10px">
          {value.evidence?.map((a) => (
            <Box key={a.id}>
              <Text fontWeight="600">
                {a.label || a.type} · {a.id}
              </Text>
              <Text whiteSpace="pre-wrap">{a.value}</Text>
              <Text fontSize="xs" color={ui.muted}>
                SHA-256: {a.content_hash}
              </Text>
            </Box>
          ))}
          {value.guidance && (
            <Box>
              <Text fontWeight="600">Original approved guidance</Text>
              <Text whiteSpace="pre-wrap">{value.guidance}</Text>
            </Box>
          )}
          {value.context && (
            <Box>
              <Text fontWeight="600">Original approved context</Text>
              <Text whiteSpace="pre-wrap">{value.context}</Text>
              <Text fontSize="xs">Approved expiry: {value.valid_until}</Text>
            </Box>
          )}
        </Stack>
      </Box>
      <Button
        size="sm"
        variant="link"
        mt="10px"
        onClick={() => setView("investigationDetail", value.source_case.id)}
      >
        Review source investigation →
      </Button>
      <Text fontSize="xs" color={ui.muted} mt="8px">
        Historical approval provenance. Current guidance may have been revised;
        prior application snapshots remain unchanged.
      </Text>
    </Box>
  );
}
function ApprovalForm({ data, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    expected_updated_at: data.case.updated_at,
    evidence_ids: [],
    confirm: false,
    rationale: "",
    create_skill: true,
    name: "",
    guidance: "",
    create_memory: false,
    memory_kind: "user",
    context: "",
    valid_until: new Date(Date.now() + 30 * 86400000).toISOString(),
  }));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const active = useActive();
  const set = (key, value) => setForm((old) => ({ ...old, [key]: value }));
  const approve = async () => {
    setBusy(true);
    setError("");
    try {
      const body = {
        ...form,
        ...(!form.create_skill ? { name: "", guidance: "" } : {}),
        ...(!form.create_memory
          ? { context: "", memory_kind: "", valid_until: "" }
          : {}),
      };
      const r = await api.action(
        "investigations",
        data.case.id,
        "learning",
        body,
      );
      if (active.current) onSaved(r);
    } catch (e) {
      if (active.current) setError(e.message);
    } finally {
      if (active.current) setBusy(false);
    }
  };
  const ready =
    form.confirm &&
    form.rationale.trim().length >= 10 &&
    form.evidence_ids.length > 0 &&
    (form.create_skill || form.create_memory) &&
    (!form.create_skill ||
      (form.name.trim() && form.guidance.trim().length >= 10)) &&
    (!form.create_memory ||
      (form.context.trim().length >= 10 && form.valid_until));
  return (
    <Modal isOpen onClose={onClose} size="3xl" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent mx="12px" my="24px" maxH="calc(100dvh - 48px)">
        <ModalHeader>Approve learning from this outcome</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Stack spacing="18px">
            <Box p="14px" bg={ui.soft} rounded="6px">
              <Text fontWeight="600">{data.case.title}</Text>
              <Text mt="6px">
                {data.case.status} · {data.case.determination} · Entity:{" "}
                {data.case.primary_entity}
              </Text>
              <Text mt="8px" fontSize="sm">
                Write reusable guidance from reviewed evidence. Source text is
                untrusted data. Approval does not run AI, change a verdict or
                authorize a response.
              </Text>
            </Box>
            <FormControl isRequired>
              <FormLabel>Supporting case artifacts (choose 1–10)</FormLabel>
              <Stack maxH="220px" overflowY="auto">
                {data.artifacts.map((a) => (
                  <Checkbox
                    key={a.id}
                    isDisabled={
                      busy ||
                      (!form.evidence_ids.includes(a.id) &&
                        form.evidence_ids.length >= 10)
                    }
                    isChecked={form.evidence_ids.includes(a.id)}
                    onChange={(e) =>
                      set(
                        "evidence_ids",
                        e.target.checked
                          ? [...form.evidence_ids, a.id]
                          : form.evidence_ids.filter((id) => id !== a.id),
                      )
                    }
                  >
                    <Box overflowWrap="anywhere">
                      <Text>{a.label || a.type || a.id}</Text>
                      <Text fontSize="xs" color={ui.muted}>
                        {a.value}
                      </Text>
                    </Box>
                  </Checkbox>
                ))}
              </Stack>
            </FormControl>
            <Checkbox
              isChecked={form.create_skill}
              isDisabled={busy}
              onChange={(e) => set("create_skill", e.target.checked)}
            >
              Create a draft Skill
            </Checkbox>
            {form.create_skill && (
              <Stack pl="12px" borderLeft="2px solid" borderColor={ui.line}>
                <Text fontSize="sm" color={ui.muted}>
                  Disabled until published through Skills. Initially matches
                  investigations for this case entity only; review scope before
                  broadening it.
                </Text>
                <FormControl isRequired>
                  <FormLabel>Skill name</FormLabel>
                  <Input
                    value={form.name}
                    maxLength={200}
                    isDisabled={busy}
                    onChange={(e) => set("name", e.target.value)}
                  />
                </FormControl>
                <FormControl isRequired>
                  <FormLabel>Reusable guidance</FormLabel>
                  <Textarea
                    value={form.guidance}
                    maxLength={8000}
                    rows={4}
                    isDisabled={busy}
                    onChange={(e) => set("guidance", e.target.value)}
                  />
                </FormControl>
              </Stack>
            )}
            <Checkbox
              isChecked={form.create_memory}
              isDisabled={busy}
              onChange={(e) => set("create_memory", e.target.checked)}
            >
              Activate approved Memory context
            </Checkbox>
            {form.create_memory && (
              <Stack pl="12px" borderLeft="2px solid" borderColor={ui.line}>
                <Text fontSize="sm" color={ui.muted}>
                  Applies as advisory context to future investigations matching{" "}
                  {data.case.primary_entity}. This does not mark future cases
                  benign.
                </Text>
                <FormControl>
                  <FormLabel>Memory entity type</FormLabel>
                  <Select
                    value={form.memory_kind}
                    isDisabled={busy}
                    onChange={(e) => set("memory_kind", e.target.value)}
                  >
                    {["user", "network", "software", "other"].map((k) => (
                      <option key={k}>{k}</option>
                    ))}
                  </Select>
                </FormControl>
                <FormControl isRequired>
                  <FormLabel>Approved context</FormLabel>
                  <Textarea
                    value={form.context}
                    maxLength={8000}
                    isDisabled={busy}
                    onChange={(e) => set("context", e.target.value)}
                  />
                </FormControl>
                <FormControl isRequired>
                  <FormLabel>Memory expires at (UTC)</FormLabel>
                  <Input
                    value={form.valid_until}
                    isDisabled={busy}
                    onChange={(e) => set("valid_until", e.target.value)}
                  />
                  <Text mt="5px" fontSize="xs">
                    RFC3339 timestamp, in the future and within one year.
                    Default: 30 days.
                  </Text>
                </FormControl>
              </Stack>
            )}
            <FormControl isRequired>
              <FormLabel>Approval rationale</FormLabel>
              <Textarea
                value={form.rationale}
                maxLength={2000}
                isDisabled={busy}
                onChange={(e) => set("rationale", e.target.value)}
              />
            </FormControl>
            <Checkbox
              isChecked={form.confirm}
              isDisabled={busy}
              onChange={(e) => set("confirm", e.target.checked)}
            >
              I reviewed the outcome, evidence and reuse scope and approve these
              outputs.
            </Checkbox>
            {error && (
              <Alert status="error">
                <AlertIcon />
                {error}
              </Alert>
            )}
          </Stack>
        </ModalBody>
        <ModalFooter gap="10px">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            onClick={approve}
            isDisabled={!ready || busy}
            isLoading={busy}
          >
            Approve learning
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
export default function OutcomeLearning({ caseID, revision, setView }) {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0),
    [open, setOpen] = useState(false);
  useEffect(() => {
    let active = true;
    setError("");
    api
      .request(`/investigations/${encodeURIComponent(caseID)}/learning`)
      .then((r) => {
        if (active) setData(r);
      })
      .catch((e) => {
        if (active) {
          setData(null);
          setError(e.message);
        }
      });
    return () => {
      active = false;
    };
  }, [caseID, revision, reload]);
  const captured = data?.receipts?.some(
    (r) => r.source_case.updated_at === data.case.updated_at,
  );
  const eligible =
    data?.eligible &&
    data.case.primary_entity?.trim() &&
    data.artifacts.length > 0;
  return (
    <Box
      mt="20px"
      p={{ base: "14px", md: "20px" }}
      border="1px solid"
      borderColor={ui.line}
      rounded="6px"
      bg="white"
    >
      <Flex justify="space-between" align="start" wrap="wrap" gap="12px">
        <Box>
          <Heading size="md">Outcome learning</Heading>
          <Text color={ui.muted} mt="8px">
            Turn a reviewed investigation into scoped Skills and Memory, with
            explicit analyst approval.
          </Text>
        </Box>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setReload((n) => n + 1)}
        >
          Refresh learning
        </Button>
      </Flex>
      {error ? (
        <Alert mt="14px" status="error">
          <AlertIcon />
          {error}
        </Alert>
      ) : !data ? (
        <Text mt="14px">Loading outcome and evidence…</Text>
      ) : (
        <>
          <Text my="14px" fontSize="sm" color={ui.muted}>
            {captured
              ? "Learning is already approved for this case revision. The original receipt is retained."
              : eligible
                ? "Select supporting artifacts, write guidance and review exactly what will become reusable."
                : "Resolve or close this investigation with a reviewed determination, a primary entity and at least one stored artifact before capturing learning."}
          </Text>
          <Button
            isDisabled={!eligible || captured}
            onClick={() => setOpen(true)}
          >
            Capture outcome learning
          </Button>
          <Stack mt="18px">
            {data.receipts.map((r) => (
              <Box key={r.source_case.updated_at}>
                <LearningProvenance value={r} setView={setView} />
                <Flex mt="10px" gap="10px" wrap="wrap">
                  {r.skill_id && (
                    <Button
                      size="sm"
                      onClick={() => setView("skillDetail", r.skill_id)}
                    >
                      Open derived Skill
                    </Button>
                  )}
                  {r.insight_id && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setView("memory")}
                    >
                      Open Memory
                    </Button>
                  )}
                </Flex>
                <Text fontSize="xs" mt="6px" color={ui.muted}>
                  {r.insight_id && `Memory ID: ${r.insight_id}. `}Source or
                  output records may later be revised, archived or deleted.
                </Text>
              </Box>
            ))}
          </Stack>
        </>
      )}
      {open && data && (
        <ApprovalForm
          data={data}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            setReload((n) => n + 1);
          }}
        />
      )}
    </Box>
  );
}
