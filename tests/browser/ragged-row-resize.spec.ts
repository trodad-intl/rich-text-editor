/**
 * Can a column that exists in only SOME rows be resized?
 *
 * A pasted table is often ragged: ten `label | : | value` rows, and two rows in
 * the middle broken into five cells for a measurement pair. Those two rows'
 * extra columns could not be dragged at all, while the three columns every row
 * shares resized normally.
 */
import { expect, test, type Page } from "@playwright/test";
import { EDITOR, openEditor } from "./support/harness";

const border = "border:1px solid #000";
const wide = (label: string, value: string) =>
  `<tr><td style="${border}">${label}</td><td style="${border}">:</td><td style="${border}">${value}</td></tr>`;
/** A row broken into five cells — the two extra columns exist only here. */
const split = (...cells: string[]) =>
  `<tr>${cells.map((t) => `<td style="${border}">${t}</td>`).join("")}</tr>`;

const TABLE =
  `<table border="1" style="border-collapse: collapse;">` +
  [
    wide("Uterus", "Gravid"),
    wide("No of fetus", "Single"),
    split("BPD", ":", "3.61 cm", "FL", "1.98 cm"),
    wide("Placenta", "Posterior"),
    split("AC", ":", "12.4 cm", "HC", "15.1 cm"),
    wide("Liquor", "Adequate"),
    wide("Presentation", "Cephalic"),
    wide("Cardiac activity", "Present"),
    wide("Movement", "Present"),
    wide("EDD", "15/06/26"),
  ].join("") +
  `</table>`;

const DRAG_PX = 60;

async function open(page: Page) {
  await openEditor(page, TABLE);
  await page.waitForTimeout(400);
}

/** colSizes as the serializer writes them back out: the <colgroup>. */
const readColSizes = (page: Page) =>
  page.evaluate((sel) => {
    const html: string = (window as any).TrodadRichTextEditor.getHtml(sel);
    const m = html.match(/<colgroup>([\s\S]*?)<\/colgroup>/);
    return m ? [...m[1].matchAll(/width:\s*([\d.]+)px/g)].map((x) => Math.round(+x[1])) : null;
  }, EDITOR);

const splitRow = (page: Page) => page.locator("[data-slate-editor] table tr").nth(2);
const splitCells = (page: Page) => splitRow(page).locator("td:not(.w-2)");
const widths = (page: Page) =>
  splitCells(page).evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));

/** Drag the right-hand handle of column `col` and report what moved. */
async function drag(page: Page, col: number) {
  const before = await widths(page);
  const handle = splitRow(page).locator(`[data-col="${col}"]`).first();
  if (!(await handle.count())) return { before, after: before, handle: false };
  const box = await handle.boundingBox();
  if (!box) return { before, after: before, handle: false };
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(box.x + box.width / 2 + (i * DRAG_PX) / 6, box.y + box.height / 2);
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await page.waitForTimeout(250);
  return { before, after: await widths(page), handle: true };
}

test.describe("a ragged table", () => {
  // The widest row is the grid: 5 columns, so 5 sizes.
  test("colSizes covers every column in the table, not just the first row's", async ({ page }) => {
    await open(page);
    const colSizes = await readColSizes(page);
    expect(colSizes).not.toBeNull();
    expect(colSizes).toHaveLength(5);
  });

  test("the split row has five cells", async ({ page }) => {
    await open(page);
    await expect(splitCells(page)).toHaveCount(5);
  });

  // The legacy script dragged column 0 and then column 3 on the same page; each
  // drag measures its own before/after, so each gets a fresh page here.
  for (const col of [0, 3]) {
    test(`column ${col} has a resize handle, and dragging it actually resizes it`, async ({
      page,
    }) => {
      await open(page);
      const { before, after, handle } = await drag(page, col);
      const moved = Math.abs(after[col] - before[col]);
      expect.soft(handle, `column ${col} has a resize handle`).toBe(true);
      expect
        .soft(
          moved,
          `dragging column ${col} actually resizes it — moved ${moved}px of ${DRAG_PX} (${before[col]} -> ${after[col]})`
        )
        .toBeGreaterThanOrEqual(DRAG_PX - 8);
    });
  }
});
