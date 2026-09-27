/**
 * Loading a document into the editor: HTML or a Plate value in, a value the
 * editor can render out. Shared by the component and the standalone
 * converters in src/convert.ts.
 */
import { deserializeHtml, KEYS, type SlateEditor, type Value } from "platejs";
import { openBreakOnlyLines } from "./break-only-lines";
import { EMPTY_VALUE } from "./html-serializer";
import { inlineInheritedColor } from "./inherited-color";
import { inlineInheritedFontSize } from "./inherited-font-size";
import { inlineLegacyAlignment } from "./legacy-alignment";
import { protectWhitespace } from "./whitespace";
import { inlineWordTextboxes } from "./word-textbox";

/**
 * Stored HTML, ready for Plate's deserializer.
 *
 * The clipboard gets these passes from plugins — `LegacyAlignmentPlugin`,
 * `WhitespacePlugin` and friends hook `transformData` — but `transformData` is
 * a CLIPBOARD-ONLY seam, so the load path has to run them itself, exactly as
 * the Word-import button does.
 *
 * Each exists because HTML states something in a place no Plate node can
 * carry, so it was silently dropped on load and then lost for good on the
 * first save:
 *
 * - `inlineLegacyAlignment`: `<p align=center>`, `<center>` and
 *   `<tr align=center>` (which centres a whole row and survives as no node at
 *   all unless it is pushed onto the cells). Pasting the same markup came out
 *   centred, which made the loss look intermittent.
 * - `inlineInheritedFontSize`: a size stated on a `<p>`, `<td>` or `<table>`
 *   reached no node, so body text opened at the editor's base size.
 * - `inlineInheritedColor`: a colour stated on a block or in `<font color>`
 *   reached no node, so coloured text opened black.
 *
 * Alignment and size first, whitespace last — the order the Word-import
 * button uses. The earlier passes re-serialize the document, and
 * `protectWhitespace` has to see the result of that, not the other way round.
 */
export function prepareHtml(html: string): string {
  // Text boxes first, on the rawest HTML — the same reason the clipboard runs
  // that pass first of all. HTML saved by another editor can have kept Word's
  // conditional comments whole.
  return protectWhitespace(
    inlineInheritedColor(
      inlineInheritedFontSize(inlineLegacyAlignment(inlineWordTextboxes(html)))
    )
  );
}

/**
 * A deserialized document as a value the editor can actually RENDER.
 *
 * Plate wraps stray root-level runs in a paragraph only when the fragment MIXES
 * blocks and inlines — see `normalizeDifferentNodeTypes` in its core. HTML that
 * is inline ALL the way down stays a list of text nodes at the root, which is
 * not a document: slate-react reads `children` off one while painting and
 * throws "undefined is not iterable", which takes the whole editor down.
 *
 * Common in stored data: HTML saved as bare text (`Hello.`), as
 * `<span>…</span>`, as `<b>…</b>` or with an empty `<div></div>` in it all land
 * here. The clipboard never does — an insert goes INTO a block that already
 * exists.
 */
export function toRenderableValue(editor: SlateEditor, value: Value): Value {
  const out: any[] = [];
  let run: any[] | null = null;

  for (const node of value as any[]) {
    if (Array.isArray(node?.children) && !editor.api.isInline(node)) {
      run = null;
      out.push(node);
      continue;
    }
    // Consecutive runs share the paragraph they were missing, so one line does
    // not come back as one paragraph per span.
    if (run) {
      run.push(node);
      continue;
    }
    run = [node];
    out.push({ type: editor.getType(KEYS.p), children: run });
  }

  return (out.length ? out : EMPTY_VALUE) as Value;
}

/** Stored HTML, prepared, deserialized and safe to render. */
export function deserializeDocument(editor: SlateEditor, html?: string): Value {
  if (!html || !html.trim()) return EMPTY_VALUE;

  const value = deserializeHtml(editor, { element: prepareHtml(html) }) as Value;
  return toRenderableValue(editor, openBreakOnlyLines(value));
}

/**
 * A Plate value (or its JSON string) as a value the editor can render. Anything
 * that is not a non-empty array of nodes opens as an empty document.
 */
export function parseValue(editor: SlateEditor, input: Value | string): Value {
  let value: unknown = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch {
      return EMPTY_VALUE;
    }
  }
  if (!Array.isArray(value) || value.length === 0) return EMPTY_VALUE;
  return toRenderableValue(editor, value as Value);
}

/** The document to open with: JSON wins over HTML when both are given. */
export function initialDocument(editor: SlateEditor, html?: string, value?: Value | string): Value {
  if (value !== undefined && value !== null && value !== "") return parseValue(editor, value);
  return deserializeDocument(editor, html);
}
