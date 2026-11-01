import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { compilerPlugins } from "./compiler.config.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isSPADocument } from "./preview-routing.mjs";

// Each launcher selects its own backend; the active release uses Go on 3002.
const apiTarget = process.env.AISOC_API_PROXY_TARGET || "http://localhost:3002";
const apiProxy = {
  "/api": apiTarget,
  "/health": apiTarget,
};

const previewSpaFallback = {
  name: "preview-spa-fallback",
  configurePreviewServer(server) {
    server.middlewares.use((request, response, next) => {
      const pathname = new URL(request.url, "http://localhost").pathname;
      if (!isSPADocument(request.method, request.headers.accept, pathname)) return next();
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(
        readFileSync(resolve(server.config.root, server.config.build.outDir, "index.html"), "utf8"),
      );
    });
  },
};

export default defineConfig({
  base: "/",
  resolve: {
    alias: process.env.VITE_REACT_PROFILE === "1"
      ? [{ find: "react-dom/client", replacement: "react-dom/profiling" }]
      : [],
  },
  plugins: [react({ babel: { plugins: compilerPlugins(process.env.AISOC_REACT_COMPILER) } }), previewSpaFallback],
  build: {
    rollupOptions: {
      input: resolve(import.meta.dirname, "index.html"),
    },
  },
  preview: {
    proxy: apiProxy,
    headers: {
      "Content-Security-Policy":
        "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'; connect-src 'self' http://localhost:3002; object-src 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    },
  },
  server: {
    proxy: apiProxy,
    headers: {
      "Content-Security-Policy":
        "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:8080 ws://127.0.0.1:8080; object-src 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    },
  },
});
