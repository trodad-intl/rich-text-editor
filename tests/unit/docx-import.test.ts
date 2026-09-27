/**
 * A .docx read in the browser and loaded through the paste path.
 *
 * lib/docx/read-docx.ts turns the file into the clipboard Word would have put
 * on a copy of it; the Word-import button hands that to `insertData`, exactly
 * as a Ctrl+V does. So these tests paste the reader's clipboard the same way
 * and check what the editor keeps — which is what the upload keeps.
 */
import { describe, expect, it } from "vitest";
import { createPlateEditor } from "platejs/react";
import { buildPlugins } from "@/plugins";
import { plateValueToHtml } from "@/lib/html-serializer";
import { loadDocxClipboard } from "@/lib/docx/load-docx";
import { readDocxAsClipboard } from "@/lib/docx/read-docx";
import { buildDocx, para, PNG_1PX, run, type DocxParts } from "./support/docx";

async function importDocx(parts: DocxParts) {
  const clipboard = await readDocxAsClipboard(await buildDocx(parts));
  const editor = createPlateEditor({ plugins: buildPlugins("clean") });
  loadDocxClipboard(editor, clipboard);
  return { clipboard, html: plateValueToHtml(editor.children as never), value: editor.children as any[] };
}

const TIMES_12 = `<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/>`;

describe("reading a .docx as Word's clipboard", () => {
  it("keeps colour, size, font, weight and alignment", async () => {
    const { html } = await importDocx({
      body: para(run("USG REPORT", `<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:b/><w:color w:val="FF0000"/><w:sz w:val="32"/>`), `<w:jc w:val="center"/>`),
    });
    expect(html).toContain("USG REPORT");
    expect(html).toContain("color: rgb(255, 0, 0)");
    expect(html).toContain("font-size: 16pt");
    expect(html).toContain("text-align: center");
    expect(html).toContain("<strong>");
    expect(html).toContain("Times New Roman");
  });

  it("keeps a tab as a tab and a run of spaces as spaces", async () => {
    const { html, value } = await importDocx({
      body: para(run("Shape\t\t\tOval", TIMES_12)) + para(run("Name     Value", TIMES_12)),
    });
    const texts = value.map((block) => block.children.map((c: any) => c.text).join(""));
    expect(texts[0]).toBe("Shape\t\t\tOval");
    expect(texts[1]).toBe("Name     Value");
    expect(html).toContain('<span style="white-space: pre">\t\t\t</span>');
  });

  it("keeps the spaces between runs a document split at every word", async () => {
    // As Word saves it: spell-check marks between the runs, each space a run of its own.
    const proof = (w: string) => `<w:proofErr w:type="spellStart"/>${run(w)}<w:proofErr w:type="spellEnd"/>`;
    const { value } = await importDocx({
      body:
        para(`${run("Dr. ")}${proof("Shamsun")}${run(" ")}${proof("Nahar")}${run(" ")}${proof("Bintha")}`) +
        para(`${run("200")}${run(" ", `<w:sz w:val="18"/>`)}${run("CFU/mL")}`),
    });
    const texts = value.map((block) => block.children.map((c: any) => c.text).join(""));
    expect(texts[0]).toBe("Dr. Shamsun Nahar Bintha");
    expect(texts[1]).toBe("200 CFU/mL");
  });

  it("writes one span for runs of one format, as Word's HTML does", async () => {
    const clipboard = await readDocxAsClipboard(await buildDocx({ body: para(`${run("Neisseria", "<w:b/>")}${run(" ", "<w:b/>")}${run("gonorrhoeae", "<w:b/>")}`) }));
    expect(clipboard.html).toContain("<b>Neisseria gonorrhoeae</b>");
  });

  it("keeps a run of no-break spaces, which the paste would drop as text", async () => {
    const { value } = await importDocx({ body: para(run("Name\u00a0\u00a0\u00a0\u00a0\u00a0Value")) + para(run("Dr.\u00a0Rahman")) });
    const texts = value.map((block) => block.children.map((c: any) => c.text).join(""));
    expect(texts[0]).toMatch(/^Name[ \u00a0]{5}Value$/);
    expect(texts[1]).toMatch(/^Dr\.[ \u00a0]Rahman$/);
  });

  it("keeps subscript and superscript", async () => {
    const { html } = await importDocx({
      body: para(`${run("H")}${run("2", `<w:vertAlign w:val="subscript"/>`)}${run("O x")}${run("2", `<w:vertAlign w:val="superscript"/>`)}`),
    });
    expect(html).toContain("<sub>2</sub>");
    expect(html).toContain("<sup>2</sup>");
  });

  it("draws raised and lowered text as superscript and subscript", async () => {
    const { html } = await importDocx({
      body: para(`${run("H")}${run("2", `<w:position w:val="-2"/><w:sz w:val="19"/>`)}${run("O x")}${run("2", `<w:position w:val="8"/><w:sz w:val="19"/>`)}`),
    });
    expect(html).toMatch(/<sub>(<span[^>]*>)?2/);
    expect(html).toMatch(/<sup>(<span[^>]*>)?2/);
  });

  it("spaces each paragraph by the document's own margins, not the editor's padding", async () => {
    // As a LibreOffice paste is spaced: zeros included, since a zero here is
    // "no space", in place of the padding the editor gives a paragraph.
    const { value } = await importDocx({
      body: para(run("Tight"), `<w:spacing w:after="0"/>`) + para(run("Spaced"), `<w:spacing w:before="240" w:after="120"/>`),
    });
    expect(value[0]).toMatchObject({ documentSpacing: true, marginTop: "0px", marginBottom: "0px" });
    // 12pt and 6pt, in LibreOffice's inches to the hundredth: 0.17in and 0.08in.
    expect(value[1]).toMatchObject({ documentSpacing: true, marginTop: "16.32px", marginBottom: "7.68px" });
  });

  it("states the document's default tab stop in its RTF", async () => {
    const clipboard = await readDocxAsClipboard(await buildDocx({ body: para(run("x")), defaultTabStop: 709 }));
    expect(clipboard.rtf).toContain("\\deftab709");
  });

  it("states a paragraph's own tab stops where the paste reads them", async () => {
    const clipboard = await readDocxAsClipboard(
      await buildDocx({ body: para(run("Label\tValue"), `<w:tabs><w:tab w:val="left" w:pos="2880"/><w:tab w:val="right" w:pos="9000"/></w:tabs>`) })
    );
    expect(clipboard.html).toContain("tab-stops: 144pt right 450pt");
  });

  it("gives a blank line its neighbours' size, as a paste from Word does", async () => {
    const { value } = await importDocx({
      body:
        para(run("One", TIMES_12)) +
        para("", `<w:rPr><w:sz w:val="28"/></w:rPr>`) +
        para(run("Two", TIMES_12)),
    });
    // Word writes it as `<o:p>&nbsp;</o:p>`, whose own size the paste does not
    // keep: the line takes the size of the lines around it.
    expect(value).toHaveLength(3);
    expect(value[1].fontSize).toBe("12pt");
  });

  it("resolves styles: defaults, basedOn and the theme's fonts", async () => {
    const { html } = await importDocx({
      styles:
        `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>` +
        `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
        `<w:style w:type="paragraph" w:styleId="Red"><w:name w:val="Red"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="C00000"/></w:rPr></w:style>` +
        `<w:style w:type="paragraph" w:styleId="RedBig"><w:name w:val="Red Big"/><w:basedOn w:val="Red"/><w:rPr><w:sz w:val="36"/></w:rPr></w:style>`,
      body: para(run("Styled"), `<w:pStyle w:val="RedBig"/>`),
    });
    expect(html).toContain("color: rgb(192, 0, 0)");
    expect(html).toContain("font-size: 18pt");
  });

  it("keeps a heading style's own colour and size", async () => {
    const { html } = await importDocx({
      styles:
        `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
        `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>` +
        `<w:rPr><w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/><w:color w:val="2F5496" w:themeColor="accent1" w:themeShade="BF"/><w:sz w:val="32"/></w:rPr></w:style>`,
      body: para(run("Findings"), `<w:pStyle w:val="Heading1"/>`),
    });
    expect(html).toContain("Findings");
    expect(html).toContain("color: rgb(47, 84, 150)");
    expect(html).toContain("font-size: 16pt");
    expect(html).toContain("Calibri Light");
  });

  it("draws the borders a table style states", async () => {
    const border = ["top", "left", "bottom", "right", "insideH", "insideV"].map((s) => `<w:${s} w:val="single" w:sz="4" w:color="auto"/>`).join("");
    const { html } = await importDocx({
      styles: `<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders>${border}</w:tblBorders></w:tblPr></w:style>`,
      body:
        `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>` +
        `<w:tr><w:tc>${para(run("A"))}</w:tc><w:tc>${para(run("B"))}</w:tc></w:tr></w:tbl>`,
    });
    expect(html).toMatch(/border-top: 1px solid/);
    expect(html).toMatch(/border-left: 1px solid/);
  });

  it("turns numbering into lists", async () => {
    const { html } = await importDocx({
      numbering:
        `<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val=""/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr></w:lvl></w:abstractNum>` +
        `<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>` +
        `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>`,
      body:
        para(run("Bullet one"), `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>`) +
        para(run("Bullet two"), `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>`) +
        para(run("Between")) +
        para(run("First"), `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>`) +
        para(run("Second"), `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>`),
    });
    expect(html).toMatch(/^<ul[^>]*><li[^>]*>(<[^>]+>)*Bullet one/);
    expect(html).toMatch(/<ol[^>]*><li[^>]*>(<[^>]+>)*First/);
    expect(html).not.toContain("·");
  });

  it("keeps a table's widths, merges, borders and shading", async () => {
    const border = `<w:top w:val="single" w:sz="4" w:color="auto"/><w:left w:val="single" w:sz="4" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:color="auto"/><w:right w:val="single" w:sz="4" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:color="auto"/>`;
    const cell = (text: string, tcPr = "") => `<w:tc>${tcPr ? `<w:tcPr>${tcPr}</w:tcPr>` : ""}${para(run(text))}</w:tc>`;
    const { html } = await importDocx({
      body:
        `<w:tbl><w:tblPr><w:tblBorders>${border}</w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="3000"/></w:tblGrid>` +
        `<w:tr>${cell("Test", `<w:shd w:val="clear" w:fill="D9D9D9"/>`)}${cell("Result", `<w:vMerge w:val="restart"/>`)}</w:tr>` +
        `<w:tr>${cell("Hb")}${cell("", "<w:vMerge/>")}</w:tr>` +
        `<w:tr>${cell("Within normal limits", `<w:gridSpan w:val="2"/>`)}</w:tr></w:tbl>`,
    });
    expect(html).toContain("Within normal limits");
    expect(html).toMatch(/colspan="2"/);
    expect(html).toMatch(/rowspan="2"/);
    expect(html).toMatch(/background-color: (#d9d9d9|rgb\(217, 217, 217\))/i);
    expect(html).toMatch(/border[^;"]*: [^;"]*solid/);
  });

  it("writes borders as LibreOffice's HTML does: 1px up to ¾pt, a double or 3D rule three lines wide", async () => {
    const side = (val: string, sz: number) => ["top", "left", "bottom", "right"].map((s) => `<w:${s} w:val="${val}" w:sz="${sz}" w:color="auto"/>`).join("");
    const table = (borders: string) =>
      `<w:tbl><w:tblPr><w:tblBorders>${borders}</w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc>${para(run("x"))}</w:tc></w:tr></w:tbl>`;
    const clipboard = await readDocxAsClipboard(
      await buildDocx({ body: table(side("outset", 6)) + table(side("single", 4)) + table(side("double", 6)) })
    );
    expect(clipboard.html).toContain("border: 2.25pt outset #000000");
    expect(clipboard.html).toContain("border: 1px solid #000000");
    expect(clipboard.html).toContain("border: 2.25pt double #000000");
  });

  it("keeps pictures, as data", async () => {
    const drawing =
      `<w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="476250"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
      `<pic:pic><pic:blipFill><a:blip r:embed="rIdImg"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
    const { html } = await importDocx({
      body: para(drawing),
      rels: [["rIdImg", "image", "media/image1.png"]],
      media: { "media/image1.png": PNG_1PX },
    });
    expect(html).toContain("data:image/png;base64,");
    expect(html).toMatch(/width[=:]"?\s*100/);
  });

  it("keeps links, both kinds", async () => {
    const { html } = await importDocx({
      body:
        para(`<w:hyperlink r:id="rIdLink">${run("site")}</w:hyperlink>`) +
        para(
          `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> HYPERLINK "https://example.org/field" </w:instrText></w:r>` +
            `<w:r><w:fldChar w:fldCharType="separate"/></w:r>${run("field link")}<w:r><w:fldChar w:fldCharType="end"/></w:r>`
        ),
      rels: [["rIdLink", "hyperlink", "https://example.com/", true]],
    });
    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain('href="https://example.org/field"');
    expect(html).not.toContain("HYPERLINK");
  });

  it("shows a field's result, never its code", async () => {
    const { html } = await importDocx({
      body: para(
        `${run("Page ")}<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r>` +
          `<w:r><w:fldChar w:fldCharType="separate"/></w:r>${run("3")}<w:r><w:fldChar w:fldCharType="end"/></w:r>`
      ),
    });
    expect(html).toContain("Page 3");
    expect(html).not.toContain("PAGE");
  });

  it("leaves deleted text out and inserted text in", async () => {
    const { html } = await importDocx({
      body: para(`${run("Kept ")}<w:del><w:r><w:delText>gone</w:delText></w:r></w:del><w:ins>${run("added")}</w:ins>`),
    });
    expect(html).toContain("Kept added");
    expect(html).not.toContain("gone");
  });

  it("keeps a highlight", async () => {
    const { html } = await importDocx({ body: para(run("marked", `<w:highlight w:val="yellow"/>`)) });
    expect(html).toContain("marked");
    expect(html).toMatch(/background-color: (yellow|rgb\(255, 255, 0\)|#ffff00)|<mark/i);
  });

  it("refuses what is not a Word document", async () => {
    await expect(readDocxAsClipboard(new TextEncoder().encode("PK not a zip").buffer)).rejects.toThrow();
  });
});
