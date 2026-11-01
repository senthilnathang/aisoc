import React, { useEffect, useState } from "react";
import { Alert, AlertIcon, Box, Button, Flex, FormControl, FormLabel, Heading, Input, Stack, Text } from "@chakra-ui/react";
import { api } from "./api";
import { ui } from "./theme";
import NotificationCenter from "./NotificationCenter";

export default function AuthGate({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const accept = value => { api.setSession(value); setSession(value); };
  useEffect(() => {
    let active = true;
    const expired = () => { api.setSession(null); setSession(previous => ({ ...previous, authenticated: false })); setError("Your session ended. Sign in again."); };
    window.addEventListener("aisoc:unauthenticated", expired);
    setLoading(true);
    api.request("/auth/session").then(value => { if (active) accept(value); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; window.removeEventListener("aisoc:unauthenticated", expired); };
  }, [version]);
  const login = async event => {
    event.preventDefault(); setBusy(true); setError("");
    try { accept(await api.request("/auth/login", { method: "POST", headers: { Authorization: `Bearer ${token.trim()}` } })); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); setToken(""); }
  };
  const logout = async (all = false) => {
    setBusy(true);
    try { await api.request(all ? "/auth/logout-all" : "/auth/logout", { method: "POST" }); accept({ mode: session.mode, sso_enabled: session.sso_enabled, authenticated: false }); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  if (loading) return <Box p="40px" role="status">Checking workspace session…</Box>;
  if (session?.authenticated) return <>
    {<Flex px="18px" py="6px" bg="#e9edf3" align="center" gap="12px" wrap="wrap"><Text fontSize="11px">Workspace: <b>{session.tenant_id}</b> · {session.operator_id} · {(session.roles||[]).join(" / ") || "no approval-workflow roles"}</Text><Box ml="auto"><NotificationCenter operatorId={session.operator_id} tenantId={session.tenant_id}/></Box><Button size="xs" variant="ghost" isLoading={busy} onClick={session.mode === "local" ? () => setSession({mode:"token",authenticated:false}) : () => logout()}>{session.mode === "local" ? "Sign in as operator" : "Sign out"}</Button>{session.mode === "oidc" && <Button size="xs" variant="ghost" isLoading={busy} onClick={() => logout(true)}>Sign out all sessions</Button>}</Flex>}
    {error && <Alert status="error"><AlertIcon />{error}</Alert>}
    {children}
  </>;
  return <Flex minH="100vh" align="center" justify="center" p="24px" bg={ui.nav}>
    <Box as="form" onSubmit={login} bg="white" p={{ base: "24px", md: "40px" }} maxW="460px" w="100%" rounded="8px">
      <Text color={ui.muted} fontSize="10px" letterSpacing=".12em">SECURITY OPERATIONS</Text><Heading fontSize="26px" mt="10px">Sign in to your workspace</Heading><Text color={ui.muted} mt="12px" mb="24px">{session?.sso_enabled ? "Sign in with your configured identity provider. Your approved identity mapping determines workspace access." : "Use your operator access token. Your credential determines which workspace you can access."}</Text>
      <Stack spacing="16px">{!session?.sso_enabled && <FormControl isRequired><FormLabel>Operator access token</FormLabel><Input type="password" autoComplete="off" spellCheck={false} value={token} onChange={e => setToken(e.target.value)} maxLength={256} /></FormControl>}
        {error && <Alert status="error"><AlertIcon />{error}</Alert>}
        {session?.sso_enabled ? <Button as="a" href="/api/v1/auth/oidc/start">Sign in with SSO</Button> : <Button type="submit" isLoading={busy} isDisabled={!token.trim()}>Sign in</Button>}
        {!session && <Button variant="outline" onClick={() => { setError(""); setVersion(v => v + 1); }}>Retry connection</Button>}
      </Stack>
    </Box>
  </Flex>;
}
