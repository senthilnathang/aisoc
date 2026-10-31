import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  AlertIcon,
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  Select,
  Spinner,
  Stack,
  Text,
} from "@chakra-ui/react";
import { api } from "./api";
import { ui } from "./theme";
const Node = ({ children, ...props }) => (
  <Box
    bg="white"
    border="1px solid"
    borderColor={ui.lineDark}
    boxShadow="0 3px 12px #16324f0a"
    borderRadius="8px"
    p="16px"
    width="min(100%, 350px)"
    {...props}
  >
    {children}
  </Box>
);
const Edge = ({ label }) => (
  <Flex direction="column" align="center" color={ui.muted}>
    <Box h="24px" borderLeft="1px solid" borderColor={ui.lineDark} />
    {label && (
      <Text fontSize="10px" bg="#f5f7fa" px="6px">
        {label}
      </Text>
    )}
    <Text lineHeight="1">↓</Text>
  </Flex>
);
export default function WorkflowCanvas({ plan, setView }) {
  const [cases, setCases] = useState([]),
    [caseId, setCaseId] = useState(""),
    [policy, setPolicy] = useState(null),
    [history, setHistory] = useState([]),
    [result, setResult] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [zoom, setZoom] = useState(1),
    [showHistory, setShowHistory] = useState(false);
  const generation = useRef({ epoch: 0 });
  useEffect(() => {
    const lifetime = generation.current;
    lifetime.epoch++;
    setBusy(false);
    let active = true;
    setLoading(true);
    setError("");
    setResult(null);
    setCaseId("");
    Promise.all([
      api.investigations({ limit: 500 }),
      api.request(`/response-plans/${encodeURIComponent(plan.id)}/policy`),
      api.request(`/response-plans/${encodeURIComponent(plan.id)}/previews`),
    ])
      .then(([c, p, h]) => {
        if (active) {
          setCases(c.items);
          setPolicy(p);
          setHistory(h.items);
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
      lifetime.epoch++;
    };
  }, [plan.id, plan.version]);
  const run = async () => {
    const lifetime = generation.current;
    const requestGeneration = lifetime.epoch;
    setBusy(true);
    setError("");
    try {
      const r = await api.action("response-plans", plan.id, "preview", {
        expected_version: plan.version,
        case_id: caseId,
      });
      if (lifetime.epoch !== requestGeneration) return;
      setResult(r);
      setHistory((h) => [r, ...h].slice(0, 50));
    } catch (e) {
      if (lifetime.epoch === requestGeneration) setError(e.message);
    } finally {
      if (lifetime.epoch === requestGeneration) setBusy(false);
    }
  };
  return (
    <Box
      mb="24px"
      border="1px solid"
      borderColor={ui.line}
      borderRadius="8px"
      overflow="hidden"
    >
      <Flex bg="white" p="14px" gap="10px" align="center" wrap="wrap">
        <Badge
          colorScheme={
            policy?.enabled && policy.plan_version === plan.version
              ? "green"
              : "gray"
          }
        >
          {policy?.enabled
            ? policy.plan_version === plan.version
              ? "Sandbox enabled"
              : "Policy needs review"
            : "Policy disabled"}
        </Badge>
        <Select
          aria-label="Preview case"
          placeholder="Select a case for dry run"
          maxW="340px"
          value={caseId}
          onChange={(e) => {
            generation.current.epoch++;
            setCaseId(e.target.value);
            setResult(null);
          }}
          isDisabled={busy || loading}
        >
          {cases.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </Select>
        <Button onClick={run} isLoading={busy} isDisabled={!caseId || loading}>
          Run dry preview
        </Button>
        <Button variant="outline" onClick={() => setShowHistory((v) => !v)}>
          Preview history ({history.length})
        </Button>
        <Button variant="ghost" onClick={() => setView("responsePolicies")}>
          Configure policy →
        </Button>
      </Flex>
      <Text px="14px" pb="12px" color={ui.muted} fontSize="11px">
        Preview only · No instructions are executed · Case selector shows up to
        500 recent cases
      </Text>
      {error && (
        <Alert status="error">
          <AlertIcon />
          {error}
        </Alert>
      )}
      {loading && <Spinner m="16px" />}
      {result && (
        <Alert status={result.eligible ? "info" : "warning"}>
          <AlertIcon />
          {result.case_title} · v{result.plan_version}: {result.reason}
        </Alert>
      )}
      {showHistory ? (
        <Stack p="20px" bg="#f5f7fa">
          {history.length ? (
            history.map((r) => (
              <Box key={r.id} bg="white" p="14px" borderRadius="6px">
                <Text fontWeight="600">
                  {r.case_title} · v{r.plan_version}
                </Text>
                <Text fontSize="12px" color={ui.muted}>
                  {r.actor} · {new Date(r.created_at).toLocaleString()}
                </Text>
                <Text mt="8px">{r.reason}</Text>
                <Text fontSize="11px">
                  {r.steps.length} steps evaluated · No provider actions
                </Text>
              </Box>
            ))
          ) : (
            <Text>No dry-run previews recorded.</Text>
          )}
        </Stack>
      ) : (
        <Box
          position="relative"
          bg="#f5f7fa"
          backgroundImage="radial-gradient(#ced6df 1px, transparent 1px)"
          backgroundSize="16px 16px"
          p={{ base: "16px", md: "30px" }}
          maxH="680px"
          overflow="auto"
        >
          <Flex
            direction="column"
            align="center"
            style={{ fontSize: `${zoom}em` }}
          >
            <Node textAlign="center" width="140px">
              <Text fontWeight="600">Start</Text>
            </Node>
            <Edge />
            <Node borderColor="#b7abdf" bg="#faf8ff">
              <Text fontSize="10px" color="purple.600" fontWeight="700">
                IF / ELSE · POLICY GATE
              </Text>
              <Text mt="6px">Active version + enabled policy</Text>
              <Text color={ui.muted} fontSize="12px" mt="4px">
                {policy?.severity || "Any severity"} ·{" "}
                {policy?.source || "Any source"}
              </Text>
              <Text fontSize="11px" mt="8px">
                No match → Block all steps and end
              </Text>
            </Node>
            <Edge label="MATCH" />
            {plan.steps.map((step, i) => (
              <React.Fragment key={i}>
                <Node>
                  <Flex justify="space-between" gap="8px">
                    <Badge>{i + 1}</Badge>
                    <Badge
                      colorScheme={step.approval_required ? "orange" : "gray"}
                    >
                      {step.approval_required
                        ? "Approval gate"
                        : "Procedure step"}
                    </Badge>
                  </Flex>
                  <Heading fontSize={`${16 * zoom}px`} mt="12px">
                    {step.title}
                  </Heading>
                  <Text
                    fontSize={`${12 * zoom}px`}
                    color={ui.muted}
                    mt="8px"
                    whiteSpace="pre-wrap"
                  >
                    {step.instructions || "No instructions added."}
                  </Text>
                  {result && (
                    <Badge
                      mt="12px"
                      colorScheme={
                        result.steps[i]?.outcome === "blocked" ? "red" : "blue"
                      }
                    >
                      {result.steps[i]?.outcome?.replaceAll("_", " ")}
                    </Badge>
                  )}
                </Node>
                <Edge />
              </React.Fragment>
            ))}
            <Node textAlign="center" width="140px">
              <Text fontWeight="600">End preview</Text>
            </Node>
          </Flex>
          <Flex
            position="sticky"
            bottom="0"
            justify="flex-end"
            gap="6px"
            mt="20px"
          >
            <Button
              size="sm"
              aria-label="Zoom out workflow"
              onClick={() => setZoom((z) => Math.max(0.75, z - 0.1))}
            >
              −
            </Button>
            <Button size="sm" onClick={() => setZoom(1)}>
              {Math.round(zoom * 100)}%
            </Button>
            <Button
              size="sm"
              aria-label="Zoom in workflow"
              onClick={() => setZoom((z) => Math.min(1.5, z + 0.1))}
            >
              +
            </Button>
          </Flex>
        </Box>
      )}
    </Box>
  );
}
