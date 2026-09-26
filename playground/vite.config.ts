/**
 * `pnpm dev` — a playground running straight from src/, with hot reload.
 *
 * Tailwind runs UNSCOPED here (no build/scope-editor-css.mjs pass), which is
 * fine on a page that exists only to show the editor. The scoped, shipped
 * stylesheets are what the Playwright suite tests against.
 */
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: __dirname,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": resolve(__dirname, "../src") } },
  server: { port: 5173, open: false },
  build: { outDir: resolve(__dirname, "dist"), emptyOutDir: true },
});
