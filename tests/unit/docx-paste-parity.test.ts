/**
 * Uploading a .docx must give what pasting the same document out of
 * LibreOffice gives.
 *
 * Each fixture (tests/fixtures/libreoffice, built by build.mjs there) is a .docx
 * and the HTML and RTF LibreOffice writes for it. The HTML and RTF are pasted
 * through `insertData`; the .docx is uploaded through the import. What the
 * editor keeps from each is compared: every run's text, font, size, colour and
 * weight; every block's line spacing, margins and alignment; every cell's
 * rules and fill. The browser twin, tests/browser/word-upload-parity.spec.ts,
 * compares them with real font metrics.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createPlateEditor } from "platejs/react";
import type { Value } from "platejs";
import { buildPlugins } from "@/plugins";
import { loadDocxClipboard } from "@/lib/docx/load-docx";
import { readDocxAsClipboard } from "@/lib/docx/read-docx";
import { readerShape } from "./support/reader-shape";

const FIXTURES = path.resolve(__dirname, "../fixtures/libreoffice");
const fixture = (name: string, ext: string, encoding: BufferEncoding = "utf8") => fs.readFileSync(path.join(FIXTURES, `${name}.${ext}`), encoding);

function pasted(name: string): Value {
  const editor = createPlateEditor({ plugins: buildPlugins("clean") });
  editor.tf.setValue([{ type: "p", children: [{ text: "" }] }] as never);
  editor.tf.select(editor.api.start([])!);
  const data: Record<string, string> = { "text/html": fixture(name, "html"), "text/rtf": fixture(name, "rtf", "latin1") };
  editor.tf.insertData({ types: Object.keys(data), getData: (t: string) => data[t] ?? "", files: [], items: [] } as unknown as DataTransfer);
  return editor.children as Value;
}

async function uploaded(name: string): Promise<Value> {
  const editor = createPlateEditor({ plugins: buildPlugins("clean") });
  loadDocxClipboard(editor, await readDocxAsClipboard(fs.readFileSync(path.join(FIXTURES, `${name}.docx`))));
  return editor.children as Value;
}

describe("an uploaded .docx comes out as the same document pasted from LibreOffice", () => {
  it("a report: sizes, fonts, colours, tabs, spaces, spacing and line spacing", async () => {
    expect(readerShape(await uploaded("report"))).toEqual(readerShape(pasted("report")));
  });

  it("tables: rules as wide as LibreOffice's, fills, merges, and rows at 1.5 and 2 lines", async () => {
    expect(readerShape(await uploaded("tables"))).toEqual(readerShape(pasted("tables")));
  });
});
