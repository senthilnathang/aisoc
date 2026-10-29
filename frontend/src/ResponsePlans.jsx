import React, { useEffect, useState } from "react";
import {
  Alert,
  AlertIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Drawer,
  DrawerBody,
  DrawerCloseButton,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerOverlay,
  Flex,
  FormControl,
  FormLabel,
  Heading,
  Input,
  Select,
  SimpleGrid,
  Spinner,
  Stack,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { api } from "./api";
import { ui } from "./theme";

const Panel = ({ children, ...props }) => (
  <Box
    p="22px"
    bg="white"
    border="1px solid"
    borderColor={ui.line}
    borderRadius="8px"
    {...props}
  >
    {children}
  </Box>
);
const blank = (kind) => ({
  kind,
  title: "",
  description: "",
  domain: "Identity",
  trigger: "",
  steps: [{ title: "", instructions: "", approval_required: true }],
});
const inputFields = (plan) => ({
  kind: plan.kind,
  title: plan.title,
  description: plan.description,
  domain: plan.domain,
  trigger: plan.trigger,
  steps: plan.steps,
});
const formatTime = (time) => new Date(time).toLocaleString();
function History({ items }) {
  return (
    <Stack spacing="12px">
      {items.map((event) => (
        <Box
          key={event.version}
          borderLeft="2px solid"
          borderColor={ui.lineDark}
          pl="14px"
        >
          <Text fontWeight="600">
            v{event.version} · {event.action.replaceAll("_", " ")}
          </Text>
          <Text color={ui.muted} fontSize="11px">
            {event.actor} · {formatTime(event.created_at)}
          </Text>
          {event.snapshot && (
            <Box as="details" mt="8px">
              <Box as="summary" cursor="pointer">
                Inspect saved version
              </Box>
              <Text fontWeight="600" mt="8px">
                {event.snapshot.title}
              </Text>
              <Text mt="4px">{event.snapshot.description}</Text>
              <Text color={ui.muted} mt="4px">
                {event.snapshot.domain} · {event.snapshot.trigger} ·{" "}
                {event.snapshot.state}
              </Text>
              {event.snapshot.steps.map((step, index) => (
                <Box key={index} mt="10px">
                  <Text>
                    {index + 1}. {step.title}{" "}
                    {step.approval_required ? "· Approval required" : ""}
                  </Text>
                  <Text whiteSpace="pre-wrap" color={ui.muted} fontSize="12px">
                    {step.instructions}
                  </Text>
                </Box>
              ))}
            </Box>
          )}
          {event.title && <Text mt="5px">{event.title}</Text>}
          {event.note && (
            <Text whiteSpace="pre-wrap" color={ui.muted}>
              {event.note}
            </Text>
          )}
          {event.approval_confirmed && (
            <Badge mt="5px" colorScheme="green">
              Analyst approval confirmed
            </Badge>
          )}
        </Box>
      ))}
    </Stack>
  );
}
export default function ResponsePlans({ kind, setView }) {
  const [items, setItems] = useState([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [query, setQuery] = useState(""),
    [state, setState] = useState("active"),
    [domain, setDomain] = useState("all");
  const [selected, setSelected] = useState(null),
    [draft, setDraft] = useState(null),
    [history, setHistory] = useState([]);
  const [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [detailError, setDetailError] = useState("");
  const [cases, setCases] = useState([]),
    [caseId, setCaseId] = useState(""),
    [message, setMessage] = useState("");
  const noun = kind === "workflow" ? "workflow" : "runbook";
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setItems((await api.list("response-plans")).items);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    let active = true;
    api
      .list("response-plans")
      .then((result) => {
        if (active) setItems(result.items);
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
  }, []);
  const open = async (plan, edit = false) => {
    setBusy(true);
    setDetailError("");
    setMessage("");
    setCaseId("");
    setHistory([]);
    setCases([]);
    setSelected(plan);
    setDraft(inputFields(plan));
    setEditing(edit);
    try {
      const [current, versions, availableCases] = await Promise.all([
        api.get("response-plans", plan.id),
        api.request("/response-plans/" + plan.id + "/history"),
        kind === "runbook"
          ? api.investigations({ limit: 500 })
          : Promise.resolve({ items: [] }),
      ]);
      setSelected(current);
      setDraft(inputFields(current));
      // A concurrent archive can invalidate an already-open edit form.
      setEditing(edit && current.state === "active");
      setHistory(versions.items);
      setCases(availableCases.items);
    } catch (err) {
      setDetailError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    if (busy) return;
    if (
      editing &&
      JSON.stringify(draft) !==
        JSON.stringify(selected ? inputFields(selected) : blank(kind)) &&
      !window.confirm("Discard unsaved changes?")
    )
      return;
    setDraft(null);
    setSelected(null);
    setDetailError("");
    setMessage("");
  };
  const mutate = async (work, success) => {
    setBusy(true);
    setDetailError("");
    setMessage("");
    try {
      const plan = await work();
      setSelected(plan);
      setDraft(inputFields(plan));
      setEditing(false);
      setMessage(success);
      setHistory(
        (await api.request("/response-plans/" + plan.id + "/history")).items,
      );
      if (kind === "runbook")
        setCases((await api.investigations({ limit: 500 })).items);
      await load();
    } catch (err) {
      setDetailError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const save = (event) => {
    event.preventDefault();
    mutate(
      () =>
        selected
          ? api.update("response-plans", selected.id, {
              ...draft,
              expected_version: selected.version,
            })
          : api.create("response-plans", draft),
      "Saved to the response library.",
    );
  };
  const updateStep = (index, field, value) =>
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step, i) =>
        i === index ? { ...step, [field]: value } : step,
      ),
    }));
  const move = (index, delta) =>
    setDraft((current) => {
      const steps = [...current.steps];
      [steps[index], steps[index + delta]] = [
        steps[index + delta],
        steps[index],
      ];
      return { ...current, steps };
    });
  const visible = items.filter(
    (plan) =>
      plan.kind === kind &&
      (state === "all" || plan.state === state) &&
      (domain === "all" || plan.domain === domain) &&
      [
        plan.title,
        plan.description,
        plan.domain,
        plan.trigger,
        ...plan.steps.map((step) => step.title + " " + step.instructions),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  return (
    <Box className="page-enter" px={{ base: "14px", md: "24px" }} pb="32px">
      <Flex justify="space-between" gap="16px" wrap="wrap" mb="24px">
        <Box>
          <Text
            fontSize="10px"
            color={ui.muted}
            letterSpacing=".1em"
            fontWeight="700"
          >
            RESPONSE LIBRARY
          </Text>
          <Heading fontSize="30px" fontWeight="500" mt="8px">
            {kind === "workflow" ? "Workflows" : "Runbooks"}
          </Heading>
          <Text mt="8px" color={ui.muted}>
            {kind === "workflow"
              ? "Design response sequences, triggers, and analyst approval gates."
              : "Build analyst procedures and track their completion on investigation cases."}
          </Text>
        </Box>
        <Button
          onClick={() => {
            setSelected(null);
            setDraft(blank(kind));
            setEditing(true);
            setHistory([]);
            setDetailError("");
            setMessage("");
          }}
        >
          Create {noun}
        </Button>
      </Flex>
      <Flex gap="12px" wrap="wrap" mb="20px">
        <Input
          aria-label="Search response plans"
          maxW="370px"
          bg="white"
          placeholder="Search titles, steps, or triggers…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select
          aria-label="Filter by state"
          maxW="170px"
          bg="white"
          value={state}
          onChange={(e) => setState(e.target.value)}
        >
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="all">All states</option>
        </Select>
        <Select
          aria-label="Filter by domain"
          maxW="190px"
          bg="white"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
        >
          <option value="all">All domains</option>
          {[
            ...new Set(
              items
                .filter((plan) => plan.kind === kind)
                .map((plan) => plan.domain),
            ),
          ].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </Select>
        <Button variant="outline" onClick={load} isLoading={loading}>
          Refresh
        </Button>
      </Flex>
      {error && (
        <Alert status="error" mb="16px">
          <AlertIcon />
          {error}
          <Button ml="auto" onClick={load}>
            Retry
          </Button>
        </Alert>
      )}
      {loading ? (
        <Spinner />
      ) : (
        !error && (
          <>
            <Text mb="12px" fontSize="11px" color={ui.muted}>
              {visible.length} {visible.length === 1 ? noun : noun + "s"}
            </Text>
            <SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} gap="18px">
              {visible.map((plan) => (
                <Panel key={plan.id} display="flex" flexDirection="column">
                  <Flex justify="space-between" gap="8px">
                    <Badge>{plan.domain}</Badge>
                    <Text color={ui.muted} fontSize="11px">
                      v{plan.version} · {plan.state}
                    </Text>
                  </Flex>
                  <Heading fontSize="20px" fontWeight="500" mt="22px">
                    {plan.title}
                  </Heading>
                  <Text mt="10px" color={ui.muted} flex="1">
                    {plan.description || "No description added."}
                  </Text>
                  <Text mt="18px" fontSize="11px" color={ui.muted}>
                    {kind === "workflow" ? "Trigger" : "Owner / usage"}:{" "}
                    {plan.trigger}
                  </Text>
                  <Flex
                    justify="space-between"
                    mt="22px"
                    gap="8px"
                    align="center"
                  >
                    <Text fontSize="11px" color={ui.muted}>
                      {plan.steps.length}{" "}
                      {plan.steps.length === 1 ? "step" : "steps"} ·{" "}
                      {
                        plan.steps.filter((step) => step.approval_required)
                          .length
                      }{" "}
                      {plan.steps.filter((step) => step.approval_required)
                        .length === 1
                        ? "approval gate"
                        : "approval gates"}
                    </Text>
                    <Button variant="outline" onClick={() => open(plan)}>
                      Open {noun} →
                    </Button>
                  </Flex>
                </Panel>
              ))}
            </SimpleGrid>
            {!visible.length && (
              <Panel textAlign="center">
                <Heading size="sm">No matching {noun}s</Heading>
                <Text color={ui.muted} mt="8px">
                  Create a {noun} or adjust the filters.
                </Text>
                <Button
                  mt="14px"
                  variant="outline"
                  onClick={() => {
                    setQuery("");
                    setState("all");
                    setDomain("all");
                  }}
                >
                  Clear filters
                </Button>
              </Panel>
            )}
          </>
        )
      )}
      <Text mt="20px" color={ui.muted} fontSize="11px">
        {kind === "workflow"
          ? "Workflow definitions are saved and versioned. Triggers and steps do not execute provider actions."
          : "Case attachments retain the exact runbook version selected. Checklist completion is analyst-recorded."}
      </Text>
      <Drawer
        isOpen={Boolean(draft)}
        onClose={close}
        size="lg"
        closeOnOverlayClick={!busy}
        closeOnEsc={!busy}
      >
        <DrawerOverlay />
        <DrawerContent>
          <DrawerCloseButton isDisabled={busy} />
          <DrawerHeader
            pr="48px"
            borderBottom="1px solid"
            borderColor={ui.line}
          >
            {editing
              ? selected
                ? "Edit " + noun
                : "Create " + noun
              : selected?.title}
            <Text fontSize="11px" color={ui.muted} fontWeight="400" mt="6px">
              {selected
                ? "Version " + selected.version + " · " + selected.state
                : "New response procedure"}
            </Text>
          </DrawerHeader>
          <DrawerBody py="22px">
            {detailError && (
              <Alert status="error" mb="16px">
                <AlertIcon />
                <Box>
                  {detailError}
                  {selected && (
                    <Button
                      display="block"
                      mt="8px"
                      variant="outline"
                      isDisabled={busy}
                      onClick={() => {
                        if (
                          !editing ||
                          window.confirm(
                            "Reload the saved version and discard your edits?",
                          )
                        )
                          open(selected, editing);
                      }}
                    >
                      Reload saved version
                    </Button>
                  )}
                </Box>
              </Alert>
            )}
            {message && (
              <Alert status="success" mb="16px">
                <AlertIcon />
                {message}
              </Alert>
            )}
            {draft &&
              (editing ? (
                <Box as="form" id="response-plan-form" onSubmit={save}>
                  <Stack as="fieldset" disabled={busy} spacing="18px">
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
                    <FormControl>
                      <FormLabel>Description</FormLabel>
                      <Textarea
                        maxLength={4000}
                        value={draft.description}
                        onChange={(e) =>
                          setDraft({ ...draft, description: e.target.value })
                        }
                      />
                    </FormControl>
                    <SimpleGrid columns={{ base: 1, md: 2 }} gap="16px">
                      <FormControl isRequired>
                        <FormLabel>Domain</FormLabel>
                        <Input
                          required
                          maxLength={100}
                          value={draft.domain}
                          onChange={(e) =>
                            setDraft({ ...draft, domain: e.target.value })
                          }
                        />
                      </FormControl>
                      <FormControl isRequired>
                        <FormLabel>
                          {kind === "workflow"
                            ? "Trigger condition"
                            : "Owner / when to use"}
                        </FormLabel>
                        <Input
                          required
                          maxLength={500}
                          value={draft.trigger}
                          onChange={(e) =>
                            setDraft({ ...draft, trigger: e.target.value })
                          }
                        />
                      </FormControl>
                    </SimpleGrid>
                    <Heading fontSize="17px">Response steps</Heading>
                    {draft.steps.map((step, index) => (
                      <Panel key={index} bg={ui.soft} p="16px">
                        <Flex mb="12px" gap="8px" align="center">
                          <Text fontWeight="600" mr="auto">
                            Step {index + 1}
                          </Text>
                          <Button
                            aria-label={"Move step " + (index + 1) + " up"}
                            variant="outline"
                            isDisabled={index === 0 || busy}
                            onClick={() => move(index, -1)}
                          >
                            ↑
                          </Button>
                          <Button
                            aria-label={"Move step " + (index + 1) + " down"}
                            variant="outline"
                            isDisabled={
                              index === draft.steps.length - 1 || busy
                            }
                            onClick={() => move(index, 1)}
                          >
                            ↓
                          </Button>
                          <Button
                            aria-label={"Remove step " + (index + 1)}
                            variant="ghost"
                            isDisabled={draft.steps.length === 1 || busy}
                            onClick={() =>
                              setDraft({
                                ...draft,
                                steps: draft.steps.filter(
                                  (_, i) => i !== index,
                                ),
                              })
                            }
                          >
                            Remove
                          </Button>
                        </Flex>
                        <FormControl isRequired>
                          <FormLabel>Step {index + 1} title</FormLabel>
                          <Input
                            bg="white"
                            required
                            maxLength={300}
                            value={step.title}
                            onChange={(e) =>
                              updateStep(index, "title", e.target.value)
                            }
                          />
                        </FormControl>
                        <FormControl mt="12px">
                          <FormLabel>Step {index + 1} instructions</FormLabel>
                          <Textarea
                            bg="white"
                            maxLength={4000}
                            value={step.instructions}
                            onChange={(e) =>
                              updateStep(index, "instructions", e.target.value)
                            }
                          />
                        </FormControl>
                        <Checkbox
                          mt="12px"
                          isChecked={step.approval_required}
                          onChange={(e) =>
                            updateStep(
                              index,
                              "approval_required",
                              e.target.checked,
                            )
                          }
                        >
                          Require analyst approval
                        </Checkbox>
                      </Panel>
                    ))}
                    <Button
                      variant="outline"
                      isDisabled={draft.steps.length >= 50 || busy}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          steps: [
                            ...draft.steps,
                            {
                              title: "",
                              instructions: "",
                              approval_required: false,
                            },
                          ],
                        })
                      }
                    >
                      Add step
                    </Button>
                  </Stack>
                </Box>
              ) : (
                <Stack spacing="22px">
                  <Text whiteSpace="pre-wrap" color={ui.muted}>
                    {selected?.description}
                  </Text>
                  <Flex gap="8px" wrap="wrap">
                    <Badge>{selected?.domain}</Badge>
                    <Badge>
                      {kind === "workflow"
                        ? "Definition only · not executing"
                        : "Case checklist available"}
                    </Badge>
                  </Flex>
                  <Box>
                    <Text fontWeight="600">
                      {kind === "workflow"
                        ? "Trigger condition"
                        : "Owner / when to use"}
                    </Text>
                    <Text mt="6px">{selected?.trigger}</Text>
                  </Box>
                  {selected?.steps.map((step, index) => (
                    <Panel key={index} bg={ui.soft} p="16px">
                      <Text fontWeight="600">
                        {index + 1}. {step.title}
                      </Text>
                      <Text whiteSpace="pre-wrap" mt="8px" color={ui.muted}>
                        {step.instructions}
                      </Text>
                      {step.approval_required && (
                        <Badge mt="10px" colorScheme="orange">
                          Analyst approval required
                        </Badge>
                      )}
                    </Panel>
                  ))}
                  {kind === "runbook" && selected?.state === "active" && (
                    <Panel>
                      <Heading fontSize="16px">
                        Attach to an investigation
                      </Heading>
                      <Text mt="8px" color={ui.muted} fontSize="12px">
                        This case will keep version {selected.version}, even
                        when the library changes.
                      </Text>
                      <Select
                        aria-label="Select investigation"
                        mt="14px"
                        value={caseId}
                        onChange={(e) => setCaseId(e.target.value)}
                      >
                        <option value="">Select investigation</option>
                        {cases.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.id} · {item.title}
                          </option>
                        ))}
                      </Select>
                      <Button
                        mt="12px"
                        isDisabled={!caseId || busy}
                        onClick={async () => {
                          setBusy(true);
                          setDetailError("");
                          setMessage("");
                          try {
                            await api.request(
                              "/investigations/" +
                                encodeURIComponent(caseId) +
                                "/runbooks",
                              {
                                method: "POST",
                                body: {
                                  plan_id: selected.id,
                                  expected_version: selected.version,
                                },
                              },
                            );
                            setMessage(
                              "Runbook attached. Open the case’s Runbooks tab to track progress.",
                            );
                          } catch (err) {
                            setDetailError(err.message);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Attach runbook
                      </Button>
                      {caseId && (
                        <Button
                          ml="8px"
                          mt="12px"
                          variant="outline"
                          isDisabled={busy}
                          onClick={() => setView("investigationDetail", caseId)}
                        >
                          Open case
                        </Button>
                      )}
                    </Panel>
                  )}
                  <Box>
                    <Heading fontSize="16px" mb="16px">
                      Version history
                    </Heading>
                    <History items={history} />
                  </Box>
                </Stack>
              ))}
          </DrawerBody>
          <DrawerFooter
            borderTop="1px solid"
            borderColor={ui.line}
            gap="8px"
            flexWrap="wrap"
          >
            <Button variant="outline" isDisabled={busy} onClick={close}>
              Close
            </Button>
            {editing ? (
              <Button
                type="submit"
                form="response-plan-form"
                isLoading={busy}
                isDisabled={busy}
              >
                Save {noun}
              </Button>
            ) : (
              selected && (
                <>
                  <Button
                    variant="outline"
                    isDisabled={busy}
                    onClick={() =>
                      mutate(
                        () =>
                          api.action(
                            "response-plans",
                            selected.id,
                            "duplicate",
                          ),
                        "Copy created. Edit it to customize the procedure.",
                      )
                    }
                  >
                    Duplicate
                  </Button>
                  <Button
                    variant="outline"
                    isDisabled={busy}
                    onClick={() => {
                      const next =
                        selected.state === "active" ? "archived" : "active";
                      if (
                        window.confirm(
                          next === "archived"
                            ? "Archive this plan? Existing case checklists will remain available."
                            : "Restore this plan to the active library?",
                        )
                      )
                        mutate(
                          () =>
                            api.action("response-plans", selected.id, "state", {
                              expected_version: selected.version,
                              state: next,
                            }),
                          next === "active"
                            ? "Plan restored."
                            : "Plan archived.",
                        );
                    }}
                  >
                    {selected.state === "active" ? "Archive" : "Restore"}
                  </Button>
                  {selected.state === "active" && (
                    <Button
                      isDisabled={busy}
                      onClick={() => {
                        setEditing(true);
                        setMessage("");
                      }}
                    >
                      Edit {noun}
                    </Button>
                  )}
                </>
              )
            )}
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </Box>
  );
}

export function CaseRunbooks({ caseId, onChange }) {
  const [items, setItems] = useState([]),
    [plans, setPlans] = useState([]),
    [planId, setPlanId] = useState("");
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [draft, setDraft] = useState(null);
  const path = "/investigations/" + encodeURIComponent(caseId) + "/runbooks";
  const load = async () => {
    const [attached, library] = await Promise.all([
      api.request(path),
      api.list("response-plans"),
    ]);
    setItems(attached.items);
    setPlans(
      library.items.filter(
        (plan) => plan.kind === "runbook" && plan.state === "active",
      ),
    );
    setError("");
  };
  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([api.request(path), api.list("response-plans")])
      .then(([attached, library]) => {
        if (active) {
          setItems(attached.items);
          setPlans(
            library.items.filter(
              (plan) => plan.kind === "runbook" && plan.state === "active",
            ),
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
  }, [path]);
  const mutate = async (work) => {
    setBusy(true);
    setError("");
    try {
      await work();
      setDraft(null);
      await load();
      await onChange?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const available = plans.filter(
    (plan) => !items.some((item) => item.plan_id === plan.id),
  );
  return (
    <Stack spacing="18px">
      <Panel>
        <Heading fontSize="18px">Case runbooks</Heading>
        <Text color={ui.muted} mt="8px">
          Follow a saved procedure and record evidence for each step. Completion
          records analyst work; it does not execute provider actions.
        </Text>
        <Flex mt="18px" gap="10px" wrap="wrap">
          <Select
            aria-label="Runbook to attach"
            maxW="450px"
            value={planId}
            onChange={(e) => setPlanId(e.target.value)}
          >
            <option value="">Select an active runbook</option>
            {available.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.title} · v{plan.version}
              </option>
            ))}
          </Select>
          <Button
            isDisabled={
              !available.some((plan) => plan.id === planId) || busy || loading
            }
            onClick={() =>
              mutate(() =>
                api.request(path, {
                  method: "POST",
                  body: {
                    plan_id: planId,
                    expected_version: available.find(
                      (plan) => plan.id === planId,
                    ).version,
                  },
                }),
              )
            }
          >
            Attach runbook
          </Button>
          <Button
            variant="outline"
            isDisabled={busy}
            onClick={() => {
              if (
                !draft ||
                window.confirm("Reload and discard unsaved step changes?")
              )
                mutate(async () => {});
            }}
          >
            Refresh
          </Button>
        </Flex>
      </Panel>
      {error && (
        <Alert status="error">
          <AlertIcon />
          {error}
        </Alert>
      )}
      {loading ? (
        <Spinner />
      ) : !items.length && !error ? (
        <Panel>
          <Text color={ui.muted}>No runbooks attached to this case yet.</Text>
        </Panel>
      ) : (
        items.map((item) => (
          <Panel key={item.id}>
            <Flex justify="space-between" gap="12px" wrap="wrap">
              <Box>
                <Heading fontSize="18px">{item.snapshot.title}</Heading>
                <Text mt="6px" color={ui.muted}>
                  Attached version {item.snapshot.version} ·{" "}
                  {item.steps.filter((step) => step.completed).length} of{" "}
                  {item.steps.length} steps complete
                </Text>
              </Box>
              <Badge alignSelf="start">{item.snapshot.domain}</Badge>
            </Flex>
            <Stack mt="22px" spacing="14px">
              {item.snapshot.steps.map((step, index) => {
                const progress = item.steps[index];
                const editing =
                  draft?.assignmentId === item.id &&
                  draft?.step_index === index;
                return (
                  <Box
                    key={index}
                    borderTop="1px solid"
                    borderColor={ui.line}
                    pt="16px"
                  >
                    <Flex justify="space-between" gap="12px" align="start">
                      <Box>
                        <Text fontWeight="600">
                          {index + 1}. {step.title}
                        </Text>
                        <Text whiteSpace="pre-wrap" mt="6px" color={ui.muted}>
                          {step.instructions}
                        </Text>
                      </Box>
                      <Badge
                        colorScheme={progress.completed ? "green" : "gray"}
                      >
                        {progress.completed ? "Complete" : "Pending"}
                      </Badge>
                    </Flex>
                    {step.approval_required && (
                      <Badge mt="8px" colorScheme="orange">
                        Approval required
                      </Badge>
                    )}
                    {progress.note && !editing && (
                      <Text whiteSpace="pre-wrap" mt="10px">
                        {progress.note}
                      </Text>
                    )}
                    {progress.updated_by && (
                      <Text color={ui.muted} fontSize="11px" mt="8px">
                        {progress.updated_by} ·{" "}
                        {formatTime(progress.updated_at)}
                      </Text>
                    )}
                    {editing ? (
                      <Stack mt="14px" spacing="12px">
                        <FormControl>
                          <FormLabel>Evidence / outcome notes</FormLabel>
                          <Textarea
                            maxLength={4000}
                            value={draft.note}
                            onChange={(e) =>
                              setDraft({ ...draft, note: e.target.value })
                            }
                          />
                        </FormControl>
                        <Checkbox
                          isChecked={draft.completed}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              completed: e.target.checked,
                              approval_confirmed: false,
                            })
                          }
                        >
                          Mark step complete
                        </Checkbox>
                        {step.approval_required && draft.completed && (
                          <Checkbox
                            isChecked={draft.approval_confirmed}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                approval_confirmed: e.target.checked,
                              })
                            }
                          >
                            I confirm analyst approval for this step
                          </Checkbox>
                        )}
                        <Flex gap="8px">
                          <Button
                            isLoading={busy}
                            isDisabled={
                              busy ||
                              (step.approval_required &&
                                draft.completed &&
                                !draft.approval_confirmed)
                            }
                            onClick={() => {
                              const { assignmentId, ...body } = draft;
                              mutate(() =>
                                api.request(path + "/" + assignmentId, {
                                  method: "PATCH",
                                  body,
                                }),
                              );
                            }}
                          >
                            Save step
                          </Button>
                          <Button
                            isDisabled={busy}
                            variant="outline"
                            onClick={() => setDraft(null)}
                          >
                            Cancel
                          </Button>
                        </Flex>
                      </Stack>
                    ) : (
                      <Button
                        mt="12px"
                        variant="outline"
                        isDisabled={busy || Boolean(draft)}
                        onClick={() =>
                          setDraft({
                            assignmentId: item.id,
                            expected_version: item.version,
                            step_index: index,
                            completed: progress.completed,
                            note: progress.note,
                            approval_confirmed: false,
                          })
                        }
                      >
                        Update step {index + 1}
                      </Button>
                    )}
                  </Box>
                );
              })}
            </Stack>
            <Box as="details" mt="24px">
              <Box as="summary" cursor="pointer" fontWeight="600">
                Runbook activity ({item.history.length})
              </Box>
              <Box mt="16px">
                <History items={item.history} />
              </Box>
            </Box>
          </Panel>
        ))
      )}
    </Stack>
  );
}
