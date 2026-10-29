import { test } from "node:test";
import assert from "node:assert/strict";
import { argumentsFor,target } from "./harness.mjs";

test("fixture writes reject active, remote, malformed and unapproved targets",async()=>{
  for(const url of ["http://localhost:3002","http://127.0.0.1:3002","http://localhost:8080","https://example.com","file:///tmp/test","http://user:password@localhost:3003","http://localhost:3003/api/v1","http://localhost:3003?unsafe=1"]) {
    await assert.rejects(()=>target({url,"allow-fixture-writes":true}));
  }
  await assert.rejects(()=>target({url:"http://localhost:3003"}));
});
test("explicit isolated loopback target requires no implicit backend startup",async()=>{
  const selected=await target({url:"http://127.0.0.1:3003","allow-fixture-writes":true});
  assert.equal(selected.url,"http://127.0.0.1:3003");assert.equal(selected.owned,false);
  await selected.close();
});
test("CLI parses named fixture options",()=>{
  assert.deepEqual(argumentsFor(["--url","http://localhost:3003","--allow-fixture-writes","--label","go"]),{url:"http://localhost:3003","allow-fixture-writes":true,label:"go"});
  assert.throws(()=>argumentsFor(["http://localhost:3003"]));
});
