/**
 * Library build: ES modules for apps that have their own bundler.
 *
 * Every dependency stays EXTERNAL — the consuming app resolves React, Plate
 * and friends once, from its own node_modules. The self-contained build for
 * pages without a bundler is vite.standalone.config.ts.
 */
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: true,
    minify: false,
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        mount: resolve(__dirname, "src/mount.tsx"),
        element: resolve(__dirname, "src/element-define.ts"),
      },
      formats: ["es"],
    },
    rollupOptions: {
      // Anything that is not a relative or absolute path is a package.
      external: (id) => !id.startsWith(".") && !id.startsWith("/") && !id.startsWith("\0"),
      output: {
        chunkFileNames: "chunks/[name]-[hash].js",
        // Everything here renders or drives a live editor, so it is client-only
        // under React Server Components (Next.js App Router). Rollup drops
        // module-level directives from the sources, so it is restated here.
        banner: '"use client";',
      },
      onwarn(warning, warn) {
        if (warning.code === "MODULE_LEVEL_DIRECTIVE") return;
        warn(warning);
      },
    },
  },
});
