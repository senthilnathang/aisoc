import RecordsTable from "./components/RecordsTable";
import WorkspaceHeader from "./WorkspaceHeader";
import React, { useEffect, useRef, useState } from "react";
import { Badge, Box, Button, Flex, Heading, HStack, Input, Select, Stack, Switch, Text } from "@chakra-ui/react";
import { api } from "./api";
import { ui } from "./theme";

export default function SkillsRegistry({ setView }) {
  const [search, setSearch] = useState(""), [state, setState] = useState(""), [module, setModule] = useState(""), [origin, setOrigin] = useState("custom"), [offset, setOffset] = useState(0), [limit, setLimit] = useState(25);
  const [data, setData] = useState(null), [error, setError] = useState(""), [actionError, setActionError] = useState(""), [loading, setLoading] = useState(true), [revision, refresh] = useState(0), [pending, setPending] = useState(""), [help, setHelp] = useState(false);
  const active = useRef(false), upload = useRef(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    let current = true; setLoading(true); setError("");
    api.list("skills/library", { search, state: state || undefined, module: module || undefined, origin, limit, offset }).then(result => { if (current) { setData(result); if (offset > 0 && offset >= result.total) setOffset(0); } }).catch(e => { if (current) { setError(e.message); setData(null); } }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [search, state, module, origin, offset, limit, revision]);
  const filter = setter => value => { setter(value); setOffset(0); };
  const toggle = async skill => {
    setPending(skill.id); setActionError("");
    try { await api.request(`/skills/${encodeURIComponent(skill.id)}/enabled`, { method: "PUT", body: { expected_version: skill.version, enabled: !skill.enabled } }); if (active.current) refresh(x => x + 1); }
    catch (e) { if (active.current) setActionError(e.message); }
    finally { if (active.current) setPending(""); }
  };
  const importFile = async e => {
    const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
    try {
      if (!/\.(md|markdown|txt)$/i.test(file.name) || file.size > 100000) throw new Error("Choose a Markdown or TXT file up to 100 KB.");
      const content = await file.text(); if (content.length > 30000 || content.includes("\0")) throw new Error("Instructions must contain at most 30,000 characters and no NUL bytes.");
      if (!content.trim()) throw new Error("The skill file is empty.");
      const draft = { name: file.name.replace(/\.[^.]+$/, "").slice(0,200), content_markdown: content };
      if (active.current) { sessionStorage.setItem("aisoc-skill-template", JSON.stringify(draft)); setView("skillCreate"); }
    } catch (e) { setActionError(e.message); }
  };
  const items = data?.items || [];
  return <Box p={{ base: "12px", md: "24px" }} className="skills-page skills-library">
    <WorkspaceHeader><Box><Heading as="h1">Skills</Heading><Text mt="8px" color={ui.muted}>Manage reusable investigation guidance, review its scope, and control where it applies.</Text></Box></WorkspaceHeader>
    <Flex borderBottom="1px solid" borderColor={ui.line} gap="24px" mb="16px">
      {[["custom", "My Custom Skills"], ["augmented", "My Augmented Skills"]].map(([key,label]) => <Button key={key} aria-pressed={origin===key} variant="ghost" borderRadius="0" borderBottom={origin === key ? "2px solid" : "2px solid transparent"} borderColor={origin === key ? ui.ink : "transparent"} onClick={() => filter(setOrigin)(key)}>{label}</Button>)}
    </Flex>
    <Flex gap="8px" wrap="wrap" align="center" mb="16px">
      <Input aria-label="Search skills" placeholder="Search skills" maxW={{ base: "full", md: "280px" }} value={search} onChange={e => filter(setSearch)(e.target.value)} />
      <Select aria-label="Skill state" maxW="150px" value={state} onChange={e => filter(setState)(e.target.value)}><option value="">All states</option><option value="draft">Draft</option><option value="published">Published</option></Select>
      <Select aria-label="Skill module" maxW="180px" value={module} onChange={e => filter(setModule)(e.target.value)}><option value="">All modules</option>{["investigations","hunting","detection","response","enterprise_insights"].map(x => <option key={x} value={x}>{x.replaceAll("_"," ")}</option>)}</Select>
      <Button variant="outline" onClick={() => setHelp(!help)}>How Skills work</Button>
      <HStack ml={{ md: "auto" }}><input ref={upload} type="file" accept=".md,.markdown,.txt" aria-label="Upload skill file" hidden onChange={importFile} /><Button variant="outline" onClick={() => upload.current.click()}>Upload skill</Button><Button bg={ui.ink} color="white" _hover={{ bg: "#30343b" }} onClick={() => setView("skillCreate")}>＋ Create skill</Button></HStack>
    </Flex>
    {help && <Box bg="white" border="1px solid" borderColor={ui.line} p="16px" mb="16px"><Text fontWeight="600">Guidance for your analysts</Text><Text mt="6px">Save instructions, references and relevance rules. Published, enabled skills can match cases and hunts; matched guidance is recorded for analyst review. It does not run response actions. Upload imports a text draft for review before saving.</Text><Text mt="6px">Augmented skills come from reviewed environment patterns. Review suggestions to create a draft.</Text><Button mt="8px" variant="outline" onClick={() => setView("skillSuggestions")}>Review environment suggestions</Button></Box>}
    {actionError && <Box role="alert" p="12px" mb="12px" bg="red.50" color="red.700">{actionError} <Button size="xs" onClick={() => { setActionError(""); refresh(x => x + 1); }}>Reload library</Button></Box>}
    <Box bg="white" border="1px solid" borderColor={ui.line} borderRadius="6px" overflow="hidden">
      <RecordsTable
        caption="Skills library" recordLabel="skills" pageSizeLabel="Skills per page"
        records={items} total={data?.total || 0} offset={offset} limit={limit}
        onPageChange={setOffset} onPageSizeChange={filter(setLimit)}
        loading={loading} loadingLabel="Loading skills…" error={error}
        onRetry={() => refresh(x => x + 1)} paginationDisabled={Boolean(pending)}
        emptyContent={<Stack align="center"><Text fontWeight="600">No skills match this view</Text><Text color={ui.muted}>{origin === "augmented" ? "Review environment suggestions to create an augmented draft." : "Create a skill, upload instructions, or start from a template."}</Text><Button variant="outline" onClick={() => setView(origin === "augmented" ? "skillSuggestions" : "skillTemplates")}>{origin === "augmented" ? "Review suggestions" : "Browse templates"}</Button></Stack>}
        columns={[
          { id: "name", header: "Name", minWidth: "240px", render: s => <><Button variant="link" color={ui.ink} textAlign="left" whiteSpace="normal" onClick={() => setView("skillDetail",s.id)}>{s.name}</Button><Text fontSize="11px" color={ui.muted} mt="4px">{s.origin === "environment_generated" ? "From reviewed cases" : s.origin === "user" ? s.created_by : "Built-in guidance"}</Text>{s.learning_archived?<Badge mt="6px">Archived</Badge>:s.learning_current===false?<Badge mt="6px" colorScheme="orange">Source review required</Badge>:null}{s.staged_edit&&<Badge mt="6px" ml="6px" colorScheme="blue">Staged edits</Badge>}</> },
          { id: "skill_type", header: "Type", render: s => <><Badge>{s.skill_type}</Badge></> },
          { id: "modules", header: "Module", render: s => <><Flex gap="4px" wrap="wrap" maxW="260px">{(s.modules?.length ? s.modules : ["All modules"]).map(m => <Badge key={m}>{m.replaceAll("_"," ")}</Badge>)}</Flex></> },
          { id: "state", header: "State", render: s => <>{s.state === "draft" ? <><Badge colorScheme="blue">Draft</Badge><Text fontSize="10px" color={ui.muted}>Publish to enable</Text></> : <HStack><Switch aria-label={`Enable ${s.name}`} colorScheme="green" isChecked={s.enabled} isDisabled={Boolean(pending) || s.learning_archived || s.learning_current === false} onChange={() => toggle(s)} /><Text fontSize="11px">{s.enabled ? "On" : "Off"}</Text></HStack>}</> },
          { id: "updated_at", header: "Last updated", render: s => <>{new Date(s.updated_at).toLocaleDateString()}</> }
        ]}
      />
      {!loading && data && !error && <Text p="12px" fontSize="12px">{`${data.total} skills · ${data.published} published · ${data.drafts} drafts in this view`}</Text>}
    </Box>
  </Box>;
}
