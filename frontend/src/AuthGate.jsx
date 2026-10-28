import React, { useEffect, useState } from "react";
import { Alert, AlertIcon, Box, Button, Flex, FormControl, FormLabel, Heading, Input, Stack, Text } from "@chakra-ui/react";
import { api } from "./api";
import { ui } from "./theme";

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
    const expired = () => { api.setSession(null); setSession({ mode: "token", authenticated: false }); setError("Your session ended. Sign in again."); };
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
  const logout = async () => {
    setBusy(true);
    try { await api.request("/auth/logout", { method: "POST" }); accept({ mode: "token", authenticated: false }); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  if (loading) return <Box p="40px" role="status">Checking workspace session…</Box>;
  if (session?.authenticated) return <>
    {session.mode === "token" && <Flex px="18px" py="6px" bg="#e9edf3" align="center" gap="12px"><Text fontSize="11px">Workspace: <b>{session.tenant_id}</b> · {session.operator_id}</Text><Button ml="auto" size="xs" variant="ghost" isLoading={busy} onClick={logout}>Sign out</Button></Flex>}
    {error && <Alert status="error"><AlertIcon />{error}</Alert>}
    {children}
  </>;
  return <Flex minH="100vh" align="center" justify="center" p="24px" bg={ui.nav}>
    <Box as="form" onSubmit={login} bg="white" p={{ base: "24px", md: "40px" }} maxW="460px" w="100%" rounded="8px">
      <Text color={ui.muted} fontSize="10px" letterSpacing=".12em">SECURITY OPERATIONS</Text><Heading fontSize="26px" mt="10px">Sign in to your workspace</Heading><Text color={ui.muted} mt="12px" mb="24px">Use your operator access token. Your credential determines which workspace you can access.</Text>
      <Stack spacing="16px"><FormControl isRequired><FormLabel>Operator access token</FormLabel><Input type="password" autoComplete="off" spellCheck={false} value={token} onChange={e => setToken(e.target.value)} maxLength={256} /></FormControl>
        {error && <Alert status="error"><AlertIcon />{error}</Alert>}
        <Button type="submit" isLoading={busy} isDisabled={!token.trim()}>Sign in</Button>
        {!session && <Button variant="outline" onClick={() => { setError(""); setVersion(v => v + 1); }}>Retry connection</Button>}
      </Stack>
    </Box>
  </Flex>;
}
