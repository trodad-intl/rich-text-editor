/**
 * Convert between the two formats the editor speaks, without mounting it.
 *
 *   htmlToValue(html)   HTML → Plate value, through the SAME pipeline the
 *                       editor uses to open a document (legacy alignment,
 *                       inherited sizes and colours, whitespace, Word text
 *                       boxes), so the result is exactly what the editor
 *                       would load.
 *   valueToHtml(value)  Plate value → the editor's inline-styled HTML.
 *
 * Browser-only: HTML parsing uses the DOM (DOMParser). `valueToHtml` is pure
 * and also runs on a server.
 */
import type { Value } from "platejs";
import { createPlateEditor } from "platejs/react";
import { deserializeDocument, parseValue } from "./lib/document";
import { plateValueToHtml } from "./lib/html-serializer";
import { buildPlugins } from "./plugins";

let converter: ReturnType<typeof createPlateEditor> | null = null;

/** One headless editor, created on first use and reused. */
function editor() {
  converter ??= createPlateEditor({ plugins: buildPlugins("faithful") });
  return converter;
}

/** HTML → Plate value, as the editor would open it. */
export function htmlToValue(html: string): Value {
  return deserializeDocument(editor(), html);
}

/** Plate value (or its JSON string) → the editor's HTML. */
export function valueToHtml(value: Value | string): string {
  const parsed = typeof value === "string" ? parseValue(editor(), value) : value;
  return plateValueToHtml(parsed);
}
