/**
 * A blank line in a document that was opened, rather than typed.
 *
 * Two things set it apart from one made with Enter, and both made it unlike the
 * same line in Word: `<p><br/></p>` read back as a paragraph holding `"\n"`,
 * which the editable draws two lines tall, and the line's size sat only on the
 * block, so the toolbar named the editor's base and typing came out at it.
 */
import { describe, expect, it } from "vitest";
import { createPlateEditor } from "platejs/react";
import type { Value } from "platejs";
import { buildPlugins } from "@/plugins";
import { htmlToValue } from "@/convert";
import { deserializeDocument } from "@/lib/document";
import { openBreakOnlyLines } from "@/lib/break-only-lines";

const textOf = (node: any): string => node.children.map((c: any) => c.text).join("");

/** Open `html` the way the editor does and let normalization run. */
function open(html: string): any[] {
  const editor = createPlateEditor({ plugins: buildPlugins() });
  editor.tf.setValue(deserializeDocument(editor, html));
  editor.tf.normalize({ force: true });
  return editor.children as any[];
}

describe("a line holding only a <br>", () => {
  it("opens as one empty line, not a line break", () => {
    const value = htmlToValue("<p>One</p><p><br/></p><p>Two</p>") as any[];
    expect(textOf(value[1])).toBe("");
  });

  it("keeps the size stated on its run", () => {
    const value = htmlToValue('<p><span style="font-size: 12pt"><br/></span></p>') as any[];
    expect(value[0].children[0]).toMatchObject({ text: "", fontSize: "12pt" });
  });

  it("does the same inside a table cell", () => {
    const value = htmlToValue("<table><tr><td><p><br/></p></td></tr></table>") as any[];
    const paragraph = value[0].children[0].children[0].children[0];
    expect(textOf(paragraph)).toBe("");
  });

  it("leaves a break between text alone", () => {
    const value = htmlToValue("<p>a<br/>b</p>") as any[];
    expect(textOf(value[0])).toBe("a\nb");
  });

  it("leaves a typed Shift+Enter alone when the document is JSON", () => {
    const typed: Value = [{ type: "p", children: [{ text: "\n" }] }];
    const editor = createPlateEditor({ plugins: buildPlugins(), value: typed });
    expect(textOf(editor.children[0])).toBe("\n");
  });

  it("is only a pass over the value it is given", () => {
    const value: Value = [{ type: "p", children: [{ text: "\n", bold: true }] }];
    expect(openBreakOnlyLines(value)).toEqual([{ type: "p", children: [{ text: "", bold: true }] }]);
    expect(value[0].children[0]).toEqual({ text: "\n", bold: true });
  });
});

describe("the size a blank line types in", () => {
  const P12 = (text: string) => `<p><span style="font-size: 12pt">${text}</span></p>`;

  it("is the size of the lines around it, on its run as well as its block", () => {
    const [, blank] = open(P12("One") + "<p><br/></p>" + P12("Two"));
    expect(blank.fontSize).toBe("12pt");
    expect(blank.children[0]).toMatchObject({ text: "", fontSize: "12pt" });
  });

  it("follows the line below when there is none above", () => {
    const [blank] = open("<p><br/></p>" + P12("Two"));
    expect(blank.children[0].fontSize).toBe("12pt");
  });

  it("keeps a size of its own over its neighbours'", () => {
    const [, blank] = open(P12("One") + '<p><span style="font-size: 20pt"><br/></span></p>' + P12("Two"));
    expect(blank.children[0].fontSize).toBe("20pt");
  });

  it("states nothing in a document that states no sizes", () => {
    const [, blank] = open("<p>One</p><p><br/></p><p>Two</p>");
    expect(blank.fontSize).toBeUndefined();
    expect(blank.children[0].fontSize).toBeUndefined();
  });
});
