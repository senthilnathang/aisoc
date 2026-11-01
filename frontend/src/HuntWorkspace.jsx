import { PromoteFinding } from "./IntelHuntFlow";
import WorkspaceHeader from "./WorkspaceHeader";
import React, { useEffect, useState } from "react";
import {
  Alert,
  AlertIcon,
  Badge,
  Box,
  Button,
  Flex,
  Grid,
  Heading,
  Input,
  Select,
  Spinner,
  Stack,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
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
const Panel = ({ children, ...p }) => (
  <Box
    bg="white"
    border="1px solid"
    borderColor={ui.line}
    borderRadius="6px"
    {...p}
  >
    {children}
  </Box>
);
const time = (v) => (v ? new Date(v).toLocaleString() : "—");
export default function HuntWorkspace({ id, mode = "hunts", setView }) {
  const [items, setItems] = useState([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [offset, setOffset] = useState(0),
    [reload, setReload] = useState(0),
    [draft, setDraft] = useState(null),
    [busy, setBusy] = useState(false),
    [formError, setFormError] = useState("");
  useEffect(() => {
    if (id) return;
    let active = true;
    setLoading(true);
    setError("");
    const timer = setTimeout(
      () =>
        api
          .list(mode === "intel" ? "threat-intel-reports" : "hunts", {
            search: query,
            limit: 50,
            offset,
          })
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
  }, [id, mode, query, offset, reload]);
  if (id) return <HuntDetail key={id} id={id} setView={setView} />;
  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    setFormError("");
    try {
      if (draft.kind === "report") {
        await api.create("threat-intel-reports", {
          title: draft.title,
          summary: draft.summary,
          source: draft.source,
          severity: draft.severity,
        });
        setReload((n) => n + 1);
        setDraft(null);
      } else {
        const h = await api.create("hunts", {
          name: draft.title,
          query: draft.query,
          source: draft.source || "ad_hoc",
        });
        setDraft(null);
        setView("huntDetail", h.id);
      }
    } catch (e) {
      setFormError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const newHunt = (report) => {
    setFormError("");
    setDraft({
      kind: "hunt",
      title: report ? `Hunt: ${report.title}`.slice(0, 200) : "",
      query: "",
      source: report ? `threat_report:${report.id}` : "ad_hoc",
    });
  };
  return (
    <Box px={{ base: "14px", md: "24px" }} pb="32px">
      <WorkspaceHeader justify="space-between" gap="16px" wrap="wrap">
        <Heading as="h1" fontSize="28px" fontWeight="500">
          {mode === "intel" ? "Threat intelligence hunting" : "Threat hunting"}
        </Heading>
        <Button
          onClick={() => {
            if (mode === "intel") {
              setFormError("");
              setDraft({
                kind: "report",
                title: "",
                summary: "",
                source: "Manual",
                severity: "medium",
              });
            } else newHunt();
          }}
        >
          {mode === "intel" ? "Ingest TI report" : "Add threat hunt"}
        </Button>
      </WorkspaceHeader>
      {mode === "intel" && (
        <Flex gap="16px" mt="24px">
          <Panel p="20px" minW="150px">
            <Text fontSize="11px" color={ui.muted}>
              REPORTS ON THIS PAGE
            </Text>
            <Heading mt="10px">{loading ? "—" : items.length}</Heading>
          </Panel>
          <Panel p="20px" minW="150px">
            <Text fontSize="11px" color={ui.muted}>
              SOURCES ON THIS PAGE
            </Text>
            <Heading mt="10px">
              {loading ? "—" : new Set(items.map((r) => r.source)).size}
            </Heading>
          </Panel>
        </Flex>
      )}
      <Flex gap="12px" my="24px">
        <Input
          maxW="380px"
          bg="white"
          aria-label="Search hunts or reports"
          placeholder="Search…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOffset(0);
          }}
        />
        <Button variant="outline" onClick={() => setReload((n) => n + 1)}>
          Refresh
        </Button>
      </Flex>
      <Text color={ui.muted} fontSize="12px" mb="16px">
        {mode === "intel"
          ? "Stored reports are starting points for analyst-directed local hunts. Feed automation and live IOC queries are not enabled."
          : "Open a hunt to search stored evidence. Legacy simulated verdicts are not presented as verified findings."}
      </Text>
      {error ? (
        <Alert status="error">
          <AlertIcon />
          {error}
        </Alert>
      ) : loading ? (
        <Spinner />
      ) : (
        <Panel overflowX="auto">
          <Table size="sm">
            <Thead>
              <Tr>
                {(mode === "intel"
                  ? ["Report", "Source", "Severity", "Published", "Actions"]
                  : [
                      "Name / Description",
                      "Created time",
                      "Source",
                      "Last updated",
                      "Actions",
                    ]
                ).map((h) => (
                  <Th key={h} py="18px">
                    {h}
                  </Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {items.map((h) => (
                <Tr key={h.id}>
                  <Td minW="260px">
                    <Button
                      variant="link"
                      color={ui.ink}
                      whiteSpace="normal"
                      textAlign="left"
                      onClick={() =>
                        setView(
                          mode === "intel" ? "threatIntelDetail" : "huntDetail",
                          h.id,
                        )
                      }
                    >
                      {h.name || h.title}
                    </Button>
                    <Text
                      mt="6px"
                      noOfLines={2}
                      fontSize="12px"
                      color={ui.muted}
                    >
                      {h.query || h.summary}
                    </Text>
                  </Td>
                  {mode === "intel" ? (
                    <>
                      <Td>{h.source}</Td>
                      <Td>
                        <Badge>{h.severity}</Badge>
                      </Td>
                      <Td whiteSpace="nowrap">{time(h.published_at)}</Td>
                      <Td>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => newHunt(h)}
                        >
                          Create hunt
                        </Button>
                      </Td>
                    </>
                  ) : (
                    <>
                      <Td whiteSpace="nowrap">{time(h.created_at)}</Td>
                      <Td>{h.source}</Td>
                      <Td whiteSpace="nowrap">{time(h.updated_at)}</Td>
                      <Td>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setView("huntDetail", h.id)}
                        >
                          Open hunt →
                        </Button>
                      </Td>
                    </>
                  )}
                </Tr>
              ))}
            </Tbody>
          </Table>
          {!items.length && (
            <Text p="32px" color={ui.muted}>
              No matching {mode === "intel" ? "reports" : "hunts"}. Add one to
              get started.
            </Text>
          )}
          <Flex p="12px" gap="12px" align="center" bg="#f5f7fa">
            <Text fontSize="12px" mr="auto">
              {items.length} records · Page {offset / 50 + 1}
            </Text>
            <Button
              size="sm"
              isDisabled={!offset}
              onClick={() => setOffset((n) => Math.max(0, n - 50))}
            >
              Previous
            </Button>
            <Button
              size="sm"
              isDisabled={items.length < 50}
              onClick={() => setOffset((n) => n + 50)}
            >
              Next
            </Button>
          </Flex>
        </Panel>
      )}
      <Modal isOpen={Boolean(draft)} onClose={() => !busy && setDraft(null)}>
        <ModalOverlay />
        <ModalContent as="form" onSubmit={create}>
          <ModalHeader>
            {draft?.kind === "report" ? "Ingest TI report" : "Add threat hunt"}
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
                {draft.kind === "hunt" ? (
                  <FormControl isRequired>
                    <FormLabel>Literal search phrase</FormLabel>
                    <Input
                      required
                      minLength={2}
                      maxLength={200}
                      value={draft.query}
                      onChange={(e) =>
                        setDraft({ ...draft, query: e.target.value })
                      }
                    />
                    <Text fontSize="12px" mt="8px" color={ui.muted}>
                      Use an IOC, entity or exact phrase. This is not a
                      natural-language query generator.
                    </Text>
                  </FormControl>
                ) : (
                  <>
                    <FormControl>
                      <FormLabel>Report text</FormLabel>
                      <Textarea
                        maxLength={8000}
                        value={draft.summary}
                        onChange={(e) =>
                          setDraft({ ...draft, summary: e.target.value })
                        }
                      />
                    </FormControl>
                    <FormControl>
                      <FormLabel>Source</FormLabel>
                      <Input
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
                        {["critical", "high", "medium", "low"].map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </Select>
                    </FormControl>
                  </>
                )}
              </Stack>
            )}
          </ModalBody>
          <ModalFooter>
            <Button type="submit" isLoading={busy}>
              Create
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
}
function HuntDetail({ id, setView }) {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0),
    [tab, setTab] = useState("Findings"),
    [selectedRun, setSelectedRun] = useState(""),
    [note, setNote] = useState(""),
    [filter, setFilter] = useState(""),
    [step, setStep] = useState(0),
    [request, setRequest] = useState(null),
    [noteRequest, setNoteRequest] = useState(null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .request(`/hunts/${encodeURIComponent(id)}/workspace`)
      .then((w) => {
        if (active) {
          setData(w);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, reload]);
  const run = async () => {
    setBusy(true);
    setError("");
    const r = request || {
      id: crypto.randomUUID(),
      expected_updated_at: data.hunt.updated_at,
    };
    setRequest(r);
    try {
      const result = await api.action("hunts", id, "search", r);
      setData((d) => ({
        ...d,
        runs: [result, ...d.runs.filter((x) => x.id !== result.id)].slice(
          0,
          20,
        ),
      }));
      setSelectedRun(result.id);
      setFilter("");
      setRequest(null);
    } catch (e) {
      setError(e.message);
      if (e.status && e.status < 500) setRequest(null);
    } finally {
      setBusy(false);
    }
  };
  const addNote = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const r =
      noteRequest?.body === note
        ? noteRequest
        : { id: crypto.randomUUID(), body: note };
    setNoteRequest(r);
    try {
      await api.action("hunts", id, "notes", r);
      setNote("");
      setNoteRequest(null);
      setReload((n) => n + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  if (!data)
    return (
      <Box p="24px">
        {error ? (
          <Alert status="error">
            <AlertIcon />
            {error}
            <Button ml="auto" onClick={() => setReload((n) => n + 1)}>
              Retry
            </Button>
          </Alert>
        ) : (
          <Spinner />
        )}
      </Box>
    );
  const current = data.runs.find((r) => r.id === selectedRun) || data.runs[0];
  const findings = current?.findings || [];
  const entities = [...new Set(findings.map((f) => f.entity).filter(Boolean))];
  const plan = [
    "Define scope and literal phrase",
    "Search stored cases and artifacts",
    "Review matches and missing evidence",
  ];
  return (
    <Box px={{ base: "14px", md: "24px" }} pb="24px">
      <Flex justify="space-between" gap="12px" wrap="wrap" mb="18px">
        <Box>
          <Heading fontSize="24px">{data.hunt.name}</Heading>
          <Text color={ui.muted} mt="6px">
            Local evidence hunt · {data.hunt.source}
          </Text>
          {data.intel?.map((link) => (
            <Button
              key={link.report_id}
              variant="link"
              mt="10px"
              onClick={() => setView("threatIntelDetail", link.report_id)}
            >
              Source intelligence report →
            </Button>
          ))}
        </Box>
        <Flex gap="8px">
          <Button variant="outline" onClick={() => setView("hunt")}>
            All hunts
          </Button>
          <Button onClick={run} isLoading={busy} isDisabled={loading}>
            Run local search
          </Button>
        </Flex>
      </Flex>
      {error && (
        <Alert status="error" mb="14px">
          <AlertIcon />
          {error}
          <Button
            ml="auto"
            isDisabled={busy}
            onClick={() => setReload((n) => n + 1)}
          >
            Reload
          </Button>
        </Alert>
      )}
      <Text color={ui.muted} fontSize="12px" mb="16px">
        {data.scope}
      </Text>
      <Grid
        templateColumns={{
          base: "1fr",
          xl: "240px minmax(0,1fr) minmax(0,1fr)",
        }}
        gap="1px"
        bg={ui.line}
        border="1px solid"
        borderColor={ui.line}
        borderRadius="8px"
        overflow="hidden"
      >
        <Box bg="white" p="18px">
          <Text fontWeight="700" mb="20px">
            Plan
          </Text>
          <Stack spacing="18px">
            {plan.map((p, i) => (
              <Button
                key={p}
                variant="ghost"
                justifyContent="flex-start"
                height="auto"
                py="10px"
                whiteSpace="normal"
                textAlign="left"
                onClick={() => {
                  setStep(i);
                  setTab("Step details");
                }}
              >
                <Badge mr="10px" colorScheme={current ? "green" : "gray"}>
                  {i + 1}
                </Badge>
                {p}
              </Button>
            ))}
          </Stack>
          <Text fontSize="11px" color={ui.muted} mt="24px">
            Deterministic search plan. No containment steps or autonomous
            reasoning.
          </Text>
        </Box>
        <Box bg="white" p="18px" minW="0">
          <Text fontWeight="700">Hunt conversation</Text>
          <Text color={ui.muted} fontSize="11px" mt="4px">
            Analyst notes and recorded search results; no AI chat model.
          </Text>
          <Box bg="#f3f5f7" p="16px" my="18px" borderRadius="8px">
            <Text fontSize="11px" color={ui.muted}>
              SAVED SEARCH PHRASE
            </Text>
            <Text mt="8px" whiteSpace="pre-wrap" overflowWrap="anywhere">
              {data.hunt.query}
            </Text>
          </Box>
          {current && (
            <Box
              borderLeft="3px solid"
              borderColor={ui.violet}
              pl="14px"
              mb="20px"
            >
              <Badge colorScheme="orange">
                {current.verdict.replaceAll("_", " ")}
              </Badge>
              <Text mt="10px" fontSize="12px" overflowWrap="anywhere">
                Searched phrase: {current.query}
              </Text>
              <Text mt="8px">
                {findings.length} matching records
                {current.truncated ? " (result limit reached)" : ""}.
              </Text>
              <Text fontSize="11px" color={ui.muted} mt="5px">
                {current.actor} · {time(current.created_at)}
              </Text>
              <Text fontSize="12px" mt="8px">
                Matches require analyst review. Absence of a match does not
                establish safety.
              </Text>
            </Box>
          )}
          <Select
            aria-label="Search history"
            placeholder="Latest search"
            value={selectedRun}
            onChange={(e) => {
              setSelectedRun(e.target.value);
              setFilter("");
            }}
            mb="16px"
          >
            {data.runs.map((r) => (
              <option key={r.id} value={r.id}>
                {time(r.created_at)} · {r.findings.length} records
              </option>
            ))}
          </Select>
          <Stack maxH="300px" overflowY="auto">
            {data.notes.map((n) => (
              <Box key={n.id} bg="#f5f7fa" p="12px" borderRadius="6px">
                <Text fontSize="10px" color={ui.muted}>
                  {n.actor} · {time(n.created_at)}
                </Text>
                <Text mt="6px" whiteSpace="pre-wrap" overflowWrap="anywhere">
                  {n.body}
                </Text>
              </Box>
            ))}
          </Stack>
          <Box as="form" onSubmit={addNote} mt="18px">
            <Textarea
              aria-label="Analyst note"
              placeholder="Add an analyst note…"
              required
              maxLength={4000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              isDisabled={busy}
            />
            <Button
              type="submit"
              mt="10px"
              isLoading={busy}
              isDisabled={!note.trim() || loading}
            >
              Add note
            </Button>
          </Box>
        </Box>
        <Box bg="white" p="18px" minW="0">
          <Flex gap="5px" wrap="wrap" mb="16px">
            {["Step details", "Entities", "Findings"].map((t) => (
              <Button
                key={t}
                size="sm"
                variant={tab === t ? "solid" : "ghost"}
                onClick={() => setTab(t)}
              >
                {t}
                {t === "Entities"
                  ? ` (${entities.length})`
                  : t === "Findings"
                    ? ` (${findings.length})`
                    : ""}
              </Button>
            ))}
          </Flex>
          {tab === "Step details" ? (
            <Box>
              <Heading size="sm">{plan[step]}</Heading>
              <Text mt="14px">
                {step === 0
                  ? data.scope
                  : step === 1
                    ? `Literal phrase: ${current?.query || data.hunt.query}`
                    : "Review the original case and evidence provenance before drawing conclusions or requesting any response."}
              </Text>
              <Badge mt="16px">
                {current ? "Evaluated locally" : "Not run"}
              </Badge>
            </Box>
          ) : (
            <>
              <Input
                aria-label="Filter evidence"
                placeholder="Filter displayed evidence…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                mb="14px"
              />
              <Stack maxH="650px" overflowY="auto">
                {tab === "Entities"
                  ? entities
                      .filter((v) =>
                        v.toLowerCase().includes(filter.toLowerCase()),
                      )
                      .map((v) => (
                        <Box
                          key={v}
                          border="1px solid"
                          borderColor={ui.line}
                          p="14px"
                          borderRadius="5px"
                        >
                          <Text fontSize="10px" color={ui.muted}>
                            RECORDED ENTITY / ARTIFACT VALUE
                          </Text>
                          <Text mt="6px" overflowWrap="anywhere">
                            {v}
                          </Text>
                        </Box>
                      ))
                  : findings
                      .filter((f) =>
                        `${f.label} ${f.excerpt}`
                          .toLowerCase()
                          .includes(filter.toLowerCase()),
                      )
                      .map((f) => (
                        <Box
                          key={`${f.kind}:${f.record_id}`}
                          bg="#eef7fa"
                          border="1px solid"
                          borderColor="#c2dce7"
                          p="14px"
                          borderRadius="5px"
                        >
                          <Badge>{f.kind} · literal match</Badge>
                          <Text fontWeight="600" mt="8px">
                            {f.label}
                          </Text>
                          <Text
                            mt="8px"
                            fontSize="12px"
                            whiteSpace="pre-wrap"
                            overflowWrap="anywhere"
                          >
                            {f.excerpt}
                          </Text>
                          <Text color={ui.muted} fontSize="10px" mt="8px">
                            {f.source} · {f.record_id}
                          </Text>
                          <Button
                            size="sm"
                            mt="12px"
                            variant="outline"
                            onClick={() =>
                              setView("investigationDetail", f.case_id)
                            }
                          >
                            Open evidence case →
                          </Button>
                          <PromoteFinding
                            key={`${current.id}:${f.kind}:${f.record_id}`}
                            huntID={id}
                            runID={current.id}
                            finding={f}
                            promotions={data.promotions}
                            setView={setView}
                          />
                        </Box>
                      ))}
              </Stack>
              {!findings.length && (
                <Text p="18px" color={ui.muted}>
                  {current
                    ? "No matching records in the bounded local search. Inconclusive."
                    : "Run a local search to populate recorded evidence."}
                </Text>
              )}
            </>
          )}
        </Box>
      </Grid>
    </Box>
  );
}
