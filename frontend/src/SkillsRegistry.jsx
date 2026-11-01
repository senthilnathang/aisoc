import React, { useEffect, useRef, useState } from "react";
import { Badge, Box, Button, Flex, HStack, Input, Select, Stack, Switch, Table, TableContainer, Tbody, Td, Text, Th, Thead, Tr } from "@chakra-ui/react";
import { api } from "./api";
import { ui } from "./theme";

export default function SkillsRegistry({ setView }) {
  const [search, setSearch] = useState(""), [state, setState] = useState(""), [module, setModule] = useState(""), [origin, setOrigin] = useState("custom"), [offset, setOffset] = useState(0);
  const [data, setData] = useState(null), [error, setError] = useState(""), [loading, setLoading] = useState(true), [revision, refresh] = useState(0), [pending, setPending] = useState(""), [help, setHelp] = useState(false);
  const active = useRef(false), upload = useRef(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    let current = true; setLoading(true); setError("");
    api.list("skills/library", { search, state: state || undefined, module: module || undefined, origin, limit: 25, offset }).then(result => { if (current) setData(result); }).catch(e => { if (current) { setError(e.message); setData(null); } }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [search, state, module, origin, offset, revision]);
  const filter = setter => value => { setter(value); setOffset(0); };
  const toggle = async skill => {
    setPending(skill.id); setError("");
    try { await api.request(`/skills/${encodeURIComponent(skill.id)}/enabled`, { method: "PUT", body: { expected_version: skill.version, enabled: !skill.enabled } }); if (active.current) refresh(x => x + 1); }
    catch (e) { if (active.current) setError(e.message); }
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
    } catch (e) { setError(e.message); }
  };
  const items = data?.items || [];
  return <Box p={{ base: "12px", md: "24px" }} className="skills-page skills-library">
    <Flex borderBottom="1px solid" borderColor={ui.line} gap="24px" mb="16px">
      {[["custom", "My Custom Skills"], ["augmented", "My Augmented Skills"]].map(([key,label]) => <Button key={key} variant="ghost" borderRadius="0" borderBottom={origin === key ? "2px solid" : "2px solid transparent"} borderColor={origin === key ? ui.ink : "transparent"} onClick={() => filter(setOrigin)(key)}>{label}</Button>)}
    </Flex>
    <Flex gap="8px" wrap="wrap" align="center" mb="16px">
      <Input aria-label="Search skills" placeholder="Search skills" maxW={{ base: "full", md: "280px" }} value={search} onChange={e => filter(setSearch)(e.target.value)} />
      <Select aria-label="Skill state" maxW="150px" value={state} onChange={e => filter(setState)(e.target.value)}><option value="">All states</option><option value="draft">Draft</option><option value="published">Published</option></Select>
      <Select aria-label="Skill module" maxW="180px" value={module} onChange={e => filter(setModule)(e.target.value)}><option value="">All modules</option>{["investigations","hunting","detection","response","enterprise_insights"].map(x => <option key={x} value={x}>{x.replaceAll("_"," ")}</option>)}</Select>
      <Button variant="outline" onClick={() => setHelp(!help)}>How Skills work</Button>
      <HStack ml={{ md: "auto" }}><input ref={upload} type="file" accept=".md,.markdown,.txt" aria-label="Upload skill file" hidden onChange={importFile} /><Button variant="outline" onClick={() => upload.current.click()}>Upload skill</Button><Button bg={ui.ink} color="white" _hover={{ bg: "#30343b" }} onClick={() => setView("skillCreate")}>＋ Create skill</Button></HStack>
    </Flex>
    {help && <Box bg="white" border="1px solid" borderColor={ui.line} p="16px" mb="16px"><Text fontWeight="600">Guidance for your analysts</Text><Text mt="6px">Save instructions, references and relevance rules. Published, enabled skills can match cases and hunts; matched guidance is recorded for analyst review. It does not run response actions. Upload imports a text draft for review before saving.</Text><Text mt="6px">Augmented skills come from reviewed environment patterns. Review suggestions to create a draft.</Text><Button mt="8px" variant="outline" onClick={() => setView("skillSuggestions")}>Review environment suggestions</Button></Box>}
    {error && <Box role="alert" p="12px" mb="12px" bg="red.50" color="red.700">{error} <Button size="xs" onClick={() => refresh(x => x + 1)}>Reload library</Button></Box>}
    <Box bg="white" border="1px solid" borderColor={ui.line} borderRadius="6px" overflow="hidden">
      {loading ? <Text p="24px">Loading skills…</Text> : !error && !items.length ? <Stack p="36px" align="center"><Text fontWeight="600">No skills match this view</Text><Text color={ui.muted}>{origin === "augmented" ? "Review environment suggestions to create an augmented draft." : "Create a skill, upload instructions, or start from a template."}</Text><Button variant="outline" onClick={() => setView(origin === "augmented" ? "skillSuggestions" : "skillTemplates")}>{origin === "augmented" ? "Review suggestions" : "Browse templates"}</Button></Stack> : <TableContainer><Table size="sm"><Thead><Tr>{["Name","Type","Module","State","Last updated"].map(x => <Th key={x} py="16px">{x}</Th>)}</Tr></Thead><Tbody>{items.map(s => <Tr key={s.id} _hover={{ bg: ui.soft }}><Td py="18px" maxW="420px" whiteSpace="normal"><Button variant="link" color={ui.ink} textAlign="left" whiteSpace="normal" onClick={() => setView("skillDetail",s.id)}>{s.name}</Button><Text fontSize="11px" color={ui.muted} mt="4px">{s.origin === "environment_generated" ? "From reviewed cases" : s.origin === "user" ? s.created_by : "Built-in guidance"}</Text></Td><Td><Badge>{s.skill_type}</Badge></Td><Td><Flex gap="4px" wrap="wrap" maxW="260px">{(s.modules?.length ? s.modules : ["All modules"]).map(m => <Badge key={m}>{m.replaceAll("_"," ")}</Badge>)}</Flex></Td><Td>{s.state === "draft" ? <><Badge colorScheme="blue">Draft</Badge><Text fontSize="10px" color={ui.muted}>Publish to enable</Text></> : <HStack><Switch aria-label={`Enable ${s.name}`} colorScheme="green" isChecked={s.enabled} isDisabled={Boolean(pending)} onChange={() => toggle(s)} /><Text fontSize="11px">{s.enabled ? "On" : "Off"}</Text></HStack>}</Td><Td>{new Date(s.updated_at).toLocaleDateString()}</Td></Tr>)}</Tbody></Table></TableContainer>}
      <Flex p="12px" bg={ui.soft} justify="space-between" align="center" gap="8px" wrap="wrap"><Text fontSize="12px">{data ? `${data.total} skills · ${data.published} published · ${data.drafts} drafts in this view` : "—"}</Text><HStack><Button size="sm" variant="outline" isDisabled={loading || offset === 0} onClick={() => setOffset(Math.max(0,offset-25))}>Previous</Button><Text fontSize="12px">Page {Math.floor(offset/25)+1}</Text><Button size="sm" variant="outline" isDisabled={loading || !data || offset+25 >= data.total} onClick={() => setOffset(offset+25)}>Next</Button></HStack></Flex>
    </Box>
  </Box>;
}
