import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Badge,
  Box,
  Button,
  ChakraProvider,
  Divider,
  Flex,
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

const nav = ["Detect", "Investigate", "Respond", "Hunt", "Memory", "Build"];
const viewForNav = {
  Detect: "detect",
  Investigate: "investigations",
  Respond: "respond",
  Hunt: "hunt",
  Memory: "memory",
  Build: "connector",
};
const navIsActive = (item, view) =>
  view === viewForNav[item] || (item === "Respond" && view === "queue");

const pathForView = {
  queue: "/",
  detect: "/detect/rules",
  investigations: "/investigations",
  respond: "/respond",
  hunt: "/hunt",
  memory: "/memory",
  connector: "/build/connectors/cribl",
};

function routeFromPath(pathname) {
  const detail = pathname.match(/^\/investigations\/([^/]+)$/);
  if (detail)
    return {
      view: "investigationDetail",
      investigationId: decodeURIComponent(detail[1]),
    };
  const matched = Object.entries(pathForView).find(
    ([, path]) => path === pathname,
  );
  return { view: matched?.[0] || "queue", investigationId: null };
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
        <Box position="relative" fontSize="13px">
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

function QueueDashboard({ setView }) {
  const [dashboard, setDashboard] = useState({
    queueItems: 8,
    openInvestigations: 3,
    openRemediations: 5,
  });
  useEffect(() => {
    let active = true;
    api
      .dashboard()
      .then((result) => active && setDashboard(result))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return (
    <Box className="page-enter" px="15px" pb="14px">
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
              ],
              [
                "Google Threat Intelligence",
                "Click, Install, Compromise: The New Wave of Zoom-Themed Attacks",
                "SUSPICIOUS",
              ],
              [
                "Google Threat Intelligence",
                "UNC1549 — Aerospace Harvest",
                "MITIGATED",
              ],
            ].map(([source, title, status]) => (
              <Box key={title}>
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
          <Flex align="center" justify="space-around">
            <Donut />
            <Box>
              <Text fontSize="8px" color={ui.muted}>
                Total alerts
              </Text>
              <Text className="metric-number" fontSize="31px">
                6,119
              </Text>
            </Box>
          </Flex>
        </Panel>
        <Panel p="18px">
          <Flex align="center" justify="space-around">
            <Donut workload />
            <Box>
              <Text fontSize="8px" color={ui.muted}>
                Deflected
              </Text>
              <Text className="metric-number" fontSize="31px">
                96%
              </Text>
            </Box>
          </Flex>
        </Panel>
      </Grid>
    </Box>
  );
}

function InvestigationDetail({ id }) {
  const [tab, setTab] = useState("Summary");
  const [investigation, setInvestigation] = useState(null);
  const [replaying, setReplaying] = useState(false);
  const toast = useToast();
  const tabs = ["Summary", "Artifacts", "Transcript", "I/O", "Debug"];
  useEffect(() => {
    let active = true;
    api
      .investigation(id || "INV-4819")
      .then((result) => active && setInvestigation(result))
      .catch(() => {});
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
        <ArtifactView tab={tab} />
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
  return (
    <Box maxW="465px" mx="auto" mt="25px">
      <Flex justify="end">
        <Button variant="outline">Expand all</Button>
      </Flex>
      <Stack mt="14px" spacing="14px">
        {[
          "Determine whether Setu.exe is benign or malicious by correlating reputation, signing, process, credential-access, network-transfer, containment, and fleet-prevalence evidence.",
          "Correlate the alert with process execution, network activity, and infrastructure reputation.",
          "Confirm browser credential access, compare file and outbound byte counts, and verify endpoint containment.",
          "Resolve the Python packaging lead, determine fleet prevalence, and check certificate reuse.",
        ].map((t, i) => (
          <Box
            key={t}
            borderLeft="1px solid"
            borderColor={i ? ui.ink : ui.violet}
            pl="14px"
          >
            <Text fontSize="8px" fontWeight="600">
              {t}
            </Text>
            {i === 0 && (
              <>
                <Text mt="8px" fontSize="7px" color={ui.muted}>
                  THOUGHT
                </Text>
                <Text mt="5px" fontSize="8px">
                  I will pivot to process-scoped behavior and verify whether
                  credential access was followed by an outbound transfer.
                </Text>
                {[
                  "Check the Setu.exe SHA-256 in VirusTotal",
                  "Check the Setu.exe SHA-1 in VirusTotal",
                  "Search public sources for the exact SHA-256",
                ].map((q, n) => (
                  <Panel key={q} mt="7px" p="9px">
                    <Text fontSize="8px">
                      ▣ Query {n + 1}: {q}
                    </Text>
                  </Panel>
                ))}
              </>
            )}
          </Box>
        ))}
      </Stack>
      <Panel mt="15px" p="12px" borderColor="#8d939d">
        <Flex>
          <Box>
            <Label>Verdict</Label>
            <Text mt="7px" fontSize="8px">
              Malicious: Setu.exe accessed browser credential stores totaling
              180,224 bytes, then sent 184,320 bytes.
            </Text>
            <Text mt="7px" fontSize="8px">
              Confidence: high
            </Text>
          </Box>
          <Badge ml="auto" bg={ui.red} color="white">
            MALICIOUS
          </Badge>
        </Flex>
      </Panel>
    </Box>
  );
}
function ArtifactView({ tab }) {
  return (
    <Grid templateColumns={{ base: "1fr", lg: "1fr 268px" }} minH="500px">
      <Box p="25px 50px">
        <Heading fontSize="13px">{tab} evidence</Heading>
        <Text color={ui.muted} fontSize="8px" mt="5px">
          Credential-store access and outbound transfer on OKAMI-FIN-074
        </Text>
        <Stack mt="35px" spacing="13px">
          {[
            "Revoke all active sessions for nadia.solis@okami-ai.com",
            "Quarantine Setu.exe on OKAMI-FIN-074",
            "Reset the corporate password for nadia.solis@okami-ai.com",
            "Block the malicious domain releases.cloudgateway.cc",
          ].map((x) => (
            <Grid
              key={x}
              templateColumns="210px 1fr 100px 60px"
              borderBottom="1px solid"
              borderColor={ui.line}
              pb="10px"
            >
              <Text fontSize="8px" fontWeight="600">
                {x}
              </Text>
              <Text color={ui.muted} fontSize="8px">
                Automated response action generated from the investigation
                evidence.
              </Text>
              <Badge variant="outline">Microsoft Defender</Badge>
              <Text fontSize="7px">PENDING</Text>
            </Grid>
          ))}
        </Stack>
      </Box>
      <Box bg="white" borderLeft="1px solid" borderColor={ui.line}>
        <Box
          p="12px"
          borderBottom="1px solid"
          borderColor={ui.line}
          fontWeight="600"
        >
          Chat
        </Box>
        <Stack p="12px" spacing="14px">
          <Box ml="25px" p="12px" bg="#e8e6ff" fontSize="8px">
            <b>Contain the identity first</b>
            <Text mt="5px">
              1. Revoke Nadia Solis's active sessions.
              <br />
              2. Reset the corporate password.
              <br />
              3. Keep OKAMI-FIN-074 isolated.
            </Text>
          </Box>
          <Box p="12px" bg="#eeeaff" fontSize="8px">
            File cleanup cannot invalidate credentials or sessions that may
            already be exposed, so identity containment comes first.
          </Box>
        </Stack>
        <Input
          position="absolute"
          bottom="10px"
          w="240px"
          ml="12px"
          placeholder="Type your question here..."
        />
      </Box>
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
function DetectionRules() {
  const [query, setQuery] = useState("");
  const [remoteRules, setRemoteRules] = useState(null);
  const [toggling, setToggling] = useState(null);
  useEffect(() => {
    let active = true;
    api
      .detectionRules()
      .then((result) => active && setRemoteRules(result.items))
      .catch(() => {});
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
    } finally {
      setToggling(null);
    }
  };
  return (
    <Box className="page-enter">
      <HStack px="15px" mb="12px" spacing="8px">
        <Panel w="135px" p="15px" textAlign="center">
          <Text fontSize="8px">Registry Rules</Text>
          <Text className="metric-number" fontSize="31px" whiteSpace="nowrap">
            200
          </Text>
        </Panel>
        <Panel w="135px" p="15px" textAlign="center">
          <Text fontSize="8px">Triggered Alerts</Text>
          <Text className="metric-number" fontSize="31px" whiteSpace="nowrap">
            7,534
          </Text>
        </Panel>
        <Panel w="135px" p="15px" textAlign="center">
          <Text fontSize="8px">MITRE Coverage</Text>
          <Text className="metric-number" fontSize="31px" whiteSpace="nowrap">
            78%
          </Text>
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
        <Button variant="ghost" ml="8px">
          ⚑ Filters
        </Button>
        <Button ml="auto">Create new Detection Rule</Button>
      </Flex>
      <Box bg="white">
        <HStack h="29px" px="18px" borderY="1px solid" borderColor={ui.line}>
          <Button
            variant="unstyled"
            borderBottom="2px solid"
            borderColor={ui.ink}
          >
            Detection Rules
          </Button>
          <Button variant="unstyled">Catalog</Button>
        </HStack>
        <TableContainer className="thin-scroll">
          <Table size="sm">
            <Thead>
              <Tr>
                {[
                  "Name",
                  "MITRE",
                  "Execution",
                  "Status",
                  "Detections",
                  "Investigations",
                  "FPR",
                  "AI recommendations",
                  "Severity",
                  "Activity",
                ].map((h) => (
                  <Th key={h} fontSize="7px" color={ui.muted}>
                    {h} ☰
                  </Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {filtered.map((rule, i) => (
                <Tr key={rule.id} bg={i % 2 ? "#fff" : "#f8f8f9"}>
                  {rule.cells.map((v, n) => (
                    <Td
                      key={n}
                      py="11px"
                      fontSize="7px"
                      borderColor={ui.line}
                      color={n === 1 || n === 6 || n === 7 ? ui.ink : undefined}
                    >
                      {n === 8 ? (
                        <Badge
                          bg={
                            v === "HIGH"
                              ? ui.red
                              : v === "MEDIUM"
                                ? ui.amber
                                : ui.green
                          }
                          color="white"
                        >
                          {v}
                        </Badge>
                      ) : n === 6 ? (
                        <>
                          <Text>{v}</Text>
                          <Text color={ui.quiet} fontSize="6px">
                            High confidence
                          </Text>
                        </>
                      ) : n === 3 ? (
                        <Button
                          variant="ghost"
                          isLoading={toggling === rule.id}
                          onClick={() => toggleRule(rule)}
                          color={v === "Enabled" ? ui.green : ui.muted}
                        >
                          {v}
                        </Button>
                      ) : n === 2 ? (
                        <>
                          <Text>{v.split(" · ")[0]}</Text>
                          <Text fontSize="6px">▣ {v.split(" · ")[1]}</Text>
                        </>
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
      </Box>
    </Box>
  );
}

function HuntDashboard({ setView }) {
  const toast = useToast();
  const [huntQuery, setHuntQuery] = useState("");
  const [hunts, setHunts] = useState([]);
  const [runningHunt, setRunningHunt] = useState(false);
  useEffect(() => {
    let active = true;
    api
      .hunts()
      .then((result) => active && setHunts(result.items))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const runHunt = async () => {
    if (!huntQuery.trim()) {
      toast({
        title: "Enter a hunt question",
        status: "warning",
        duration: 2000,
      });
      return;
    }
    setRunningHunt(true);
    try {
      const created = await api.create("hunts", {
        name: huntQuery.trim().slice(0, 90),
        query: huntQuery.trim(),
        source: "ad_hoc",
      });
      const completed = await api.runHunt(created.id);
      setHunts((current) => [completed, ...current]);
      setHuntQuery("");
      toast({
        title: "Hunt completed",
        description: `${completed.findings_count} findings require review.`,
        status: "success",
        duration: 2500,
      });
    } catch (error) {
      toast({
        title: "Hunt failed",
        description: error.message,
        status: "error",
        duration: 3000,
      });
    } finally {
      setRunningHunt(false);
    }
  };
  return (
    <Box className="page-enter" px="15px">
      <Button variant="outline" mb="12px">
        ▣ Last 7 days
      </Button>
      <Grid
        templateColumns={{ base: "1fr", lg: "minmax(0,2.4fr) 1fr" }}
        gap="8px"
      >
        <Stack spacing="8px">
          <Panel>
            <Box p="10px" borderBottom="1px solid" borderColor={ui.line}>
              <Label>Hunt details</Label>
            </Box>
            <SimpleGrid columns={5} p="14px 26px">
              {[
                ["17", "Reports processed"],
                ["218", "IOC processed"],
                [String(27 + hunts.length), "Hunts"],
                ["3", "Findings"],
                ["2", "Hunts with findings"],
              ].map(([v, l]) => (
                <Metric key={l} value={v} label={l} size="30px" />
              ))}
            </SimpleGrid>
          </Panel>
          <Panel p="10px">
            <Flex justify="space-between">
              <Label>Hunt lifecycle</Label>
              <HStack>
                <Badge bg={ui.violet} color="white">
                  All
                </Badge>
                <Badge>Emerging</Badge>
                <Badge>Ad hoc</Badge>
              </HStack>
            </Flex>
            <HuntSankey />
          </Panel>
          <Panel>
            <Box p="10px" borderBottom="1px solid" borderColor={ui.line}>
              <Label>Ad hoc hunts</Label>
            </Box>
            <Flex p="12px" justify="space-between">
              <Text color={ui.violet} fontSize="8px">
                TH for CVE-2026-42897 — Microsoft Exchange Server XSS / Spoofing
                Vulnerability
              </Text>
              <Text fontSize="8px">Robert Kim · May 18, 2026</Text>
            </Flex>
          </Panel>
        </Stack>
        <Stack spacing="8px">
          <Panel p="10px">
            <Flex justify="space-between">
              <Label>Ad hoc hunt</Label>
              <Badge bg={ui.violet} color="white">
                Mode 1
              </Badge>
            </Flex>
            <HStack mt="12px">
              <Input
                placeholder="What do you want to search for?"
                value={huntQuery}
                onChange={(event) => setHuntQuery(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && runHunt()}
              />
              <Button isLoading={runningHunt} onClick={runHunt}>
                Run
              </Button>
            </HStack>
            <Text mt="12px" fontSize="7px" color={ui.muted}>
              MOST RECENT
            </Text>
            <Flex mt="5px">
              <Text fontSize="8px">
                {hunts[0]?.name || "TH for CVE-2026-42897"}
              </Text>
              <Text ml="auto" color={ui.violet}>
                View
              </Text>
            </Flex>
          </Panel>
          <Panel p="12px">
            <Flex justify="space-between">
              <Text fontWeight="600">Threat intel hunt quota</Text>
              <Text fontSize="7px">83 hunts remaining</Text>
            </Flex>
            <Text mt="8px">
              <b>17 /100</b> &nbsp; Monthly threat intelligence hunts
            </Text>
            <Box mt="7px" w="100%" h="4px" bg="#e7e8ed">
              <Box w="17%" h="full" bg={ui.violet} />
            </Box>
          </Panel>
          <Panel p="12px">
            <Label>7AI activity</Label>
            <Text mt="15px" fontSize="8px">
              <b>17 threat reports</b> ingested and reviewed
            </Text>
            <Text mt="12px" color={ui.violet} fontSize="8px">
              2 emerging threats identified in your environment
            </Text>
            <Text mt="12px" fontSize="8px">
              <b>218 IOCs</b> checked across 4 connectors
            </Text>
            <Button
              mt="14px"
              float="right"
              variant="outline"
              onClick={() => setView("investigations")}
            >
              View investigations
            </Button>
          </Panel>
          <Panel p="12px">
            <Label>Threat intelligence feeds</Label>
            <HStack mt="14px">
              <Badge bg={ui.amber}>G</Badge>
              <Box>
                <Text fontSize="8px" fontWeight="600">
                  Google Threat Intelligence
                </Text>
                <Text fontSize="7px" color={ui.muted}>
                  8 reports · 8 hunts
                </Text>
              </Box>
            </HStack>
            <HStack mt="12px">
              <Badge bg="#111827" color="white">
                7AI
              </Badge>
              <Box>
                <Text fontSize="8px" fontWeight="600">
                  7AI Threat Intelligence
                </Text>
                <Text fontSize="7px" color={ui.muted}>
                  9 reports · 9 hunts
                </Text>
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
];

function RespondCenter({ setView }) {
  const toast = useToast();
  const [items, setItems] = useState(fallbackRemediations);
  const [filter, setFilter] = useState("all");
  const [running, setRunning] = useState(null);

  useEffect(() => {
    let active = true;
    api
      .remediations()
      .then((result) => active && setItems(result.items))
      .catch(() => {});
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
          <Button isDisabled={!pending}>Execute approved</Button>
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
                    onClick={() => execute(item)}
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
      .catch(() => {});
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
  const selected =
    records.find((record) => record.id === selectedId) ||
    visible[0] ||
    records[0];

  return (
    <Box className="page-enter" px={{ base: "12px", md: "24px" }} pb="28px">
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
                onClick={() => setSelectedId(record.id)}
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

function ConnectorSetupLive() {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
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
    [
      "workspace_url",
      "Cribl Workspace URL *",
      "https://main-my-org-abc123.cribl.cloud",
    ],
    ["client_id", "Client ID *", "Client ID of a Cribl.Cloud API credential"],
    ["secret", "Client Secret *", "Client Secret for the same credential"],
    ["search_group", "Search Group", "default_search"],
    ["tags", "Tags", "Select tags..."],
  ];
  const submit = async () => {
    if (!form.name || !form.workspace_url || !form.client_id || !form.secret) {
      toast({
        title: "Complete all required fields",
        status: "warning",
        duration: 2500,
      });
      return;
    }
    setSaving(true);
    try {
      const connector = await api.createConnector({
        type: "cribl",
        name: form.name,
        description: form.description,
        workspace_url: form.workspace_url,
        client_id: form.client_id,
        secret: form.secret,
        config: {
          searchGroup: form.search_group,
          tags: form.tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        },
      });
      const tested = await api.testConnector(connector.id);
      toast({
        title: "Cribl connector added",
        description: `Connection status: ${tested.status}`,
        status: tested.status === "operational" ? "success" : "error",
        duration: 3000,
      });
    } catch (error) {
      toast({
        title: "Could not add connector",
        description: error.message,
        status: "error",
        duration: 3500,
      });
    } finally {
      setSaving(false);
    }
  };
  return (
    <Box className="page-enter" px="15px">
      <Flex justify="end" mb="12px">
        <Button variant="outline">Cancel</Button>
        <Button ml="5px" isLoading={saving} onClick={submit}>
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
            {fields.map(([key, label, placeholder]) => (
              <Box key={key}>
                <Text fontSize="7px" mb="3px">
                  {label}
                </Text>
                <Input
                  type={key === "secret" ? "password" : "text"}
                  placeholder={placeholder}
                  value={form[key]}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }))
                  }
                />
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
            <Box fontSize="9px" maxW="360px">
              <Text>
                1. Enter the <b>API Base URL</b> from your Cribl workspace.
              </Text>
              <Text mt="8px">
                2. Enter the <b>Client ID</b> and <b>Client Secret</b> for a
                Cribl.Cloud API credential.
              </Text>
              <Text mt="8px">
                3. Click <b>Add connector</b>. 7AI saves and tests the
                connection.
              </Text>
              <Text mt="8px">
                4. Operational connections become available to search and
                remediation workflows.
              </Text>
            </Box>
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
  const setView = (view, investigationId) => {
    const path =
      view === "investigationDetail"
        ? `/investigations/${encodeURIComponent(investigationId || "INV-4819")}`
        : pathForView[view] || "/";
    if (window.location.pathname !== path)
      window.history.pushState({}, "", path);
    setRoute(routeFromPath(path));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const { view, investigationId } = route;
  const pages = {
    queue: <QueueDashboard setView={setView} />,
    investigations: <InvestigationsDashboard setView={setView} />,
    investigationDetail: <InvestigationDetail id={investigationId} />,
    detect: <DetectionRules />,
    respond: <RespondCenter setView={setView} />,
    hunt: <HuntDashboard setView={setView} />,
    memory: <MemoryCenter setView={setView} />,
    connector: <ConnectorSetupLive />,
  };
  const crumbs = {
    queue: ["Respond", "Operations Queue"],
    investigations: ["Investigate", "Investigations Dashboard"],
    investigationDetail: [
      "Investigate",
      "Credential-store access and outbound transfer",
    ],
    detect: ["Detect", "Detection Rules"],
    respond: ["Respond", "Response Center"],
    hunt: ["Hunt", "Hunt Dashboard"],
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
