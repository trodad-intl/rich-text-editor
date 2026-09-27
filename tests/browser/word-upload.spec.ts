/**
 * Uploading a real .docx, in a real browser: read by lib/docx/read-docx.ts and
 * laid out by the paste path, so the columns a document lines up with tabs and
 * spaces come out lined up, as they do in Word.
 */
import { expect, test, type Page } from "@playwright/test";
import { getHtml, openEditor } from "./support/harness";
import { buildDocx, para, PNG_1PX, run } from "../unit/support/docx";

async function upload(page: Page, name: string, docx: ArrayBuffer) {
  await page.setInputFiles('input[accept=".doc,.docx"]', {
    name,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(docx),
  });
  await expect(page.getByText(`Loaded: ${name}`)).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(300);
}

/**
 * A report's findings table, tabs and spaces exactly as the document was typed:
 * the value column only lines up at the document's own size (Times New Roman
 * 10.5pt) and default tab stop (1.25cm) — at any other it is ragged in Word too.
 */
const FINDINGS: [string, string][] = [
  ["Shape\t\t\t\t\tOval", "Oval"],
  ["Position\t\t\t\t\tMidline of the uterus ", "Midline"],
  ["Contour\t\t\t\t\tSmooth ", "Smooth"],
  ["Wall (Trophoblastic reaction )" + " ".repeat(8) + "\tEchogenic 3mm or more in thickness ", "Echogenic"],
  ["MSD(GS)\t\t\t" + " ".repeat(13) + "38 mm", "38"],
  ["Internal landmark" + " ".repeat(26) + "\tYolk sac, amnion & embryo", "Yolk"],
  ["Cardiac Activity \t\t" + " ".repeat(4) + "\tPresent which is regular in rhythm ", "Present"],
  ["CRL \t\t\t \t" + " ".repeat(13) + "16 mm", "16"],
  ["EDD\t\t\t\t" + " ".repeat(13) + "25.08.2026 (acc. to CRL,GS)+/-07days.", "25.08.2026"],
];

test("a table lined up with tabs and spaces keeps its column", async ({ page }) => {
  const rPr = `<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="21"/>`;
  const docx = await buildDocx({
    defaultTabStop: 709,
    body: FINDINGS.map(([text]) => para(run(text.replace(/&/g, "&amp;"), rPr), `<w:spacing w:after="0"/>`)).join(""),
  });
  await openEditor(page);
  await upload(page, "usg.docx", docx);

  const xs = await page.evaluate((firsts) => {
    const blocks = [...document.querySelectorAll("[data-slate-editor] > *")];
    return firsts.map((first) => {
      for (const block of blocks) {
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode as Text;
          const tab = node.data.indexOf("\t");
          const at = tab < 0 ? -1 : node.data.indexOf(first, tab);
          if (at < 0) continue;
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + 1);
          return range.getBoundingClientRect().left - block.getBoundingClientRect().left;
        }
      }
      return null;
    });
  }, FINDINGS.map(([, first]) => first));

  expect(xs.every((x) => x !== null), `every value found: ${xs.join(", ")}`).toBe(true);
  const spread = Math.max(...(xs as number[])) - Math.min(...(xs as number[]));
  expect(spread, `value column at ${xs.map((x) => x!.toFixed(1)).join(" / ")}px`).toBeLessThanOrEqual(3);
});

test("colour, a shaded cell, a picture and a list all arrive", async ({ page }) => {
  const border = ["top", "left", "bottom", "right", "insideH", "insideV"].map((s) => `<w:${s} w:val="single" w:sz="4" w:color="auto"/>`).join("");
  const docx = await buildDocx({
    numbering:
      `<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>` +
      `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`,
    body:
      para(run("HAEMATOLOGY REPORT", `<w:b/><w:color w:val="FF0000"/><w:sz w:val="32"/>`), `<w:jc w:val="center"/>`) +
      `<w:tbl><w:tblPr><w:tblBorders>${border}</w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>` +
      `<w:tr><w:tc><w:tcPr><w:shd w:val="clear" w:fill="D9D9D9"/></w:tcPr>${para(run("Test"))}</w:tc><w:tc>${para(run("Result"))}</w:tc></w:tr></w:tbl>` +
      para(
        `<w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="952500"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
          `<pic:pic><pic:blipFill><a:blip r:embed="rIdImg"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
      ) +
      para(run("First"), `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>`) +
      para(run("Second"), `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>`),
    rels: [["rIdImg", "image", "media/image1.png"]],
    media: { "media/image1.png": PNG_1PX },
  });
  await openEditor(page);
  await upload(page, "report.docx", docx);

  const drawn = await page.evaluate(() => {
    const editable = document.querySelector("[data-slate-editor]")!;
    const heading = [...editable.querySelectorAll("*")].find((el) => el.textContent === "HAEMATOLOGY REPORT" && !el.children.length)!;
    const cell = [...editable.querySelectorAll("td")].find((td) => td.textContent?.trim() === "Test")!;
    const img = editable.querySelector("img") as HTMLImageElement | null;
    return {
      color: getComputedStyle(heading).color,
      cellBackground: getComputedStyle(cell).backgroundColor,
      imgWidth: img?.getBoundingClientRect().width ?? 0,
      listItems: editable.querySelectorAll("ol li").length,
    };
  });
  expect(drawn.color).toBe("rgb(255, 0, 0)");
  expect(drawn.cellBackground).toBe("rgb(217, 217, 217)");
  expect(Math.round(drawn.imgWidth)).toBe(100);
  expect(drawn.listItems).toBe(2);
  expect(await getHtml(page)).toContain("HAEMATOLOGY REPORT");
});
