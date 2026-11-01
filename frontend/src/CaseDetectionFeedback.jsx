import { useEffect, useState } from "react";
import {
  Alert,
  AlertIcon,
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  Stack,
  Text,
} from "@chakra-ui/react";
import { api } from "./api";
import { ui } from "./theme";
import { AlertLabelReview } from "./RuleRecommendations";
const names = {
  true_positive: "True positive",
  false_positive: "False positive",
  unreviewed: "Unreviewed",
};
export default function CaseDetectionFeedback({ caseID, onChanged }) {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [offset, setOffset] = useState(0),
    [reload, setReload] = useState(0),
    [review, setReview] = useState(null),
    [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api
      .request(
        `/investigations/${encodeURIComponent(caseID)}/detection-feedback?limit=25&offset=${offset}`,
      )
      .then((r) => {
        if (active) setData(r);
      })
      .catch((e) => {
        if (active) {
          setData(null);
          setError(e.message);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [caseID, offset, reload]);
  return (
    <Box
      mt="20px"
      p={{ base: "14px", md: "20px" }}
      border="1px solid"
      borderColor={ui.line}
      rounded="6px"
      bg="white"
    >
      <Flex justify="space-between" gap="12px" wrap="wrap" align="start">
        <Box>
          <Heading size="md">Detection feedback</Heading>
          <Text mt="8px" color={ui.muted}>
            Review each source alert independently, then evaluate changes in its
            rule workspace.
          </Text>
        </Box>
        <Button
          size="sm"
          variant="outline"
          isDisabled={loading || !!review}
          onClick={() => setReload((n) => n + 1)}
        >
          Refresh alert labels
        </Button>
      </Flex>
      <Text mt="12px" fontSize="sm">
        A benign case is not automatically a false positive. Explicit labels and
        rationale feed the existing rule recommendations; saving a label does
        not change the case, enable a rule or deploy a query.
      </Text>
      {message && (
        <Alert status="success" mt="14px">
          <AlertIcon />
          {message}
        </Alert>
      )}
      {error && (
        <Alert status="error" mt="14px">
          <AlertIcon />
          {error}
        </Alert>
      )}
      {loading ? (
        <Text mt="16px" role="status">
          Loading source alerts…
        </Text>
      ) : (
        data && (
          <>
            <Text mt="16px" color={ui.muted} fontSize="xs">
              {data.total} linked source alerts · Case determination:{" "}
              {data.case.determination}
            </Text>
            {!data.total ? (
              <Text mt="16px">
                No source alerts are linked to this investigation. Manual cases
                and promoted hunt findings may have none; no detection labels
                are inferred.
              </Text>
            ) : (
              <Stack spacing="12px" mt="14px">
                {data.items.map((a) => (
                  <Box
                    key={a.id}
                    p="16px"
                    border="1px solid"
                    borderColor={ui.line}
                    rounded="6px"
                    overflowWrap="anywhere"
                  >
                    <Flex justify="space-between" gap="10px" wrap="wrap">
                      <Text fontWeight="600">{a.title || a.id}</Text>
                      <Badge
                        colorScheme={
                          a.label === "false_positive"
                            ? "orange"
                            : a.label === "true_positive"
                              ? "red"
                              : "gray"
                        }
                      >
                        {names[a.label]}
                      </Badge>
                    </Flex>
                    <Text fontSize="xs" color={ui.muted} mt="8px">
                      {a.source} · {a.severity} ·{" "}
                      {new Date(a.created_at).toLocaleString()}
                    </Text>
                    <Text fontSize="xs" color={ui.muted} mt="6px">
                      {a.id} · Source ID: {a.external_id}
                    </Text>
                    {a.primary_entity && (
                      <Text mt="8px" fontSize="sm">
                        Entity: {a.primary_entity}
                      </Text>
                    )}
                    {a.summary && (
                      <Text mt="8px" fontSize="sm" whiteSpace="pre-wrap">
                        {a.summary}
                      </Text>
                    )}
                    <Text mt="10px" fontSize="sm">
                      Rule: {a.rule_name} · v{a.rule_version} ·{" "}
                      {a.rule_enabled ? "Enabled" : "Disabled"}
                    </Text>
                    {a.rationale && (
                      <Box mt="10px" p="10px" bg={ui.soft} rounded="4px">
                        <Text fontSize="sm" whiteSpace="pre-wrap">
                          {a.rationale}
                        </Text>
                        <Text mt="6px" fontSize="xs" color={ui.muted}>
                          {a.reviewer} · Label v{a.label_version} ·{" "}
                          {new Date(a.label_updated_at).toLocaleString()}
                        </Text>
                      </Box>
                    )}
                    <Flex gap="10px" mt="14px" wrap="wrap">
                      <Button
                        size="sm"
                        onClick={() => {
                          setMessage("");
                          setReview(a);
                        }}
                      >
                        Review source alert label
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        as="a"
                        href={`/detect/rules/${encodeURIComponent(a.rule_id)}?tab=recommendations&days=30`}
                      >
                        Review rule recommendations →
                      </Button>
                    </Flex>
                  </Box>
                ))}
              </Stack>
            )}
            <Flex
              gap="12px"
              justify="space-between"
              align="center"
              mt="16px"
              wrap="wrap"
            >
              <Text fontSize="xs" color={ui.muted}>
                {data.total
                  ? `${offset + 1}–${offset + data.items.length} of ${data.total}`
                  : "0 source alerts"}
              </Text>
              <Flex gap="10px">
                <Button
                  size="sm"
                  variant="outline"
                  isDisabled={!offset || !!review}
                  onClick={() => setOffset((n) => Math.max(0, n - 25))}
                >
                  Previous source alerts
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  isDisabled={offset + 25 >= data.total || !!review}
                  onClick={() => setOffset((n) => n + 25)}
                >
                  Next source alerts
                </Button>
              </Flex>
            </Flex>
          </>
        )
      )}
      {review && (
        <AlertLabelReview
          key={`${review.id}:${review.label_version}`}
          alert={review}
          caseID={caseID}
          ruleID={review.rule_id}
          onClose={() => setReview(null)}
          onSaved={() => {
            setMessage(
              "Explicit alert label saved. Open rule recommendations to generate and replay proposals before any local application.",
            );
            setReload((n) => n + 1);
            onChanged?.();
          }}
        />
      )}
    </Box>
  );
}
