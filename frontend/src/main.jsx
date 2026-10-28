import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Alert,
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertIcon,
  Badge,
  Box,
  Button,
  ChakraProvider,
  Divider,
  Flex,
  FormControl,
  FormLabel,
  Grid,
  GridItem,
  Heading,
  HStack,
  Input,
  InputGroup,
  InputLeftElement,
  Select,
  SimpleGrid,
  Stack,
  Table,
  TableContainer,
  Tbody,
  Td,
  Text,
  Textarea,
  Th,
  Thead,
  Tr,
  useToast,
} from "@chakra-ui/react";
import { theme, ui } from "./theme";
import { api } from "./api";
import InvestigationCase from "./InvestigationCase";
import InvestigationQueue from "./InvestigationQueue";
import AuthGate from "./AuthGate";
import ApiSources from "./ApiSources";
import CreateDetectionRule from "./CreateDetectionRule";
import DetectionRegistry, { RuleWorkspace } from "./DetectionRegistry";
import DetectionIntelligence from "./DetectionIntelligence";
import { SkillsLibrary, SkillEditor, SkillsOutcomes } from "./Skills";
import "./app.css";

const I = ({ d, size = 14, color = "currentColor", ...props }) => (
  <Box as="svg" width={`${size}px`} height={`${size}px`} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" display="inline-block" verticalAlign="middle" flexShrink={0} {...props}>
    {typeof d === "string" ? <path d={d} /> : d}
  </Box>
);
const Icon = {
  search: (p) => <I {...p} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />,
  filter: (p) => <I {...p} d={<polygon points="22,3 2,3 10,12.46 10,19 14,21 14,12.46" fill="none" stroke={p?.color || "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />} />,
  bell: (p) => <I {...p} d={<><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 01-3.46 0" /></>} />,
  chevronDown: (p) => <I {...p} d="M6 9l6 6 6-6" />,
  chevronRight: (p) => <I {...p} d="M9 18l6-6-6-6" />,
  chevronLeft: (p) => <I {...p} d="M15 18l-6-6 6-6" />,
  arrowLeft: (p) => <I {...p} d={<><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12,19 5,12 12,5" /></>} />,
  sort: (p) => <I {...p} size={p?.size || 10} d={<><path d="M7 15l5 5 5-5" /><path d="M7 9l5-5 5 5" /></>} />,
  grid: (p) => <I {...p} d={<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>} />,
  plus: (p) => <I {...p} d={<><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>} />,
  settings: (p) => <I {...p} d={<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></>} />,
  user: (p) => <I {...p} d={<><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></>} />,
  star: (p) => <I {...p} d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />,
  clock: (p) => <I {...p} d={<><circle cx="12" cy="12" r="10" /><polyline points="12,6 12,12 16,14" /></>} />,
  play: (p) => <I {...p} d={<polygon points="5,3 19,12 5,21" fill="none" stroke={p?.color || "currentColor"} strokeWidth="2" strokeLinejoin="round" />} />,
  refresh: (p) => <I {...p} d={<><polyline points="23,4 23,10 17,10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" /></>} />,
  eye: (p) => <I {...p} d={<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>} />,
  shield: (p) => <I {...p} d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  zap: (p) => <I {...p} d={<polygon points="13,2 3,14 12,14 11,22 21,10 12,10" fill="none" stroke={p?.color || "currentColor"} strokeWidth="2" strokeLinejoin="round" />} />,
  activity: (p) => <I {...p} d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  alertCircle: (p) => <I {...p} d={<><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></>} />,
  check: (p) => <I {...p} d="M20 6L9 17l-5-5" />,
  x: (p) => <I {...p} d={<><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>} />,
  externalLink: (p) => <I {...p} d={<><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15,3 21,3 21,9" /><line x1="10" y1="14" x2="21" y2="3" /></>} />,
  messageSquare: (p) => <I {...p} d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />,
  clipboard: (p) => <I {...p} d={<><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" /><rect x="8" y="2" width="8" height="4" rx="1" /></>} />,
  calendar: (p) => <I {...p} d={<><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>} />,
  target: (p) => <I {...p} d={<><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></>} />,
  layers: (p) => <I {...p} d={<><polygon points="12,2 2,7 12,12 22,7" /><polyline points="2,17 12,22 22,17" /><polyline points="2,12 12,17 22,12" /></>} />,
  compass: (p) => <I {...p} d={<><circle cx="12" cy="12" r="10" /><polygon points="16.24,7.76 14.12,14.12 7.76,16.24 9.88,9.88" /></>} />,
};

const nav = ["Detect", "Investigate", "Respond", "Hunt", "Threat Intel", "Skills", "Memory", "Build"];
const viewForNav = {
  Detect: "detect",
  Investigate: "investigations",
  Respond: "respond",
  Hunt: "hunt",
  "Threat Intel": "threatIntel",
  Skills: "skills",
  Memory: "memory",
  Build: "apiSources",
};
const navIsActive = (item, view) =>
  view === viewForNav[item] ||
  (item === "Respond" && view === "queue") ||
  (item === "Build" && view === "connector") ||
  (item === "Detect" && view === "detectionRuleDetail") ||
  (item === "Detect" && view === "detectionIntelligence") ||
  (item === "Threat Intel" && view === "threatIntelDetail") ||
  (item === "Skills" && ["skillCreate", "skillDetail", "skillTemplates", "skillSuggestions", "skillOutcomes"].includes(view));

const pathForView = {
  queue: "/",
  detect: "/detect/rules",
  detectionIntelligence: "/detect/intelligence",
  investigations: "/investigations",
  respond: "/respond",
  hunt: "/hunt",
  threatIntel: "/threat-intel",
  memory: "/memory",
  connector: "/build/connectors/cribl",
  apiSources: "/build/api-sources",
  skills: "/skills",
  skillCreate: "/skills/new",
  skillTemplates: "/skills/templates",
  skillSuggestions: "/skills/suggestions",
  skillOutcomes: "/skills/outcomes",
};

function routeFromPath(pathname) {
  if (pathname === "/skills/new") return { view: "skillCreate", skillId: null };
  if (pathname === "/skills/templates") return { view: "skillTemplates", skillId: null };
  if (pathname === "/skills/suggestions") return { view: "skillSuggestions", skillId: null };
  if (pathname === "/skills/outcomes") return { view: "skillOutcomes", skillId: null };
  const skillDetail = pathname.match(/^\/skills\/([^/]+)$/);
  if (skillDetail) return { view: "skillDetail", skillId: decodeURIComponent(skillDetail[1]) };
  const invDetail = pathname.match(/^\/investigations\/([^/]+)$/);
  if (invDetail)
    return {
      view: "investigationDetail",
      investigationId: decodeURIComponent(invDetail[1]),
      reportId: null, ruleId: null,
    };
  const tiDetail = pathname.match(/^\/threat-intel\/([^/]+)$/);
  if (tiDetail)
    return {
      view: "threatIntelDetail",
      investigationId: null,
      reportId: decodeURIComponent(tiDetail[1]),
      ruleId: null,
    };
  const ruleDetail = pathname.match(/^\/detect\/rules\/([^/]+)$/);
  if (ruleDetail)
    return {
      view: "detectionRuleDetail",
      investigationId: null, reportId: null,
      ruleId: decodeURIComponent(ruleDetail[1]),
    };
  const matched = Object.entries(pathForView).find(
    ([, path]) => path === pathname,
  );
  return { view: matched?.[0] || "queue", investigationId: null, reportId: null, ruleId: null };
}

function Logo() {
  return (
    <Text
      color="white"
      fontSize="17px"
      fontWeight="800"
      fontStyle="italic"
      letterSpacing="-.08em"
      whiteSpace="nowrap"
    >
      AISOC
    </Text>
  );
}

function TopNav({ view, setView }) {
  return (
    <Flex
      className="desktop-nav"
      h={{ base: "44px", md: "48px" }}
      bg={ui.nav}
      align="center"
      px={{ base: "12px", md: "20px" }}
      gap={{ base: "12px", md: "28px" }}
      position="sticky"
      top="0"
      zIndex="20"
      color="#f7f7fa"
    >
      <Box w="56px" flexShrink={0}>
        <Logo />
      </Box>
      <HStack
        className="primary-nav"
        spacing={{ base: "14px", md: "26px" }}
        h="full"
      >
        {nav.map((item) => (
          <Button
            key={item}
            variant="unstyled"
            color={navIsActive(item, view) ? "white" : "#c7cad2"}
            fontSize="12px"
            h="full"
            borderRadius="0"
            borderBottom="2px solid"
            borderColor={navIsActive(item, view) ? "white" : "transparent"}
            onClick={() => setView(viewForNav[item])}
          >
            {item}
          </Button>
        ))}
      </HStack>
      <HStack className="account-nav" ml="auto" spacing="18px" flexShrink="0">
        <Button variant="unstyled" fontSize="11px">
          Enterprise Demo {Icon.chevronDown({ size: 10 })}
        </Button>
        <Button
          variant="unstyled"
          fontSize="11px"
          onClick={() => setView("connector")}
        >
          Configuration
        </Button>
        <Box
          position="relative"
          role="img"
          aria-label="Notifications"
          cursor="pointer"
        >
          {Icon.bell({ size: 16, color: "#c7cad2" })}
          <Badge
            position="absolute"
            top="-7px"
            right="-9px"
            bg={ui.red}
            color="white"
          >
            15
          </Badge>
        </Box>
        <Flex
          w="24px"
          h="24px"
          rounded="full"
          bg="#6056e8"
          color="white"
          align="center"
          justify="center"
          fontSize="10px"
          fontWeight="600"
        >
          WA
        </Flex>
        <Box className="hide-mobile">
          <Text fontSize="9px">Walter Abeson</Text>
          <Text color="#8c929f" fontSize="7px">
            AISOC
          </Text>
        </Box>
        {Icon.chevronDown({ size: 12, color: "#8c929f" })}
      </HStack>
    </Flex>
  );
}

function ToolRail() {
  return (
    <Flex
      className="tool-rail"
      position="fixed"
      top="48px"
      bottom="0"
      left="0"
      w="40px"
      bg="#f8f9fb"
      borderRight="1px solid"
      borderColor={ui.line}
      direction="column"
      align="center"
      zIndex="10"
      pt="18px"
      gap="19px"
      color="#858d9b"
      fontSize="14px"
    >
      {Icon.grid({ size: 16, color: ui.violet })}
      {Icon.plus({ size: 16 })}
      {Icon.messageSquare({ size: 16 })}
      {Icon.settings({ size: 16 })}
    </Flex>
  );
}

function Breadcrumb({ section, title }) {
  return (
    <HStack
      px={{ base: "16px", md: "24px" }}
      h="46px"
      color={ui.muted}
      fontSize="11px"
    >
      {Icon.grid({ size: 13, color: ui.quiet })}
      <Text>{section}</Text>
      {Icon.chevronRight({ size: 12, color: ui.quiet })}
      <Text color={ui.ink} fontWeight="600">
        {title}
      </Text>
    </HStack>
  );
}

function Shell({ view, setView, children, breadcrumb }) {
  return (
    <Box minH="100vh" bg={ui.page}>
      <TopNav view={view} setView={setView} />
      <ToolRail />
      <Box className="main-content" ml="40px">
        <Breadcrumb
          section={breadcrumb?.[0] || "Respond"}
          title={breadcrumb?.[1] || "Operations Queue"}
        />
        {children}
      </Box>
    </Box>
  );
}

const Panel = ({ children, ...props }) => (
  <Box
    bg="white"
    border="1px solid"
    borderColor={ui.line}
    borderRadius="3px"
    {...props}
  >
    {children}
  </Box>
);
const Label = ({ children }) => (
  <Text
    fontSize="8px"
    fontWeight="700"
    letterSpacing=".08em"
    textTransform="uppercase"
  >
    {children}
  </Text>
);
const Metric = ({ value, label, color = ui.ink, size = "36px" }) => (
  <Box>
    <Text
      className="metric-number"
      fontSize={size}
      color={color}
      lineHeight="1"
    >
      {value}
    </Text>
    <Text fontSize="8px" color={ui.muted} mt="4px">
      {label}
    </Text>
  </Box>
);

// Shown when a live request fails and the screen falls back to sample data,
// so the fixture numbers are never mistaken for live data.
const SampleDataNotice = ({ show }) =>
  show ? (
    <Alert
      status="warning"
      variant="left-accent"
      fontSize="11px"
      py="6px"
      mb="8px"
      borderRadius="3px"
    >
      <AlertIcon />
      Live data is unavailable. Showing sample data.
    </Alert>
  ) : null;

function QueueDashboard({ setView }) {
  const [dashboard, setDashboard] = useState({
    queueItems: 8,
    openInvestigations: 3,
    openRemediations: 5,
  });
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    let active = true;
    api
      .dashboard()
      .then((result) => active && setDashboard(result))
      .catch(() => active && setLoadFailed(true));
    return () => {
      active = false;
    };
  }, []);
  return (
    <Box className="page-enter" px="15px" pb="14px">
      <SampleDataNotice show={loadFailed} />
      <Flex align="center" mb="10px">
        <Heading fontSize="20px" fontWeight="400">
          There Are {dashboard.queueItems} Items In Your Queue:
        </Heading>
        <Badge ml="15px" bg="white" color={ui.ink}>
          {Icon.alertCircle({ size: 11 })} {dashboard.openInvestigations} open cases
        </Badge>
        <Badge ml="8px" bg="white" color={ui.ink}>
          {Icon.shield({ size: 11 })} {dashboard.openRemediations} open remediations
        </Badge>
        <Button ml="auto" variant="outline">
          ∞ Agentic flywheel
        </Button>
      </Flex>
      <Grid
        templateColumns={{ base: "1fr", lg: "1.06fr 1.06fr 1fr" }}
        gap="8px"
      >
        <QueueColumn
          title="Federated SIEM"
          subtitle="Query, search, and act on data wherever it lives"
        >
          <Label>Detect</Label>
          <Metric value="78%" label="ATT&CK coverage" />
          <Flex minH="180px" align="center" justify="space-between">
            <Box w="42%">
              <Text fontSize="8px" color={ui.muted} lineHeight="1.45">
                3 detection tuning recommendations to improve ATT&CK coverage
                are ready for review
              </Text>
            </Box>
            <Radar />
          </Flex>
          <Text fontSize="8px" fontWeight="600">
            Exfiltration: Optimize Coverage for T1567 ·{" "}
            <Text as="span" color={ui.red}>
              Critical
            </Text>
          </Text>
          <Text color={ui.violet} fontSize="8px" mt="5px">
            Fix the exfiltration coverage gap ›
          </Text>
          <Divider my="14px" />
          <Label>Data lakes</Label>
          <Metric value="3" label="Watchlist hits on ingest" size="30px" />
          <Stack mt="12px" spacing="7px">
            {[
              ["45.83.12.9", "Cobalt Strike C2", "2 HITS"],
              ["31fc9a2b7e", "Lumma Stealer", "1 HITS"],
            ].map((x) => (
              <Flex key={x[0]} fontSize="8px">
                <Text fontWeight="600">{x[0]}</Text>
                <Text color={ui.muted} ml="5px">
                  · {x[1]}
                </Text>
                <Text ml="auto" color={ui.red}>
                  {x[2]}
                </Text>
              </Flex>
            ))}
          </Stack>
          <Text mt="12px" fontSize="7px" color={ui.muted}>
            LAKE HEALTH
          </Text>
          {[1, 2, 3].map((i) => (
            <HStack key={i} mt="5px">
              <Badge
                bg={i === 1 ? "#111827" : i === 2 ? ui.red : ui.violet}
                color="white"
              >
                {i === 1 ? "AI" : i === 2 ? "CS" : "AZ"}
              </Badge>
              <Box className="spark-line" flex="1" />
              <Text color={ui.green} fontSize="7px">
                ● OPERATIONAL
              </Text>
            </HStack>
          ))}
          <Box mt="auto" pt="22px">
            <Text fontSize="8px">
              Review: Credential theft around 185.220.101.45
            </Text>
            <Text color={ui.violet} fontSize="8px">
              Dive into your search results ›
            </Text>
          </Box>
        </QueueColumn>
        <QueueColumn
          title="AI SOC"
          subtitle="Investigate and respond to every alert"
        >
          <Label>Investigate</Label>
          <Metric value="14" label="Escalated investigations" />
          <SankeyMini />
          <Text mt="15px" fontSize="8px">
            AiTM session token replay from anomalous infrastructure
          </Text>
          <Text color={ui.violet} fontSize="8px">
            Investigate this alert ›
          </Text>
          <Divider my="14px" />
          <Label>Respond</Label>
          <Metric value="5" label="Open remediations" size="30px" />
          <Flex align="end" minH="180px">
            <Stack spacing="4px" fontSize="7px" flex="1">
              {[
                [ui.red, "Open"],
                [ui.teal, "Closed"],
                [ui.steel, "AISOC Auto"],
                ["#687488", "AISOC PLAID Elite"],
                ["#283446", "Analysts"],
              ].map(([c, t]) => (
                <HStack key={t}>
                  <Box w="6px" h="6px" rounded="full" bg={c} />
                  <Text>{t}</Text>
                </HStack>
              ))}
            </Stack>
            <Donut />
          </Flex>
          <Box mt="auto">
            <Text fontSize="8px">
              Credential-store access and outbound transfer on OKAMI-FIN-074 ·{" "}
              <Text as="span" color={ui.red}>
                Critical
              </Text>
            </Text>
            <Text
              color={ui.violet}
              fontSize="8px"
              onClick={() => setView("investigationDetail")}
              cursor="pointer"
            >
              Review the case ›
            </Text>
          </Box>
        </QueueColumn>
        <QueueColumn
          title="Hunt & Services"
          subtitle="Threat hunting and 24/7 managed services"
        >
          <Label>Hunt</Label>
          <Metric value="17" label="Reports processed" />
          <Stack mt="15px" spacing="12px">
            {[
              [
                "AISOC Threat Intelligence",
                "CRXfiltrate — Remote-Controlled Manifest V3 Browser Extensions",
                "MALICIOUS",
                "TIR-001",
              ],
              [
                "Google Threat Intelligence",
                "Click, Install, Compromise: The New Wave of Zoom-Themed Attacks",
                "SUSPICIOUS",
                "TIR-003",
              ],
              [
                "Google Threat Intelligence",
                "UNC1549 — Aerospace Harvest",
                "MITIGATED",
                "TIR-004",
              ],
            ].map(([source, title, status, reportId]) => (
              <Box key={title} cursor="pointer" onClick={() => setView("threatIntelDetail", reportId)}>
                <HStack>
                  <Badge bg="#20232d" color="white">
                    AISOC
                  </Badge>
                  <Text fontSize="8px">{source}</Text>
                </HStack>
                <Flex mt="5px">
                  <Text color={ui.violet} fontSize="8px">
                    {title}
                  </Text>
                  <Badge
                    ml="auto"
                    bg={
                      status === "MALICIOUS"
                        ? ui.red
                        : status === "SUSPICIOUS"
                          ? ui.amber
                          : ui.steel
                    }
                    color="white"
                  >
                    {status}
                  </Badge>
                </Flex>
              </Box>
            ))}
          </Stack>
          <Box mt="auto">
            <Divider my="14px" />
            <Label>Plaid Elite 24/7 Services</Label>
            <Metric value="84%" label="workload reduced" size="30px" />
            <Flex align="end" minH="190px">
              <Stack spacing="6px" fontSize="7px" color={ui.muted} flex="1">
                <Text>● Not escalated</Text>
                <Text>● Cases Resolved</Text>
                <Text color={ui.amber}>● Pending action</Text>
                <Text>● Assigned to Plaid Elite</Text>
              </Stack>
              <Donut workload />
            </Flex>
            <Text fontSize="8px">Confirmation required</Text>
            <Text color={ui.violet} fontSize="8px">
              Accept Plaid Elite's recommended action ›
            </Text>
          </Box>
        </QueueColumn>
      </Grid>
    </Box>
  );
}

function QueueColumn({ title, subtitle, children }) {
  return (
    <Panel
      minH={{ base: "auto", lg: "calc(100vh - 94px)" }}
      display="flex"
      flexDirection="column"
      overflow="hidden"
    >
      <Box px="10px" py="8px" borderBottom="1px solid" borderColor={ui.line}>
        <Text fontSize="10px" fontWeight="600">
          {Icon.activity({ size: 12, color: ui.violet })} &nbsp;{title}
        </Text>
        <Text fontSize="7px" color={ui.muted} mt="2px">
          {subtitle}
        </Text>
      </Box>
      <Flex direction="column" flex="1" p="12px">
        {children}
      </Flex>
    </Panel>
  );
}

function Radar() {
  return (
    <Box
      className="radar-grid"
      position="relative"
      w="130px"
      h="130px"
      rounded="full"
    >
      <Box
        position="absolute"
        inset="27px"
        bg="rgba(96,86,232,.20)"
        border="1px solid"
        borderColor={ui.violet}
        clipPath="polygon(50% 0,82% 13%,100% 50%,78% 88%,38% 100%,6% 65%,13% 20%)"
      />
    </Box>
  );
}
function SankeyMini() {
  return (
    <Box mt="12px" h="105px" position="relative" overflow="hidden">
      {[12, 39, 66].map((top, i) => (
        <React.Fragment key={top}>
          <Box
            position="absolute"
            left="8px"
            top={`${top}px`}
            w="10px"
            h="18px"
            bg="#43516a"
          />
          <Box
            position="absolute"
            left="18px"
            right="20px"
            top={`${top + 4}px`}
            h={`${24 - i * 4}px`}
            bg={`linear-gradient(90deg,rgba(67,81,106,.32),rgba(142,161,183,.12))`}
            transform={`skewY(${i === 0 ? -3 : i === 2 ? 3 : 0}deg)`}
          />
        </React.Fragment>
      ))}
      <Stack
        position="absolute"
        right="0"
        top="5px"
        spacing="4px"
        fontSize="7px"
      >
        <Text color={ui.red}>Escalated</Text>
        <Text>Mitigated</Text>
        <Text>Benign</Text>
      </Stack>
    </Box>
  );
}
function Donut({ workload = false }) {
  return (
    <Box
      position="relative"
      w="105px"
      h="105px"
      rounded="full"
      bg={
        workload
          ? `conic-gradient(${ui.steel} 0 62%,${ui.teal} 62% 84%,${ui.amber} 84% 89%,#edf0f3 89%)`
          : `conic-gradient(${ui.steel} 0 28%,${ui.teal} 28% 62%,#687488 62% 82%,#283446 82%)`
      }
      _after={{
        content: '""',
        position: "absolute",
        inset: "15px",
        bg: "white",
        borderRadius: "50%",
      }}
    />
  );
}

function InvestigationsDashboard({ setView }) {
  const sources = [
    ["AISOC", 947],
    ["AWS", 198],
    ["CrowdStrike", 851],
    ["Microsoft Defender", 1780],
    ["Microsoft Sentinel", 726],
    ["SentinelOne", 1285],
    ["Splunk", 206],
    ["Wiz", 126],
  ];
  return (
    <Box className="page-enter">
      <HStack px="15px" mb="12px">
        <Button variant="outline" leftIcon={Icon.calendar({ size: 12 })}>Last 7 days</Button>
      </HStack>
      <Panel borderX="0" borderRadius="0" p="16px 7% 20px">
        <Box
          className="sankey"
          onClick={() => setView("investigationDetail", "INV-4819")}
          cursor="pointer"
        >
          <Flex justify="space-between" fontSize="8px" mb="15px">
            <Text>Detection</Text>
            <Text>Categorization</Text>
            <Text>Grouping</Text>
            <Text>Triage</Text>
            <Text>Determination</Text>
          </Flex>
          <Grid
            templateColumns="1fr 1fr 1fr 1fr 1.2fr"
            gap="9%"
            position="relative"
            zIndex="2"
          >
            <Stack spacing="7px">
              {sources.map(([n, v]) => (
                <HStack key={n} justify="end">
                  <Text fontSize="7px">
                    {n} <b>{v.toLocaleString()}</b>
                  </Text>
                  <Box w="13px" h="18px" bg="#11151f" />
                </HStack>
              ))}
            </Stack>
            <Stack spacing="15px">
              {[
                ["Identity", 1483],
                ["Endpoint", 2255],
                ["Cloud", 1145],
                ["Email", 789],
                ["Threat intel", 279],
                ["Insider threat", 170],
              ].map(([n, v]) => (
                <HStack key={n}>
                  <Box w="13px" h="25px" bg="#293246" />
                  <Text fontSize="7px">
                    {n} {v.toLocaleString()}
                  </Text>
                </HStack>
              ))}
            </Stack>
            <Stack spacing="8px">
              {[
                ["Various Identity alerts", 867],
                ["Impossible Travel", 335],
                ["Password Spray", 206],
                ["Various Endpoint alerts", 1939],
                ["Software vulnerability", 249],
                ["Various Cloud alerts", 829],
                ["Unusual Network Traffic", 241],
                ["Various Email alerts", 322],
              ].map(([n, v]) => (
                <HStack key={n}>
                  <Text fontSize="7px" textAlign="right" flex="1">
                    {n} <b>{v}</b>
                  </Text>
                  <Box w="13px" h="18px" bg="#3d4964" />
                </HStack>
              ))}
            </Stack>
            <Stack spacing="35px" pt="15px">
              <HStack>
                <Text fontSize="7px" color={ui.red}>
                  Escalated <b>193</b>
                </Text>
                <Box w="13px" h="18px" bg={ui.red} />
              </HStack>
              <HStack>
                <Text fontSize="7px">
                  Not escalated <b>5,540</b>
                </Text>
                <Box w="13px" h="130px" bg="#91aca6" />
              </HStack>
            </Stack>
            <Stack spacing="8px" fontSize="7px" pt="10px">
              <Text color={ui.red}>━ 20 Malicious</Text>
              <Text color={ui.amber}>━ 134 Suspicious</Text>
              <Text color={ui.violet}>━ 39 Recommended for review</Text>
              <Text color="#6c82ad">━ 548 Acceptable risk</Text>
              <Text color={ui.steel}>━ 853 Mitigated</Text>
              <Text color="#86aaa2">━ 4,141 Benign</Text>
            </Stack>
          </Grid>
          {[20, 50, 85, 120, 155, 190].map((top, i) => (
            <Box
              key={top}
              className="sankey-flow"
              left="8%"
              top={`${top}px`}
              w="72%"
              bg={
                i < 2
                  ? "linear-gradient(90deg,#77839b,#d6d9e2)"
                  : "linear-gradient(90deg,#8f98aa,#9bbdb6)"
              }
              transform={`rotate(${i * 2 - 5}deg)`}
            />
          ))}
        </Box>
      </Panel>
      <Grid
        templateColumns={{ base: "1fr", md: "1fr 1fr 2fr 2fr" }}
        gap="8px"
        mt="8px"
      >
        <Panel p="18px">
          <Metric value="193" label="Escalated alerts" color={ui.red} />
          <Divider my="10px" />
          <Metric value="115d 10h" label="Estimated time saved" />
        </Panel>
        <Panel p="18px">
          <Metric value="5,540" label="Not escalated" />
          <Divider my="10px" />
          <Metric value="549" label="Alerts consolidated" />
        </Panel>
        <Panel p="18px">
          <Text fontSize="8px" fontWeight="600" mb="10px">Sources</Text>
          <Flex align="center" gap="14px">
            <Box position="relative">
              <Donut />
              <Flex position="absolute" inset="0" align="center" justify="center" direction="column" zIndex="1">
                <Text fontSize="7px" color={ui.muted}>Total Alerts</Text>
                <Text className="metric-number" fontSize="22px">6,119</Text>
              </Flex>
            </Box>
            <Stack spacing="5px" fontSize="7px">
              {[["Microsoft Defender", "1,780", "29.1%", "#2563eb"], ["SentinelOne", "1,285", "21%", "#7c3aed"], ["AISOC", "947", "15.5%", "#111827"], ["CrowdStrike", "851", "13.9%", ui.red], ["Microsoft Sentinel", "726", "11.9%", "#0ea5e9"], ["Remaining sources", "530", "8.7%", ui.steel]].map(([name, count, pct, color]) => (
                <HStack key={name}>
                  <Box w="6px" h="6px" rounded="full" bg={color} flexShrink="0" />
                  <Text>{name}</Text>
                  <Text fontWeight="600" ml="auto">{count}</Text>
                  <Text color={ui.quiet} w="32px" textAlign="right">{pct}</Text>
                </HStack>
              ))}
            </Stack>
          </Flex>
        </Panel>
        <Panel p="18px">
          <Text fontSize="8px" fontWeight="600" mb="10px">Workload Reduction</Text>
          <Flex align="center" gap="14px">
            <Box position="relative">
              <Donut workload />
              <Flex position="absolute" inset="0" align="center" justify="center" direction="column" zIndex="1">
                <Text fontSize="7px" color={ui.muted}>Deflected</Text>
                <Text className="metric-number" fontSize="22px">96%</Text>
              </Flex>
            </Box>
            <Stack spacing="5px" fontSize="7px">
              {[["De-duplicated", "186", "3%", ui.steel], ["Clustered", "183", "3%", ui.teal], ["Not Escalated", "5,540", "90.5%", "#91aca6"], ["Escalated", "193", "3.2%", ui.red]].map(([name, count, pct, color]) => (
                <HStack key={name}>
                  <Box w="6px" h="6px" rounded="full" bg={color} flexShrink="0" />
                  <Text>{name}</Text>
                  <Text fontWeight="600" ml="auto">{count}</Text>
                  <Text color={ui.quiet} w="32px" textAlign="right">{pct}</Text>
                </HStack>
              ))}
            </Stack>
          </Flex>
        </Panel>
      </Grid>
    </Box>
  );
}

const rules = [
  [
    "AISOC - CRXfiltrate Browser Domain and Path Match",
    "2 techniques",
    "Scheduled · AISOC SIEM",
    "837",
    "193",
    "26%",
    "Validated",
    "HIGH",
    "Last alert today",
  ],
  [
    "AISOC - Impossible Travel",
    "5 techniques",
    "Scheduled · AISOC SIEM",
    "200",
    "170",
    "45%",
    "Not analyzed",
    "MEDIUM",
    "Last alert 3 days ago",
  ],
  [
    "AISOC - Suspicious PowerShell EncodedCommand",
    "T1059.001 (PowerShell)",
    "Scheduled · AISOC SIEM",
    "190",
    "153",
    "10%",
    "Validated",
    "HIGH",
    "Last alert 7 days ago",
  ],
  [
    "File Integrity violations",
    "2 techniques",
    "Scheduled · Microsoft Defender",
    "152",
    "129",
    "62%",
    "2 recommendations",
    "LOW",
    "Last alert 1 week ago",
  ],
  [
    "Authentication Anomalies",
    "T1078 (Valid Accounts)",
    "Scheduled · Microsoft Defender",
    "158",
    "122",
    "88%",
    "2 recommendations",
    "MEDIUM",
    "Last alert today",
  ],
  [
    "AISOC - Remote Logon → LOLBin Execution",
    "5 techniques",
    "Realtime · AISOC SIEM",
    "140",
    "119",
    "17%",
    "Validated",
    "HIGH",
    "Last alert 1 week ago",
  ],
  [
    "Multiple Accounts Failing Authentication from Same IP",
    "2 techniques",
    "Scheduled · Microsoft Defender",
    "127",
    "112",
    "75%",
    "2 recommendations",
    "MEDIUM",
    "Last alert 3 days ago",
  ],
  [
    "AISOC - Auth From Endpoint With Active Finding",
    "3 techniques",
    "Realtime · AISOC SIEM",
    "127",
    "108",
    "28%",
    "2 recommendations",
    "HIGH",
    "Last alert 3 weeks ago",
  ],
  [
    "Suspicious Service Account Behavior",
    "2 techniques",
    "Scheduled · Microsoft Defender",
    "124",
    "101",
    "47%",
    "1 recommendation",
    "MEDIUM",
    "Last alert today",
  ],
];
const mitreTactics = [
  { id: "TA0043", name: "Reconnaissance", techniques: 10, covered: 6 },
  { id: "TA0042", name: "Resource Development", techniques: 8, covered: 4 },
  { id: "TA0001", name: "Initial Access", techniques: 10, covered: 9 },
  { id: "TA0002", name: "Execution", techniques: 14, covered: 12 },
  { id: "TA0003", name: "Persistence", techniques: 20, covered: 14 },
  { id: "TA0004", name: "Privilege Escalation", techniques: 14, covered: 11 },
  { id: "TA0005", name: "Defense Evasion", techniques: 43, covered: 28 },
  { id: "TA0006", name: "Credential Access", techniques: 17, covered: 15 },
  { id: "TA0007", name: "Discovery", techniques: 32, covered: 22 },
  { id: "TA0008", name: "Lateral Movement", techniques: 9, covered: 8 },
  { id: "TA0009", name: "Collection", techniques: 17, covered: 12 },
  { id: "TA0011", name: "Command and Control", techniques: 16, covered: 13 },
  { id: "TA0010", name: "Exfiltration", techniques: 9, covered: 7 },
  { id: "TA0040", name: "Impact", techniques: 14, covered: 11 },
];
const catalogRules = [
  { id: "CAT-001", name: "Kerberoasting via SPN Request", tactics: ["Credential Access"], techniques: ["T1558.003"], source: "AISOC", severity: "high", description: "Detects service ticket requests for SPNs indicating Kerberoasting attempts." },
  { id: "CAT-002", name: "DCSync Attack Detection", tactics: ["Credential Access"], techniques: ["T1003.006"], source: "AISOC", severity: "critical", description: "Identifies directory replication requests from non-DC sources." },
  { id: "CAT-003", name: "Scheduled Task Creation via CLI", tactics: ["Persistence", "Execution"], techniques: ["T1053.005"], source: "AISOC", severity: "medium", description: "Detects scheduled tasks created via schtasks.exe or at.exe command line." },
  { id: "CAT-004", name: "LSASS Memory Dump Detection", tactics: ["Credential Access"], techniques: ["T1003.001"], source: "AISOC", severity: "critical", description: "Identifies attempts to dump LSASS process memory for credential harvesting." },
  { id: "CAT-005", name: "DNS Tunneling Detection", tactics: ["Command and Control", "Exfiltration"], techniques: ["T1071.004"], source: "AISOC", severity: "high", description: "Detects high-entropy DNS queries indicating possible data exfiltration via DNS." },
  { id: "CAT-006", name: "Cloud Storage Exfiltration", tactics: ["Exfiltration"], techniques: ["T1567.002"], source: "AISOC", severity: "medium", description: "Monitors unusual uploads to cloud storage services outside approved providers." },
  { id: "CAT-007", name: "WMI Lateral Movement", tactics: ["Lateral Movement", "Execution"], techniques: ["T1047"], source: "Community", severity: "high", description: "Detects WMI process creation on remote hosts indicative of lateral movement." },
  { id: "CAT-008", name: "Registry Run Key Persistence", tactics: ["Persistence"], techniques: ["T1547.001"], source: "Community", severity: "medium", description: "Monitors modifications to registry run keys for auto-start persistence." },
  { id: "CAT-009", name: "Token Impersonation Detection", tactics: ["Privilege Escalation", "Defense Evasion"], techniques: ["T1134.001"], source: "AISOC", severity: "high", description: "Detects access token manipulation and impersonation attempts." },
  { id: "CAT-010", name: "Suspicious Office Macro Execution", tactics: ["Execution"], techniques: ["T1204.002"], source: "Community", severity: "medium", description: "Identifies Office applications spawning suspicious child processes." },
];
const tuningRecommendations = [
  { ruleId: "fixture-3", ruleName: "File Integrity Violations", fpr: 62, analystHours: 14.2, issue: "Service account svc-deploy triggers file modifications during scheduled deployments every 6 hours, generating ~40% of all false positives.", recommendation: "Add exclusion for process.user.name:\"svc-deploy\" AND file.path:\"C:\\\\Deploy\\\\*\" during maintenance windows (02:00-04:00 UTC).", impact: "Estimated FPR reduction: 62% → 38%" },
  { ruleId: "fixture-4", ruleName: "Authentication Anomalies", fpr: 88, analystHours: 22.5, issue: "The VPN gateway IP pool 10.0.50.0/24 is classified as an anomalous source because geolocation returns null for internal addresses, triggering the anomaly threshold.", recommendation: "Whitelist source.ip in CIDR 10.0.50.0/24 when event.provider:\"corporate-vpn\" and add these as known-good in the baseline.", impact: "Estimated FPR reduction: 88% → 31%" },
  { ruleId: "fixture-6", ruleName: "Multiple Accounts Failing Authentication from Same IP", fpr: 75, analystHours: 11.8, issue: "Conference room shared workstations (CONF-*) generate bursts of failed auth when users forget cached credentials, each appearing as a brute-force pattern.", recommendation: "Exclude host.name matching \"CONF-*\" when failure_count < 15 within 5 minutes, preserving detection for actual brute-force above that threshold.", impact: "Estimated FPR reduction: 75% → 28%" },
];
function MitreMatrix({ onClose }) {
  const [selectedTactic, setSelectedTactic] = useState(null);
  const totalTechniques = mitreTactics.reduce((s, t) => s + t.techniques, 0);
  const totalCovered = mitreTactics.reduce((s, t) => s + t.covered, 0);
  const pct = Math.round((totalCovered / totalTechniques) * 100);
  return (
    <Box>
      <Flex justify="space-between" align="center" mb="16px">
        <Box>
          <Heading fontSize="14px">MITRE ATT&CK Coverage</Heading>
          <Text fontSize="9px" color={ui.muted} mt="2px">{totalCovered} of {totalTechniques} techniques covered ({pct}%)</Text>
        </Box>
        <HStack>
          <HStack spacing="4px"><Box w="8px" h="8px" bg={ui.green} rounded="2px" /><Text fontSize="8px">Covered</Text></HStack>
          <HStack spacing="4px"><Box w="8px" h="8px" bg={ui.amber} rounded="2px" /><Text fontSize="8px">Partial</Text></HStack>
          <HStack spacing="4px"><Box w="8px" h="8px" bg="#e2e4ea" rounded="2px" /><Text fontSize="8px">No coverage</Text></HStack>
          <Button variant="outline" ml="8px" onClick={onClose} leftIcon={Icon.arrowLeft({ size: 13 })}>Back to rules</Button>
        </HStack>
      </Flex>
      <Box overflowX="auto" pb="8px">
        <Flex gap="3px" minW="900px">
          {mitreTactics.map((tactic) => {
            const gapCount = tactic.techniques - tactic.covered;
            const partial = Math.floor(gapCount * 0.4);
            const none = gapCount - partial;
            return (
              <Box key={tactic.id} flex="1" minW="62px" cursor="pointer" onClick={() => setSelectedTactic(selectedTactic?.id === tactic.id ? null : tactic)}>
                <Box bg={ui.ink} color="white" p="4px" textAlign="center" fontSize="6px" fontWeight="600" lineHeight="1.3" minH="32px" display="flex" alignItems="center" justifyContent="center">
                  {tactic.name}
                </Box>
                <Stack spacing="2px" mt="2px">
                  {Array.from({ length: tactic.covered }, (_, i) => (
                    <Box key={`c${i}`} h="14px" bg={ui.green} opacity={0.7 + (i % 3) * 0.1} borderRadius="1px" />
                  ))}
                  {Array.from({ length: partial }, (_, i) => (
                    <Box key={`p${i}`} h="14px" bg={ui.amber} opacity={0.7} borderRadius="1px" />
                  ))}
                  {Array.from({ length: none }, (_, i) => (
                    <Box key={`n${i}`} h="14px" bg="#e2e4ea" borderRadius="1px" />
                  ))}
                </Stack>
                <Text mt="3px" textAlign="center" fontSize="6px" color={ui.muted}>{tactic.covered}/{tactic.techniques}</Text>
              </Box>
            );
          })}
        </Flex>
      </Box>
      {selectedTactic && (
        <Panel mt="12px" p="14px">
          <Flex justify="space-between" align="center">
            <Box>
              <Text fontWeight="600" fontSize="12px">{selectedTactic.name}</Text>
              <Text fontSize="9px" color={ui.muted}>{selectedTactic.id} · {selectedTactic.covered} of {selectedTactic.techniques} techniques covered</Text>
            </Box>
            <Badge bg={selectedTactic.covered / selectedTactic.techniques > 0.7 ? ui.green : selectedTactic.covered / selectedTactic.techniques > 0.4 ? ui.amber : ui.red} color="white">
              {Math.round((selectedTactic.covered / selectedTactic.techniques) * 100)}% coverage
            </Badge>
          </Flex>
          <Box mt="12px" overflowX="auto">
            <Box as="table" w="100%" fontSize="10px">
              <Box as="thead">
                <Box as="tr" borderBottom="1px solid" borderColor={ui.line}>
                  <Box as="th" p="6px 10px" textAlign="left" fontSize="8px" color={ui.muted}>Technique</Box>
                  <Box as="th" p="6px 10px" textAlign="left" fontSize="8px" color={ui.muted}>Status</Box>
                  <Box as="th" p="6px 10px" textAlign="left" fontSize="8px" color={ui.muted}>Rules</Box>
                  <Box as="th" p="6px 10px" textAlign="left" fontSize="8px" color={ui.muted}>Action</Box>
                </Box>
              </Box>
              <Box as="tbody">
                {Array.from({ length: selectedTactic.techniques }, (_, i) => {
                  const covered = i < selectedTactic.covered;
                  const partial = !covered && i < selectedTactic.covered + Math.floor((selectedTactic.techniques - selectedTactic.covered) * 0.4);
                  const techId = `T${1000 + i + (selectedTactic.id === "TA0001" ? 189 : selectedTactic.id === "TA0002" ? 203 : 100)}`;
                  return (
                    <Box as="tr" key={i} borderBottom="1px solid" borderColor={ui.line} _hover={{ bg: ui.soft }}>
                      <Box as="td" p="6px 10px"><Text fontFamily="mono" fontSize="9px">{techId}</Text></Box>
                      <Box as="td" p="6px 10px">
                        <Badge bg={covered ? ui.green : partial ? ui.amber : "#e2e4ea"} color={covered || partial ? "white" : ui.muted} fontSize="7px">
                          {covered ? "Covered" : partial ? "Partial" : "No coverage"}
                        </Badge>
                      </Box>
                      <Box as="td" p="6px 10px" color={ui.muted}>{covered ? `${1 + (i % 3)} rules` : partial ? "1 rule (limited)" : "—"}</Box>
                      <Box as="td" p="6px 10px">
                        {!covered && <Text color={ui.violet} cursor="pointer" fontSize="9px">{partial ? "Improve coverage" : "Browse catalog →"}</Text>}
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          </Box>
        </Panel>
      )}
    </Box>
  );
}
function DetectionRules({ setView }) {
  const [severityFilter, setSeverityFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [deploying, setDeploying] = useState(null);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [query, setQuery] = useState("");
  const [remoteRules, setRemoteRules] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [toggling, setToggling] = useState(null);
  const [activeTab, setActiveTab] = useState("rules");
  const [showMitre, setShowMitre] = useState(false);
  const [showTuning, setShowTuning] = useState(false);
  const [routingRule, setRoutingRule] = useState(null);
  const toast = useToast();
  useEffect(() => {
    let active = true;
    api.detectionRules().then((result) => active && setRemoteRules(result.items)).catch(() => active && setLoadFailed(true));
    return () => { active = false; };
  }, []);
  const tableRows = remoteRules
    ? remoteRules.map((rule) => ({
        id: rule.id,
        cells: [rule.name, rule.mitre_techniques?.join(", ") || "No techniques", `${rule.execution_mode || "scheduled"} · AISOC SIEM`, rule.enabled ? "Enabled" : "Disabled", String(rule.detections || 0), String(rule.investigations || 0), `${rule.false_positive_rate || 0}%`, rule.recommendation_status?.replaceAll("_", " ") || "Not analyzed", String(rule.severity || "medium").toUpperCase(), rule.last_activity_at ? new Date(rule.last_activity_at).toLocaleDateString() : "No activity"],
      }))
    : [];
  const filtered = tableRows.filter((rule) => rule.cells.join(" ").toLowerCase().includes(query.toLowerCase()) && (!severityFilter || rule.cells[8] === severityFilter));
  const toggleRule = async (rule) => {
    if (rule.id.startsWith("fixture-")) return;
    setToggling(rule.id);
    try {
      const updated = await api.toggleDetectionRule(rule.id);
      setRemoteRules((current) => current.map((item) => (item.id === rule.id ? updated : item)));
    } catch (error) { toast({ title: "Could not change rule status", description: error.message, status: "error", duration: 3000 }); }
    finally { setToggling(null); }
  };
  const totalRules = remoteRules ? remoteRules.length : 0;
  const deployRule = async (rule) => {
    setDeploying(rule.id);
    try {
      const created = await api.create("detection-rules", { name: rule.name, description: rule.description, severity: rule.severity, mitre_techniques: rule.techniques, enabled: false });
      setRemoteRules(current => [created, ...(current || [])]);
      toast({ title: "Template added to registry", description: "Add query logic before enabling this rule. No external engine is connected.", status: "success", duration: 4000 });
    } catch (error) { toast({ title: "Could not add rule", description: error.message, status: "error" }); }
    finally { setDeploying(null); }
  };
  const saveRouting = async (routing) => {
    try {
      const updated = await api.update("detection-rules", routingRule.id, { routing });
      setRemoteRules(current => current.map(item => item.id === updated.id ? updated : item));
      setRoutingRule(null);
      toast({ title: "Routing preference saved", description: "Stored locally; no detection engine is connected.", status: "success" });
    } catch (error) { toast({ title: "Could not save routing", description: error.message, status: "error" }); }
  };
  const totalDetections = remoteRules ? remoteRules.reduce((s, r) => s + (r.detections || 0), 0) : 0;
  const noisyCount = tuningRecommendations.length;
  return (
    <Flex className="page-enter">
      <Box
        className="hide-mobile"
        position="sticky" top="48px" alignSelf="flex-start" w="28px" minH="calc(100vh - 94px)"
        bg="#f8f9fb" borderRight="1px solid" borderColor={ui.line}
        display="flex" alignItems="center" justifyContent="center"
        css={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
      >
        <Text fontSize="8px" color={ui.quiet} fontWeight="600" letterSpacing=".06em" textTransform="uppercase">Detection Assistant</Text>
      </Box>
      <Box flex="1">
        {loadFailed && <Alert status="error"><AlertIcon />Could not load rules. Check the API and reload this page.</Alert>}
        {!loadFailed && !remoteRules && <Text p="15px" role="status">Loading detection rules…</Text>}
        <HStack px="15px" mb="12px" spacing="8px">
          <Panel w="135px" p="15px" textAlign="center" cursor="pointer" _hover={{ borderColor: ui.violet }} onClick={() => {}}>
            <Text fontSize="8px">Registry Rules</Text>
            <Text className="metric-number" fontSize="31px" whiteSpace="nowrap">{totalRules}</Text>
          </Panel>
          <Panel w="135px" p="15px" textAlign="center">
            <Text fontSize="8px">Triggered Alerts</Text>
            <Text className="metric-number" fontSize="31px" whiteSpace="nowrap">{totalDetections.toLocaleString()}</Text>
          </Panel>
          <Panel w="135px" p="15px" textAlign="center" cursor="pointer" _hover={{ borderColor: ui.violet }} onClick={() => setShowMitre(true)}>
            <Text fontSize="8px">MITRE Coverage · Demo</Text>
            <Text className="metric-number" fontSize="31px" whiteSpace="nowrap">78%</Text>
          </Panel>
          {noisyCount > 0 && (
            <Panel w="200px" p="15px" bg="#fff8f0" borderColor={ui.amber} cursor="pointer" _hover={{ bg: "#fff3e0" }} onClick={() => setShowTuning(true)}>
              <Text fontSize="8px" color={ui.amber} fontWeight="600">⚠ Tuning Recommendations</Text>
              <Text fontSize="11px" mt="4px">{noisyCount} example recommendations · Demo analysis</Text>
            </Panel>
          )}
        </HStack>

        {showMitre ? (
          <Box px="15px"><MitreMatrix onClose={() => setShowMitre(false)} /></Box>
        ) : showTuning ? (
          <Box px="15px">
            <Flex justify="space-between" align="center" mb="14px">
              <Box>
                <Heading fontSize="14px">Detection Tuning Recommendations</Heading>
                <Text fontSize="9px" color={ui.muted} mt="2px">{noisyCount} rules flagged for false-positive tuning</Text>
              </Box>
              <Button variant="outline" onClick={() => setShowTuning(false)} leftIcon={Icon.arrowLeft({ size: 13 })}>Back to rules</Button>
            </Flex>
            <Stack spacing="10px">
              {tuningRecommendations.map((rec) => (
                <Panel key={rec.ruleId} p="16px">
                  <Flex justify="space-between" align="start">
                    <Box flex="1">
                      <Flex align="center" gap="8px">
                        <Text fontWeight="600" fontSize="12px">{rec.ruleName}</Text>
                        <Badge bg={ui.red} color="white">{rec.fpr}% FPR</Badge>
                      </Flex>
                      <Text fontSize="9px" color={ui.muted} mt="2px">~{rec.analystHours} analyst-hours wasted per week</Text>
                    </Box>
                  </Flex>
                  <Box mt="12px" p="10px" bg="#fef3f2" borderLeft="3px solid" borderLeftColor={ui.red} borderRadius="3px">
                    <Text fontSize="8px" fontWeight="600" color={ui.red}>Problem</Text>
                    <Text fontSize="9px" mt="4px">{rec.issue}</Text>
                  </Box>
                  <Box mt="8px" p="10px" bg="#f0fdf4" borderLeft="3px solid" borderLeftColor={ui.green} borderRadius="3px">
                    <Text fontSize="8px" fontWeight="600" color={ui.green}>Recommended Change</Text>
                    <Text fontSize="9px" mt="4px" fontFamily="mono">{rec.recommendation}</Text>
                    <Text fontSize="8px" mt="4px" color={ui.green} fontWeight="600">{rec.impact}</Text>
                  </Box>
                  <Flex mt="10px" gap="8px" justify="end">
                    <Button size="xs" isDisabled>
                      Demo only · Engine not connected
                    </Button>
                  </Flex>
                </Panel>
              ))}
            </Stack>
          </Box>
        ) : (
          <>
            <Flex px="15px" py="8px" align="center">
              <InputGroup w="170px">
                <InputLeftElement>{Icon.search({ size: 13, color: ui.muted })}</InputLeftElement>
                <Input bg="white" placeholder="Search detection rules" value={query} onChange={(e) => setQuery(e.target.value)} />
              </InputGroup>
              <Select ml="8px" w="140px" aria-label="Filter by severity" bg="white" value={severityFilter} onChange={e => setSeverityFilter(e.target.value)}><option value="">All severities</option>{["LOW", "MEDIUM", "HIGH", "CRITICAL"].map(value => <option key={value}>{value}</option>)}</Select>
              <HStack ml="auto" spacing="6px">
                <Button variant="outline" onClick={() => setShowMitre(true)}>MITRE Coverage</Button>
                <Button variant="outline" onClick={() => setShowTuning(true)}>Tuning ({noisyCount})</Button>
                <Button onClick={() => setCreating(true)}>Create new Detection Rule</Button>
              </HStack>
            </Flex>
            <Box bg="white">
              <HStack h="32px" px="18px" borderY="1px solid" borderColor={ui.line} spacing="0">
                {[["rules", "Detection Rules"], ["catalog", "Catalog"]].map(([key, label]) => (
                  <Button key={key} variant="unstyled" h="32px" px="12px" borderRadius="0" borderBottom="2px solid" borderColor={activeTab === key ? ui.ink : "transparent"} fontWeight={activeTab === key ? "700" : "400"} fontSize="9px" onClick={() => setActiveTab(key)}>{label}</Button>
                ))}
              </HStack>

              {activeTab === "rules" ? (
                <>
                  <TableContainer className="thin-scroll">
                    <Table size="sm">
                      <Thead>
                        <Tr>
                          {["Name", "MITRE", "Execution", "Status", "Detections", "Investigations", "FPR", "AI recommendations", "Severity", "Activity"].map((h) => (
                            <Th key={h} fontSize="7px" color={ui.muted} py="10px" borderColor={ui.line}><HStack spacing="4px" display="inline-flex"><Text>{h}</Text>{Icon.sort({ size: 8, color: ui.quiet })}</HStack></Th>
                          ))}
                        </Tr>
                      </Thead>
                      <Tbody>
                        {filtered.map((rule, i) => (
                          <Tr key={rule.id} bg={i % 2 ? "white" : "#fafafb"} _hover={{ bg: "#f2f3f7" }}>
                            <Td py="14px" fontSize="8px" borderColor={ui.line} maxW="220px">
                              <Text color={ui.ink} cursor="pointer" fontWeight="500" _hover={{ color: ui.violet }} onClick={() => setView("detectionRuleDetail", rule.id)}>{rule.cells[0]}</Text>
                            </Td>
                            <Td py="14px" fontSize="8px" borderColor={ui.line} color={ui.violet} cursor="pointer">
                              <Text textDecoration="underline" textDecorationColor={ui.violet+"44"}>{rule.cells[1]}</Text>
                            </Td>
                            <Td py="14px" fontSize="8px" borderColor={ui.line}>
                              <Text>{rule.cells[2].split(" · ")[0]}</Text>
                              <HStack spacing="3px" display="inline-flex"><Box>{Icon.layers({ size: 9, color: ui.quiet })}</Box><Text fontSize="7px" color={ui.muted}>{rule.cells[2].split(" · ")[1]}</Text></HStack>
                            </Td>
                            <Td py="14px" fontSize="8px" borderColor={ui.line}>
                              <Text color={rule.cells[3] === "Enabled" ? ui.green : ui.muted} fontWeight="500" cursor="pointer" onClick={() => toggleRule(rule)}>
                                {toggling === rule.id ? "…" : rule.cells[3]}
                              </Text>
                            </Td>
                            <Td py="14px" fontSize="8px" borderColor={ui.line} fontWeight="600" isNumeric>{rule.cells[4]}</Td>
                            <Td py="14px" fontSize="8px" borderColor={ui.line} isNumeric>
                              <Text fontWeight="600">{rule.cells[5]}</Text>
                              <Text fontSize="6px" color={ui.muted}>↗</Text>
                            </Td>
                            <Td py="14px" fontSize="8px" borderColor={ui.line}>
                              <Text fontWeight="600">{rule.cells[6]}</Text>
                              <Text fontSize="6px" color={ui.quiet}>{parseInt(rule.cells[6]) > 50 ? "Medium confidence" : "High confidence"}</Text>
                            </Td>
                            <Td py="14px" fontSize="8px" borderColor={ui.line}>
                              {rule.cells[7].includes("recommendation") ? (
                                <><Text color={ui.violet} cursor="pointer" textDecoration="underline">{rule.cells[7]}</Text><Text fontSize="6px" color={ui.quiet}>Analysis complete</Text></>
                              ) : rule.cells[7] === "Validated" ? (
                                <><Flex align="center" gap="4px"><Box w="7px" h="7px" rounded="full" border="2px solid" borderColor={ui.green} /><Text>Validated</Text></Flex><Text fontSize="6px" color={ui.quiet}>No tuning changes needed</Text></>
                              ) : (
                                <><Text color={ui.muted}>{rule.cells[7]}</Text><Text fontSize="6px" color={ui.violet} cursor="pointer">Queue for analysis</Text></>
                              )}
                            </Td>
                            <Td py="14px" fontSize="8px" borderColor={ui.line}>
                              <Badge bg={rule.cells[8] === "HIGH" || rule.cells[8] === "CRITICAL" ? ui.red : rule.cells[8] === "MEDIUM" ? ui.amber : ui.green} color="white">{rule.cells[8]}</Badge>
                            </Td>
                            <Td py="14px" fontSize="8px" borderColor={ui.line} color={ui.muted}>{rule.cells[9]}<Button display="block" variant="ghost" size="xs" aria-label={`Route ${rule.cells[0]}`} onClick={() => setRoutingRule(rule)}>Route</Button></Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>
                  </TableContainer>
                  <Flex px="18px" py="10px" bg={ui.ink} borderTop="1px solid" borderColor={ui.line} align="center" justify="space-between">
                    <Text fontSize="8px" color="#ccc">Showing {filtered.length ? 1 : 0} – {filtered.length} of {totalRules} Detection Rules</Text>
                    <HStack spacing="4px">
                      <Button variant="ghost" size="xs" color="#ccc" isDisabled>‹</Button>
                      <Button size="xs" w="24px" h="24px" p="0" bg={ui.violet} color="white">1</Button>
                      <Button variant="ghost" size="xs" color="#ccc" isDisabled>›</Button>
                    </HStack>
                  </Flex>
                </>
              ) : (
                <Box p="15px">
                  <Flex mb="12px" justify="space-between" align="center">
                    <Box>
                      <Text fontWeight="600">Detection Rule Catalog</Text>
                      <Text fontSize="9px" color={ui.muted}>{catalogRules.length} rules available to deploy · Maintained by AISOC and community contributors</Text>
                    </Box>
                    <InputGroup w="200px">
                      <InputLeftElement>{Icon.search({ size: 13, color: ui.muted })}</InputLeftElement>
                      <Input bg="white" placeholder="Search catalog..." value={catalogQuery} onChange={e => setCatalogQuery(e.target.value)} />
                    </InputGroup>
                  </Flex>
                  <Stack spacing="0">
                    {catalogRules.filter(cr => `${cr.name} ${cr.description}`.toLowerCase().includes(catalogQuery.toLowerCase())).map((cr) => (
                      <Flex key={cr.id} p="12px" borderBottom="1px solid" borderColor={ui.line} _hover={{ bg: ui.soft }} align="center">
                        <Box flex="1">
                          <Flex align="center" gap="8px">
                            <Text fontSize="11px" fontWeight="500">{cr.name}</Text>
                            <Badge bg={cr.severity === "critical" ? ui.red : cr.severity === "high" ? ui.red : cr.severity === "medium" ? ui.amber : ui.green} color="white" fontSize="7px">{cr.severity.toUpperCase()}</Badge>
                            <Badge variant="outline" fontSize="7px">{cr.source}</Badge>
                          </Flex>
                          <Text fontSize="9px" color={ui.muted} mt="3px">{cr.description}</Text>
                          <HStack mt="4px" spacing="4px">
                            {cr.techniques.map((t) => <Badge key={t} variant="outline" color={ui.violet} borderColor={ui.violet} fontSize="7px">{t}</Badge>)}
                            {cr.tactics.map((t) => <Text key={t} fontSize="7px" color={ui.quiet}>· {t}</Text>)}
                          </HStack>
                        </Box>
                        <Button size="xs" variant="outline" isLoading={deploying === cr.id} isDisabled={!!deploying || remoteRules?.some(rule => rule.name === cr.name)} onClick={() => deployRule(cr)}>
                          {remoteRules?.some(rule => rule.name === cr.name) ? "Added" : "Add template"}
                        </Button>
                      </Flex>
                    ))}
                  </Stack>
                </Box>
              )}
            </Box>
          </>
        )}

        {creating && <CreateDetectionRule onClose={() => setCreating(false)} onCreated={rule => setRemoteRules(current => [rule, ...(current || [])])} />}
        {routingRule && (
          <Box position="fixed" top="0" left="0" right="0" bottom="0" bg="blackAlpha.500" zIndex="1000" onClick={() => setRoutingRule(null)}>
            <Box position="absolute" right="0" top="0" bottom="0" w="min(420px, 100vw)" bg="white" p="20px" overflowY="auto" onClick={(e) => e.stopPropagation()}>
              <Heading fontSize="14px" mb="12px">Detection Routing</Heading>
              <Button variant="ghost" onClick={() => setRoutingRule(null)}>Close</Button>
              <Text fontSize="9px" color={ui.muted}>Configure how detections from this rule are routed.</Text>
              <Stack mt="16px" spacing="10px">
                {["Investigate", "Sample (10%)", "Suppress", "Escalate"].map((action) => (
                  <Panel as="button" type="button" key={action} p="10px" cursor="pointer" onClick={() => saveRouting(action)} _hover={{ borderColor: ui.violet }}>
                    <Flex align="center" justify="space-between">
                      <Text fontSize="11px" fontWeight="500">{action}</Text>
                      <Box w="14px" h="14px" rounded="full" border="2px solid" borderColor={action === remoteRules?.find(item => item.id === routingRule.id)?.routing ? ui.violet : ui.line} bg={action === remoteRules?.find(item => item.id === routingRule.id)?.routing ? ui.violet : "transparent"} />
                    </Flex>
                  </Panel>
                ))}
              </Stack>
            </Box>
          </Box>
        )}
      </Box>
    </Flex>
  );
}

const fallbackRuleDetails = {
  "fixture-0": { id: "RULE-001", name: "AISOC - CRXfiltrate Browser Domain and Path Match", description: "Detects outbound HTTP requests to known CRXfiltrate command-and-control domains with URI paths matching the exfiltration pattern used by malicious Chrome extensions. This rule correlates DNS resolution, TLS SNI, and HTTP path segments to identify active data theft from compromised browser extensions.", mitre_techniques: ["T1567.002", "T1185"], execution_mode: "Scheduled", source: "AISOC SIEM", enabled: true, severity: "high", detections: 837, investigations: 193, false_positive_rate: 26, recommendation_status: "Validated", confidence: "High", last_activity_at: "2026-10-27T09:15:00Z", query: 'event.category:"network" AND destination.domain:("crxfiltrate.com" OR "ext-relay.crxfiltrate.com") AND url.path:/^\\/upload\\/[a-f0-9]{32}/', schedule: "Every 5 minutes", lookback_window: "15 minutes", created_by: "AISOC Detection Engineering", created_at: "2026-03-12T10:00:00Z", updated_at: "2026-10-25T14:30:00Z", tags: ["browser-extension", "exfiltration", "C2"] },
  "fixture-1": { id: "RULE-002", name: "AISOC - Impossible Travel", description: "Identifies user authentication events from geographically distant locations within a timeframe that makes physical travel impossible. Compares successive sign-in coordinates, factors in VPN usage, and checks device compliance to reduce false positives from legitimate remote access.", mitre_techniques: ["T1078", "T1078.004", "T1550.001", "T1538", "T1087"], execution_mode: "Scheduled", source: "AISOC SIEM", enabled: true, severity: "medium", detections: 200, investigations: 170, false_positive_rate: 45, recommendation_status: "Not analyzed", confidence: "Medium", last_activity_at: "2026-10-24T16:42:00Z", query: 'event.category:"authentication" AND event.outcome:"success" | geoip(source.ip) | consecutive_logins_distance > 500km AND time_delta < 2h', schedule: "Every 15 minutes", lookback_window: "2 hours", created_by: "AISOC Detection Engineering", created_at: "2026-01-08T09:00:00Z", updated_at: "2026-10-20T11:15:00Z", tags: ["identity", "travel", "account-compromise"] },
  "fixture-2": { id: "RULE-003", name: "AISOC - Suspicious PowerShell EncodedCommand", description: "Detects PowerShell processes launched with -EncodedCommand or -enc parameters that decode to suspicious patterns including download cradles, reflection loading, AMSI bypasses, and credential access commands. Applies entropy analysis to the decoded payload.", mitre_techniques: ["T1059.001"], execution_mode: "Scheduled", source: "AISOC SIEM", enabled: true, severity: "high", detections: 190, investigations: 153, false_positive_rate: 10, recommendation_status: "Validated", confidence: "High", last_activity_at: "2026-10-20T08:30:00Z", query: 'process.name:"powershell.exe" AND process.command_line:(/\\-[eE][nN][cC]/ OR "-EncodedCommand") | base64_decode(encoded_payload) | match_patterns(["IEX","Invoke-Expression","Net.WebClient","Reflection.Assembly"])', schedule: "Every 5 minutes", lookback_window: "10 minutes", created_by: "AISOC Detection Engineering", created_at: "2026-02-15T14:00:00Z", updated_at: "2026-10-18T09:45:00Z", tags: ["powershell", "execution", "obfuscation"] },
  "fixture-3": { id: "RULE-004", name: "File Integrity Violations", description: "Monitors critical system files and registry keys for unauthorized modifications. Compares file hashes against known-good baselines and alerts on changes outside of approved maintenance windows.", mitre_techniques: ["T1565.001", "T1112"], execution_mode: "Scheduled", source: "Microsoft Defender", enabled: true, severity: "low", detections: 152, investigations: 129, false_positive_rate: 62, recommendation_status: "2 recommendations", confidence: "Medium", last_activity_at: "2026-10-21T07:00:00Z", query: 'event.category:"file" AND event.action:"modification" AND file.path:("C:\\\\Windows\\\\System32\\\\*" OR "C:\\\\Windows\\\\SysWOW64\\\\*") AND NOT process.name:("TrustedInstaller.exe" OR "msiexec.exe")', schedule: "Every 30 minutes", lookback_window: "1 hour", created_by: "SOC Team", created_at: "2026-04-01T10:00:00Z", updated_at: "2026-10-22T16:00:00Z", tags: ["integrity", "system-files", "persistence"] },
};

function DetectionRuleDetail({ id, setView }) {
  const [savedRule, setSavedRule] = useState(null);
  const [history, setHistory] = useState([]);
  const toast = useToast();
  const [rule, setRule] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  useEffect(() => {
    let active = true;
    if (id && !id.startsWith("fixture-")) {
      api.get("detection-rules", id)
        .then((result) => { if (active) { setRule(result); setSavedRule(result); } })
        .catch(() => active && setLoadFailed(true));
    } else {
      setRule(fallbackRuleDetails[id] || fallbackRuleDetails["fixture-0"]);
    }
    return () => { active = false; };
  }, [id]);
  useEffect(() => {
    let active = true;
    if (activeTab === "history" && id && !id.startsWith("fixture-")) {
      api.request(`/detection-rules/${encodeURIComponent(id)}/history`).then(result => { if (active) setHistory(result.items); }).catch(e => { if (active) toast({ title: "Could not load history", description: e.message, status: "error" }); });
    }
    return () => { active = false; };
  }, [activeTab, id, toast]);
  const toggleEnabled = async () => {
    if (!rule) return;
    if (id && !id.startsWith("fixture-")) {
      try {
        const updated = await api.toggleDetectionRule(id);
        setRule((c) => ({ ...c, ...updated }));
        setSavedRule(updated);
      } catch (e) { toast({ title: "Could not toggle rule", description: e.message, status: "error", duration: 3000 }); }
    } else {
      setRule((c) => ({ ...c, enabled: !c.enabled }));
    }
  };
  const saveRule = async () => {
    setSaving(true);
    try {
      if (id && !id.startsWith("fixture-")) {
        const fields = ["name", "description", "severity", "mitre_techniques", "execution_mode", "enabled", "query", "schedule", "lookback_window", "routing"];
        const updated = await api.update("detection-rules", id, Object.fromEntries(fields.filter(key => rule[key] !== undefined).map(key => [key, rule[key]])));
        setRule((c) => ({ ...c, ...updated }));
        setSavedRule(updated);
      }
      toast({ title: "Rule saved", status: "success", duration: 2000 });
      setEditing(false);
    } catch (e) { toast({ title: "Could not save", description: e.message, status: "error", duration: 3000 }); }
    finally { setSaving(false); }
  };
  if (!rule) return <Box p="40px" textAlign="center"><Text color={ui.muted}>{loadFailed ? "Could not load this rule. Check the API and return to the registry." : "Loading rule..."}</Text><Button variant="ghost" onClick={() => setView("detect")}>Back to rules</Button></Box>;
  const sevColor = rule.severity === "high" || rule.severity === "critical" ? ui.red : rule.severity === "medium" ? ui.amber : ui.green;
  return (
    <Box className="page-enter">
      {loadFailed && <Box px="15px" pt="8px"><SampleDataNotice show /></Box>}
      <Flex px="15px" py="10px" bg="#f5f6f9" align="center" justify="space-between">
        <HStack>
          <Button variant="ghost" onClick={() => setView("detect")} leftIcon={Icon.arrowLeft({ size: 13 })}>Back to rules</Button>
          <Text fontWeight="600" fontSize="13px">{rule.name}</Text>
          <Badge bg={sevColor} color="white">{String(rule.severity).toUpperCase()}</Badge>
          <Badge bg={rule.enabled ? ui.green : ui.muted} color="white">{rule.enabled ? "Enabled" : "Disabled"}</Badge>
        </HStack>
        <HStack>
          <Button variant="outline" isDisabled={editing} onClick={toggleEnabled}>{rule.enabled ? "Disable" : "Enable"}</Button>
          {editing ? (
            <>
              <Button variant="outline" onClick={() => { setRule(savedRule || rule); setEditing(false); }}>Cancel</Button>
              <Button isLoading={saving} onClick={saveRule}>Save changes</Button>
            </>
          ) : (
            <Button onClick={() => setEditing(true)}>Edit rule</Button>
          )}
        </HStack>
      </Flex>
      <Flex px="15px" h="28px" bg="white" borderY="1px solid" borderColor={ui.line}>
        {["overview", "query", "history", "recommendations"].map((t) => (
          <Button key={t} variant="unstyled" h="28px" px="8px" borderRadius="0" borderBottom="2px solid" borderColor={activeTab === t ? ui.ink : "transparent"} fontSize="8px" textTransform="capitalize" onClick={() => setActiveTab(t)}>{t}</Button>
        ))}
      </Flex>
      {activeTab === "overview" ? (
        <Grid templateColumns={{ base: "1fr", lg: "1fr 320px" }} gap="12px" p="15px">
          <Stack spacing="12px">
            <Panel p="16px">
              <Label>Rule Configuration</Label>
              <Grid templateColumns="1fr 1fr" gap="12px" mt="12px">
                <FormControl>
                  <FormLabel fontSize="8px" color={ui.muted}>Rule name</FormLabel>
                  {editing ? <Input value={rule.name} onChange={(e) => setRule((c) => ({ ...c, name: e.target.value }))} /> : <Text fontSize="11px" fontWeight="500">{rule.name}</Text>}
                </FormControl>
                <FormControl>
                  <FormLabel fontSize="8px" color={ui.muted}>Severity</FormLabel>
                  {editing ? (
                    <Select value={rule.severity} onChange={(e) => setRule((c) => ({ ...c, severity: e.target.value }))}>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </Select>
                  ) : <Badge bg={sevColor} color="white">{String(rule.severity).toUpperCase()}</Badge>}
                </FormControl>
                <FormControl>
                  <FormLabel fontSize="8px" color={ui.muted}>Execution mode</FormLabel>
                  {editing ? (
                    <Select value={rule.execution_mode} onChange={(e) => setRule((c) => ({ ...c, execution_mode: e.target.value }))}>
                      <option value="scheduled">Scheduled</option>
                      <option value="realtime">Realtime</option>
                    </Select>
                  ) : <Text fontSize="11px">{rule.execution_mode}</Text>}
                </FormControl>
                <FormControl>
                  <FormLabel fontSize="8px" color={ui.muted}>Data source</FormLabel>
                  <HStack spacing="4px" display="inline-flex"><Box>{Icon.layers({ size: 11, color: ui.quiet })}</Box><Text fontSize="11px">{rule.source}</Text></HStack>
                </FormControl>
                <FormControl>
                  <FormLabel fontSize="8px" color={ui.muted}>Schedule</FormLabel>
                  {editing ? <Input aria-label="Schedule" value={rule.schedule || ""} onChange={e => setRule({ ...rule, schedule: e.target.value })} /> : <Text fontSize="11px">{rule.schedule || "Every 5 minutes"}</Text>}
                </FormControl>
                <FormControl>
                  <FormLabel fontSize="8px" color={ui.muted}>Lookback window</FormLabel>
                  {editing ? <Input aria-label="Lookback window" value={rule.lookback_window || ""} onChange={e => setRule({ ...rule, lookback_window: e.target.value })} /> : <Text fontSize="11px">{rule.lookback_window || "15 minutes"}</Text>}
                </FormControl>
                <FormControl><FormLabel>Routing</FormLabel>{editing ? <Select aria-label="Routing" value={rule.routing || "Investigate"} onChange={e => setRule({ ...rule, routing: e.target.value })}>{["Investigate", "Sample (10%)", "Suppress", "Escalate"].map(value => <option key={value}>{value}</option>)}</Select> : <Text>{rule.routing || "Investigate"}</Text>}</FormControl>
              </Grid>
            </Panel>
            <Panel p="16px">
              <Label>Description</Label>
              {editing ? (
                <Textarea mt="8px" fontSize="11px" rows={4} value={rule.description} onChange={(e) => setRule((c) => ({ ...c, description: e.target.value }))} />
              ) : (
                <Text mt="8px" fontSize="11px" lineHeight="1.6">{rule.description}</Text>
              )}
            </Panel>
            <Panel p="16px">
              <Label>MITRE ATT&CK Techniques</Label>
              <Flex mt="10px" gap="6px" flexWrap="wrap">
                {(rule.mitre_techniques || []).map((t) => (
                  <Badge key={t} variant="outline" color={ui.violet} borderColor={ui.violet} fontSize="10px" px="8px" py="3px">{t}</Badge>
                ))}
              </Flex>
            </Panel>
            <Panel p="16px">
              <Label>Tags</Label>
              <Flex mt="10px" gap="6px" flexWrap="wrap">
                {(rule.tags || []).map((t) => (
                  <Badge key={t} bg={ui.soft} color={ui.ink} fontSize="10px" px="8px" py="3px">{t}</Badge>
                ))}
              </Flex>
            </Panel>
          </Stack>
          <Stack spacing="12px">
            <Panel p="16px">
              <Label>Performance</Label>
              <SimpleGrid columns={2} gap="12px" mt="12px">
                <Box><Text fontSize="8px" color={ui.muted}>Detections</Text><Text className="metric-number" fontSize="22px">{rule.detections?.toLocaleString()}</Text></Box>
                <Box><Text fontSize="8px" color={ui.muted}>Investigations</Text><Text className="metric-number" fontSize="22px">{rule.investigations?.toLocaleString()}</Text></Box>
                <Box><Text fontSize="8px" color={ui.muted}>False positive rate</Text><Text className="metric-number" fontSize="22px">{rule.false_positive_rate}%</Text><Text fontSize="7px" color={ui.quiet}>{rule.confidence} confidence</Text></Box>
                <Box><Text fontSize="8px" color={ui.muted}>Status</Text><Badge mt="4px" bg={rule.enabled ? ui.green : ui.muted} color="white">{rule.enabled ? "Enabled" : "Disabled"}</Badge></Box>
              </SimpleGrid>
            </Panel>
            <Panel p="16px">
              <Label>AI Recommendations</Label>
              <Flex mt="10px" align="center">
                <Box w="10px" h="10px" rounded="full" border="2px solid" borderColor={rule.recommendation_status === "Validated" ? ui.green : ui.amber} mr="8px" />
                <Text fontSize="11px">{rule.recommendation_status}</Text>
              </Flex>
              {rule.recommendation_status?.includes("recommendation") && (
                <Text mt="8px" fontSize="9px" color={ui.violet} cursor="pointer">View recommendations →</Text>
              )}
              {rule.recommendation_status === "Validated" && (
                <Text mt="8px" fontSize="9px" color={ui.green}>No tuning changes needed</Text>
              )}
              {rule.recommendation_status === "Not analyzed" && (
                <Text mt="8px" fontSize="9px" color={ui.amber}>Queue for analysis</Text>
              )}
            </Panel>
            <Panel p="16px">
              <Label>Metadata</Label>
              <Stack mt="10px" spacing="6px" fontSize="10px">
                <Flex justify="space-between"><Text color={ui.muted}>Created by</Text><Text>{rule.created_by}</Text></Flex>
                <Flex justify="space-between"><Text color={ui.muted}>Created</Text><Text>{rule.created_at ? new Date(rule.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}</Text></Flex>
                <Flex justify="space-between"><Text color={ui.muted}>Last updated</Text><Text>{rule.updated_at ? new Date(rule.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}</Text></Flex>
                <Flex justify="space-between"><Text color={ui.muted}>Last alert</Text><Text>{rule.last_activity_at ? new Date(rule.last_activity_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "No activity"}</Text></Flex>
              </Stack>
            </Panel>
          </Stack>
        </Grid>
      ) : activeTab === "query" ? (
        <Box p="15px" maxW="820px">
          <Panel p="16px">
            <Flex justify="space-between" align="center">
              <Label>Detection Query</Label>
              <Badge bg={ui.ink} color="white">{rule.source}</Badge>
            </Flex>
            <Box mt="12px" p="14px" bg="#0d1117" borderRadius="6px" fontFamily="mono" fontSize="11px" color="#e6edf3" lineHeight="1.7" whiteSpace="pre-wrap" overflowX="auto">
              {editing ? <Textarea aria-label="Detection query" rows={8} fontFamily="mono" value={rule.query || ""} onChange={e => setRule({ ...rule, query: e.target.value })} /> : rule.query || "No query defined"}
            </Box>
          </Panel>
          <Panel mt="12px" p="16px">
            <Label>Schedule Configuration</Label>
            <Grid templateColumns="1fr 1fr 1fr" gap="12px" mt="12px">
              <Box><Text fontSize="8px" color={ui.muted}>Execution</Text><Text fontSize="11px">{rule.execution_mode}</Text></Box>
              <Box><Text fontSize="8px" color={ui.muted}>Interval</Text><Text fontSize="11px">{rule.schedule || "Every 5 min"}</Text></Box>
              <Box><Text fontSize="8px" color={ui.muted}>Lookback</Text><Text fontSize="11px">{rule.lookback_window || "15 min"}</Text></Box>
            </Grid>
          </Panel>
        </Box>
      ) : activeTab === "history" ? (
        <Box p="15px" maxW="820px">
          <Panel p="16px">
            <Label>Detection Activity</Label>
            <Stack mt="12px" spacing="0">
              {!history.length && <Text color={ui.muted}>No recorded changes yet.</Text>}
              {history.map(event => ({ date: new Date(event.created_at).toLocaleString(), event: event.action, detail: event.details.fields?.join(", ") || "Registry change recorded", severity: "info" })).map((entry, i) => (
                <Flex key={i} py="10px" borderBottom="1px solid" borderColor={ui.line} align="start">
                  <Box w="8px" h="8px" mt="4px" rounded="full" bg={entry.severity === "high" ? ui.red : entry.severity === "medium" ? ui.amber : entry.severity === "success" ? ui.green : ui.steel} mr="12px" flexShrink={0} />
                  <Box flex="1">
                    <Flex justify="space-between"><Text fontSize="11px" fontWeight="600">{entry.event}</Text><Text fontSize="9px" color={ui.muted}>{entry.date}</Text></Flex>
                    <Text fontSize="10px" color={ui.muted} mt="2px">{entry.detail}</Text>
                  </Box>
                </Flex>
              ))}
            </Stack>
          </Panel>
        </Box>
      ) : (
        <Box p="15px" maxW="820px">
          <Panel p="16px">
            <Flex justify="space-between" align="center">
              <Label>AI Recommendations</Label>
              <Badge bg={rule.recommendation_status === "Validated" ? ui.green : ui.amber} color="white">{rule.recommendation_status}</Badge>
            </Flex>
            {rule.recommendation_status === "Validated" ? (
              <Box mt="12px" p="12px" bg="#f0fdf4" borderRadius="6px" border="1px solid" borderColor="#bbf7d0">
                <Text fontSize="11px" fontWeight="600" color={ui.green}>No tuning changes needed</Text>
                <Text fontSize="10px" mt="4px" color={ui.muted}>The detection logic has been validated against 30 days of alert data. The false-positive rate of {rule.false_positive_rate}% is within acceptable thresholds for {rule.severity}-severity rules.</Text>
              </Box>
            ) : rule.recommendation_status?.includes("recommendation") ? (
              <Stack mt="12px" spacing="10px">
                <Box p="12px" bg="#fffbeb" borderRadius="6px" border="1px solid" borderColor="#fde68a">
                  <Text fontSize="11px" fontWeight="600" color={ui.amber}>Recommendation 1: Reduce false-positive rate</Text>
                  <Text fontSize="10px" mt="4px" color={ui.muted}>Add an exclusion for service accounts matching pattern svc-* to reduce the {rule.false_positive_rate}% FPR by an estimated 15-20 points.</Text>
                  <Button mt="8px" size="xs" variant="outline">Apply recommendation</Button>
                </Box>
                <Box p="12px" bg="#fffbeb" borderRadius="6px" border="1px solid" borderColor="#fde68a">
                  <Text fontSize="11px" fontWeight="600" color={ui.amber}>Recommendation 2: Improve MITRE coverage</Text>
                  <Text fontSize="10px" mt="4px" color={ui.muted}>Add correlation with T1003 (OS Credential Dumping) to catch lateral-movement chains that follow initial {rule.mitre_techniques?.[0]} activity.</Text>
                  <Button mt="8px" size="xs" variant="outline">Apply recommendation</Button>
                </Box>
              </Stack>
            ) : (
              <Box mt="12px" p="12px" bg={ui.soft} borderRadius="6px">
                <Text fontSize="11px" color={ui.muted}>This rule has not been analyzed yet. Queue it for AI-driven tuning analysis to receive detection optimization recommendations.</Text>
                <Button mt="8px" size="xs">Queue for analysis</Button>
              </Box>
            )}
          </Panel>
        </Box>
      )}
    </Box>
  );
}

function HuntDashboard({ setView }) {
  const toast = useToast();
  const [huntQuery, setHuntQuery] = useState("");
  const [huntContext, setHuntContext] = useState("");
  const [hunts, setHunts] = useState([]);
  const [runningHunt, setRunningHunt] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [huntMode, setHuntMode] = useState("mode1");
  const [lifecycleFilter, setLifecycleFilter] = useState("all");
  const fallbackHunts = [
    { id: "HUNT-001", name: "TH for CVE-2026-42897 — Exchange Server XSS", query: "CVE-2026-42897", source: "threat_intel", status: "completed", verdict: "review_required", findings_count: 3, author: "Robert Kim", updated_at: "2026-05-18T14:22:00Z" },
    { id: "HUNT-002", name: "Lumma Stealer C2 beacon detection", query: "lumma stealer", source: "threat_intel", status: "completed", verdict: "review_required", findings_count: 5, author: "AISOC Engine", updated_at: "2026-05-17T09:15:00Z" },
    { id: "HUNT-003", name: "APT42 phishing infrastructure overlap", query: "APT42 phishing", source: "threat_intel", status: "completed", verdict: "no_findings", findings_count: 0, author: "Maria Santos", updated_at: "2026-05-16T11:40:00Z" },
    { id: "HUNT-004", name: "Black Basta lateral movement patterns", query: "Black Basta", source: "ad_hoc", status: "completed", verdict: "review_required", findings_count: 2, author: "James Chen", updated_at: "2026-05-15T16:30:00Z" },
    { id: "HUNT-005", name: "Cobalt Strike malleable C2 profiles", query: "cobalt strike C2", source: "ad_hoc", status: "completed", verdict: "no_findings", findings_count: 0, author: "Robert Kim", updated_at: "2026-05-14T08:55:00Z" },
    { id: "HUNT-006", name: "UNC1549 MINIBIKE/MINIBUS backdoor hunt", query: "UNC1549", source: "threat_intel", status: "completed", verdict: "review_required", findings_count: 1, author: "AISOC Engine", updated_at: "2026-05-13T13:20:00Z" },
  ];
  useEffect(() => {
    let active = true;
    api.hunts().then((result) => active && setHunts(result.items)).catch(() => active && setLoadFailed(true));
    return () => { active = false; };
  }, []);
  const displayHunts = hunts.length ? hunts : fallbackHunts;
  const runHunt = async () => {
    if (runningHunt) return;
    if (!huntQuery.trim()) { toast({ title: "Enter a hunt question", status: "warning", duration: 2000 }); return; }
    setRunningHunt(true);
    try {
      const created = await api.create("hunts", { name: huntQuery.trim().slice(0, 90), query: huntQuery.trim(), source: "ad_hoc", insight_refs: huntContext.split(",").map(value => value.trim()).filter(Boolean) });
      const completed = await api.runHunt(created.id);
      setHunts((current) => [completed, ...current]);
      setHuntQuery("");
      setHuntContext("");
      const applied = completed.applied_skills || [];
      toast({ title: "Hunt completed", description: `${completed.findings_count} findings require review.${applied.length ? ` ${applied.length} skill${applied.length === 1 ? "" : "s"} attached: ${applied.map(skill => `${skill.name} v${skill.version}`).join(", ")}.` : " No enabled skills matched this hunt."}`, status: "success", duration: 4500 });
    } catch (error) {
      toast({ title: "Hunt failed", description: error.message, status: "error", duration: 3000 });
    } finally { setRunningHunt(false); }
  };
  const verdictColor = (v) => v === "review_required" ? ui.amber : v === "no_findings" ? ui.green : ui.muted;
  const verdictLabel = (v) => v === "review_required" ? "Review Required" : v === "no_findings" ? "No Findings" : v || "Pending";
  const totalFindings = displayHunts.reduce((s, h) => s + (h.findings_count || 0), 0);
  const withFindings = displayHunts.filter((h) => h.findings_count > 0).length;
  return (
    <Box className="page-enter" px="15px">
      <SampleDataNotice show={loadFailed} />
      <Flex mb="12px" gap="8px" align="center">
        <Button variant="outline" leftIcon={Icon.calendar({ size: 12 })}>Last 7 days</Button>
        <Button variant="outline" leftIcon={Icon.calendar({ size: 12 })}>Last 30 days</Button>
        <Button variant="ghost" ml="auto" onClick={() => setView("threatIntel")}>View threat intel →</Button>
      </Flex>
      <Grid templateColumns={{ base: "1fr", lg: "minmax(0,2.4fr) 1fr" }} gap="8px">
        <Stack spacing="8px">
          <Panel>
            <Box p="10px" borderBottom="1px solid" borderColor={ui.line}>
              <Label>Hunt details</Label>
            </Box>
            <SimpleGrid columns={5} p="14px 26px">
              {[
                ["17", "Reports processed"],
                ["218", "IOC processed"],
                [String(27 + displayHunts.length), "Hunts"],
                [String(totalFindings || 3), "Findings"],
                [String(withFindings || 2), "Hunts with findings"],
              ].map(([v, l]) => (
                <Metric key={l} value={v} label={l} size="30px" />
              ))}
            </SimpleGrid>
          </Panel>
          <Panel p="10px">
            <Flex justify="space-between">
              <Label>Hunt lifecycle</Label>
              <HStack>
                {["all", "emerging", "ad_hoc"].map((f) => (
                  <Badge key={f} bg={lifecycleFilter === f ? ui.violet : undefined} color={lifecycleFilter === f ? "white" : undefined} cursor="pointer" onClick={() => setLifecycleFilter(f)}>
                    {f === "all" ? "All" : f === "emerging" ? "Emerging" : "Ad hoc"}
                  </Badge>
                ))}
              </HStack>
            </Flex>
            <HuntSankey />
          </Panel>
          <Panel>
            <Box p="10px" borderBottom="1px solid" borderColor={ui.line}>
              <Flex justify="space-between" align="center">
                <Label>Ad hoc hunts</Label>
                <Text fontSize="9px" color={ui.muted}>{displayHunts.length} hunt{displayHunts.length !== 1 ? "s" : ""}</Text>
              </Flex>
            </Box>
            <Box overflowX="auto">
              <Box as="table" w="100%" fontSize="11px">
                <Box as="thead">
                  <Box as="tr" borderBottom="1px solid" borderColor={ui.line}>
                    {["Name", "Author", "Last Updated", "Findings", "Verdict", "Skills"].map((h) => (
                      <Box as="th" key={h} p="8px 12px" textAlign="left" fontSize="9px" color={ui.muted} fontWeight="600" textTransform="uppercase" letterSpacing=".04em">{h}</Box>
                    ))}
                  </Box>
                </Box>
                <Box as="tbody">
                  {displayHunts.slice(0, 8).map((h) => (
                    <Box as="tr" key={h.id} borderBottom="1px solid" borderColor={ui.line} _hover={{ bg: ui.soft }} cursor="pointer">
                      <Box as="td" p="8px 12px" color={ui.violet} maxW="340px" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">{h.name}</Box>
                      <Box as="td" p="8px 12px" color={ui.muted}>{h.author || h.source || "Analyst"}</Box>
                      <Box as="td" p="8px 12px" color={ui.muted}>{h.updated_at ? new Date(h.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}</Box>
                      <Box as="td" p="8px 12px" fontWeight="600">{h.findings_count ?? 0}</Box>
                      <Box as="td" p="8px 12px"><Badge bg={verdictColor(h.verdict)} color="white" fontSize="8px">{verdictLabel(h.verdict)}</Badge></Box>
                      <Box as="td" p="8px 12px"><Badge colorScheme="purple" fontSize="8px">{h.applied_skills?.length || 0}</Badge></Box>
                    </Box>
                  ))}
                </Box>
              </Box>
            </Box>
            {displayHunts.length > 8 && (
              <Flex p="8px 12px" justify="center">
                <Text fontSize="9px" color={ui.violet} cursor="pointer">View all {displayHunts.length} hunts</Text>
              </Flex>
            )}
          </Panel>
        </Stack>
        <Stack spacing="8px">
          <Panel p="10px">
            <Flex justify="space-between" align="center">
              <Label>Ad hoc hunt</Label>
              <HStack spacing="4px">
                <Badge bg={huntMode === "mode1" ? ui.violet : undefined} color={huntMode === "mode1" ? "white" : undefined} cursor="pointer" onClick={() => setHuntMode("mode1")}>Mode 1</Badge>
                <Badge bg={huntMode === "mode2" ? ui.violet : undefined} color={huntMode === "mode2" ? "white" : undefined} cursor="pointer" onClick={() => setHuntMode("mode2")}>Mode 2</Badge>
              </HStack>
            </Flex>
            <Text mt="6px" fontSize="8px" color={ui.muted}>
              {huntMode === "mode1" ? "Quick IOC and keyword search across all connected data sources" : "Deep behavioral analysis using AI-driven hypothesis generation"}
            </Text>
            <HStack mt="12px">
              <Input
                placeholder={huntMode === "mode1" ? "Search IOCs, CVEs, threat actors..." : "Describe suspicious behavior to investigate..."}
                value={huntQuery}
                onChange={(event) => setHuntQuery(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && runHunt()}
              />
              <Button isLoading={runningHunt} onClick={runHunt}>Run</Button>
            </HStack>
            <Input mt="8px" aria-label="Enterprise context references" placeholder="Enterprise context IDs (optional, comma separated)" value={huntContext} onChange={event => setHuntContext(event.target.value)} />
            <Text mt="12px" fontSize="7px" color={ui.muted}>MOST RECENT</Text>
            <Stack mt="5px" spacing="4px">
              {displayHunts.slice(0, 3).map((h) => (
                <Flex key={h.id} align="center" justify="space-between">
                  <Text fontSize="8px" maxW="200px" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">{h.name}</Text>
                  <Badge bg={verdictColor(h.verdict)} color="white" fontSize="7px">{h.findings_count || 0}</Badge>
                </Flex>
              ))}
            </Stack>
          </Panel>
          <Panel p="12px">
            <Flex justify="space-between">
              <Text fontWeight="600">Threat intel hunt quota</Text>
              <Text fontSize="7px">83 hunts remaining</Text>
            </Flex>
            <Text mt="8px"><b>17 /100</b> &nbsp; Monthly threat intelligence hunts</Text>
            <Box mt="7px" w="100%" h="4px" bg="#e7e8ed"><Box w="17%" h="full" bg={ui.violet} /></Box>
          </Panel>
          <Panel p="12px">
            <Label>AISOC activity</Label>
            <Text mt="15px" fontSize="8px"><b>17 threat reports</b> ingested and reviewed</Text>
            <Text mt="12px" color={ui.violet} fontSize="8px">2 emerging threats identified in your environment</Text>
            <Text mt="12px" fontSize="8px"><b>218 IOCs</b> checked across 4 connectors</Text>
            <Button mt="14px" float="right" variant="outline" onClick={() => setView("investigations")}>View investigations</Button>
          </Panel>
          <Panel p="12px">
            <Label>Threat intelligence feeds</Label>
            <HStack mt="14px">
              <Badge bg={ui.amber}>G</Badge>
              <Box>
                <Text fontSize="8px" fontWeight="600">Google Threat Intelligence</Text>
                <Text fontSize="7px" color={ui.muted}>8 reports · 8 hunts</Text>
              </Box>
            </HStack>
            <HStack mt="12px">
              <Badge bg="#111827" color="white">AISOC</Badge>
              <Box>
                <Text fontSize="8px" fontWeight="600">AISOC Threat Intelligence</Text>
                <Text fontSize="7px" color={ui.muted}>9 reports · 9 hunts</Text>
              </Box>
            </HStack>
            <HStack mt="12px">
              <Badge bg={ui.red}>M</Badge>
              <Box>
                <Text fontSize="8px" fontWeight="600">MITRE ATT&CK</Text>
                <Text fontSize="7px" color={ui.muted}>Technique mapping active</Text>
              </Box>
            </HStack>
          </Panel>
        </Stack>
      </Grid>
    </Box>
  );
}
function HuntSankey() {
  return (
    <Box h="285px" position="relative" mt="12px" overflow="hidden">
      <Flex justify="space-around" fontSize="7px">
        <Text>Trigger</Text>
        <Text>Filtering</Text>
        <Text>Hunt outcome</Text>
        <Text>Escalation</Text>
        <Text>Output</Text>
      </Flex>
      {[
        ["Threat intel ingest · 142", 12, 22],
        ["Analyst initiated · 74", 12, 160],
        ["Relevant reports · 142", 170, 22],
        ["Not applicable · 74", 170, 160],
        ["IOCs found · 13", 340, 22],
        ["No findings · 59", 340, 195],
        ["Escalated · 13", 505, 25],
        ["Not escalated · 203", 505, 100],
        ["10 Cases created", 675, 30],
        ["206 Rules created", 675, 110],
      ].map(([t, l, top], i) => (
        <HStack
          key={t}
          position="absolute"
          left={`${l / 8.2}%`}
          top={`${top}px`}
        >
          <Text fontSize="7px" whiteSpace="nowrap">
            {t}
          </Text>
          <Box
            w="11px"
            h={i === 4 ? "115px" : "42px"}
            bg={i === 6 ? ui.red : i > 6 ? ui.teal : "#080a0f"}
          />
        </HStack>
      ))}
      {[45, 105, 170].map((top, i) => (
        <Box
          key={top}
          position="absolute"
          left="13%"
          top={`${top}px`}
          w="70%"
          h={`${65 - i * 8}px`}
          bg={
            i === 0
              ? "linear-gradient(90deg,#8e929b,#efd4d7)"
              : "linear-gradient(90deg,#a3a6ad,#dce5e3)"
          }
          opacity=".75"
          transform={`skewY(${i - 1}deg)`}
        />
      ))}
    </Box>
  );
}

const fallbackRemediations = [
  {
    id: "REM-001",
    investigation_id: "INV-4814",
    title: "Revoke all active sessions",
    description:
      "Invalidate active browser and refresh tokens for the compromised identity.",
    connector: "Microsoft Defender",
    status: "pending",
    action_type: "revoke_sessions",
  },
  {
    id: "REM-002",
    investigation_id: "INV-4814",
    title: "Quarantine Setu.exe on OKAMI-FIN-074",
    description:
      "Isolate the endpoint and quarantine the confirmed malicious executable.",
    connector: "Microsoft Defender",
    status: "pending",
    action_type: "isolate_device",
  },
  {
    id: "REM-003",
    investigation_id: "INV-4819",
    title: "Reset identity credentials",
    description: "Force a password reset after session revocation completes.",
    connector: "Entra ID",
    status: "completed",
    action_type: "reset_credentials",
  },
  {
    id: "REM-004",
    investigation_id: "INV-4814",
    title: "Block releases.cloudgateway.cc",
    description: "Block the malicious C2 domain in DNS, proxy, and endpoint controls.",
    connector: "Microsoft Defender",
    status: "pending",
    action_type: "block_domain",
  },
  {
    id: "REM-005",
    investigation_id: "INV-4819",
    title: "Revoke OAuth app consent grant",
    description: "Remove suspicious OAuth application that was granted mailbox access.",
    connector: "Entra ID",
    status: "pending",
    action_type: "revoke_consent",
  },
];

function RespondCenter({ setView }) {
  const toast = useToast();
  const [items, setItems] = useState(fallbackRemediations);
  const [filter, setFilter] = useState("all");
  const [running, setRunning] = useState(null);
  const [confirmItem, setConfirmItem] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const cancelRef = useRef(null);

  useEffect(() => {
    let active = true;
    api
      .remediations()
      .then((result) => active && setItems(result.items))
      .catch(() => active && setLoadFailed(true));
    return () => {
      active = false;
    };
  }, []);

  const execute = async (item) => {
    setRunning(item.id);
    try {
      const updated = await api.executeRemediation(item.id);
      setItems((current) =>
        current.map((entry) => (entry.id === item.id ? updated : entry)),
      );
      toast({
        title: "Response action completed",
        description: item.title,
        status: "success",
        duration: 2500,
      });
    } catch (error) {
      toast({
        title: "Action could not be completed",
        description: error.message,
        status: "error",
        duration: 3000,
      });
    } finally {
      setRunning(null);
    }
  };

  const visible =
    filter === "all" ? items : items.filter((item) => item.status === filter);
  const pending = items.filter((item) => item.status === "pending").length;
  const completed = items.filter((item) => item.status === "completed").length;

  return (
    <Box className="page-enter" px={{ base: "12px", md: "24px" }} pb="28px">
      <SampleDataNotice show={loadFailed} />
      <Flex
        align={{ base: "start", md: "center" }}
        direction={{ base: "column", md: "row" }}
        gap="12px"
        mb="18px"
      >
        <Box>
          <Heading fontSize={{ base: "22px", md: "28px" }} fontWeight="500">
            Response Center
          </Heading>
          <Text color={ui.muted} mt="3px">
            Review, approve, and execute containment actions from active
            investigations.
          </Text>
        </Box>
        <HStack ml={{ base: 0, md: "auto" }}>
          <Button
            variant="outline"
            onClick={() => setView("investigationDetail", "INV-4814")}
          >
            View investigation
          </Button>
          <Button isDisabled={!pending} onClick={() => setConfirmItem({ id: "__bulk__", title: `all ${pending} pending actions`, connector: "multiple connectors" })} leftIcon={Icon.zap({ size: 13 })}>Execute {pending} Action{pending !== 1 ? "s" : ""}</Button>
        </HStack>
      </Flex>

      <SimpleGrid columns={{ base: 2, md: 4 }} spacing="10px" mb="16px">
        {[
          [pending, "Awaiting action", ui.red],
          [completed, "Completed", ui.green],
          ["4m 12s", "Median response", ui.ink],
          ["96%", "Automation rate", ui.violet],
        ].map(([value, label, color]) => (
          <Panel
            key={label}
            p={{ base: "14px", md: "18px" }}
            borderTop="3px solid"
            borderTopColor={color}
          >
            <Metric value={value} label={label} color={color} size="34px" />
          </Panel>
        ))}
      </SimpleGrid>

      <Grid
        templateColumns={{
          base: "1fr",
          xl: "minmax(0, 2.2fr) minmax(270px, .8fr)",
        }}
        gap="12px"
      >
        <Panel overflow="hidden">
          <Flex
            px="16px"
            py="13px"
            borderBottom="1px solid"
            borderColor={ui.line}
            align="center"
            gap="10px"
            wrap="wrap"
          >
            <Box>
              <Label>Remediation queue</Label>
              <Text color={ui.muted} mt="2px">
                Actions are ordered by incident risk and containment dependency.
              </Text>
            </Box>
            <HStack ml={{ base: 0, md: "auto" }}>
              {["all", "pending", "completed"].map((value) => (
                <Button
                  key={value}
                  variant={filter === value ? "solid" : "ghost"}
                  onClick={() => setFilter(value)}
                  textTransform="capitalize"
                >
                  {value}
                </Button>
              ))}
            </HStack>
          </Flex>
          <Stack spacing="0" divider={<Divider />}>
            {visible.map((item) => (
              <Grid
                className="response-row"
                key={item.id}
                templateColumns={{
                  base: "1fr",
                  md: "34px minmax(180px, 1fr) minmax(220px, 1.4fr) 130px 92px",
                }}
                gap="12px"
                alignItems="center"
                p="15px 16px"
              >
                <Flex
                  w="30px"
                  h="30px"
                  rounded="full"
                  bg={item.status === "completed" ? "#e7f5ed" : "#fff0f1"}
                  color={item.status === "completed" ? ui.green : ui.red}
                  align="center"
                  justify="center"
                  fontWeight="700"
                >
                  {item.status === "completed" ? "OK" : "!"}
                </Flex>
                <Box>
                  <Text fontWeight="700">{item.title}</Text>
                  <Text color={ui.violet} mt="3px">
                    {item.investigation_id}
                  </Text>
                </Box>
                <Text color={ui.muted}>{item.description}</Text>
                <Badge
                  justifySelf={{ base: "start", md: "auto" }}
                  variant="outline"
                >
                  {item.connector || "AISOC"}
                </Badge>
                {item.status === "completed" ? (
                  <Badge
                    justifySelf={{ base: "start", md: "end" }}
                    bg="#e7f5ed"
                    color="#26734d"
                  >
                    Completed
                  </Badge>
                ) : (
                  <Button
                    justifySelf={{ base: "start", md: "end" }}
                    isLoading={running === item.id}
                    onClick={() => setConfirmItem(item)}
                  >
                    Execute
                  </Button>
                )}
              </Grid>
            ))}
          </Stack>
        </Panel>

        <Stack spacing="12px">
          <Panel p="16px">
            <Label>Containment sequence</Label>
            <Stack mt="16px" spacing="14px">
              {[
                "Revoke active sessions",
                "Reset exposed credentials",
                "Isolate affected endpoint",
                "Block malicious infrastructure",
              ].map((step, index) => (
                <HStack key={step} align="start">
                  <Flex
                    flexShrink="0"
                    w="24px"
                    h="24px"
                    rounded="full"
                    bg={
                      index < completed
                        ? ui.green
                        : index === completed
                          ? ui.nav
                          : ui.soft
                    }
                    color={index <= completed ? "white" : ui.muted}
                    align="center"
                    justify="center"
                    fontSize="10px"
                    fontWeight="700"
                  >
                    {index + 1}
                  </Flex>
                  <Box>
                    <Text fontWeight="600">{step}</Text>
                    <Text color={ui.muted}>
                      {index < completed
                        ? "Completed"
                        : index === completed
                          ? "Ready to execute"
                          : "Waiting on dependency"}
                    </Text>
                  </Box>
                </HStack>
              ))}
            </Stack>
          </Panel>
          <Panel p="16px" bg="#131722" color="white" borderColor="#131722">
            <Label>Automation guardrail</Label>
            <Heading mt="12px" fontSize="17px">
              Human approval stays in the loop
            </Heading>
            <Text mt="8px" color="#b9c0cc">
              High-impact identity and endpoint actions require analyst
              confirmation before execution.
            </Text>
          </Panel>
        </Stack>
      </Grid>

      <AlertDialog
        isOpen={Boolean(confirmItem)}
        leastDestructiveRef={cancelRef}
        onClose={() => setConfirmItem(null)}
      >
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="16px" fontWeight="600">
              Run this response action?
            </AlertDialogHeader>
            <AlertDialogBody fontSize="13px">
              {confirmItem?.title} will run on{" "}
              {confirmItem?.connector || "AISOC"}. Identity and endpoint changes
              take effect immediately.
            </AlertDialogBody>
            <AlertDialogFooter>
              <Button
                ref={cancelRef}
                variant="outline"
                onClick={() => setConfirmItem(null)}
              >
                Cancel
              </Button>
              <Button
                ml="8px"
                onClick={() => {
                  setConfirmItem(null);
                  if (confirmItem?.id === "__bulk__") {
                    items.filter((i) => i.status === "pending").forEach((i) => execute(i));
                  } else {
                    execute(confirmItem);
                  }
                }}
              >
                Execute
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </Box>
  );
}

const fallbackMemory = [
  {
    id: "INV-4819",
    title: "Risk-Backed Impossible Travel",
    summary:
      "Impossible travel was confirmed as identity compromise after a non-compliant device reused a valid session.",
    source: "Entra ID",
    category: "identity",
    determination: "malicious",
    severity: "high",
    primary_entity: "maya.santos@okami-ai.com",
    updated_at: "2026-10-21T19:52:30Z",
  },
  {
    id: "INV-4814",
    title: "Encoded PowerShell spawned by Excel",
    summary:
      "Browser credential access was followed by a size-matched outbound transfer from the endpoint.",
    source: "CrowdStrike",
    category: "endpoint",
    determination: "suspicious",
    severity: "high",
    primary_entity: "OKAMI-FIN-074",
    updated_at: "2026-10-20T15:18:00Z",
  },
  {
    id: "INV-4808",
    title: "Unusual S3 bulk object access",
    summary:
      "Service account object collection exceeded its 30-day baseline and requires owner validation.",
    source: "AWS GuardDuty",
    category: "cloud",
    determination: "unknown",
    severity: "medium",
    primary_entity: "svc-data-export",
    updated_at: "2026-10-18T11:42:00Z",
  },
];

function MemoryCenter({ setView }) {
  const [query, setQuery] = useState("");
  const [records, setRecords] = useState(fallbackMemory);
  const [selectedId, setSelectedId] = useState(fallbackMemory[0].id);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .investigations({ limit: 100 })
      .then((result) => {
        if (active && result.items.length) {
          setRecords(result.items);
          setSelectedId(result.items[0].id);
        }
      })
      .catch(() => active && setLoadFailed(true));
    return () => {
      active = false;
    };
  }, []);

  const normalized = query.trim().toLowerCase();
  const visible = records.filter(
    (record) =>
      !normalized ||
      [
        record.title,
        record.summary,
        record.source,
        record.category,
        record.primary_entity,
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
  );
  // Only pick from visible rows so the detail pane never shows a filtered-out record.
  const selected =
    visible.find((record) => record.id === selectedId) || visible[0];

  return (
    <Box className="page-enter" px={{ base: "12px", md: "24px" }} pb="28px">
      <SampleDataNotice show={loadFailed} />
      <Flex
        align={{ base: "start", md: "end" }}
        direction={{ base: "column", md: "row" }}
        gap="14px"
        mb="18px"
      >
        <Box>
          <Badge bg="#e9e7ff" color={ui.violet}>
            ORGANIZATIONAL MEMORY
          </Badge>
          <Heading
            fontSize={{ base: "22px", md: "28px" }}
            fontWeight="500"
            mt="7px"
          >
            What your SOC already knows
          </Heading>
          <Text color={ui.muted} mt="4px">
            Search prior investigations, entities, outcomes, and reusable
            analyst knowledge.
          </Text>
        </Box>
        <InputGroup ml={{ base: 0, md: "auto" }} maxW="390px">
          <InputLeftElement h="34px">{Icon.search({ size: 14, color: ui.muted })}</InputLeftElement>
          <Input
            bg="white"
            pl="34px"
            placeholder="Search entities, techniques, or findings"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </InputGroup>
      </Flex>

      <SimpleGrid columns={{ base: 2, md: 4 }} spacing="10px" mb="16px">
        {[
          [records.length, "Investigation memories"],
          [
            new Set(records.map((item) => item.primary_entity)).size,
            "Known entities",
          ],
          ["38", "Reusable findings"],
          ["91%", "Context reuse"],
        ].map(([value, label]) => (
          <Panel key={label} p="15px">
            <Metric value={value} label={label} size="31px" />
          </Panel>
        ))}
      </SimpleGrid>

      <Grid
        templateColumns={{
          base: "1fr",
          lg: "minmax(320px, .9fr) minmax(0, 1.5fr)",
        }}
        gap="12px"
      >
        <Panel overflow="hidden">
          <Flex
            px="15px"
            py="12px"
            borderBottom="1px solid"
            borderColor={ui.line}
          >
            <Label>Investigation memory</Label>
            <Badge ml="auto">{visible.length} records</Badge>
          </Flex>
          <Stack
            spacing="0"
            divider={<Divider />}
            maxH={{ base: "none", lg: "540px" }}
            overflowY="auto"
            className="thin-scroll"
          >
            {visible.map((record) => (
              <Box
                key={record.id}
                p="15px"
                cursor="pointer"
                bg={selected?.id === record.id ? "#f0efff" : "white"}
                borderLeft="3px solid"
                borderLeftColor={
                  selected?.id === record.id ? ui.violet : "transparent"
                }
                _hover={{ bg: "#f7f7fb" }}
                role="button"
                tabIndex={0}
                aria-pressed={selected?.id === record.id}
                onClick={() => setSelectedId(record.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedId(record.id);
                  }
                }}
              >
                <Flex align="center">
                  <Badge
                    color={
                      record.determination === "malicious" ? "white" : ui.ink
                    }
                    bg={
                      record.determination === "malicious"
                        ? ui.red
                        : record.determination === "suspicious"
                          ? ui.amber
                          : "#e7eaf0"
                    }
                  >
                    {record.determination}
                  </Badge>
                  <Text ml="auto" color={ui.muted}>
                    {record.id}
                  </Text>
                </Flex>
                <Text mt="9px" fontWeight="700" fontSize="12px !important">
                  {record.title}
                </Text>
                <Text mt="5px" color={ui.muted} noOfLines={2}>
                  {record.summary}
                </Text>
                <HStack mt="10px" color={ui.muted}>
                  <Text>{record.source}</Text>
                  <Text>•</Text>
                  <Text>{record.primary_entity}</Text>
                </HStack>
              </Box>
            ))}
            {!visible.length && (
              <Box p="30px" textAlign="center">
                <Text fontWeight="600">No memories found</Text>
                <Text color={ui.muted} mt="4px">
                  Try a broader entity or technique.
                </Text>
              </Box>
            )}
          </Stack>
        </Panel>

        {selected && (
          <Panel p={{ base: "16px", md: "22px" }} minH="430px">
            <Flex align="start">
              <Box>
                <Text color={ui.muted}>
                  {selected.id} / {selected.category}
                </Text>
                <Heading mt="6px" fontSize={{ base: "18px", md: "22px" }}>
                  {selected.title}
                </Heading>
              </Box>
              <Badge
                ml="auto"
                bg={
                  selected.severity === "critical" ||
                  selected.severity === "high"
                    ? ui.red
                    : ui.amber
                }
                color="white"
              >
                {selected.severity}
              </Badge>
            </Flex>
            <Box
              mt="22px"
              p="16px"
              bg="#f4f6f8"
              borderLeft="3px solid"
              borderLeftColor={ui.violet}
            >
              <Label>Learned outcome</Label>
              <Text mt="8px" fontSize="13px !important">
                {selected.summary}
              </Text>
            </Box>
            <SimpleGrid columns={{ base: 1, md: 2 }} spacing="12px" mt="18px">
              <Box>
                <Label>Primary entity</Label>
                <Text mt="6px" color={ui.violet} fontWeight="600">
                  {selected.primary_entity || "No primary entity"}
                </Text>
              </Box>
              <Box>
                <Label>Evidence source</Label>
                <Text mt="6px" fontWeight="600">
                  {selected.source}
                </Text>
              </Box>
              <Box>
                <Label>Determination</Label>
                <Text mt="6px" textTransform="capitalize" fontWeight="600">
                  {selected.determination}
                </Text>
              </Box>
              <Box>
                <Label>Last updated</Label>
                <Text mt="6px" fontWeight="600">
                  {new Date(selected.updated_at).toLocaleDateString()}
                </Text>
              </Box>
            </SimpleGrid>
            <Divider my="20px" />
            <Label>Reusable context</Label>
            <Stack mt="10px" spacing="8px">
              {[
                "Entity behavior baseline retained for future correlation",
                "Investigation outcome contributes to triage confidence",
                "Response sequence available as an analyst-approved pattern",
              ].map((text) => (
                <HStack key={text} p="10px" bg={ui.soft}>
                  <Text color={ui.green} fontWeight="700">
                    ✓
                  </Text>
                  <Text>{text}</Text>
                </HStack>
              ))}
            </Stack>
            <Button
              mt="20px"
              onClick={() => setView("investigationDetail", selected.id)}
            >
              Open full investigation
            </Button>
          </Panel>
        )}
      </Grid>
    </Box>
  );
}

/* ─── Threat Intel ──────────────────────────────────────────────── */

const fallbackReports = [
  { id: "TIR-001", title: "CRXfiltrate — Remote-Controlled Manifest V3 Browser Extensions", source: "AISOC Threat Intelligence", report_type: "threat_report", severity: "critical", status: "actionable", ioc_count: 12, hunt_status: "completed", hunts_launched: 2, findings_count: 3, tags: ["browser", "extension", "exfiltration"], published_at: "2026-10-22T14:30:00Z" },
  { id: "TIR-002", title: "APT42 — Gov Phishing Wave", source: "AISOC Threat Intelligence", report_type: "advisory", severity: "high", status: "actionable", ioc_count: 8, hunt_status: "completed", hunts_launched: 1, findings_count: 1, tags: ["apt", "phishing", "government"], published_at: "2026-10-21T09:15:00Z" },
  { id: "TIR-003", title: "Click, Install, Compromise: The New Wave of Zoom-Themed Attacks", source: "Google Threat Intelligence", report_type: "threat_report", severity: "high", status: "reviewing", ioc_count: 6, hunt_status: "hunting", hunts_launched: 1, findings_count: 0, tags: ["social-engineering", "zoom", "malware"], published_at: "2026-10-20T16:45:00Z" },
  { id: "TIR-004", title: "UNC1549 — Aerospace Harvest", source: "Google Threat Intelligence", report_type: "advisory", severity: "medium", status: "archived", ioc_count: 4, hunt_status: "completed", hunts_launched: 1, findings_count: 0, tags: ["apt", "aerospace", "espionage"], published_at: "2026-10-18T11:00:00Z" },
  { id: "TIR-005", title: "Lumma Stealer C2 Infrastructure Update", source: "AISOC Threat Intelligence", report_type: "ioc_feed", severity: "critical", status: "actionable", ioc_count: 15, hunt_status: "completed", hunts_launched: 3, findings_count: 2, tags: ["stealer", "c2", "infrastructure"], published_at: "2026-10-17T08:20:00Z" },
  { id: "TIR-006", title: "CVE-2026-42897 — Microsoft Exchange Server XSS / Spoofing Vulnerability", source: "NIST NVD", report_type: "advisory", severity: "high", status: "new", ioc_count: 3, hunt_status: "not_started", hunts_launched: 0, findings_count: 0, tags: ["cve", "exchange", "xss"], published_at: "2026-10-16T20:00:00Z" },
  { id: "TIR-007", title: "Black Basta Ransomware TTPs — Q4 2026", source: "Mandiant", report_type: "hunt_pack", severity: "critical", status: "reviewing", ioc_count: 9, hunt_status: "hunting", hunts_launched: 2, findings_count: 0, tags: ["ransomware", "black-basta", "ttps"], published_at: "2026-10-15T13:10:00Z" },
  { id: "TIR-008", title: "Cobalt Strike Malleable C2 Profiles", source: "Recorded Future", report_type: "ioc_feed", severity: "high", status: "actionable", ioc_count: 11, hunt_status: "completed", hunts_launched: 2, findings_count: 1, tags: ["cobalt-strike", "c2", "profiles"], published_at: "2026-10-14T06:30:00Z" },
];

const fallbackIndicators = [
  { id: "IOC-001", report_id: "TIR-001", indicator_type: "domain", value: "crx-update.cloudgateway.cc", severity: "critical", status: "active", hits: 3 },
  { id: "IOC-002", report_id: "TIR-001", indicator_type: "ip", value: "45.83.12.9", severity: "critical", status: "active", hits: 2 },
  { id: "IOC-003", report_id: "TIR-001", indicator_type: "hash_sha256", value: "31fc9a2b7e4d8c...a6f1b2e5", severity: "high", status: "active", hits: 1 },
  { id: "IOC-004", report_id: "TIR-005", indicator_type: "domain", value: "releases.cloudgateway.cc", severity: "critical", status: "active", hits: 4 },
  { id: "IOC-005", report_id: "TIR-005", indicator_type: "ip", value: "104.21.79.237", severity: "high", status: "mitigated", hits: 2 },
  { id: "IOC-006", report_id: "TIR-008", indicator_type: "ip", value: "185.220.101.45", severity: "high", status: "active", hits: 1 },
  { id: "IOC-007", report_id: "TIR-002", indicator_type: "domain", value: "gov-login-verify.net", severity: "high", status: "active", hits: 0 },
  { id: "IOC-008", report_id: "TIR-006", indicator_type: "cve", value: "CVE-2026-42897", severity: "high", status: "active", hits: 0 },
];

const huntStatusColor = (s) =>
  s === "completed" ? ui.green : s === "hunting" ? ui.violet : s === "no_findings" ? ui.steel : ui.quiet;
const huntStatusLabel = (s) =>
  s === "completed" ? "Completed" : s === "hunting" ? "Hunting…" : s === "no_findings" ? "No findings" : "Not started";
const reportTypeLabel = (t) =>
  t === "threat_report" ? "Threat Report" : t === "advisory" ? "Advisory" : t === "ioc_feed" ? "IOC Feed" : t === "hunt_pack" ? "Hunt Pack" : t;
const reportTypeBg = (t) =>
  t === "threat_report" ? "#111827" : t === "advisory" ? ui.violet : t === "ioc_feed" ? ui.amber : "#3d4964";

function ThreatIntelDashboard({ setView }) {
  const toast = useToast();
  const [reports, setReports] = useState(fallbackReports);
  const [loadFailed, setLoadFailed] = useState(false);
  const [filter, setFilter] = useState("all");
  const [launching, setLaunching] = useState(null);

  useEffect(() => {
    let active = true;
    api.threatIntelReports()
      .then((result) => active && result.items.length && setReports(result.items))
      .catch(() => active && setLoadFailed(true));
    return () => { active = false; };
  }, []);

  const launchHunt = async (report) => {
    setLaunching(report.id);
    try {
      const updated = await api.launchThreatHunt(report.id);
      setReports((cur) => cur.map((r) => (r.id === report.id ? { ...r, ...updated } : r)));
      toast({ title: "Threat hunt launched", description: `Hunting across your environment for ${report.title}`, status: "success", duration: 3000 });
    } catch (error) {
      toast({ title: "Hunt launch failed", description: error.message, status: "error", duration: 3000 });
    } finally {
      setLaunching(null);
    }
  };

  const totalIOCs = reports.reduce((s, r) => s + (r.ioc_count || 0), 0);
  const totalFindings = reports.reduce((s, r) => s + (r.findings_count || 0), 0);
  const activeHunts = reports.filter((r) => r.hunt_status === "hunting").length;
  const sourceCounts = {};
  reports.forEach((r) => { sourceCounts[r.source] = (sourceCounts[r.source] || 0) + 1; });
  const visible = filter === "all" ? reports : reports.filter((r) => r.status === filter || r.hunt_status === filter);

  return (
    <Box className="page-enter" px={{ base: "12px", md: "24px" }} pb="28px">
      <SampleDataNotice show={loadFailed} />
      <Flex align={{ base: "start", md: "center" }} direction={{ base: "column", md: "row" }} gap="12px" mb="18px">
        <Box>
          <Badge bg="#e9e7ff" color={ui.violet}>THREAT INTELLIGENCE</Badge>
          <Heading fontSize={{ base: "22px", md: "28px" }} fontWeight="500" mt="7px">Threat Intelligence Center</Heading>
          <Text color={ui.muted} mt="4px">Ingest threat reports, track indicators, and launch proactive hunts across your environment.</Text>
        </Box>
        <HStack ml={{ base: 0, md: "auto" }}>
          <Button variant="outline" leftIcon={Icon.calendar({ size: 12 })}>Last 30 days</Button>
          <Button onClick={() => setView("hunt")}>View hunts</Button>
        </HStack>
      </Flex>

      <SimpleGrid columns={{ base: 2, md: 5 }} spacing="10px" mb="16px">
        {[
          [reports.length, "Intel reports", ui.ink],
          [totalIOCs, "IOCs tracked", ui.violet],
          [totalFindings, "Findings", ui.red],
          [activeHunts, "Active hunts", ui.amber],
          [`${reports.filter((r) => r.hunt_status === "completed" || r.hunt_status === "no_findings").length}/${reports.length}`, "Reports hunted", ui.green],
        ].map(([value, label, color]) => (
          <Panel key={label} p="15px" borderTop="3px solid" borderTopColor={color}>
            <Metric value={value} label={label} color={color} size="31px" />
          </Panel>
        ))}
      </SimpleGrid>

      <Grid templateColumns={{ base: "1fr", xl: "minmax(0, 2.2fr) minmax(270px, .8fr)" }} gap="12px">
        <Panel overflow="hidden">
          <Flex px="16px" py="13px" borderBottom="1px solid" borderColor={ui.line} align="center" gap="10px" wrap="wrap">
            <Box>
              <Label>Intelligence feed</Label>
              <Text color={ui.muted} mt="2px">Reports from connected threat intelligence sources, ordered by publish date.</Text>
            </Box>
            <HStack ml={{ base: 0, md: "auto" }}>
              {["all", "new", "reviewing", "actionable", "hunting"].map((v) => (
                <Button key={v} variant={filter === v ? "solid" : "ghost"} onClick={() => setFilter(v)} textTransform="capitalize">{v === "hunting" ? "Hunting" : v}</Button>
              ))}
            </HStack>
          </Flex>
          <Stack spacing="0" divider={<Divider />}>
            {visible.map((report) => (
              <Grid
                className="response-row"
                key={report.id}
                templateColumns={{ base: "1fr", md: "minmax(220px, 1.5fr) 100px 80px 80px 100px 90px" }}
                gap="12px"
                alignItems="center"
                p="15px 16px"
                cursor="pointer"
                onClick={() => setView("threatIntelDetail", report.id)}
              >
                <Box>
                  <Flex align="center" gap="8px" mb="4px">
                    <Badge bg={reportTypeBg(report.report_type)} color="white" fontSize="8px">{reportTypeLabel(report.report_type)}</Badge>
                    <Badge bg={report.severity === "critical" ? ui.red : report.severity === "high" ? ui.amber : ui.steel} color="white">{report.severity.toUpperCase()}</Badge>
                  </Flex>
                  <Text fontWeight="700" fontSize="12px !important">{report.title}</Text>
                  <Text color={ui.muted} mt="3px">{report.source}</Text>
                </Box>
                <Box textAlign="center">
                  <Text className="metric-number" fontSize="22px">{report.ioc_count}</Text>
                  <Text color={ui.muted}>IOCs</Text>
                </Box>
                <Box textAlign="center">
                  <Text className="metric-number" fontSize="22px" color={report.findings_count ? ui.red : ui.ink}>{report.findings_count}</Text>
                  <Text color={ui.muted}>Findings</Text>
                </Box>
                <Box textAlign="center">
                  <Text className="metric-number" fontSize="22px">{report.hunts_launched}</Text>
                  <Text color={ui.muted}>Hunts</Text>
                </Box>
                <Flex justify="center">
                  <Badge bg={`${huntStatusColor(report.hunt_status)}22`} color={huntStatusColor(report.hunt_status)}>{huntStatusLabel(report.hunt_status)}</Badge>
                </Flex>
                <Box textAlign="right" onClick={(e) => e.stopPropagation()}>
                  {report.hunt_status === "not_started" || report.hunt_status === "completed" ? (
                    <Button size="sm" isLoading={launching === report.id} onClick={() => launchHunt(report)}>
                      {report.hunt_status === "completed" ? "Re-hunt" : "Hunt"}
                    </Button>
                  ) : (
                    <Text color={ui.violet} fontWeight="600">In progress</Text>
                  )}
                </Box>
              </Grid>
            ))}
            {!visible.length && (
              <Box p="30px" textAlign="center">
                <Text fontWeight="600">No reports match this filter</Text>
                <Text color={ui.muted} mt="4px">Try a different status filter.</Text>
              </Box>
            )}
          </Stack>
        </Panel>

        <Stack spacing="12px">
          <Panel p="16px">
            <Label>Intelligence sources</Label>
            <Stack mt="14px" spacing="12px">
              {Object.entries(sourceCounts).map(([source, count]) => (
                <HStack key={source}>
                  <Badge bg={source.includes("AISOC") ? "#111827" : source.includes("Google") ? ui.amber : ui.steel} color="white" fontSize="9px">
                    {source.includes("AISOC") ? "AISOC" : source.includes("Google") ? "G" : source.slice(0, 2).toUpperCase()}
                  </Badge>
                  <Box flex="1">
                    <Text fontWeight="600">{source}</Text>
                    <Text color={ui.muted}>{count} report{count !== 1 ? "s" : ""}</Text>
                  </Box>
                </HStack>
              ))}
            </Stack>
          </Panel>

          <Panel p="16px">
            <Label>Top active indicators</Label>
            <Stack mt="14px" spacing="10px">
              {fallbackIndicators.filter((i) => i.status === "active" && i.hits > 0).sort((a, b) => b.hits - a.hits).slice(0, 5).map((ioc) => (
                <Flex key={ioc.id} align="center" justify="space-between">
                  <Box>
                    <Text fontWeight="600" fontSize="11px !important" fontFamily="mono">{ioc.value}</Text>
                    <Text color={ui.muted}>{ioc.indicator_type.toUpperCase()}</Text>
                  </Box>
                  <Badge bg={ui.red} color="white">{ioc.hits} HIT{ioc.hits !== 1 ? "S" : ""}</Badge>
                </Flex>
              ))}
            </Stack>
          </Panel>

          <Panel p="16px" bg="#131722" color="white" borderColor="#131722">
            <Label>Threat intel hunt</Label>
            <Heading mt="12px" fontSize="17px">Automatic environment scanning</Heading>
            <Text mt="8px" color="#b9c0cc">
              New reports are automatically checked against your environment. IOCs and TTPs are hunted across all connected sources.
            </Text>
          </Panel>
        </Stack>
      </Grid>
    </Box>
  );
}

function ThreatIntelReportDetail({ id, setView }) {
  const toast = useToast();
  const [report, setReport] = useState(null);
  const [indicators, setIndicators] = useState([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    let active = true;
    const fallback = fallbackReports.find((r) => r.id === id) || fallbackReports[0];
    const fallbackIocs = fallbackIndicators.filter((i) => i.report_id === (id || fallback?.id));
    api.threatIntelReport(id || "TIR-001")
      .then((result) => {
        if (!active) return;
        setReport(result);
        setIndicators(result.indicators || []);
      })
      .catch(() => {
        if (!active) return;
        setLoadFailed(true);
        setReport(fallback);
        setIndicators(fallbackIocs);
      });
    return () => { active = false; };
  }, [id]);

  const launchHunt = async () => {
    if (!report) return;
    setLaunching(true);
    try {
      const updated = await api.launchThreatHunt(report.id);
      setReport((cur) => ({ ...cur, ...updated }));
      toast({ title: "Threat hunt launched", status: "success", duration: 2500 });
    } catch (error) {
      toast({ title: "Hunt launch failed", description: error.message, status: "error", duration: 3000 });
    } finally {
      setLaunching(false);
    }
  };

  if (!report) return <Box p="40px" textAlign="center"><Text color={ui.muted}>Loading report…</Text></Box>;

  return (
    <Box className="page-enter threat-intel-detail" minW="0" w="full">
      {loadFailed && <Box px={{ base: "12px", md: "20px" }} pt="8px"><SampleDataNotice show /></Box>}
      <Flex px={{ base: "12px", md: "20px" }} py="10px" bg="#f5f6f9" align="center" wrap="wrap" gap="8px">
        <Button variant="ghost" onClick={() => setView("threatIntel")} leftIcon={Icon.arrowLeft({ size: 13 })}>Back to feed</Button>
        <HStack ml="auto">
          <Badge bg={reportTypeBg(report.report_type)} color="white">{reportTypeLabel(report.report_type)}</Badge>
          <Badge bg={report.severity === "critical" ? ui.red : report.severity === "high" ? ui.amber : ui.steel} color="white">{report.severity?.toUpperCase()}</Badge>
          <Button variant="outline" isLoading={launching} onClick={launchHunt} leftIcon={Icon.play({ size: 12 })}>
            {report.hunt_status === "hunting" ? "Hunting…" : report.hunt_status === "completed" ? "Re-hunt" : "Launch Hunt"}
          </Button>
        </HStack>
      </Flex>

      <Grid className="threat-intel-detail-layout" templateColumns={{ base: "minmax(0, 1fr)", xl: "minmax(260px, 22%) minmax(0, 1fr)" }} w="full" mt={{ base: "12px", md: "18px" }} gap={{ base: "16px", md: "22px" }} px={{ base: "12px", md: "20px" }} alignItems="start">
        <Box minW="0" borderRight={{ base: "none", xl: "1px solid" }} borderBottom={{ base: "1px solid", xl: "none" }} borderColor={ui.line} pr={{ base: 0, xl: "18px" }} pb={{ base: "14px", xl: 0 }}>
          <Text color={ui.muted}>{report.source}</Text>
          <Text mt="4px" fontSize="8px" color={ui.quiet}>Published {new Date(report.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</Text>
          <Divider my="14px" />
          <SimpleGrid columns={2} spacing="12px">
            <Box><Label>IOCs</Label><Text className="metric-number" fontSize="28px" mt="4px">{report.ioc_count}</Text></Box>
            <Box><Label>Findings</Label><Text className="metric-number" fontSize="28px" mt="4px" color={report.findings_count ? ui.red : ui.ink}>{report.findings_count}</Text></Box>
            <Box><Label>Hunts launched</Label><Text className="metric-number" fontSize="28px" mt="4px">{report.hunts_launched}</Text></Box>
            <Box><Label>Hunt status</Label><Badge mt="6px" bg={`${huntStatusColor(report.hunt_status)}22`} color={huntStatusColor(report.hunt_status)}>{huntStatusLabel(report.hunt_status)}</Badge></Box>
          </SimpleGrid>
          <Divider my="14px" />
          <Label>Tags</Label>
          <Flex mt="8px" gap="6px" wrap="wrap">
            {(report.tags || []).map((tag) => (<Badge key={tag} variant="outline">{tag}</Badge>))}
          </Flex>
        </Box>

        <Box minW="0">
          <Heading fontSize="18px">{report.title}</Heading>
          <Text color={ui.muted} mt="8px">{report.summary || "Detailed analysis and indicators for this threat intelligence report."}</Text>

          {report.findings_count > 0 && (
            <Box mt="18px" p="14px" bg="#fff0f1" borderLeft="3px solid" borderLeftColor={ui.red} borderRadius="3px">
              <Text fontWeight="700" color={ui.red}>⚠ {report.findings_count} finding{report.findings_count !== 1 ? "s" : ""} detected in your environment</Text>
              <Text mt="4px" color={ui.ink}>Indicators from this report matched activity in your connected data sources. Review the indicators below and take action.</Text>
            </Box>
          )}

          <Box mt="24px">
            <Flex align="center" mb="12px">
              <Label>Indicators of compromise</Label>
              <Badge ml="8px">{indicators.length} IOCs</Badge>
            </Flex>
            <Panel overflow="hidden">
              <TableContainer className="thin-scroll">
                <Table size="sm">
                  <Thead>
                    <Tr>
                      {["Type", "Value", "Severity", "Status", "Hits"].map((h) => (
                        <Th key={h} fontSize="7px" color={ui.muted}>{h}</Th>
                      ))}
                    </Tr>
                  </Thead>
                  <Tbody>
                    {indicators.map((ioc) => (
                      <Tr key={ioc.id}>
                        <Td py="10px" fontSize="8px" borderColor={ui.line}>
                          <Badge variant="outline">{(ioc.indicator_type || "").toUpperCase()}</Badge>
                        </Td>
                        <Td py="10px" fontSize="8px" borderColor={ui.line} fontFamily="mono" fontWeight="600">{ioc.value}</Td>
                        <Td py="10px" borderColor={ui.line}>
                          <Badge bg={ioc.severity === "critical" ? ui.red : ioc.severity === "high" ? ui.amber : ui.steel} color="white">{(ioc.severity || "medium").toUpperCase()}</Badge>
                        </Td>
                        <Td py="10px" fontSize="8px" borderColor={ui.line}>
                          <Text color={ioc.status === "active" ? ui.red : ioc.status === "mitigated" ? ui.green : ui.quiet} fontWeight="600" textTransform="capitalize">{ioc.status}</Text>
                        </Td>
                        <Td py="10px" fontSize="8px" borderColor={ui.line}>
                          {ioc.hits > 0 ? <Badge bg={ui.red} color="white">{ioc.hits} HIT{ioc.hits !== 1 ? "S" : ""}</Badge> : <Text color={ui.quiet}>—</Text>}
                        </Td>
                      </Tr>
                    ))}
                    {!indicators.length && (
                      <Tr><Td colSpan={5} textAlign="center" py="20px" color={ui.muted}>No indicators available</Td></Tr>
                    )}
                  </Tbody>
                </Table>
              </TableContainer>
            </Panel>
          </Box>

          <Flex mt="18px" gap="8px">
            <Button variant="outline" onClick={() => setView("hunt")}>View related hunts</Button>
            <Button variant="outline" onClick={() => setView("investigations")}>View investigations</Button>
          </Flex>
        </Box>
      </Grid>
    </Box>
  );
}

function ConnectorSetup() {
  const toast = useToast();
  return (
    <Box className="page-enter" px="15px">
      <Flex justify="end" mb="12px">
        <Button variant="outline">Cancel</Button>
        <Button
          ml="5px"
          onClick={() =>
            toast({
              title: "Mock Cribl connector added",
              status: "success",
              duration: 2000,
            })
          }
        >
          Add connector
        </Button>
      </Flex>
      <HStack mb="15px">
        <Label>Connector</Label>
        <Badge bg="#19a6d4" color="white">
          ▶
        </Badge>
        <Text>Cribl</Text>
      </HStack>
      <Grid templateColumns={{ base: "1fr", lg: "470px 1fr" }} gap="15px">
        <Panel p="12px">
          <Stack spacing="8px">
            {[
              ["Connection name *", "e.g. Production Cribl"],
              ["Description", "Optional"],
              [
                "Cribl Workspace URL *",
                "https://main-my-org-abc123.cribl.cloud",
              ],
              ["Client ID *", "Client ID of a Cribl.Cloud API credential"],
              ["Client Secret *", "Client Secret for the same credential"],
              ["Search Group", "default_search"],
              ["Tags ⓘ", "Select tags..."],
            ].map(([l, p]) => (
              <Box key={l}>
                <Text fontSize="7px" mb="3px">
                  {l}
                </Text>
                <Input placeholder={p} />
              </Box>
            ))}
          </Stack>
        </Panel>
        <Box>
          <Heading fontSize="14px" mb="12px">
            Step 3: Enter Connection Information in AISOC
          </Heading>
          <Panel
            h="450px"
            borderColor="#6d7989"
            display="flex"
            alignItems="center"
            justifyContent="center"
          >
            <HStack spacing="40px">
              <Box fontSize="9px" maxW="310px">
                <Text>
                  1. Enter the <b>API Base URL</b> from Step 2.
                </Text>
                <Text>
                  2. Enter the <b>Client ID</b> and <b>Client Secret</b> from
                  Step 1.
                </Text>
                <Text>
                  3. Click <b>Save</b>.
                </Text>
                <Text>
                  4. Once accepted, the connector will appear in Active
                  Connectors and display as <b>Operational</b>.
                </Text>
              </Box>
              <Panel p="12px" w="120px">
                <Stack spacing="5px">
                  <Input />
                  <Input />
                  <Input />
                  <Button>Save</Button>
                </Stack>
              </Panel>
            </HStack>
          </Panel>
          <HStack justify="center" mt="8px">
            <Text>‹</Text>
            <Text color={ui.quiet}>○ ○</Text>
            <Text>●</Text>
            <Text>›</Text>
          </HStack>
        </Box>
      </Grid>
    </Box>
  );
}

function ConnectorSetupLive({ setView }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [setupStep, setSetupStep] = useState(3);
  const [form, setForm] = useState({
    name: "",
    description: "",
    workspace_url: "",
    client_id: "",
    secret: "",
    search_group: "default_search",
    tags: "",
  });
  const fields = [
    ["name", "Connection name *", "e.g. Production Cribl"],
    ["description", "Description", "Optional"],
    ["workspace_url", "Cribl Workspace URL *", "https://main-my-org-abc123.cribl.cloud"],
    ["client_id", "Client ID *", "Client ID of a Cribl.Cloud API credential with search read access"],
    ["secret", "Client Secret *", "Client Secret for the same Cribl.Cloud API credential"],
    ["search_group", "Search Group", "default_search"],
    ["tags", "Tags ⓘ", "Select tags..."],
  ];
  const wizardSteps = [
    { num: 1, title: "Create API Credentials in Cribl", instructions: ["Navigate to your Cribl Cloud workspace Settings.", "Go to API Credentials and click Create Credential.", "Choose Search scope with read access.", "Copy the Client ID and Client Secret."] },
    { num: 2, title: "Enable Search in Cribl", instructions: ["Open Settings → Search in your Cribl workspace.", "Enable the Cribl Search feature if not already active.", "Verify the search group (default_search) is configured.", "Test a sample query to confirm access."] },
    { num: 3, title: "Enter Connection Information in AISOC", instructions: ["Enter the API Base URL from Step 2.", "Enter the Client ID and Client Secret from Step 1.", "Click Save.", "Once the credentials are accepted, the Cribl connector will appear in the Active Connectors section. After 5–10 minutes, a heartcheck will run automatically. If successful, the connector tile will display as Operational, confirming the installation was successful."] },
    { num: 4, title: "Verify Connection", instructions: ["Check that the connector status shows Operational.", "Run a test search to verify data is flowing.", "Configure any search filters or log routing rules.", "The connector is now ready for investigations."] },
  ];
  const currentStep = wizardSteps.find((s) => s.num === setupStep) || wizardSteps[2];
  const submit = async () => {
    if (!form.name || !form.workspace_url || !form.client_id || !form.secret) {
      toast({ title: "Complete all required fields", status: "warning", duration: 2500 });
      return;
    }
    setSaving(true);
    try {
      const connector = await api.createConnector({
        type: "cribl", name: form.name, description: form.description,
        workspace_url: form.workspace_url, client_id: form.client_id, secret: form.secret,
        config: { searchGroup: form.search_group, tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean) },
      });
      const tested = await api.testConnector(connector.id);
      toast({ title: "Connector saved", description: tested.test_result?.message || `Connection status: ${tested.status}`, status: tested.test_result?.status === "operational" ? "success" : "info", duration: 5000 });
    } catch (error) {
      toast({ title: "Could not add connector", description: error.message, status: "error", duration: 3500 });
    } finally { setSaving(false); }
  };
  return (
    <Box className="page-enter" px="15px">
      <Flex justify="end" mb="12px">
        <Button variant="outline" onClick={() => setView("queue")}>Cancel</Button>
        <Button ml="5px" isLoading={saving} onClick={submit}>Add connector</Button>
      </Flex>
      <HStack mb="15px">
        <Text fontSize="7px" fontWeight="600" color={ui.muted} letterSpacing=".04em" textTransform="uppercase">Connector</Text>
        <Badge bg="#19a6d4" color="white" fontSize="9px">▶</Badge>
        <Text fontWeight="600">Cribl</Text>
      </HStack>
      <Grid templateColumns={{ base: "1fr", lg: "470px 1fr" }} gap="18px">
        <Panel p="16px">
          <Stack spacing="10px">
            {fields.map(([key, label, placeholder]) => (
              <FormControl key={key} isRequired={label.includes("*")}>
                <FormLabel fontSize="8px" mb="4px" fontWeight="600">{label.replace(" *", "")}</FormLabel>
                <Input
                  type={key === "secret" ? "password" : "text"}
                  placeholder={placeholder}
                  value={form[key]}
                  onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
                  bg="white"
                  borderColor={ui.line}
                  _placeholder={{ color: "#b5bac6" }}
                />
              </FormControl>
            ))}
          </Stack>
        </Panel>
        <Box>
          <Heading fontSize="15px" mb="14px">
            Step {currentStep.num}: {currentStep.title}
          </Heading>
          <Panel borderColor="#6d7989" overflow="hidden">
            <Grid templateColumns={{ base: "1fr", md: "1fr 260px" }} minH="400px">
              <Box p="20px">
                <Stack spacing="10px">
                  {currentStep.instructions.map((inst, i) => (
                    <Flex key={i} align="start">
                      <Text fontSize="10px" fontWeight="600" color={ui.violet} mr="8px" mt="1px" flexShrink={0}>{i + 1}.</Text>
                      <Text fontSize="10px" lineHeight="1.6" dangerouslySetInnerHTML={{ __html: inst.replace(/\*\*(.*?)\*\*/g, "<b>$1</b>").replace(/(Client ID|Client Secret|API Base URL|Active Connectors|Operational|Save|Search)/g, "<b>$&</b>") }} />
                    </Flex>
                  ))}
                </Stack>
              </Box>
              <Box bg="#f5f6f9" p="16px" borderLeft="1px solid" borderColor={ui.line} display="flex" alignItems="center" justifyContent="center">
                <Box w="200px">
                  <Panel p="12px" bg="white" transform="scale(0.85)" transformOrigin="top center">
                    <Text fontSize="7px" color={ui.muted} mb="6px">Preview</Text>
                    {["Connection name", "Workspace URL", "Client ID", "Client Secret"].map((f) => (
                      <Box key={f} mb="6px">
                        <Text fontSize="6px" color={ui.muted}>{f}</Text>
                        <Box h="16px" bg={ui.soft} borderRadius="3px" border="1px solid" borderColor={ui.line} />
                      </Box>
                    ))}
                    <Flex mt="8px" gap="4px" justify="end">
                      <Box px="8px" py="3px" bg={ui.soft} borderRadius="3px" fontSize="6px">Test</Box>
                      <Box px="8px" py="3px" bg={ui.violet} color="white" borderRadius="3px" fontSize="6px">Save</Box>
                    </Flex>
                  </Panel>
                  <Text mt="12px" fontSize="8px" color={ui.violet} textAlign="center" cursor="pointer">Click to enlarge</Text>
                </Box>
              </Box>
            </Grid>
            <Flex p="12px" borderTop="1px solid" borderColor={ui.line} justify="center" align="center" gap="8px">
              <Button variant="ghost" size="xs" isDisabled={setupStep <= 1} onClick={() => setSetupStep((s) => s - 1)}>‹</Button>
              {wizardSteps.map((s) => (
                <Box key={s.num} w="8px" h="8px" rounded="full" bg={s.num === setupStep ? ui.violet : ui.line} cursor="pointer" onClick={() => setSetupStep(s.num)} />
              ))}
              <Button variant="ghost" size="xs" isDisabled={setupStep >= 4} onClick={() => setSetupStep((s) => s + 1)}>›</Button>
            </Flex>
          </Panel>
        </Box>
      </Grid>
    </Box>
  );
}

function App() {
  const [route, setRoute] = useState(() =>
    routeFromPath(window.location.pathname),
  );
  useEffect(() => {
    const onPopState = () => setRoute(routeFromPath(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const setView = (view, detailId) => {
    let path;
    if (view === "investigationDetail")
      path = `/investigations/${encodeURIComponent(detailId || "INV-4819")}`;
    else if (view === "threatIntelDetail")
      path = `/threat-intel/${encodeURIComponent(detailId || "TIR-001")}`;
    else if (view === "detectionRuleDetail")
      path = `/detect/rules/${encodeURIComponent(detailId || "RULE-001")}`;
    else if (view === "skillDetail") path = `/skills/${encodeURIComponent(detailId)}`;
    else path = pathForView[view] || "/";
    if (window.location.pathname !== path)
      window.history.pushState({}, "", path);
    setRoute(routeFromPath(path));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const { view, investigationId, reportId, ruleId, skillId } = route;
  const pages = {
    queue: <QueueDashboard setView={setView} />,
    investigations: <InvestigationQueue setView={setView} />,
    investigationDetail: <InvestigationCase key={investigationId} id={investigationId} />,
    detect: <DetectionRegistry setView={setView} templates={catalogRules} />,
    detectionIntelligence: <DetectionIntelligence setView={setView} />,
    detectionRuleDetail: <Box p={{ base: "12px", md: "20px" }}><RuleWorkspace key={ruleId} id={ruleId} standalone onClose={() => setView("detect")} onChanged={() => {}} onSelect={id => setView("detectionRuleDetail", id)} /></Box>,
    respond: <RespondCenter setView={setView} />,
    hunt: <HuntDashboard setView={setView} />,
    threatIntel: <ThreatIntelDashboard setView={setView} />,
    threatIntelDetail: <ThreatIntelReportDetail id={reportId} setView={setView} />,
    memory: <MemoryCenter setView={setView} />,
    connector: <ConnectorSetupLive setView={setView} />,
    apiSources: <ApiSources setView={setView} />,
    skills: <SkillsLibrary setView={setView} />,
    skillTemplates: <SkillsLibrary setView={setView} templatesView />,
    skillSuggestions: <SkillsLibrary setView={setView} suggestions />,
    skillOutcomes: <SkillsOutcomes setView={setView} />,
    skillCreate: <SkillEditor setView={setView} />,
    skillDetail: <SkillEditor key={skillId} id={skillId} setView={setView} />,
  };
  const crumbs = {
    queue: ["Respond", "Operations Queue"],
    investigations: ["Investigate", "Investigations Dashboard"],
    investigationDetail: [
      "Investigate",
      "Investigation detail",
    ],
    detect: ["Detect", "Detection Rules"],
    detectionIntelligence: ["Detect", "Detection Intelligence"],
    detectionRuleDetail: ["Detect", "Detection Rule Detail"],
    respond: ["Respond", "Response Center"],
    hunt: ["Hunt", "Hunt Dashboard"],
    threatIntel: ["Threat Intel", "Threat Intelligence"],
    threatIntelDetail: ["Threat Intel", "Report Detail"],
    memory: ["Memory", "Investigation Memory"],
    connector: ["Configuration", "Log Connectors › Cribl"],
    apiSources: ["Build", "API Sources"],
    skills: ["Skills", "Library"], skillTemplates: ["Skills", "Starter templates"], skillSuggestions: ["Skills", "Environment suggestions"], skillOutcomes: ["Skills", "Outcomes"], skillCreate: ["Skills", "Create skill"], skillDetail: ["Skills", "Skill details"],
  };
  return (
    <Shell view={view} setView={setView} breadcrumb={crumbs[view]}>
      {pages[view]}
    </Shell>
  );
}

const reactRoot = import.meta.hot?.data.reactRoot || createRoot(document.getElementById("root"));
if (import.meta.hot) import.meta.hot.dispose(data => { data.reactRoot = reactRoot; });
reactRoot.render(
  <ChakraProvider theme={theme}>
    <AuthGate><App /></AuthGate>
  </ChakraProvider>,
);
