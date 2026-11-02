import WorkspaceHeader from "./WorkspaceHeader";
import React, { useEffect, useState } from "react";
import {
  Alert,
  AlertIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Flex,
  Heading,
  Input,
  Select,
  Text,
} from "@chakra-ui/react";
import RecordsTable from "./components/RecordsTable";
import { api } from "./api";
import { ui } from "./theme";
const defaults = {
  version: 0,
  plan_version: 0,
  enabled: false,
  connector: "local-sandbox",
  calling: "confirmation",
  severity: "",
  source: "",
};
export default function ResponsePolicies({ setView }) {
  const [items, setItems] = useState([]),
    [policies, setPolicies] = useState({}),
    [drafts, setDrafts] = useState({}),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [offset, setOffset] = useState(0),
    [limit, setLimit] = useState(25),
    [busy, setBusy] = useState(""),
    [message, setMessage] = useState("");
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [plans, configs] = await Promise.all([
        api.list("response-plans"),
        api.request("/response-workflow-policies"),
      ]);
      setItems(plans.items.filter((p) => p.kind === "workflow"));
      const map = Object.fromEntries(
        configs.items.map((p) => [p.plan_id, p.policy]),
      );
      setPolicies(map);
      setDrafts({});
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    let active = true;
    Promise.all([
      api.list("response-plans"),
      api.request("/response-workflow-policies"),
    ])
      .then(([plans, configs]) => {
        if (active) {
          setItems(plans.items.filter((p) => p.kind === "workflow"));
          setPolicies(
            Object.fromEntries(configs.items.map((p) => [p.plan_id, p.policy])),
          );
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
  }, []);
  const update = (id, field, value) =>
    setDrafts((d) => ({
      ...d,
      [id]: { ...(d[id] || policies[id] || defaults), [field]: value },
    }));
  const save = async (plan) => {
    setBusy(plan.id);
    setError("");
    setMessage("");
    const p = drafts[plan.id] || policies[plan.id] || defaults;
    try {
      const result = await api.request(
        `/response-plans/${encodeURIComponent(plan.id)}/policy`,
        {
          method: "PATCH",
          body: {
            expected_version: p.version,
            plan_version: plan.version,
            enabled: p.enabled,
            connector: p.connector,
            calling: p.calling,
            severity: p.severity,
            source: p.source,
          },
        },
      );
      setPolicies((all) => ({ ...all, [plan.id]: result }));
      setDrafts((all) => {
        const next = { ...all };
        delete next[plan.id];
        return next;
      });
      setMessage(
        `Saved policy for ${plan.title}. Provider execution remains disabled.`,
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };
  const visible = items.filter((p) =>
    `${p.title} ${p.description}`.toLowerCase().includes(query.toLowerCase()),
  );
  // The saved library is loaded in full, so paging slices the filtered list locally.
  // A changed result set can leave the offset past the last page; return to the first page.
  useEffect(() => {
    if (offset > 0 && offset >= visible.length) setOffset(0);
  }, [offset, visible.length]);
  const page = visible.slice(offset, offset + limit);
  const policyOf = (plan) => drafts[plan.id] || policies[plan.id] || defaults;
  const columns = [
    {
      id: "status",
      header: "Status",
      render: (plan) => {
        const p = policyOf(plan);
        const stale = p.version > 0 && p.plan_version !== plan.version;
        return (
          <>
            <Checkbox
              aria-label={`Enable ${plan.title}`}
              isChecked={p.enabled}
              isDisabled={Boolean(busy) || plan.state !== "active"}
              onChange={(e) => update(plan.id, "enabled", e.target.checked)}
            />
            <Text fontSize="10px" mt="6px">
              {plan.state === "archived"
                ? "Archived"
                : stale
                  ? "Needs review"
                  : p.enabled
                    ? "Enabled"
                    : "Disabled"}
            </Text>
          </>
        );
      },
    },
    {
      id: "workflow",
      header: "Workflow",
      render: (plan) => (
        <>
          <Text fontWeight="600">{plan.title}</Text>
          <Badge mt="6px">v{plan.version}</Badge>
        </>
      ),
    },
    {
      id: "description",
      header: "Description",
      render: (plan) => (
        <Text noOfLines={3} color={ui.muted}>
          {plan.description || "No description"}
        </Text>
      ),
    },
    {
      id: "connector",
      header: "Connector",
      render: (plan) => (
        <Select
          aria-label={`Connector for ${plan.title}`}
          value={policyOf(plan).connector}
          isDisabled
        >
          <option value="local-sandbox">Local sandbox</option>
        </Select>
      ),
    },
    {
      id: "calling",
      header: "Dynamic calling",
      render: (plan) => (
        <Select
          aria-label={`Calling mode for ${plan.title}`}
          value={policyOf(plan).calling}
          isDisabled={Boolean(busy) || plan.state !== "active"}
          onChange={(e) => update(plan.id, "calling", e.target.value)}
        >
          <option value="confirmation">Requires confirmation</option>
          <option value="automatic_dry_run">Automatic dry run</option>
        </Select>
      ),
    },
    {
      id: "conditions",
      header: "Conditions",
      render: (plan) => {
        const p = policyOf(plan);
        return (
          <>
            <Select
              aria-label={`Severity condition for ${plan.title}`}
              value={p.severity}
              isDisabled={Boolean(busy) || plan.state !== "active"}
              onChange={(e) => update(plan.id, "severity", e.target.value)}
            >
              <option value="">Any severity</option>
              {["critical", "high", "medium", "low"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
            <Input
              mt="8px"
              maxLength={200}
              aria-label={`Source condition for ${plan.title}`}
              placeholder="Exact source (optional)"
              value={p.source}
              isDisabled={Boolean(busy) || plan.state !== "active"}
              onChange={(e) => update(plan.id, "source", e.target.value)}
            />
          </>
        );
      },
    },
    {
      id: "save",
      header: "Save",
      render: (plan) => (
        <Button
          size="sm"
          isLoading={busy === plan.id}
          isDisabled={Boolean(busy) || plan.state !== "active"}
          onClick={() => save(plan)}
        >
          Save policy
        </Button>
      ),
    },
  ];
  return (
    <Box px={{ base: "14px", md: "24px" }} pb="32px">
      <WorkspaceHeader justify="space-between" gap="16px" wrap="wrap">
        <Box>
          <Heading as="h1" fontSize="30px" fontWeight="500">
            Remediation actions
          </Heading>
          <Text color={ui.muted} mt="8px">
            Configure when a workflow is eligible for a local preview.
          </Text>
        </Box>
        <Button onClick={() => setView("responseWorkflows")}>
          Create custom workflow →
        </Button>
      </WorkspaceHeader>
      <Alert status="info" mt="20px">
        <AlertIcon />
        Sandbox policy only. Automatic dry run evaluates eligibility; it never
        dispatches containment or schedules a workflow.
      </Alert>
      <Flex gap="12px" my="20px">
        <Input
          bg="white"
          maxW="380px"
          aria-label="Search remediation policies"
          placeholder="Search workflows…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOffset(0);
          }}
        />
        <Button
          variant="outline"
          isDisabled={Boolean(busy)}
          onClick={() => {
            if (
              !Object.keys(drafts).length ||
              window.confirm("Discard unsaved policy changes and refresh?")
            )
              load();
          }}
        >
          Refresh
        </Button>
      </Flex>
      {error && (
        <Alert status="error" mb="14px">
          <AlertIcon />
          {error}
        </Alert>
      )}
      {message && (
        <Alert status="success" mb="14px">
          <AlertIcon />
          {message}
        </Alert>
      )}
      <Box bg="white" border="1px solid" borderColor={ui.line} borderRadius="8px">
        <RecordsTable
          caption="Remediation policies"
          recordLabel="workflows"
          pageSizeLabel="Workflows per page"
          columns={columns}
          records={loading ? [] : page}
          rowKey="id"
          total={loading ? 0 : visible.length}
          offset={offset}
          limit={limit}
          onPageChange={setOffset}
          onPageSizeChange={(size) => {
            setLimit(size);
            setOffset(0);
          }}
          loading={loading}
          loadingLabel="Loading remediation policies…"
          paginationDisabled={Boolean(busy)}
          emptyContent="No matching workflows. Create one in the workflow library."
        />
      </Box>
    </Box>
  );
}
