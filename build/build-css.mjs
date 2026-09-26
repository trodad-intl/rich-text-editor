/**
 * Builds the three stylesheets the package ships.
 *
 *   dist/rich-text-editor.css            editor UI, scoped to .rte-scope
 *   dist/rich-text-editor.bootstrap.css  the same, hardened for Bootstrap 5 pages
 *   dist/content.css                 read-only rendering of saved HTML
 *
 * Tailwind generates the editor sheet from src/editor.css; scope-editor-css.mjs
 * then re-roots every rule under `.rte-scope`, so preflight and the
 * utilities cannot reach the host page. The Bootstrap variant additionally
 * matches Bootstrap's `!important` utilities and neutralises the properties it
 * states for colliding class names — see scope-editor-css.mjs for why both are
 * needed. It is computed against the Bootstrap build in tests/fixtures (5.0.2).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  bootstrapImportantClasses,
  bootstrapNeutralizerCss,
  scopeEditorCss,
} from "./scope-editor-css.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const BOOTSTRAP_CSS = path.join(root, "tests/fixtures/bootstrap-5.0.2.min.css");

fs.mkdirSync(dist, { recursive: true });

const raw = path.join(dist, ".tailwind.css");
execFileSync(
  path.join(root, "node_modules/.bin/tailwindcss"),
  ["-i", path.join(root, "src/editor.css"), "-o", raw, "--minify"],
  { cwd: root, stdio: ["ignore", "ignore", "inherit"] }
);
const css = fs.readFileSync(raw, "utf8");
fs.rmSync(raw);

const plain = scopeEditorCss(css);
fs.writeFileSync(path.join(dist, "rich-text-editor.css"), plain);

const important = bootstrapImportantClasses(BOOTSTRAP_CSS);
const scoped = scopeEditorCss(css, important);
const bootstrap = fs.readFileSync(BOOTSTRAP_CSS, "utf8");
// Appended last so it wins the ties it is meant to win.
fs.writeFileSync(
  path.join(dist, "rich-text-editor.bootstrap.css"),
  scoped + "\n" + bootstrapNeutralizerCss(bootstrap, scoped)
);

fs.copyFileSync(path.join(root, "src/styles/content.css"), path.join(dist, "content.css"));

for (const f of ["rich-text-editor.css", "rich-text-editor.bootstrap.css", "content.css"]) {
  const kb = (fs.statSync(path.join(dist, f)).size / 1024).toFixed(1);
  console.log(`dist/${f}  ${kb} kB`);
}
