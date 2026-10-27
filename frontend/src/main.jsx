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
import "./app.css";

const nav = ["Detect", "Investigate", "Respond", "Hunt", "Threat Intel", "Memory", "Build"];
const viewForNav = {
  Detect: "detect",
  Investigate: "investigations",
  Respond: "respond",
  Hunt: "hunt",
  "Threat Intel": "threatIntel",
  Memory: "memory",
  Build: "connector",
};
const navIsActive = (item, view) =>
  view === viewForNav[item] ||
  (item === "Respond" && view === "queue") ||
  (item === "Detect" && view === "detectionRuleDetail") ||
  (item === "Threat Intel" && view === "threatIntelDetail");

const pathForView = {
  queue: "/",
  detect: "/detect/rules",
  investigations: "/investigations",
  respond: "/respond",
  hunt: "/hunt",
  threatIntel: "/threat-intel",
  memory: "/memory",
  connector: "/build/connectors/cribl",
};

function routeFromPath(pathname) {
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
    >
      7AI
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
      <Box w="32px">
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
          Enterprise Demo⌄
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
          fontSize="13px"
          role="img"
          aria-label="Notifications"
        >
          ♧
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
          w="23px"
          h="23px"
          rounded="full"
          bg="#d8dbe2"
          color="#606876"
          align="center"
          justify="center"
        >
          ●
        </Flex>
        <Box className="hide-mobile">
          <Text fontSize="9px">Walter Abeson</Text>
          <Text color="#8c929f" fontSize="7px">
            7AI
          </Text>
        </Box>
        <Text>⌄</Text>
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
      <Text color={ui.violet}>✣</Text>
      <Text>＋</Text>
      <Text>⌁</Text>
      <Text>↟</Text>
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
      <Text>{section}</Text>
      <Text>›</Text>
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
          ＋ {dashboard.openInvestigations} open cases
        </Badge>
        <Badge ml="8px" bg="white" color={ui.ink}>
          ⚒ {dashboard.openRemediations} open remediations
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
                {i === 1 ? "7AI" : i === 2 ? "CS" : "AZ"}
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
                [ui.steel, "7AI Auto"],
                ["#687488", "7AI PLAID Elite"],
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
                "7AI Threat Intelligence",
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
                    7AI
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
          ◉ &nbsp;{title}
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
    ["7AI", 947],
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
        <Button variant="outline">▣ Last 7 days</Button>
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
              {[["Microsoft Defender", "1,780", "29.1%", "#2563eb"], ["SentinelOne", "1,285", "21%", "#7c3aed"], ["7AI", "947", "15.5%", "#111827"], ["CrowdStrike", "851", "13.9%", ui.red], ["Microsoft Sentinel", "726", "11.9%", "#0ea5e9"], ["Remaining sources", "530", "8.7%", ui.steel]].map(([name, count, pct, color]) => (
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

function InvestigationDetail({ id }) {
  const [tab, setTab] = useState("Summary");
  const [investigation, setInvestigation] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const toast = useToast();
  const tabs = ["Summary", "Artifacts", "Transcript", "I/O", "Debug"];
  useEffect(() => {
    let active = true;
    api
      .investigation(id || "INV-4819")
      .then((result) => active && setInvestigation(result))
      .catch(() => active && setLoadFailed(true));
    return () => {
      active = false;
    };
  }, [id]);
  const reinvestigate = async () => {
    setReplaying(true);
    try {
      const updated = await api.reinvestigate(id || "INV-4819");
      setInvestigation((current) => ({ ...current, ...updated }));
      toast({
        title: "Reinvestigation started",
        description: `${updated.id} is back in triage.`,
        status: "success",
        duration: 2500,
      });
    } catch (error) {
      toast({
        title: "Could not reinvestigate",
        description: error.message,
        status: "error",
        duration: 3000,
      });
    } finally {
      setReplaying(false);
    }
  };
  return (
    <Box className="page-enter">
      {loadFailed && (
        <Box px="15px" pt="8px">
          <SampleDataNotice show />
        </Box>
      )}
      <Flex px="15px" py="8px" bg="#f5f6f9" align="center">
        <InputGroup w="140px">
          <InputLeftElement>⌕</InputLeftElement>
          <Input placeholder="Press F to search" bg="white" />
        </InputGroup>
        <HStack ml="auto">
          <Button variant="outline">☰ Investigation History</Button>
          <Button variant="outline">⌁ Add Feedback⌄</Button>
          <Button
            variant="outline"
            isLoading={replaying}
            onClick={reinvestigate}
          >
            ▷ Reinvestigate
          </Button>
          <Button variant="outline">◐ {investigation?.status || "Open"}</Button>
        </HStack>
      </Flex>
      <Flex
        px="15px"
        h="28px"
        bg="white"
        borderY="1px solid"
        borderColor={ui.line}
      >
        {tabs.map((t) => (
          <Button
            key={t}
            variant="unstyled"
            h="28px"
            px="8px"
            borderRadius="0"
            borderBottom="2px solid"
            borderColor={tab === t ? ui.ink : "transparent"}
            fontSize="8px"
            onClick={() => setTab(t)}
          >
            {t}
          </Button>
        ))}
        <Button ml="auto" variant="unstyled" fontSize="8px">
          ▣ Open Chat⌄
        </Button>
      </Flex>
      {tab === "Summary" ? (
        <SummaryView investigation={investigation} />
      ) : tab === "Transcript" ? (
        <TranscriptView />
      ) : (
        <ArtifactView tab={tab} investigation={investigation} />
      )}
    </Box>
  );
}
function SummaryView({ investigation }) {
  return (
    <Grid
      templateColumns={{ base: "1fr", lg: "245px 1fr" }}
      maxW="820px"
      mx="auto"
      mt="26px"
      gap="20px"
    >
      <Box borderRight="1px solid" borderColor={ui.line} pr="15px">
        <Text fontSize="8px">◷ Oct 21, 2026 at 7:52:30 PM EDT</Text>
        <HStack mt="14px">
          <Badge bg="#111827" color="white">
            7AI
          </Badge>
          <Text fontSize="8px">High</Text>
        </HStack>
        <Badge mt="8px" variant="outline" color={ui.violet}>
          IDENTITY
        </Badge>
        <Text mt="8px" fontSize="9px" fontWeight="600" lineHeight="1.45">
          maya.santos@okami-ai.com signed in from an anonymized Astana, KZ
          address 27 minutes after a normal Quezon City, PH sign-in.
        </Text>
        <Stack mt="70px" spacing="8px">
          <Label>Compromised account</Label>
          <Text color={ui.violet} fontSize="8px">
            maya.santos@okami-ai.com
          </Text>
          <Label>Adversary sign-in IP</Label>
          <Text color={ui.violet} fontSize="8px">
            192.0.2.160 (Astana, KZ)
          </Text>
          <Label>Baseline sign-in location</Label>
          <Text color={ui.violet} fontSize="8px">
            198.51.100.54 (Quezon City, PH)
          </Text>
        </Stack>
      </Box>
      <Box>
        <Flex align="start">
          <Flex
            w="38px"
            h="38px"
            rounded="full"
            bg={ui.red}
            color="white"
            align="center"
            justify="center"
            fontSize="18px"
          >
            ◉
          </Flex>
          <Box ml="12px">
            <Heading fontSize="14px">
              {investigation?.title ||
                "Risk-Backed Impossible Travel - Entra ID"}
            </Heading>
            <Text color={ui.muted} fontSize="8px" mt="5px">
              {investigation?.summary ||
                "Impossible-travel sign-ins for maya.santos@okami-ai.com from Philippines and Kazakhstan."}
            </Text>
          </Box>
          <Badge ml="auto" bg={ui.red} color="white">
            MALICIOUS
          </Badge>
        </Flex>
        <Text mt="20px" fontSize="9px" lineHeight="1.55">
          maya.santos@okami-ai.com signed in successfully from 198.51.100.54
          (Quezon City, PH) at 2026-08-07 08:47:21 UTC on a managed Windows 11
          device, then again from 192.0.2.160 (Astana, KZ) 20 minutes later on
          an unmanaged, non-compliant device.
        </Text>
        <Box mt="12px" p="9px" bg="#e7eef4" fontSize="8px" fontWeight="600">
          Malicious: treat as identity compromise. Revoke sessions and tokens,
          reset credentials, and scope all Kazakhstan-session activity
          immediately.
        </Box>
        <Stack mt="28px" spacing="15px">
          {[
            [
              "8c03d86a-e487-41b0-8866-b249599a6c38",
              "Unmanaged, non-compliant device; distinct correlation",
            ],
            [
              "singleFactorAuthentication",
              "Two fresh resultType 50158 challenge failures",
            ],
            ["Astana, KZ", "OfficeHomeChrome 152.0 versus Outlook Web"],
          ].map(([t, d]) => (
            <HStack key={t}>
              <Flex
                w="27px"
                h="27px"
                rounded="full"
                bg={ui.red}
                color="white"
                align="center"
                justify="center"
              >
                ◇
              </Flex>
              <Box>
                <Text color="#bd3946" fontSize="8px">
                  {t}
                </Text>
                <Text fontSize="8px" mt="3px">
                  ♡ {d}
                </Text>
              </Box>
            </HStack>
          ))}
        </Stack>
      </Box>
    </Grid>
  );
}
function TranscriptView() {
  const [expanded, setExpanded] = useState({ 0: true });
  const toggleStep = (i) => setExpanded((c) => ({ ...c, [i]: !c[i] }));
  const steps = [
    {
      title: "Determine whether Setu.exe is benign or malicious by correlating reputation, signing, process, credential-access, network-transfer, containment, and fleet-prevalence evidence.",
      thought: "I will not treat zero antivirus detections or a trusted signature as proof of safety. I will first establish what reputation knows, then pivot to process-scoped behavior and verify whether credential access was followed by an outbound transfer.",
      queries: [
        { text: "Check the Setu.exe SHA-256 in VirusTotal", rows: "1 row", time: "0.35s", ok: true },
        { text: "Check the Setu.exe SHA-1 in VirusTotal", rows: "1 row", time: "0.38s", ok: true },
        { text: "Search public sources for the exact SHA-256", rows: "1 row", time: "0.29s", ok: true },
      ],
      conclusion: "Reputation was unknown, but process-scoped endpoint evidence proved Setu.exe accessed browser credential stores totaling 180,224 bytes and then sent 184,320 bytes to a malicious domain.",
    },
    {
      title: "Correlate the alert with process execution, network activity, and infrastructure reputation.",
      thought: "I need to verify the outbound connection target and check if releases.cloudgateway.cc is a known C2 domain. Cross-referencing with threat intelligence feeds.",
      queries: [
        { text: "Query network connections from Setu.exe PID 4812", rows: "3 rows", time: "0.42s", ok: true },
        { text: "Check releases.cloudgateway.cc in threat intel databases", rows: "1 row", time: "0.31s", ok: true },
      ],
      badges: ["▣", "▣"],
    },
    {
      title: "Confirm browser credential access, compare file and outbound byte counts, and verify endpoint containment.",
      thought: "The file-read byte count (180,224) and outbound transfer (184,320) are close enough to confirm credential exfiltration. The 4,096 byte difference accounts for HTTP/TLS overhead.",
      queries: [
        { text: "Enumerate file reads by Setu.exe on credential stores", rows: "6 rows", time: "0.55s", ok: true },
        { text: "Verify endpoint isolation status for OKAMI-FIN-074", rows: "1 row", time: "0.19s", ok: true },
      ],
      badges: ["▣"],
    },
    {
      title: "Resolve the Python packaging lead, determine fleet prevalence, and check certificate reuse.",
      thought: "Checking if the Setu.exe binary has appeared elsewhere on the fleet and verifying the signing certificate's validity period and issuer chain.",
      queries: [
        { text: "Search for Setu.exe hash across fleet endpoints", rows: "1 row", time: "0.67s", ok: true },
        { text: "Extract and validate the signing certificate chain", rows: "1 row", time: "0.28s", ok: true },
      ],
      badges: ["▣"],
    },
  ];
  return (
    <Box maxW="520px" mx="auto" mt="25px" pb="40px">
      <Flex justify="end" mb="4px">
        <Text fontSize="7px" color={ui.muted} mr="8px" mt="6px">:</Text>
        <Button variant="outline" onClick={() => setExpanded(steps.reduce((a, _, i) => ({ ...a, [i]: true }), {}))}>Expand all</Button>
      </Flex>
      <Stack mt="14px" spacing="0">
        {steps.map((step, i) => (
          <Box key={i} borderLeft="2px solid" borderColor={i === 0 ? ui.violet : ui.ink} pl="16px" pb="18px" position="relative">
            <Box position="absolute" left="-5px" top="0" w="8px" h="8px" rounded="full" bg={i === 0 ? ui.violet : ui.ink} />
            <Flex align="center" cursor="pointer" onClick={() => toggleStep(i)}>
              <Text fontSize="9px" fontWeight="600" flex="1" lineHeight="1.45">{step.title}</Text>
              <HStack ml="8px" flexShrink={0} spacing="4px">
                {step.badges && step.badges.map((b, bi) => <Badge key={bi} bg={ui.violet} color="white" fontSize="7px">{b}</Badge>)}
                <Badge variant="outline" fontSize="7px">Query {step.queries.length}</Badge>
                <Text fontSize="9px" color={ui.muted}>{expanded[i] ? "▾" : "▸"}</Text>
              </HStack>
            </Flex>
            {expanded[i] && (
              <Box mt="10px">
                <Text fontSize="7px" color={ui.muted} fontWeight="600" letterSpacing=".04em">THOUGHT</Text>
                <Text mt="5px" fontSize="9px" color="#495064" fontStyle="italic" lineHeight="1.5">{step.thought}</Text>
                <Stack mt="10px" spacing="6px">
                  {step.queries.map((q, n) => (
                    <Panel key={n} p="10px" bg="#fafbfc" borderColor={ui.line}>
                      <Flex align="center" justify="space-between">
                        <HStack spacing="6px">
                          <Badge bg={ui.violet} color="white" fontSize="7px" w="18px" textAlign="center">{n + 1}</Badge>
                          <Text fontSize="9px">Query {n + 1}: {q.text}</Text>
                        </HStack>
                        <HStack spacing="8px" flexShrink={0}>
                          <Text fontSize="8px" color={ui.muted}>{q.rows}</Text>
                          <Text fontSize="8px" color={ui.muted}>{q.time}</Text>
                          {q.ok && <Text color={ui.green} fontSize="10px">✓</Text>}
                          <Text fontSize="9px" color={ui.muted}>›</Text>
                        </HStack>
                      </Flex>
                    </Panel>
                  ))}
                </Stack>
                {step.conclusion && (
                  <>
                    <Text mt="14px" fontSize="7px" color={ui.muted} fontWeight="600" letterSpacing=".04em">CONCLUSION</Text>
                    <Text mt="5px" fontSize="9px" lineHeight="1.5">{step.conclusion}</Text>
                  </>
                )}
              </Box>
            )}
          </Box>
        ))}
      </Stack>
      <Panel mt="18px" p="14px" borderColor="#8d939d" borderWidth="1px">
        <Flex justify="space-between" align="start">
          <Box>
            <Text fontSize="8px" fontWeight="700" letterSpacing=".04em" color={ui.muted}>VERDICT</Text>
            <Text mt="8px" fontSize="10px" lineHeight="1.5">
              Malicious: Setu.exe accessed browser credential stores totaling 180,224 bytes, then sent 184,320 bytes.
            </Text>
            <Text mt="6px" fontSize="9px" color={ui.muted}>Confidence: high</Text>
            <Text mt="6px" fontSize="9px" color={ui.violet} cursor="pointer">Show more</Text>
          </Box>
          <Badge bg={ui.red} color="white" flexShrink={0}>MALICIOUS</Badge>
        </Flex>
      </Panel>
    </Box>
  );
}
function ArtifactView({ tab, investigation }) {
  const toast = useToast();
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState([
    { role: "assistant", title: "Recommended containment order", body: "1. Revoke Nadia Solis's active sessions.\n2. Reset the corporate password and rotate credentials saved in Chrome, Edge, and Firefox.\n3. Keep OKAMI-FIN-074 isolated, quarantine the Setu.exe hash, and remove the extraction directory.\n4. Block releases.cloudgateway.cc in DNS, proxy, and endpoint controls.\n5. Report and monitor the short-lived signing certificate." },
    { role: "user", body: "Why not clean the file first or block the domain?" },
    { role: "assistant", body: "File cleanup cannot invalidate credentials or sessions that may already be exposed, so identity containment comes first.\n\nBlock releases.cloudgateway.cc only after you confirm 104.21.79.237. The IP is behind shared Cloudflare infrastructure; blocking it could disrupt unrelated services. Keep the endpoint isolated until credential rotation and malware cleanup are complete." },
  ]);
  const [showChat, setShowChat] = useState(true);
  const remediationActions = investigation?.remediations?.length ? investigation.remediations : [
    { id: "REM-001", title: "Revoke all active sessions for nadia.solis@okami-ai.com", description: "Setu.exe read Nadia Solis's Chrome, Edge, and Firefox credential stores and successfully exfiltrated data. Revoke active sessions immediately to terminate access obtained with stolen session material.", connector: "Microsoft Defender", status: "pending", primary_entity: "nadia.solis@okami-ai.com" },
    { id: "REM-002", title: "Quarantine Setu.exe on OKAMI-FIN-074", description: "Setu.exe read browser credential stores and exfiltrated data from OKAMI-FIN-074. Quarantine SHA-256 bc1563c1a977c92... while the host remains isolated.", connector: "Microsoft Defender", status: "pending", primary_entity: "OKAMI-FIN-074" },
    { id: "REM-003", title: "Reset the corporate password for nadia.solis@okami-ai.com", description: "Setu.exe accessed and exfiltrated browser credential stores belonging to Nadia Solis. Force a corporate password reset after session revocation to invalidate the exposed credential.", connector: "Microsoft Defender", status: "pending", primary_entity: "nadia.solis@okami-ai.com" },
    { id: "REM-004", title: "Block the malicious domain releases.cloudgateway.cc", description: "Setu.exe successfully exfiltrated data to releases.cloudgateway.cc. Block the malicious domain without blocking its benign shared Cloudflare IP 104.21.79.237.", connector: "Microsoft Defender", status: "pending", primary_entity: "releases.cloudgateway.cc" },
  ];
  const [actionStatuses, setActionStatuses] = useState({});
  const [executing, setExecuting] = useState(null);

  const executeAction = async (action) => {
    setExecuting(action.id);
    try {
      if (!action.id.startsWith("REM-0")) await api.executeRemediation(action.id);
      setActionStatuses((cur) => ({ ...cur, [action.id]: "completed" }));
      toast({ title: "Action executed", description: action.title, status: "success", duration: 2500 });
    } catch (error) {
      toast({ title: "Execution failed", description: error.message, status: "error", duration: 3000 });
    } finally {
      setExecuting(null);
    }
  };
  const executeAll = async () => {
    for (const action of remediationActions.filter((a) => (actionStatuses[a.id] || a.status) === "pending")) {
      await executeAction(action);
    }
  };
  const pendingCount = remediationActions.filter((a) => (actionStatuses[a.id] || a.status) === "pending").length;

  const handleChat = () => {
    if (!chatInput.trim()) return;
    setChatMessages((cur) => [...cur, { role: "user", body: chatInput.trim() }, { role: "assistant", body: "I'm reviewing the investigation evidence and will provide a response shortly. In the meantime, you can proceed with the recommended containment order above." }]);
    setChatInput("");
  };

  return (
    <Grid templateColumns={{ base: "1fr", lg: showChat ? "1fr 290px" : "1fr" }} minH="500px">
      <Box p="18px 30px">
        <Flex align="center" justify="space-between" mb="14px">
          <Box>
            <Heading fontSize="13px">{tab === "Artifacts" ? "Remediation" : tab} actions</Heading>
            <Text color={ui.muted} mt="3px">Credential-store access and outbound transfer on OKAMI-FIN-074</Text>
          </Box>
          <HStack>
            <Button variant="outline" onClick={() => toast({ title: "Audit log", description: "Audit trail for all actions", status: "info", duration: 2000 })}>◎ Audit Log</Button>
            <Button isDisabled={!pendingCount} onClick={executeAll}>✦ Execute {pendingCount} Action{pendingCount !== 1 ? "s" : ""}</Button>
          </HStack>
        </Flex>

        <TableContainer className="thin-scroll">
          <Table size="sm">
            <Thead>
              <Tr>
                {["Action", "Description", "Connector", "Status", ""].map((h) => (
                  <Th key={h} fontSize="7px" color={ui.muted}>{h}</Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {remediationActions.map((action) => {
                const status = actionStatuses[action.id] || action.status;
                return (
                  <Tr key={action.id} className="response-row">
                    <Td py="12px" borderColor={ui.line} maxW="240px">
                      <Text fontWeight="700" fontSize="8px">{action.title}</Text>
                      {action.primary_entity && <Text color={ui.violet} mt="2px" fontSize="7px">{action.primary_entity}</Text>}
                    </Td>
                    <Td py="12px" borderColor={ui.line} maxW="280px">
                      <Text color={ui.muted} fontSize="8px">{action.description}</Text>
                    </Td>
                    <Td py="12px" borderColor={ui.line}>
                      <Badge variant="outline">{action.connector || "7AI"}</Badge>
                    </Td>
                    <Td py="12px" borderColor={ui.line}>
                      <Text fontWeight="600" fontSize="7px" color={status === "completed" ? ui.green : ui.muted} textTransform="uppercase">{status}</Text>
                    </Td>
                    <Td py="12px" borderColor={ui.line}>
                      {status === "pending" ? (
                        <Button size="sm" isLoading={executing === action.id} onClick={() => executeAction(action)}>Execute</Button>
                      ) : (
                        <Text color={ui.green} fontWeight="700" fontSize="9px">✓</Text>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        </TableContainer>
      </Box>

      {showChat && (
        <Flex direction="column" bg="white" borderLeft="1px solid" borderColor={ui.line} position="relative" maxH="calc(100vh - 140px)">
          <Flex p="12px" borderBottom="1px solid" borderColor={ui.line} align="center" justify="space-between">
            <Text fontWeight="600">Chat</Text>
            <Button variant="ghost" size="xs" onClick={() => setShowChat(false)}>×</Button>
          </Flex>
          <Box flex="1" overflowY="auto" className="thin-scroll" p="12px">
            <Stack spacing="14px">
              {chatMessages.map((msg, i) => (
                <Box key={i} ml={msg.role === "user" ? "25px" : 0} p="12px" bg={msg.role === "user" ? "#f5f6f9" : "#e8e6ff"} borderRadius="6px" fontSize="8px">
                  {msg.title && <Text fontWeight="700" mb="5px">{msg.title}</Text>}
                  {msg.body.split("\n").map((line, j) => <Text key={j} mt={j ? "3px" : 0}>{line}</Text>)}
                  {msg.role === "assistant" && <Text color={ui.quiet} mt="6px" fontSize="7px">{i === 0 ? "Jul 5, 7:59 PM EDT" : ""}</Text>}
                </Box>
              ))}
            </Stack>
          </Box>
          <Flex p="10px" borderTop="1px solid" borderColor={ui.line} gap="6px">
            <Input size="sm" placeholder="Type your question here…" value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleChat()} />
            <Button size="sm" onClick={handleChat}>↑</Button>
          </Flex>
        </Flex>
      )}
      {!showChat && (
        <Button position="fixed" bottom="20px" right="20px" onClick={() => setShowChat(true)} borderRadius="full" w="44px" h="44px">💬</Button>
      )}
    </Grid>
  );
}

const rules = [
  [
    "7AI - CRXfiltrate Browser Domain and Path Match",
    "2 techniques",
    "Scheduled · 7AI SIEM",
    "837",
    "193",
    "26%",
    "Validated",
    "HIGH",
    "Last alert today",
  ],
  [
    "7AI - Impossible Travel",
    "5 techniques",
    "Scheduled · 7AI SIEM",
    "200",
    "170",
    "45%",
    "Not analyzed",
    "MEDIUM",
    "Last alert 3 days ago",
  ],
  [
    "7AI - Suspicious PowerShell EncodedCommand",
    "T1059.001 (PowerShell)",
    "Scheduled · 7AI SIEM",
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
    "7AI - Remote Logon → LOLBin Execution",
    "5 techniques",
    "Realtime · 7AI SIEM",
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
    "7AI - Auth From Endpoint With Active Finding",
    "3 techniques",
    "Realtime · 7AI SIEM",
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
function DetectionRules({ setView }) {
  const [query, setQuery] = useState("");
  const [remoteRules, setRemoteRules] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [toggling, setToggling] = useState(null);
  const toast = useToast();
  useEffect(() => {
    let active = true;
    api
      .detectionRules()
      .then((result) => active && setRemoteRules(result.items))
      .catch(() => active && setLoadFailed(true));
    return () => {
      active = false;
    };
  }, []);
  const tableRows = remoteRules
    ? remoteRules.map((rule) => ({
        id: rule.id,
        cells: [
          rule.name,
          rule.mitre_techniques?.join(", ") || "No techniques",
          `${rule.execution_mode || "scheduled"} · 7AI SIEM`,
          rule.enabled ? "Enabled" : "Disabled",
          String(rule.detections || 0),
          String(rule.investigations || 0),
          `${rule.false_positive_rate || 0}%`,
          rule.recommendation_status?.replaceAll("_", " ") || "Not analyzed",
          String(rule.severity || "medium").toUpperCase(),
          rule.last_activity_at
            ? new Date(rule.last_activity_at).toLocaleDateString()
            : "No activity",
        ],
      }))
    : rules.map((cells, index) => ({
        id: `fixture-${index}`,
        cells: [cells[0], cells[1], cells[2], "Enabled", ...cells.slice(3)],
      }));
  const filtered = tableRows.filter((rule) =>
    rule.cells.join(" ").toLowerCase().includes(query.toLowerCase()),
  );
  const toggleRule = async (rule) => {
    if (rule.id.startsWith("fixture-")) return;
    setToggling(rule.id);
    try {
      const updated = await api.toggleDetectionRule(rule.id);
      setRemoteRules((current) =>
        current.map((item) => (item.id === rule.id ? updated : item)),
      );
    } catch (error) {
      toast({
        title: "Could not change rule status",
        description: error.message,
        status: "error",
        duration: 3000,
      });
    } finally {
      setToggling(null);
    }
  };
  const totalRules = remoteRules ? remoteRules.length : 200;
  const totalDetections = remoteRules ? remoteRules.reduce((s, r) => s + (r.detections || 0), 0) : 7534;
  const mitreCoverage = "78%";
  return (
    <Flex className="page-enter">
      {/* Detection Assistant sidebar */}
      <Box
        className="hide-mobile"
        position="sticky"
        top="48px"
        alignSelf="flex-start"
        w="28px"
        minH="calc(100vh - 94px)"
        bg="#f8f9fb"
        borderRight="1px solid"
        borderColor={ui.line}
        display="flex"
        alignItems="center"
        justifyContent="center"
        css={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
      >
        <Text fontSize="8px" color={ui.quiet} fontWeight="600" letterSpacing=".06em" textTransform="uppercase">
          Detection Assistant
        </Text>
      </Box>
      <Box flex="1">
        <SampleDataNotice show={loadFailed} />
        <HStack px="15px" mb="12px" spacing="8px">
          <Panel w="135px" p="15px" textAlign="center">
            <Text fontSize="8px">Registry Rules</Text>
            <Text className="metric-number" fontSize="31px" whiteSpace="nowrap">{totalRules}</Text>
          </Panel>
          <Panel w="135px" p="15px" textAlign="center">
            <Text fontSize="8px">Triggered Alerts</Text>
            <Text className="metric-number" fontSize="31px" whiteSpace="nowrap">{totalDetections.toLocaleString()}</Text>
          </Panel>
          <Panel w="135px" p="15px" textAlign="center">
            <Text fontSize="8px">MITRE Coverage</Text>
            <Text className="metric-number" fontSize="31px" whiteSpace="nowrap">{mitreCoverage}</Text>
          </Panel>
        </HStack>
        <Flex px="15px" py="8px">
          <InputGroup w="145px">
            <InputLeftElement>⌕</InputLeftElement>
            <Input
              bg="white"
              placeholder="Search detection rules"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </InputGroup>
          <Button variant="ghost" ml="8px">⚑ Filters</Button>
          <Button ml="auto">Create new Detection Rule</Button>
        </Flex>
        <Box bg="white">
          <HStack h="29px" px="18px" borderY="1px solid" borderColor={ui.line}>
            <Button variant="unstyled" borderBottom="2px solid" borderColor={ui.ink}>Detection Rules</Button>
            <Button variant="unstyled">Catalog</Button>
          </HStack>
          <TableContainer className="thin-scroll">
            <Table size="sm">
              <Thead>
                <Tr>
                  {["Name", "MITRE", "Execution", "Status", "Detections", "Investigations", "FPR", "AI recommendations", "Severity", "Activity"].map((h) => (
                    <Th key={h} fontSize="7px" color={ui.muted}>{h} ☰</Th>
                  ))}
                </Tr>
              </Thead>
              <Tbody>
                {filtered.map((rule, i) => (
                  <Tr key={rule.id} bg={i % 2 ? "#fff" : "#f8f8f9"}>
                    {rule.cells.map((v, n) => (
                      <Td key={n} py="11px" fontSize="7px" borderColor={ui.line} color={n === 1 || n === 6 || n === 7 ? ui.ink : undefined}>
                        {n === 0 ? (
                          <Text color={ui.ink} cursor="pointer" fontWeight="500" _hover={{ color: ui.violet }} onClick={() => setView("detectionRuleDetail", rule.id)}>{v}</Text>
                        ) : n === 8 ? (
                          <Badge bg={v === "HIGH" ? ui.red : v === "MEDIUM" ? ui.amber : v === "LOW" ? ui.green : ui.steel} color="white">{v}</Badge>
                        ) : n === 6 ? (
                          <><Text>{v}</Text><Text color={ui.quiet} fontSize="6px">{parseInt(v) > 50 ? "Medium" : "High"} confidence</Text></>
                        ) : n === 3 ? (
                          <Button variant="ghost" isLoading={toggling === rule.id} onClick={() => toggleRule(rule)} color={v === "Enabled" ? ui.green : ui.muted}>{v}</Button>
                        ) : n === 2 ? (
                          <><Text>{v.split(" · ")[0]}</Text><Text fontSize="6px">▣ {v.split(" · ")[1]}</Text></>
                        ) : n === 7 && v.includes("recommendation") ? (
                          <Text color={ui.violet} cursor="pointer">{v}</Text>
                        ) : (
                          v
                        )}
                      </Td>
                    ))}
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </TableContainer>
          <Flex px="18px" py="10px" bg="#fafafa" borderTop="1px solid" borderColor={ui.line} align="center" justify="space-between">
            <Text fontSize="8px" color={ui.muted}>
              Showing 1 – {filtered.length} of {totalRules} Detection Rules
            </Text>
            <HStack spacing="4px">
              <Button variant="ghost" size="xs" isDisabled>‹</Button>
              <Button variant="solid" size="xs" w="24px" h="24px" p="0">1</Button>
              {totalRules > filtered.length && <Button variant="ghost" size="xs" w="24px" h="24px" p="0">2</Button>}
              <Button variant="ghost" size="xs">›</Button>
            </HStack>
          </Flex>
        </Box>
      </Box>
    </Flex>
  );
}

const fallbackRuleDetails = {
  "fixture-0": { id: "RULE-001", name: "7AI - CRXfiltrate Browser Domain and Path Match", description: "Detects outbound HTTP requests to known CRXfiltrate command-and-control domains with URI paths matching the exfiltration pattern used by malicious Chrome extensions. This rule correlates DNS resolution, TLS SNI, and HTTP path segments to identify active data theft from compromised browser extensions.", mitre_techniques: ["T1567.002", "T1185"], execution_mode: "Scheduled", source: "7AI SIEM", enabled: true, severity: "high", detections: 837, investigations: 193, false_positive_rate: 26, recommendation_status: "Validated", confidence: "High", last_activity_at: "2026-10-27T09:15:00Z", query: 'event.category:"network" AND destination.domain:("crxfiltrate.com" OR "ext-relay.crxfiltrate.com") AND url.path:/^\\/upload\\/[a-f0-9]{32}/', schedule: "Every 5 minutes", lookback_window: "15 minutes", created_by: "7AI Detection Engineering", created_at: "2026-03-12T10:00:00Z", updated_at: "2026-10-25T14:30:00Z", tags: ["browser-extension", "exfiltration", "C2"] },
  "fixture-1": { id: "RULE-002", name: "7AI - Impossible Travel", description: "Identifies user authentication events from geographically distant locations within a timeframe that makes physical travel impossible. Compares successive sign-in coordinates, factors in VPN usage, and checks device compliance to reduce false positives from legitimate remote access.", mitre_techniques: ["T1078", "T1078.004", "T1550.001", "T1538", "T1087"], execution_mode: "Scheduled", source: "7AI SIEM", enabled: true, severity: "medium", detections: 200, investigations: 170, false_positive_rate: 45, recommendation_status: "Not analyzed", confidence: "Medium", last_activity_at: "2026-10-24T16:42:00Z", query: 'event.category:"authentication" AND event.outcome:"success" | geoip(source.ip) | consecutive_logins_distance > 500km AND time_delta < 2h', schedule: "Every 15 minutes", lookback_window: "2 hours", created_by: "7AI Detection Engineering", created_at: "2026-01-08T09:00:00Z", updated_at: "2026-10-20T11:15:00Z", tags: ["identity", "travel", "account-compromise"] },
  "fixture-2": { id: "RULE-003", name: "7AI - Suspicious PowerShell EncodedCommand", description: "Detects PowerShell processes launched with -EncodedCommand or -enc parameters that decode to suspicious patterns including download cradles, reflection loading, AMSI bypasses, and credential access commands. Applies entropy analysis to the decoded payload.", mitre_techniques: ["T1059.001"], execution_mode: "Scheduled", source: "7AI SIEM", enabled: true, severity: "high", detections: 190, investigations: 153, false_positive_rate: 10, recommendation_status: "Validated", confidence: "High", last_activity_at: "2026-10-20T08:30:00Z", query: 'process.name:"powershell.exe" AND process.command_line:(/\\-[eE][nN][cC]/ OR "-EncodedCommand") | base64_decode(encoded_payload) | match_patterns(["IEX","Invoke-Expression","Net.WebClient","Reflection.Assembly"])', schedule: "Every 5 minutes", lookback_window: "10 minutes", created_by: "7AI Detection Engineering", created_at: "2026-02-15T14:00:00Z", updated_at: "2026-10-18T09:45:00Z", tags: ["powershell", "execution", "obfuscation"] },
  "fixture-3": { id: "RULE-004", name: "File Integrity Violations", description: "Monitors critical system files and registry keys for unauthorized modifications. Compares file hashes against known-good baselines and alerts on changes outside of approved maintenance windows.", mitre_techniques: ["T1565.001", "T1112"], execution_mode: "Scheduled", source: "Microsoft Defender", enabled: true, severity: "low", detections: 152, investigations: 129, false_positive_rate: 62, recommendation_status: "2 recommendations", confidence: "Medium", last_activity_at: "2026-10-21T07:00:00Z", query: 'event.category:"file" AND event.action:"modification" AND file.path:("C:\\\\Windows\\\\System32\\\\*" OR "C:\\\\Windows\\\\SysWOW64\\\\*") AND NOT process.name:("TrustedInstaller.exe" OR "msiexec.exe")', schedule: "Every 30 minutes", lookback_window: "1 hour", created_by: "SOC Team", created_at: "2026-04-01T10:00:00Z", updated_at: "2026-10-22T16:00:00Z", tags: ["integrity", "system-files", "persistence"] },
};

function DetectionRuleDetail({ id, setView }) {
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
        .then((result) => active && setRule(result))
        .catch(() => active && setLoadFailed(true));
    } else {
      setRule(fallbackRuleDetails[id] || fallbackRuleDetails["fixture-0"]);
    }
    return () => { active = false; };
  }, [id]);
  const toggleEnabled = async () => {
    if (!rule) return;
    if (id && !id.startsWith("fixture-")) {
      try {
        const updated = await api.toggleDetectionRule(id);
        setRule((c) => ({ ...c, ...updated }));
      } catch (e) { toast({ title: "Could not toggle rule", description: e.message, status: "error", duration: 3000 }); }
    } else {
      setRule((c) => ({ ...c, enabled: !c.enabled }));
    }
  };
  const saveRule = async () => {
    setSaving(true);
    try {
      if (id && !id.startsWith("fixture-")) {
        const updated = await api.update("detection-rules", id, rule);
        setRule((c) => ({ ...c, ...updated }));
      }
      toast({ title: "Rule saved", status: "success", duration: 2000 });
      setEditing(false);
    } catch (e) { toast({ title: "Could not save", description: e.message, status: "error", duration: 3000 }); }
    finally { setSaving(false); }
  };
  if (!rule) return <Box p="40px" textAlign="center"><Text color={ui.muted}>Loading rule...</Text></Box>;
  const sevColor = rule.severity === "high" || rule.severity === "critical" ? ui.red : rule.severity === "medium" ? ui.amber : ui.green;
  return (
    <Box className="page-enter">
      {loadFailed && <Box px="15px" pt="8px"><SampleDataNotice show /></Box>}
      <Flex px="15px" py="10px" bg="#f5f6f9" align="center" justify="space-between">
        <HStack>
          <Button variant="ghost" onClick={() => setView("detect")}>← Back to rules</Button>
          <Text fontWeight="600" fontSize="13px">{rule.name}</Text>
          <Badge bg={sevColor} color="white">{String(rule.severity).toUpperCase()}</Badge>
          <Badge bg={rule.enabled ? ui.green : ui.muted} color="white">{rule.enabled ? "Enabled" : "Disabled"}</Badge>
        </HStack>
        <HStack>
          <Button variant="outline" onClick={toggleEnabled}>{rule.enabled ? "Disable" : "Enable"}</Button>
          {editing ? (
            <>
              <Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
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
                      <option value="Scheduled">Scheduled</option>
                      <option value="Realtime">Realtime</option>
                    </Select>
                  ) : <Text fontSize="11px">{rule.execution_mode}</Text>}
                </FormControl>
                <FormControl>
                  <FormLabel fontSize="8px" color={ui.muted}>Data source</FormLabel>
                  <Text fontSize="11px">▣ {rule.source}</Text>
                </FormControl>
                <FormControl>
                  <FormLabel fontSize="8px" color={ui.muted}>Schedule</FormLabel>
                  <Text fontSize="11px">{rule.schedule || "Every 5 minutes"}</Text>
                </FormControl>
                <FormControl>
                  <FormLabel fontSize="8px" color={ui.muted}>Lookback window</FormLabel>
                  <Text fontSize="11px">{rule.lookback_window || "15 minutes"}</Text>
                </FormControl>
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
              {rule.query || "No query defined"}
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
              {[
                { date: "Oct 27, 2026", event: "Alert triggered", detail: "Matched 3 events from endpoint OKAMI-WS-142", severity: "high" },
                { date: "Oct 25, 2026", event: "Rule updated", detail: "Tuning: added exclusion for internal staging domains", severity: "info" },
                { date: "Oct 23, 2026", event: "Alert triggered", detail: "Matched 7 events from endpoint PLAID-DC-001", severity: "high" },
                { date: "Oct 20, 2026", event: "AI validation", detail: "Rule logic validated — no false-positive tuning recommended", severity: "success" },
                { date: "Oct 18, 2026", event: "Alert triggered", detail: "Matched 2 events from endpoint OKAMI-FIN-074", severity: "medium" },
                { date: "Oct 12, 2026", event: "Rule created", detail: `Initial deployment by ${rule.created_by}`, severity: "info" },
              ].map((entry, i) => (
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
  const [hunts, setHunts] = useState([]);
  const [runningHunt, setRunningHunt] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [huntMode, setHuntMode] = useState("mode1");
  const [lifecycleFilter, setLifecycleFilter] = useState("all");
  const fallbackHunts = [
    { id: "HUNT-001", name: "TH for CVE-2026-42897 — Exchange Server XSS", query: "CVE-2026-42897", source: "threat_intel", status: "completed", verdict: "review_required", findings_count: 3, author: "Robert Kim", updated_at: "2026-05-18T14:22:00Z" },
    { id: "HUNT-002", name: "Lumma Stealer C2 beacon detection", query: "lumma stealer", source: "threat_intel", status: "completed", verdict: "review_required", findings_count: 5, author: "7AI Engine", updated_at: "2026-05-17T09:15:00Z" },
    { id: "HUNT-003", name: "APT42 phishing infrastructure overlap", query: "APT42 phishing", source: "threat_intel", status: "completed", verdict: "no_findings", findings_count: 0, author: "Maria Santos", updated_at: "2026-05-16T11:40:00Z" },
    { id: "HUNT-004", name: "Black Basta lateral movement patterns", query: "Black Basta", source: "ad_hoc", status: "completed", verdict: "review_required", findings_count: 2, author: "James Chen", updated_at: "2026-05-15T16:30:00Z" },
    { id: "HUNT-005", name: "Cobalt Strike malleable C2 profiles", query: "cobalt strike C2", source: "ad_hoc", status: "completed", verdict: "no_findings", findings_count: 0, author: "Robert Kim", updated_at: "2026-05-14T08:55:00Z" },
    { id: "HUNT-006", name: "UNC1549 MINIBIKE/MINIBUS backdoor hunt", query: "UNC1549", source: "threat_intel", status: "completed", verdict: "review_required", findings_count: 1, author: "7AI Engine", updated_at: "2026-05-13T13:20:00Z" },
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
      const created = await api.create("hunts", { name: huntQuery.trim().slice(0, 90), query: huntQuery.trim(), source: "ad_hoc" });
      const completed = await api.runHunt(created.id);
      setHunts((current) => [completed, ...current]);
      setHuntQuery("");
      toast({ title: "Hunt completed", description: `${completed.findings_count} findings require review.`, status: "success", duration: 2500 });
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
        <Button variant="outline">▣ Last 7 days</Button>
        <Button variant="outline">▣ Last 30 days</Button>
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
                    {["Name", "Author", "Last Updated", "Findings", "Verdict"].map((h) => (
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
            <Label>7AI activity</Label>
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
              <Badge bg="#111827" color="white">7AI</Badge>
              <Box>
                <Text fontSize="8px" fontWeight="600">7AI Threat Intelligence</Text>
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
          <Button isDisabled={!pending} onClick={() => setConfirmItem({ id: "__bulk__", title: `all ${pending} pending actions`, connector: "multiple connectors" })}>✦ Execute {pending} Action{pending !== 1 ? "s" : ""}</Button>
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
                  {item.connector || "7AI"}
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
              {confirmItem?.connector || "7AI"}. Identity and endpoint changes
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
          <InputLeftElement h="34px">⌕</InputLeftElement>
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
  { id: "TIR-001", title: "CRXfiltrate — Remote-Controlled Manifest V3 Browser Extensions", source: "7AI Threat Intelligence", report_type: "threat_report", severity: "critical", status: "actionable", ioc_count: 12, hunt_status: "completed", hunts_launched: 2, findings_count: 3, tags: ["browser", "extension", "exfiltration"], published_at: "2026-10-22T14:30:00Z" },
  { id: "TIR-002", title: "APT42 — Gov Phishing Wave", source: "7AI Threat Intelligence", report_type: "advisory", severity: "high", status: "actionable", ioc_count: 8, hunt_status: "completed", hunts_launched: 1, findings_count: 1, tags: ["apt", "phishing", "government"], published_at: "2026-10-21T09:15:00Z" },
  { id: "TIR-003", title: "Click, Install, Compromise: The New Wave of Zoom-Themed Attacks", source: "Google Threat Intelligence", report_type: "threat_report", severity: "high", status: "reviewing", ioc_count: 6, hunt_status: "hunting", hunts_launched: 1, findings_count: 0, tags: ["social-engineering", "zoom", "malware"], published_at: "2026-10-20T16:45:00Z" },
  { id: "TIR-004", title: "UNC1549 — Aerospace Harvest", source: "Google Threat Intelligence", report_type: "advisory", severity: "medium", status: "archived", ioc_count: 4, hunt_status: "completed", hunts_launched: 1, findings_count: 0, tags: ["apt", "aerospace", "espionage"], published_at: "2026-10-18T11:00:00Z" },
  { id: "TIR-005", title: "Lumma Stealer C2 Infrastructure Update", source: "7AI Threat Intelligence", report_type: "ioc_feed", severity: "critical", status: "actionable", ioc_count: 15, hunt_status: "completed", hunts_launched: 3, findings_count: 2, tags: ["stealer", "c2", "infrastructure"], published_at: "2026-10-17T08:20:00Z" },
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
          <Button variant="outline">▣ Last 30 days</Button>
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
                  <Badge bg={source.includes("7AI") ? "#111827" : source.includes("Google") ? ui.amber : ui.steel} color="white" fontSize="9px">
                    {source.includes("7AI") ? "7AI" : source.includes("Google") ? "G" : source.slice(0, 2).toUpperCase()}
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
    <Box className="page-enter">
      {loadFailed && <Box px="15px" pt="8px"><SampleDataNotice show /></Box>}
      <Flex px="15px" py="8px" bg="#f5f6f9" align="center" wrap="wrap" gap="8px">
        <Button variant="ghost" onClick={() => setView("threatIntel")}>← Back to feed</Button>
        <HStack ml="auto">
          <Badge bg={reportTypeBg(report.report_type)} color="white">{reportTypeLabel(report.report_type)}</Badge>
          <Badge bg={report.severity === "critical" ? ui.red : report.severity === "high" ? ui.amber : ui.steel} color="white">{report.severity?.toUpperCase()}</Badge>
          <Button variant="outline" isLoading={launching} onClick={launchHunt}>
            {report.hunt_status === "hunting" ? "Hunting…" : report.hunt_status === "completed" ? "▷ Re-hunt" : "▷ Launch Hunt"}
          </Button>
        </HStack>
      </Flex>

      <Grid templateColumns={{ base: "1fr", lg: "280px 1fr" }} maxW="1100px" mx="auto" mt="26px" gap="24px" px="15px">
        <Box borderRight={{ base: "none", lg: "1px solid" }} borderColor={ui.line} pr={{ base: 0, lg: "18px" }}>
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

        <Box>
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
            Step 3: Enter Connection Information in 7AI
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
    { num: 3, title: "Enter Connection Information in 7AI", instructions: ["Enter the API Base URL from Step 2.", "Enter the Client ID and Client Secret from Step 1.", "Click Save.", "Once the credentials are accepted, the Cribl connector will appear in the Active Connectors section. After 5–10 minutes, a heartcheck will run automatically. If successful, the connector tile will display as Operational, confirming the installation was successful."] },
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
      toast({ title: "Cribl connector added", description: `Connection status: ${tested.status}`, status: tested.status === "operational" ? "success" : "error", duration: 3000 });
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
    else path = pathForView[view] || "/";
    if (window.location.pathname !== path)
      window.history.pushState({}, "", path);
    setRoute(routeFromPath(path));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const { view, investigationId, reportId, ruleId } = route;
  const pages = {
    queue: <QueueDashboard setView={setView} />,
    investigations: <InvestigationsDashboard setView={setView} />,
    investigationDetail: <InvestigationDetail id={investigationId} />,
    detect: <DetectionRules setView={setView} />,
    detectionRuleDetail: <DetectionRuleDetail id={ruleId} setView={setView} />,
    respond: <RespondCenter setView={setView} />,
    hunt: <HuntDashboard setView={setView} />,
    threatIntel: <ThreatIntelDashboard setView={setView} />,
    threatIntelDetail: <ThreatIntelReportDetail id={reportId} setView={setView} />,
    memory: <MemoryCenter setView={setView} />,
    connector: <ConnectorSetupLive setView={setView} />,
  };
  const crumbs = {
    queue: ["Respond", "Operations Queue"],
    investigations: ["Investigate", "Investigations Dashboard"],
    investigationDetail: [
      "Investigate",
      "Credential-store access and outbound transfer",
    ],
    detect: ["Detect", "Detection Rules"],
    detectionRuleDetail: ["Detect", "Detection Rule Detail"],
    respond: ["Respond", "Response Center"],
    hunt: ["Hunt", "Hunt Dashboard"],
    threatIntel: ["Threat Intel", "Threat Intelligence"],
    threatIntelDetail: ["Threat Intel", "Report Detail"],
    memory: ["Memory", "Investigation Memory"],
    connector: ["Configuration", "Log Connectors › Cribl"],
  };
  return (
    <Shell view={view} setView={setView} breadcrumb={crumbs[view]}>
      {pages[view]}
    </Shell>
  );
}

createRoot(document.getElementById("root")).render(
  <ChakraProvider theme={theme}>
    <App />
  </ChakraProvider>,
);
