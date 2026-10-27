import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";

const apiProxy = {
  "/api": "http://localhost:3002",
  "/health": "http://localhost:3002",
};

const previewSpaFallback = {
  name: "preview-spa-fallback",
  configurePreviewServer(server) {
    server.middlewares.use((request, response, next) => {
      const pathname = new URL(request.url, "http://localhost").pathname;
      const wantsHtml =
        request.method === "GET" && request.headers.accept?.includes("text/html");
      if (!wantsHtml || extname(pathname)) return next();
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(
        readFileSync(resolve(import.meta.dirname, "dist/index.html"), "utf8"),
      );
    });
  },
};

export default defineConfig({
  base: "/",
  plugins: [react(), previewSpaFallback],
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
        "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:8080 http://localhost:3002; object-src 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    },
  },
});
