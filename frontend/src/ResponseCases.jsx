import WorkspaceHeader from "./WorkspaceHeader";
import React, { useEffect, useState } from "react";
import {
  Alert,
  AlertIcon,
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  Input,
  Select,
  SimpleGrid,
  Spinner,
  Stack,
  Text,
  Textarea,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  ModalFooter,
  FormControl,
  FormLabel,
} from "@chakra-ui/react";
import { api } from "./api";
import { ui } from "./theme";
export const caseStage = (status) =>
  status === "open"
    ? "Open"
    : ["resolved", "closed"].includes(status)
      ? "Closed"
      : "In progress";
const severityRank = { critical: 0, high: 1, medium: 2, low: 3 };
export default function ResponseCases({ setView }) {
  const [items, setItems] = useState([]),
    [query, setQuery] = useState(""),
    [severity, setSeverity] = useState(""),
    [offset, setOffset] = useState(0),
    [reload, setReload] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [layout, setLayout] = useState("board"),
    [sort, setSort] = useState("priority"),
    [draft, setDraft] = useState(null),
    [busy, setBusy] = useState(false),
    [formError, setFormError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const timer = setTimeout(
      () =>
        api
          .investigations({ limit: 100, offset, search: query, severity })
          .then((r) => {
            if (active) setItems(r.items);
          })
          .catch((e) => {
            if (active) setError(e.message);
          })
          .finally(() => {
            if (active) setLoading(false);
          }),
      150,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, severity, offset, reload]);
  const visible = [...items].sort((a, b) =>
    sort === "priority"
      ? (severityRank[a.severity] ?? 4) - (severityRank[b.severity] ?? 4) ||
        b.updated_at.localeCompare(a.updated_at)
      : b.updated_at.localeCompare(a.updated_at),
  );
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setFormError("");
    try {
      if (draft.id)
        await api.update("investigations", draft.id, {
          status: draft.status,
          expected_updated_at: draft.updated_at,
        });
      else await api.create("investigations", draft);
      setDraft(null);
      setReload((n) => n + 1);
    } catch (e) {
      setFormError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const card = (c) => (
    <Box
      key={c.id}
      bg="white"
      border="1px solid"
      borderColor={ui.line}
      borderRadius="8px"
      p="18px"
    >
      <Flex justify="space-between" gap="8px">
        <Badge
          colorScheme={
            c.severity === "critical" || c.severity === "high"
              ? "red"
              : "orange"
          }
        >
          {c.severity}
        </Badge>
        <Text fontSize="10px" color={ui.muted} noOfLines={1}>
          {c.id}
        </Text>
      </Flex>
      <Heading fontSize="17px" mt="15px" lineHeight="1.4">
        {c.title}
      </Heading>
      <Flex gap="6px" mt="12px" wrap="wrap">
        <Badge variant="outline" maxW="full" whiteSpace="normal" overflowWrap="anywhere">{c.source}</Badge>
        <Badge variant="subtle">{c.category || "other"}</Badge>
      </Flex>
      <Text color={ui.muted} mt="14px" fontSize="12px" noOfLines={3}>
        {c.summary || "No summary recorded yet."}
      </Text>
      <Text mt="14px" fontSize="11px" color={ui.muted}>
        {c.status} · {c.determination}
      </Text>
      <Flex mt="16px" gap="8px" wrap="wrap">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setDraft({ ...c });
            setFormError("");
          }}
        >
          Update status
        </Button>
        <Button
          size="sm"
          ml="auto"
          onClick={() => setView("investigationDetail", c.id)}
        >
          Open case →
        </Button>
      </Flex>
    </Box>
  );
  return (
    <Box px={{ base: "14px", md: "24px" }} pb="32px">
      <WorkspaceHeader justify="space-between" wrap="wrap" gap="16px">
        <Box>
          <Text color={ui.muted} fontSize="10px" letterSpacing=".1em">
            RESPONSE OPERATIONS
          </Text>
          <Heading as="h1" mt="8px" fontSize="30px" fontWeight="500">
            Cases
          </Heading>
          <Text color={ui.muted} mt="8px">
            Move from investigation to a reviewed response.
          </Text>
        </Box>
        <Button
          onClick={() => {
            setDraft({
              title: "",
              source: "Manual",
              severity: "medium",
              summary: "",
              status: "open",
              determination: "unknown",
            });
            setFormError("");
          }}
        >
          Create case
        </Button>
      </WorkspaceHeader>
      <Flex my="24px" gap="10px" wrap="wrap">
        <Input
          bg="white"
          maxW="330px"
          aria-label="Search cases"
          placeholder="Search cases…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOffset(0);
          }}
        />
        <Select
          maxW="160px"
          bg="white"
          aria-label="Case severity"
          value={severity}
          onChange={(e) => {
            setSeverity(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">All severities</option>
          {["critical", "high", "medium", "low"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </Select>
        <Select
          maxW="175px"
          bg="white"
          aria-label="Sort cases"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="priority">Priority (this page)</option>
          <option value="updated">Recently updated</option>
        </Select>
        <Button
          aria-pressed={layout === "board"}
          variant={layout === "board" ? "solid" : "outline"}
          onClick={() => setLayout("board")}
        >
          Board
        </Button>
        <Button
          aria-pressed={layout === "list"}
          variant={layout === "list" ? "solid" : "outline"}
          onClick={() => setLayout("list")}
        >
          List
        </Button>
        <Button variant="outline" onClick={() => setReload((n) => n + 1)}>
          Refresh
        </Button>
      </Flex>
      {error ? (
        <Alert status="error">
          <AlertIcon />
          {error}
        </Alert>
      ) : loading ? (
        <Spinner />
      ) : (
        <>
          <Text mb="12px" fontSize="11px" color={ui.muted}>
            {items.length} cases on this page. Includes cases without
            remediation actions.
          </Text>
          {layout === "board" ? (
            <SimpleGrid columns={{ base: 1, xl: 3 }} gap="18px">
              {["Open", "In progress", "Closed"].map((stage) => (
                <Box key={stage} bg="#f0f3f6" borderRadius="10px" p="12px">
                  <Flex px="5px" pb="14px" justify="space-between">
                    <Heading fontSize="15px">{stage}</Heading>
                    <Badge>
                      {
                        visible.filter((c) => caseStage(c.status) === stage)
                          .length
                      }
                    </Badge>
                  </Flex>
                  <Stack spacing="12px">
                    {visible
                      .filter((c) => caseStage(c.status) === stage)
                      .map(card)}
                  </Stack>
                  {!visible.some((c) => caseStage(c.status) === stage) && (
                    <Text p="20px" color={ui.muted}>
                      No cases on this page.
                    </Text>
                  )}
                </Box>
              ))}
            </SimpleGrid>
          ) : (
            <Stack spacing="12px">
              {visible.map(card)}
              {!visible.length && <Text>No matching cases.</Text>}
            </Stack>
          )}
          <Flex mt="20px" gap="12px" align="center">
            <Button
              variant="outline"
              isDisabled={!offset}
              onClick={() => setOffset((n) => Math.max(0, n - 100))}
            >
              Previous
            </Button>
            <Text>Page {offset / 100 + 1}</Text>
            <Button
              variant="outline"
              isDisabled={items.length < 100}
              onClick={() => setOffset((n) => n + 100)}
            >
              Next
            </Button>
          </Flex>
        </>
      )}
      <Modal isOpen={Boolean(draft)} onClose={() => !busy && setDraft(null)}>
        <ModalOverlay />
        <ModalContent as="form" onSubmit={save}>
          <ModalHeader>
            {draft?.id ? "Update case status" : "Create case"}
          </ModalHeader>
          <ModalCloseButton isDisabled={busy} />
          <ModalBody>
            {formError && (
              <Alert status="error" mb="12px">
                <AlertIcon />
                {formError}
              </Alert>
            )}
            {draft && (
              <Stack spacing="14px">
                {draft.id ? (
                  <>
                    <Text>{draft.title}</Text>
                    <FormControl>
                      <FormLabel>Status</FormLabel>
                      <Select
                        value={draft.status}
                        onChange={(e) =>
                          setDraft({ ...draft, status: e.target.value })
                        }
                      >
                        {[
                          "open",
                          "investigating",
                          "contained",
                          "resolved",
                          "closed",
                        ].map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </Select>
                    </FormControl>
                    <Text fontSize="12px" color={ui.muted}>
                      This records a local case status. It does not contain an
                      asset or update a provider.
                    </Text>
                  </>
                ) : (
                  <>
                    <FormControl isRequired>
                      <FormLabel>Title</FormLabel>
                      <Input
                        required
                        maxLength={200}
                        value={draft.title}
                        onChange={(e) =>
                          setDraft({ ...draft, title: e.target.value })
                        }
                      />
                    </FormControl>
                    <FormControl isRequired>
                      <FormLabel>Source</FormLabel>
                      <Input
                        required
                        maxLength={200}
                        value={draft.source}
                        onChange={(e) =>
                          setDraft({ ...draft, source: e.target.value })
                        }
                      />
                    </FormControl>
                    <FormControl>
                      <FormLabel>Severity</FormLabel>
                      <Select
                        value={draft.severity}
                        onChange={(e) =>
                          setDraft({ ...draft, severity: e.target.value })
                        }
                      >
                        {["critical", "high", "medium", "low"].map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </Select>
                    </FormControl>
                    <FormControl>
                      <FormLabel>Summary</FormLabel>
                      <Textarea
                        maxLength={4000}
                        value={draft.summary}
                        onChange={(e) =>
                          setDraft({ ...draft, summary: e.target.value })
                        }
                      />
                    </FormControl>
                  </>
                )}
              </Stack>
            )}
          </ModalBody>
          <ModalFooter>
            <Button
              variant="ghost"
              isDisabled={busy}
              onClick={() => setDraft(null)}
            >
              Cancel
            </Button>
            <Button type="submit" isLoading={busy}>
              Save
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
}
