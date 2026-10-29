import React, { useEffect, useState } from "react";
import {
  Alert,
  AlertIcon,
  Badge,
  Box,
  Button,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerOverlay,
  Flex,
  Heading,
  Input,
  Select,
  SimpleGrid,
  Spinner,
  Stack,
  Text,
  useToast,
} from "@chakra-ui/react";
import { api } from "./api";
import { ui } from "./theme";
export const responseNavigation = [
  ["respond", "Overview", "Your response workspace"],
  ["responseCases", "Cases", "Actions grouped by investigation"],
  ["responseActions", "Actions", "Contain and remediate threats"],
  ["responseApprovals", "Approvals", "Review pending decisions"],
  ["responseWorkflows", "Workflows", "Explore automation patterns"],
  ["responseRunbooks", "Runbooks", "Follow response procedures"],
  ["responseActivity", "Activity", "Review recorded simulations"],
];
const Panel = ({ children, ...props }) => (
  <Box
    bg="white"
    border="1px solid"
    borderColor={ui.line}
    borderRadius="8px"
    {...props}
  >
    {children}
  </Box>
);
const Eyebrow = ({ children, ...props }) => (
  <Text
    fontSize="10px"
    fontWeight="700"
    letterSpacing=".1em"
    textTransform="uppercase"
    color={ui.muted}
    {...props}
  >
    {children}
  </Text>
);
const Status = ({ status }) => (
  <Badge
    textTransform="none"
    colorScheme={
      status === "completed"
        ? "green"
        : status === "pending"
          ? "orange"
          : "gray"
    }
  >
    {status === "completed"
      ? "Simulation recorded"
      : status === "pending"
        ? "Awaiting approval"
        : status}
  </Badge>
);
const descriptions = {
  respond:
    "Move from an investigation verdict to a reviewed response, with every action in context.",
  responseCases:
    "Follow response progress across investigations and open the evidence behind each action.",
  responseActions:
    "Review containment and remediation actions across your investigation records.",
  responseApprovals:
    "Inspect the proposed scope and investigation before recording a response simulation.",
  responseActivity:
    "A history of completed action simulations. No live provider actions are performed.",
  responseWorkflows:
    "Explore repeatable response sequences, with an approval gate before containment.",
  responseRunbooks:
    "Keep clear, step-by-step analyst procedures close to the response work.",
};
export default function ResponseWorkspace({ mode = "respond", setView }) {
  const [items, setItems] = useState([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [selected, setSelected] = useState(null);
  const [running, setRunning] = useState(false),
    [reload, setReload] = useState(0);
  const toast = useToast();
  const [planCount, setPlanCount] = useState(0);
  useEffect(() => {
    setQuery("");
    setFilter("all");
    setSelected(null);
  }, [mode]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    Promise.all([api.remediations(), api.list("response-plans")])
      .then((result) => {
        if (active) {
          setItems(result[0].items);
          setPlanCount(
            result[1].items.filter(
              (plan) => plan.kind === "workflow" && plan.state === "active",
            ).length,
          );
        }
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reload]);
  const pending = items.filter((item) => item.status === "pending"),
    completed = items.filter((item) => item.status === "completed");
  const cases = [...new Set(items.map((item) => item.investigation_id))].map(
    (id) => ({
      id,
      actions: items.filter((item) => item.investigation_id === id),
    }),
  );
  const matches = (record) =>
    Object.values(record)
      .join(" ")
      .toLowerCase()
      .includes(query.trim().toLowerCase());
  const visibleCases = cases.filter((record) =>
    matches({
      id: record.id,
      actions: record.actions
        .map((item) => Object.values(item).join(" "))
        .join(" "),
    }),
  );
  const effectiveFilter =
    mode === "responseApprovals"
      ? "pending"
      : mode === "responseActivity"
        ? "completed"
        : filter;
  const visible = items.filter(
    (item) =>
      (effectiveFilter === "all" || item.status === effectiveFilter) &&
      matches(item),
  );
  const execute = async () => {
    setRunning(true);
    try {
      const updated = await api.executeRemediation(selected.id);
      setItems((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setSelected(updated);
      toast({
        title: "Simulation recorded",
        description: "The record was updated. No provider action was sent.",
        status: "success",
        duration: 4000,
      });
    } catch (err) {
      toast({
        title: "Unable to record simulation",
        description: err.message,
        status: "error",
      });
    } finally {
      setRunning(false);
    }
  };
  const empty = (
    <Box textAlign="center" py="48px">
      <Heading size="sm">
        {query || filter !== "all" ? "No matching results" : "Nothing here yet"}
      </Heading>
      <Text mt="8px" color={ui.muted}>
        {query || filter !== "all"
          ? "Try a different search or clear your filters."
          : mode === "responseApprovals"
            ? "There are no actions awaiting approval."
            : "Records will appear here as response actions are added or completed."}
      </Text>
      {(query || filter !== "all") && (
        <Button
          mt="14px"
          variant="outline"
          onClick={() => {
            setQuery("");
            setFilter("all");
          }}
        >
          Clear filters
        </Button>
      )}
    </Box>
  );
  function actionRows(rows) {
    return rows.length ? (
      <Stack spacing="0">
        {rows.map((item) => (
          <Flex
            key={item.id}
            className="response-action-row"
            p="18px"
            gap="14px"
            align={{
              base: "start",
              md: "center",
            }}
            flexWrap={{
              base: "wrap",
              md: "nowrap",
            }}
            borderBottom="1px solid"
            borderColor={ui.line}
          >
            <Flex
              aria-hidden="true"
              bg={item.status === "completed" ? "#eaf5ef" : "#fff3df"}
              color={item.status === "completed" ? "#26734d" : "#93620a"}
              w="34px"
              h="34px"
              borderRadius="8px"
              align="center"
              justify="center"
              flexShrink="0"
            >
              {item.status === "completed" ? "✓" : "↗"}
            </Flex>
            <Box flex="1" minW="160px">
              <Button
                variant="link"
                color={ui.ink}
                fontSize="12px"
                whiteSpace="normal"
                textAlign="left"
                justifyContent="start"
                onClick={() => setSelected(item)}
              >
                {item.title}
              </Button>
              <Text mt="5px" fontSize="11px" color={ui.muted}>
                {item.id} · {item.connector || "Unassigned provider"}
              </Text>
            </Box>
            <Button
              variant="link"
              fontSize="11px"
              color={ui.violet}
              onClick={() =>
                setView("investigationDetail", item.investigation_id)
              }
            >
              {item.investigation_id}
            </Button>
            <Status status={item.status} />
            <Button variant="outline" onClick={() => setSelected(item)}>
              {item.status === "pending" ? "Review action" : "View details"}
            </Button>
          </Flex>
        ))}
      </Stack>
    ) : (
      empty
    );
  }
  return (
    <Box
      className="page-enter response-workspace"
      px={{
        base: "14px",
        md: "24px",
      }}
      pb="32px"
    >
      <Flex
        align="start"
        gap="16px"
        justify="space-between"
        wrap="wrap"
        mb="24px"
      >
        <Box>
          <Eyebrow mb="8px">Response operations</Eyebrow>
          <Heading
            fontSize={{
              base: "26px",
              md: "32px",
            }}
            fontWeight="500"
            letterSpacing="-.035em"
          >
            {mode === "respond"
              ? "Response overview"
              : responseNavigation.find(([key]) => key === mode)?.[1]}
          </Heading>
          <Text color={ui.muted} mt="8px" maxW="700px">
            {descriptions[mode]}
          </Text>
        </Box>
        <Flex gap="8px" align="center">
          <Badge bg="#e9edf3" color="#4d596b" p="8px">
            Simulation workspace
          </Badge>
          {
            <Button
              variant="outline"
              isLoading={loading}
              onClick={() => setReload((value) => value + 1)}
            >
              Refresh
            </Button>
          }
        </Flex>
      </Flex>
      {error && (
        <Alert status="error" mb="16px">
          <AlertIcon />
          Unable to load response records: {error}
          <Button ml="auto" onClick={() => setReload((value) => value + 1)}>
            Retry
          </Button>
        </Alert>
      )}
      {loading ? (
        <Flex py="70px" gap="12px" justify="center">
          <Spinner size="sm" />
          <Text>Loading response records…</Text>
        </Flex>
      ) : error ? null : (
        <>
          {mode === "respond" && (
            <>
              <SimpleGrid
                columns={{
                  base: 2,
                  lg: 4,
                }}
                spacing="14px"
                mb="20px"
              >
                {[
                  [
                    pending.length,
                    "Awaiting approval",
                    "Review proposed actions",
                    "responseApprovals",
                  ],
                  [
                    cases.length,
                    "Response cases",
                    "Investigations with actions",
                    "responseCases",
                  ],
                  [
                    completed.length,
                    "Simulations recorded",
                    "Review action history",
                    "responseActivity",
                  ],
                  [
                    planCount,
                    "Active workflows",
                    "Review saved definitions",
                    "responseWorkflows",
                  ],
                ].map(([count, label, help, target]) => (
                  <Panel
                    as="button"
                    textAlign="left"
                    key={label}
                    p="20px"
                    className="response-metric"
                    onClick={() => setView(target)}
                  >
                    <Eyebrow>{label}</Eyebrow>
                    <Text
                      className="metric-number"
                      fontSize="46px"
                      lineHeight="1.3"
                      mt="8px"
                    >
                      {count}
                      <Box
                        as="span"
                        float="right"
                        color={ui.quiet}
                        fontSize="20px"
                      >
                        ↗
                      </Box>
                    </Text>
                    <Text fontSize="11px" color={ui.muted}>
                      {help}
                    </Text>
                  </Panel>
                ))}
              </SimpleGrid>
              <SimpleGrid
                columns={{
                  base: 1,
                  xl: 2,
                }}
                spacing="20px"
                mb="20px"
              >
                <Panel
                  bg="#131b28"
                  borderColor="#131b28"
                  color="white"
                  p="26px"
                >
                  <Eyebrow color="#acb8cd">From verdict to resolution</Eyebrow>
                  <Heading fontWeight="500" fontSize="24px" mt="12px">
                    Every action starts with context.
                  </Heading>
                  <Text color="#bac4d3" maxW="470px" mt="10px">
                    Review the evidence, inspect the proposed action, and record
                    the outcome on the investigation.
                  </Text>
                  <Flex mt="24px" gap="8px" wrap="wrap">
                    {["01 · Investigate", "02 · Approve", "03 · Record"].map(
                      (step) => (
                        <Box
                          key={step}
                          border="1px solid #42516a"
                          borderRadius="4px"
                          px="12px"
                          py="9px"
                          fontSize="11px"
                        >
                          {step}
                        </Box>
                      ),
                    )}
                  </Flex>
                  <Button
                    mt="22px"
                    bg="white"
                    color={ui.ink}
                    _hover={{
                      bg: "#e5eaf2",
                    }}
                    onClick={() => setView("responseApprovals")}
                  >
                    Open approval queue →
                  </Button>
                </Panel>
                <Panel p="24px">
                  <Eyebrow>Response toolkit</Eyebrow>
                  {[
                    [
                      "Workflows",
                      "Repeatable sequences for identity, endpoint, and email response.",
                      "responseWorkflows",
                    ],
                    [
                      "Runbooks",
                      "Step-by-step procedures for analyst-led recovery.",
                      "responseRunbooks",
                    ],
                  ].map(([label, description, target]) => (
                    <Box key={target} mt="20px">
                      <Flex justify="space-between">
                        <Heading size="sm" fontWeight="600">
                          {label}
                        </Heading>
                        <Button
                          variant="link"
                          color={ui.violet}
                          onClick={() => setView(target)}
                        >
                          Explore →
                        </Button>
                      </Flex>
                      <Text mt="8px" color={ui.muted}>
                        {description}
                      </Text>
                    </Box>
                  ))}
                  <Text mt="22px" fontSize="11px" color={ui.muted}>
                    Procedures are saved and versioned. Provider execution is
                    not connected.
                  </Text>
                </Panel>
              </SimpleGrid>
              <Panel overflow="hidden">
                <Flex p="18px" justify="space-between" align="center">
                  <Box>
                    <Heading size="sm">Needs your review</Heading>
                    <Text mt="4px" color={ui.muted}>
                      Pending containment and remediation actions
                    </Text>
                  </Box>
                  <Button
                    variant="ghost"
                    onClick={() => setView("responseApprovals")}
                  >
                    View all ({pending.length}) →
                  </Button>
                </Flex>
                {actionRows(pending.slice(0, 4))}
              </Panel>
            </>
          )}
          {mode !== "respond" && (
            <>
              <Flex gap="12px" mb="18px" wrap="wrap">
                <Input
                  aria-label="Search response records"
                  placeholder={
                    "Search actions, providers, or investigation ID…"
                  }
                  bg="white"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  maxW="440px"
                />
                <Select
                  aria-label={"Filter by status"}
                  bg="white"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  maxW="210px"
                  display={
                    [
                      "responseApprovals",
                      "responseActivity",
                      "responseCases",
                    ].includes(mode)
                      ? "none"
                      : "block"
                  }
                >
                  <option value="all">{"All statuses"}</option>
                  {
                    <>
                      <option value="pending">Awaiting approval</option>
                      <option value="completed">Simulation recorded</option>
                    </>
                  }
                </Select>
                <Text
                  ml={{
                    base: "0",
                    md: "auto",
                  }}
                  alignSelf="center"
                  color={ui.muted}
                  fontSize="11px"
                >
                  {mode === "responseCases"
                    ? `${visibleCases.length} cases`
                    : `${visible.length} actions`}
                </Text>
              </Flex>
              {mode === "responseCases" ? (
                <SimpleGrid
                  columns={{
                    base: 1,
                    lg: 2,
                  }}
                  spacing="16px"
                >
                  {visibleCases.map((record) => {
                    const done = record.actions.filter(
                      (item) => item.status === "completed",
                    ).length;
                    return (
                      <Panel key={record.id} p="22px">
                        <Flex justify="space-between">
                          <Eyebrow>{record.id}</Eyebrow>
                          <Badge
                            colorScheme={
                              done === record.actions.length
                                ? "green"
                                : "orange"
                            }
                          >
                            {done === record.actions.length
                              ? "Simulations complete"
                              : "Needs review"}
                          </Badge>
                        </Flex>
                        <Heading fontSize="18px" mt="16px">
                          {record.actions[0].title}
                        </Heading>
                        <Text mt="8px" color={ui.muted}>
                          {[
                            ...new Set(
                              record.actions
                                .map((item) => item.connector)
                                .filter(Boolean),
                            ),
                          ].join(" · ")}
                        </Text>
                        <Box
                          mt="20px"
                          h="5px"
                          bg={ui.soft}
                          borderRadius="full"
                          overflow="hidden"
                        >
                          <Box
                            w={`${(done / record.actions.length) * 100}%`}
                            h="full"
                            bg={ui.green}
                          />
                        </Box>
                        <Flex
                          mt="14px"
                          align="center"
                          justify="space-between"
                          gap="12px"
                          wrap="wrap"
                        >
                          <Text color={ui.muted} fontSize="11px">
                            {done} of {record.actions.length} action simulations
                            recorded
                          </Text>
                          <Button
                            variant="outline"
                            onClick={() =>
                              setView("investigationDetail", record.id)
                            }
                          >
                            Open case →
                          </Button>
                        </Flex>
                      </Panel>
                    );
                  })}
                  {!visibleCases.length && empty}
                </SimpleGrid>
              ) : mode === "responseActivity" ? (
                <Panel p="22px">
                  <Eyebrow mb="20px">Recorded outcomes</Eyebrow>
                  {visible.length
                    ? [...visible]
                        .sort((a, b) =>
                          (b.executed_at || "").localeCompare(
                            a.executed_at || "",
                          ),
                        )
                        .map((item) => (
                          <Flex
                            key={item.id}
                            borderLeft="2px solid"
                            borderColor="#bcd9c8"
                            pl="22px"
                            pb="26px"
                            gap="14px"
                            justify="space-between"
                            wrap="wrap"
                          >
                            <Box>
                              <Text color={ui.muted} fontSize="11px">
                                {item.executed_at
                                  ? new Date(item.executed_at).toLocaleString()
                                  : "Time not recorded"}{" "}
                                · {item.id}
                              </Text>
                              <Text mt="6px" fontWeight="600">
                                {item.title}
                              </Text>
                              <Text color={ui.muted} mt="6px">
                                {item.investigation_id} · {item.connector} ·
                                Local simulation
                              </Text>
                            </Box>
                            <Button
                              variant="outline"
                              onClick={() => setSelected(item)}
                            >
                              View record
                            </Button>
                          </Flex>
                        ))
                    : empty}
                </Panel>
              ) : (
                <Panel overflow="hidden">
                  {mode === "responseApprovals" && (
                    <Box
                      p="18px"
                      bg="#fffaf0"
                      borderBottom="1px solid"
                      borderColor={ui.line}
                    >
                      <Text fontWeight="600">Your review is the next step</Text>
                      <Text mt="4px" color={ui.muted}>
                        Open an action to inspect its scope and linked
                        investigation. Approval records a local simulation only.
                      </Text>
                    </Box>
                  )}
                  {actionRows(visible)}
                </Panel>
              )}
            </>
          )}
        </>
      )}
      <Drawer
        isOpen={Boolean(selected)}
        placement="right"
        size="md"
        onClose={() => {
          if (!running) setSelected(null);
        }}
        closeOnOverlayClick={!running}
        closeOnEsc={!running}
      >
        <DrawerOverlay />
        <DrawerContent>
          <DrawerCloseButton isDisabled={running} />
          <DrawerHeader
            borderBottom="1px solid"
            borderColor={ui.line}
            pr="48px"
          >
            <Eyebrow mb="8px">
              {selected?.id} · {"Response action"}
            </Eyebrow>
            <Text fontSize="21px" fontWeight="500">
              {selected?.title}
            </Text>
          </DrawerHeader>
          <DrawerBody py="24px">
            {selected && (
              <>
                <Text color={ui.muted}>{selected.description}</Text>
                {
                  <>
                    <Box mt="22px">
                      <Status status={selected.status} />
                    </Box>
                    <SimpleGrid columns={2} gap="20px" mt="26px">
                      <Box>
                        <Eyebrow>Provider</Eyebrow>
                        <Text mt="6px">
                          {selected.connector || "Unassigned"}
                        </Text>
                      </Box>
                      <Box>
                        <Eyebrow>Action type</Eyebrow>
                        <Text mt="6px">
                          {selected.action_type?.replaceAll("_", " ")}
                        </Text>
                      </Box>
                    </SimpleGrid>
                    <Panel mt="24px" p="18px" bg={ui.soft}>
                      <Eyebrow>Investigation context</Eyebrow>
                      <Button
                        mt="10px"
                        variant="link"
                        color={ui.violet}
                        onClick={() =>
                          setView(
                            "investigationDetail",
                            selected.investigation_id,
                          )
                        }
                      >
                        Open {selected.investigation_id} →
                      </Button>
                      <Text mt="10px" color={ui.muted}>
                        Review the verdict and evidence before recording this
                        action.
                      </Text>
                    </Panel>
                    {selected.executed_at && (
                      <Text mt="20px" color={ui.muted}>
                        Recorded{" "}
                        {new Date(selected.executed_at).toLocaleString()}
                      </Text>
                    )}
                    <Alert status="info" mt="24px" alignItems="start">
                      <AlertIcon />
                      <Text fontSize="12px">
                        This workspace records local simulations. No action is
                        sent to {selected.connector || "a provider"}, and no
                        identity, endpoint, email, or cloud state changes.
                      </Text>
                    </Alert>
                  </>
                }
              </>
            )}
          </DrawerBody>
          <DrawerFooter borderTop="1px solid" borderColor={ui.line} gap="10px">
            <Button
              variant="outline"
              isDisabled={running}
              onClick={() => setSelected(null)}
            >
              Close
            </Button>
            {selected?.status === "pending" && (
              <Button isLoading={running} onClick={execute}>
                Approve & record simulation
              </Button>
            )}
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </Box>
  );
}
