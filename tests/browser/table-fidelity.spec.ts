/**
 * Does a pasted table look like the document it came from?
 *
 * Checked against the browser's OWN rendering of the same Word markup, in a
 * clean iframe — that is the only honest reference, and jsdom cannot give it
 * because none of this is visible without layout.
 *
 * Three things this pins down, each of which was wrong:
 *  - the RULE COLOUR. The cell borders were drawn in the editor's theme grey
 *    while the saved HTML had them black, so the editor and the print
 *    disagreed about the same table.
 *  - alignment stated on the CELL. Word writes `<td align=center>` around a
 *    plain paragraph as readily as it writes it on the paragraph, and only the
 *    paragraph was ever read — so centred header rows came back left.
 *  - the GAP under the table, which was 20px of editor chrome against Word's 0.
 */
import { expect, test, type Page } from "@playwright/test";
import { EDITOR, openEditor } from "./support/harness";

const cell = (inner: string, width: number, attrs = "") =>
  `<td width=${width} valign=top ${attrs} style='width:${(width * 0.75).toFixed(1)}pt;border:solid windowtext 1.0pt;padding:0cm 5.4pt'>${inner}</td>`;

/** A centred header row written on the CELL, and a data row centred on the P. */
const WORD = `<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><style>
<!-- p.MsoNormal {margin:0cm; line-height:107%; font-size:11.0pt; font-family:"Calibri",sans-serif;} --></style></head><body>
<table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0 width=624 style='width:468.0pt;border-collapse:collapse'>
 <tr>
  ${cell("<p class=MsoNormal><b>Pathogen Type</b></p>", 130, "align=center")}
  ${cell("<p class=MsoNormal><b>Tests</b></p>", 320, "align=center")}
  ${cell("<p class=MsoNormal><b>Result</b></p>", 174, "align=center")}
 </tr>
 <tr>
  ${cell("<p class=MsoNormal>Bacteria</p>", 130, "rowspan=2")}
  ${cell("<p class=MsoNormal>Neisseria gonorrhoeae</p>", 320)}
  ${cell("<p class=MsoNormal align=center style='text-align:center'>Not Detected</p>", 174)}
 </tr>
 <tr>
  ${cell("<p class=MsoNormal>Chlamydia trachomatis</p>", 320)}
  ${cell("<p class=MsoNormal align=center style='text-align:center'>Detected</p>", 174)}
 </tr>
</table>
<p class=MsoNormal>Limit of Detection: 200 CFU/mL</p></body></html>`;

test.use({
  viewport: { width: 1440, height: 900 },
  permissions: ["clipboard-read", "clipboard-write"],
});

/** How the browser itself renders WORD, in a clean iframe. */
async function measureTruth(page: Page) {
  return page.evaluate(async (html) => {
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:absolute;left:-9999px;width:1200px;height:900px";
    document.body.append(frame);
    const doc = frame.contentDocument!;
    doc.open();
    doc.write(html);
    doc.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const win = frame.contentWindow!;
    const table = doc.querySelector("table")!;
    const cells = Array.from(table.querySelectorAll("td"));
    return {
      // -webkit-center is what a td-level `align` computes to; the text is centred.
      centred: cells.map((c) => /center/.test(win.getComputedStyle(c.querySelector("p")!).textAlign)),
      borderColor: win.getComputedStyle(cells[0]).borderTopColor,
      rowspans: cells.map((c) => c.rowSpan).join(","),
      gapUnder: Math.round(
        doc.querySelector("table + p")!.getBoundingClientRect().top -
          table.getBoundingClientRect().bottom
      ),
    };
  }, WORD);
}

/** Paste WORD through the real clipboard and measure what the editor made of it. */
async function pasteAndMeasure(page: Page) {
  await page.click("[data-slate-editor]");
  await page.evaluate(async (html) => {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([""], { type: "text/plain" }),
      }),
    ]);
  }, WORD);
  await page.keyboard.press("Control+V");
  await page.waitForTimeout(500);

  return page.evaluate((sel) => {
    const editable = document.querySelector("[data-slate-editor]")!;
    const table = editable.querySelector("table")!;
    const cells = Array.from(table.querySelectorAll("td")).filter(
      (c) => !c.classList.contains("w-2")
    );
    const block = table.closest('[data-slate-node="element"]')!;
    const saved: string = (window as any).TrodadRichTextEditor.getHtml(sel);
    return {
      centred: cells.map((c) =>
        /center/.test(
          getComputedStyle(c.querySelector('[data-slate-node="element"]') ?? c).textAlign
        )
      ),
      // The rule is painted on the cell's ::before, not on the <td> itself.
      borderColor: getComputedStyle(cells[0], "::before").borderTopColor,
      borderWidth: getComputedStyle(cells[0], "::before").borderTopWidth,
      rowspans: cells.map((c) => c.rowSpan).join(","),
      gapUnder: block.nextElementSibling
        ? Math.round(
            block.nextElementSibling.getBoundingClientRect().top -
              table.getBoundingClientRect().bottom
          )
        : null,
      savedCentredCells: (saved.match(/<td[^>]*text-align: center/g) ?? []).length,
    };
  }, EDITOR);
}

async function run(page: Page) {
  await openEditor(page);
  const truth = await measureTruth(page);
  const got = await pasteAndMeasure(page);
  return { truth, got };
}

test.describe("a pasted Word table keeps the document's look", () => {
  test("the rules are the colour the document drew them, not the theme grey", async ({ page }) => {
    const { truth, got } = await run(page);
    expect(got.borderColor).toBe(truth.borderColor);
    expect(got.borderWidth).toBe("1px");
  });

  test("every cell the document centred is still centred", async ({ page }) => {
    const { truth, got } = await run(page);
    expect(got.centred).toEqual(truth.centred);
  });

  test("alignment stated on the cell reaches the saved HTML too", async ({ page }) => {
    const { got } = await run(page);
    expect(got.savedCentredCells, "header cells saved as centred").toBe(3);
  });

  test("merged cells keep their span", async ({ page }) => {
    const { truth, got } = await run(page);
    expect(got.rowspans).toBe(truth.rowspans);
  });

  test("the gap under the table is the handles’ clearance, not 20px of chrome", async ({
    page,
  }) => {
    const { truth, got } = await run(page);
    expect(got.gapUnder, `word ${truth.gapUnder}px`).not.toBeNull();
    expect(got.gapUnder!, `word ${truth.gapUnder}px`).toBeLessThanOrEqual(6);
  });
});
