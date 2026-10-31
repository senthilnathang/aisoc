import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  AlertIcon,
  Badge,
  Box,
  Button,
  Checkbox,
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
const Panel = ({ children, ...props }) => (
  <Box
    bg="white"
    border="1px solid"
    borderColor={ui.line}
    borderRadius="7px"
    {...props}
  >
    {children}
  </Box>
);
const blank = {
  title: "",
  summary: "",
  source: "Manual",
  severity: "medium",
  threat_actor: "",
  targeted_industry: "",
  targeted_region: "",
  relevant: false,
  status: "new",
};
const time = (v) => (v ? new Date(v).toLocaleString() : "—");
export default function ThreatIntelWorkspace({ id, setView, hunting = false }) {
  const [data, setData] = useState({ items: [], total: 0, sources: 0 }),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [relevant, setRelevant] = useState(false),
    [offset, setOffset] = useState(0),
    [reload, setReload] = useState(0),
    [creating, setCreating] = useState(false);
  useEffect(() => {
    if (id) return;
    let active = true;
    setLoading(true);
    setError("");
    const timer = setTimeout(
      () =>
        api
          .list("threat-intel/registry", {
            search,
            status,
            relevant,
            limit: 50,
            offset,
          })
          .then((r) => {
            if (active) setData(r);
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
  }, [id, search, status, relevant, offset, reload]);
  if (id) return <ReportDetail key={id} id={id} setView={setView} />;
  return (
    <Box px={{ base: "14px", md: "24px" }} pb="30px">
      <Flex justify="space-between" gap="14px" wrap="wrap">
        <Heading fontSize="28px" fontWeight="500">
          {hunting ? "Threat intelligence hunting" : "Threat intelligence"}
        </Heading>
        <Button onClick={() => setCreating(true)}>Ingest TI report</Button>
      </Flex>
      <Flex gap="16px" mt="24px" wrap="wrap">
        {[
          [data.total, "REPORTS IN FILTER"],
          [data.sources, "INTELLIGENCE SOURCES"],
        ].map(([n, label]) => (
          <Panel key={label} p="20px" minW="170px">
            <Text color={ui.muted} fontSize="10px">
              {label}
            </Text>
            <Heading mt="10px" fontWeight="500">
              {loading || error ? "—" : n}
            </Heading>
          </Panel>
        ))}
      </Flex>
      <Flex gap="12px" align="center" my="24px" wrap="wrap">
        <Input
          bg="white"
          maxW="350px"
          aria-label="Search intelligence"
          placeholder="Search reports, actors or regions…"
          maxLength={200}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
        />
        <Select
          bg="white"
          maxW="170px"
          aria-label="Report status filter"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">All statuses</option>
          {["new", "reviewing", "actionable", "archived"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </Select>
        <Checkbox
          isChecked={relevant}
          onChange={(e) => {
            setRelevant(e.target.checked);
            setOffset(0);
          }}
        >
          Relevant reports only
        </Checkbox>
        <Button variant="outline" onClick={() => setReload((n) => n + 1)}>
          Refresh
        </Button>
      </Flex>
      <Text color={ui.muted} fontSize="12px" mb="16px">
        Relevance and report status are analyst assessments. Local hunt links do
        not imply live scanning or confirmed compromise.
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
                {[
                  "Report",
                  "Actor",
                  "Targeted industry",
                  "Targeted region",
                  "Published",
                  "Review / hunts",
                ].map((h) => (
                  <Th key={h} py="16px">
                    {h}
                  </Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {data.items.map((r) => (
                <Tr key={r.id}>
                  <Td minW="260px">
                    <Button
                      variant="link"
                      whiteSpace="normal"
                      textAlign="left"
                      color={ui.ink}
                      onClick={() => setView("threatIntelDetail", r.id)}
                    >
                      {r.title}
                    </Button>
                    <Text color={ui.muted} fontSize="11px" mt="6px">
                      {r.source} · {r.indicator_count_actual} stored IOCs
                    </Text>
                  </Td>
                  <Td>{r.threat_actor || "—"}</Td>
                  <Td>{r.targeted_industry || "—"}</Td>
                  <Td>{r.targeted_region || "—"}</Td>
                  <Td whiteSpace="nowrap">{time(r.published_at)}</Td>
                  <Td>
                    <Badge
                      colorScheme={
                        r.status === "actionable" ? "orange" : "gray"
                      }
                    >
                      {r.status}
                    </Badge>
                    <Text mt="6px" fontSize="11px">
                      {r.linked_hunts} linked local hunts
                    </Text>
                    {r.relevant && (
                      <Badge mt="4px" variant="outline">
                        Analyst-relevant
                      </Badge>
                    )}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
          {!data.items.length && (
            <Text p="30px" color={ui.muted}>
              No reports match this filter. Ingest a report or adjust the
              filters.
            </Text>
          )}
          <Flex p="12px" bg="#f5f7fa" align="center" gap="10px">
            <Text mr="auto" fontSize="12px">
              {data.total ? offset + 1 : 0}–{offset + data.items.length} of{" "}
              {data.total} reports
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
              isDisabled={offset + 50 >= data.total}
              onClick={() => setOffset((n) => n + 50)}
            >
              Next
            </Button>
          </Flex>
        </Panel>
      )}
      {creating && (
        <ReportEditor
          onClose={() => setCreating(false)}
          onSaved={(r) => {
            setCreating(false);
            setView("threatIntelDetail", r.id);
          }}
        />
      )}
    </Box>
  );
}
function ReportEditor({ report, onClose, onSaved }) {
  const active = useActive();
  const [draft, setDraft] = useState(() =>
      report
        ? Object.fromEntries(
            Object.keys(blank).map((k) => [k, report[k] ?? blank[k]]),
          )
        : { ...blank },
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = report
        ? await api.update("threat-intel-reports", report.id, {
            ...draft,
            expected_updated_at: report.updated_at,
          })
        : await api.create("threat-intel-reports", draft);
      if (active.current) onSaved(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal isOpen onClose={() => !busy && onClose()} size="xl">
      <ModalOverlay />
      <ModalContent as="form" onSubmit={save}>
        <ModalHeader>
          {report ? "Edit intelligence report" : "Ingest TI report"}
        </ModalHeader>
        <ModalCloseButton isDisabled={busy} />
        <ModalBody>
          {error && (
            <Alert status="error" mb="12px">
              <AlertIcon />
              {error}
            </Alert>
          )}
          <Stack spacing="14px">
            {[
              ["title", "Title"],
              ["source", "Source"],
              ["threat_actor", "Threat actor"],
              ["targeted_industry", "Targeted industry"],
              ["targeted_region", "Targeted region"],
            ].map(([k, label]) => (
              <FormControl key={k} isRequired={k === "title" || k === "source"}>
                <FormLabel>{label}</FormLabel>
                <Input
                  required={k === "title" || k === "source"}
                  maxLength={200}
                  value={draft[k]}
                  onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                />
              </FormControl>
            ))}
            <FormControl>
              <FormLabel>Report text</FormLabel>
              <Textarea
                maxLength={16000}
                value={draft.summary}
                onChange={(e) =>
                  setDraft({ ...draft, summary: e.target.value })
                }
              />
            </FormControl>
            <Flex gap="12px">
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
                <FormLabel>Review status</FormLabel>
                <Select
                  value={draft.status}
                  onChange={(e) =>
                    setDraft({ ...draft, status: e.target.value })
                  }
                >
                  {["new", "reviewing", "actionable", "archived"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </Select>
              </FormControl>
            </Flex>
            <Checkbox
              isChecked={draft.relevant}
              onChange={(e) =>
                setDraft({ ...draft, relevant: e.target.checked })
              }
            >
              Relevant to our environment (analyst assessment)
            </Checkbox>
          </Stack>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={onClose} isDisabled={busy}>
            Cancel
          </Button>
          <Button type="submit" isLoading={busy}>
            Save report
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
function ReportDetail({ id, setView }) {
  const active = useActive();
  const [workspace, setWorkspace] = useState(null),
    [indicators, setIndicators] = useState([]),
    [offset, setOffset] = useState(0),
    [search, setSearch] = useState(""),
    [reload, setReload] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [editing, setEditing] = useState(false),
    [adding, setAdding] = useState(false),
    [tab, setTab] = useState("Report"),
    [busy, setBusy] = useState(""),
    [request, setRequest] = useState(null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const timer = setTimeout(
      () =>
        Promise.all([
          api.request(
            `/threat-intel-reports/${encodeURIComponent(id)}/workspace`,
          ),
          api.threatIndicators({ reportId: id, search, limit: 50, offset }),
        ])
          .then(([w, i]) => {
            if (active) {
              setWorkspace(w);
              setIndicators(i.items);
            }
          })
          .catch((e) => {
            if (active) setError(e.message);
          })
          .finally(() => {
            if (active) setLoading(false);
          }),
      100,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [id, offset, search, reload]);
  const createHunt = async (indicator) => {
    setBusy(indicator.id);
    setError("");
    const body =
      request?.indicator_id === indicator.id
        ? request
        : { id: crypto.randomUUID(), indicator_id: indicator.id };
    setRequest(body);
    try {
      const r = await api.action(
        "threat-intel-reports",
        id,
        "local-hunt",
        body,
      );
      setRequest(null);
      if (active.current) setView("huntDetail", r.hunt_id);
    } catch (e) {
      setError(e.message);
      if (e.status && e.status < 500) setRequest(null);
    } finally {
      setBusy("");
    }
  };
  if (!workspace)
    return (
      <Box p="24px">
        {error ? (
          <Alert status="error">
            <AlertIcon />
            {error}
            <Button onClick={() => setReload((n) => n + 1)}>Retry</Button>
          </Alert>
        ) : (
          <Spinner />
        )}
      </Box>
    );
  const r = workspace.report;
  return (
    <Box px={{ base: "14px", md: "24px" }} pb="30px">
      <Flex justify="space-between" gap="12px" wrap="wrap">
        <Button variant="ghost" onClick={() => setView("threatIntel")}>
          ← Reports
        </Button>
        <Button
          variant="outline"
          onClick={() => setEditing(true)}
          isDisabled={loading || Boolean(busy)}
        >
          Edit report
        </Button>
      </Flex>
      {error && (
        <Alert status="error" my="14px">
          <AlertIcon />
          {error}
          <Button ml="auto" onClick={() => setReload((n) => n + 1)}>
            Reload
          </Button>
        </Alert>
      )}
      <Grid
        templateColumns={{ base: "1fr", xl: "260px minmax(0,1fr)" }}
        gap="24px"
        mt="20px"
      >
        <Panel p="20px" height="fit-content">
          <Text fontWeight="600">{r.source}</Text>
          <Text fontSize="11px" color={ui.muted} mt="8px">
            Published {time(r.published_at)}
          </Text>
          <Flex gap="8px" mt="16px">
            <Badge>{r.severity}</Badge>
            <Badge>{r.status}</Badge>
          </Flex>
          <Heading mt="22px" fontSize="28px">
            {workspace.indicator_count}
          </Heading>
          <Text color={ui.muted}>Stored indicators</Text>
          {[
            ["Actor", r.threat_actor],
            ["Industry", r.targeted_industry],
            ["Region", r.targeted_region],
            [
              "Relevance",
              r.relevant
                ? "Analyst-marked relevant"
                : "Not assessed as relevant",
            ],
          ].map(([label, value]) => (
            <Box key={label} mt="18px">
              <Text fontSize="10px" color={ui.muted}>
                {label.toUpperCase()}
              </Text>
              <Text mt="5px" overflowWrap="anywhere">
                {value || "Not recorded"}
              </Text>
            </Box>
          ))}
          <Text mt="20px" fontSize="11px" color={ui.muted}>
            Report severity and imported IOC hit counters are source statements,
            not verified local findings.
          </Text>
        </Panel>
        <Box minW="0">
          <Heading fontSize="25px">{r.title}</Heading>
          <Flex gap="8px" my="20px" wrap="wrap">
            {["Report", "Indicators", "Related hunts"].map((t) => (
              <Button
                key={t}
                aria-pressed={tab === t}
                variant={tab === t ? "solid" : "outline"}
                onClick={() => setTab(t)}
              >
                {t}
              </Button>
            ))}
          </Flex>
          {tab === "Report" ? (
            <Panel p="24px">
              <Text whiteSpace="pre-wrap" overflowWrap="anywhere">
                {r.summary || "No report text provided."}
              </Text>
              <Text fontSize="12px" color={ui.muted} mt="24px">
                Untrusted source text. This report has not been automatically
                evaluated against live systems.
              </Text>
            </Panel>
          ) : tab === "Related hunts" ? (
            <Stack>
              {workspace.hunts.map((h) => (
                <Panel key={h.hunt_id} p="18px">
                  <Text fontWeight="600" overflowWrap="anywhere">
                    {h.indicator_value}
                  </Text>
                  <Text color={ui.muted} fontSize="11px" mt="6px">
                    Created by {h.actor} · {time(h.created_at)}
                  </Text>
                  <Button
                    mt="12px"
                    variant="outline"
                    isDisabled={!h.available}
                    onClick={() => setView("huntDetail", h.hunt_id)}
                  >
                    {h.available
                      ? "Open local hunt →"
                      : "Hunt deleted — link retained"}
                  </Button>
                </Panel>
              ))}
              {!workspace.hunts.length && (
                <Text color={ui.muted}>
                  No linked local hunts. Select an active indicator to create
                  one.
                </Text>
              )}
              <Text fontSize="11px" color={ui.muted}>
                Latest 100 links. Creation alone does not execute a search.
              </Text>
            </Stack>
          ) : (
            <>
              <Flex gap="12px" mb="14px" wrap="wrap">
                <Input
                  bg="white"
                  maxW="350px"
                  aria-label="Search report indicators"
                  placeholder="Search indicator values…"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setOffset(0);
                  }}
                />
                <Button
                  onClick={() => setAdding(true)}
                  isDisabled={loading || Boolean(busy)}
                >
                  Add indicator
                </Button>
              </Flex>
              {loading ? (
                <Spinner />
              ) : (
                <Panel overflowX="auto">
                  <Table size="sm">
                    <Thead>
                      <Tr>
                        {["Type", "Value", "Status", "Reported hits", ""].map(
                          (h) => (
                            <Th key={h}>{h}</Th>
                          ),
                        )}
                      </Tr>
                    </Thead>
                    <Tbody>
                      {indicators.map((i) => (
                        <Tr key={i.id}>
                          <Td>
                            <Badge>{i.indicator_type}</Badge>
                          </Td>
                          <Td maxW="400px" overflowWrap="anywhere">
                            {i.value}
                          </Td>
                          <Td>{i.status}</Td>
                          <Td>{i.hits ?? 0}</Td>
                          <Td>
                            <Button
                              size="sm"
                              isLoading={busy === i.id}
                              isDisabled={
                                Boolean(busy) ||
                                i.status !== "active" ||
                                r.status === "archived"
                              }
                              onClick={() => createHunt(i)}
                            >
                              Create local hunt
                            </Button>
                          </Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                  {!indicators.length && (
                    <Text p="24px">No matching indicators.</Text>
                  )}
                  <Flex p="12px" gap="10px">
                    <Button
                      size="sm"
                      isDisabled={!offset}
                      onClick={() => setOffset((n) => Math.max(0, n - 50))}
                    >
                      Previous
                    </Button>
                    <Text alignSelf="center">Page {offset / 50 + 1}</Text>
                    <Button
                      size="sm"
                      isDisabled={indicators.length < 50}
                      onClick={() => setOffset((n) => n + 50)}
                    >
                      Next
                    </Button>
                  </Flex>
                </Panel>
              )}
              <Text color={ui.muted} mt="12px" fontSize="12px">
                Create a draft hunt from an active IOC, then explicitly run its
                bounded local evidence search. No live source query is launched
                here.
              </Text>
            </>
          )}
        </Box>
      </Grid>
      {editing && (
        <ReportEditor
          report={r}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setReload((n) => n + 1);
          }}
        />
      )}
      {adding && (
        <IndicatorEditor
          reportId={id}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            setOffset(0);
            setReload((n) => n + 1);
          }}
        />
      )}
    </Box>
  );
}
function IndicatorEditor({ reportId, onClose, onSaved }) {
  const [draft, setDraft] = useState({
      indicator_type: "ip",
      value: "",
      severity: "medium",
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.create("threat-indicators", { ...draft, report_id: reportId });
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal isOpen onClose={() => !busy && onClose()}>
      <ModalOverlay />
      <ModalContent as="form" onSubmit={save}>
        <ModalHeader>Add indicator</ModalHeader>
        <ModalCloseButton isDisabled={busy} />
        <ModalBody>
          {error && (
            <Alert status="error">
              <AlertIcon />
              {error}
            </Alert>
          )}
          <Stack spacing="14px">
            <FormControl>
              <FormLabel>Type</FormLabel>
              <Select
                value={draft.indicator_type}
                onChange={(e) =>
                  setDraft({ ...draft, indicator_type: e.target.value })
                }
              >
                {[
                  "ip",
                  "domain",
                  "hash_sha256",
                  "hash_md5",
                  "url",
                  "email",
                  "cve",
                ].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
            </FormControl>
            <FormControl isRequired>
              <FormLabel>Value</FormLabel>
              <Input
                required
                minLength={2}
                maxLength={200}
                value={draft.value}
                onChange={(e) => setDraft({ ...draft, value: e.target.value })}
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
                {["critical", "high", "medium", "low"].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </ModalBody>
        <ModalFooter>
          <Button type="submit" isLoading={busy}>
            Save indicator
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
