import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const dist = resolve(root, "dist");
const generatedHtml = resolve(dist, "index.html");

if (!existsSync(generatedHtml)) {
  throw new Error("Expected dist/index.html after Vite build");
}

copyFileSync(generatedHtml, resolve(dist, "app.html"));
// Build artifacts stay in dist/. Vite serves source assets from public/ in dev.
