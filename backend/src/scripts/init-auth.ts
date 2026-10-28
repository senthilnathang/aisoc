import { randomBytes, createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const directory = resolve(process.cwd(), "../.run/auth");
const credentialsPath = resolve(directory, "operators.json");
const tokenPath = resolve(directory, "operator-token");
if (existsSync(credentialsPath) || existsSync(tokenPath)) {
  throw new Error("Auth files already exist. Initialization will not overwrite or rotate existing credentials.");
}
mkdirSync(directory, { recursive: true, mode: 0o700 });
const token = `aisoc_op_${randomBytes(32).toString("base64url")}`;
const tenant = process.env.DEFAULT_TENANT_ID || "demo";
writeFileSync(tokenPath, `${token}\n`, { mode: 0o600, flag: "wx" });
writeFileSync(credentialsPath, JSON.stringify([{ id: "local-operator", tenant_id: tenant, token_hash: createHash("sha256").update(token).digest("hex") }], null, 2) + "\n", { mode: 0o600, flag: "wx" });
console.log(`Authentication initialized for tenant ${tenant}.`);
console.log(`Operator token saved to ${tokenPath} (mode 0600). Token value is not printed.`);
console.log("Restart the backend with run.sh to enable token authentication, then sign in through the frontend.");
