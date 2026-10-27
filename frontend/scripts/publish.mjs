import { copyFileSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const generatedHtml = resolve(dist, "index.html");

if (!existsSync(generatedHtml)) {
  throw new Error("Expected dist/index.html after Vite build");
}

copyFileSync(generatedHtml, resolve(dist, "app.html"));

for (const directory of ["assets", "fonts", "vendor"]) {
  const source = resolve(dist, directory);
  if (!existsSync(source)) continue;
  const target = resolve(root, directory);
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true, force: true });
}

const favicon = resolve(dist, "favicon.png");
if (existsSync(favicon)) copyFileSync(favicon, resolve(root, "favicon.png"));
