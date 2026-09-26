/**
 * Standalone build: React, Plate and the editor in ONE ES module, for pages
 * with no bundler — Blade, ERB, Django templates, plain HTML.
 *
 * Loading it registers <trodad-rich-text-editor> and sets
 * window.TrodadRichTextEditor.
 *
 * A regular (app) build rather than library mode: library mode never
 * whitespace-minifies ES output, so a consumer's bundler can still tree-shake
 * it — but this file IS the final artifact a page loads.
 */
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  publicDir: false,
  build: {
    outDir: "dist/standalone",
    emptyOutDir: true,
    sourcemap: true,
    target: "es2020",
    minify: "esbuild",
    rollupOptions: {
      input: resolve(__dirname, "src/standalone.ts"),
      preserveEntrySignatures: "exports-only",
      output: {
        format: "es",
        entryFileNames: "rich-text-editor.js",
        // mammoth (Word import) is loaded on first use, not with the page.
        chunkFileNames: "chunks/[name]-[hash].js",
      },
    },
  },
});
