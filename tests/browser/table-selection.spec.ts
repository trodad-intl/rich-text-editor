/**
 * Can you select text in a table and see that you have?
 *
 * The selection always WORKED — the range was there, the right text was in it,
 * Ctrl+C copied it. It just never looked selected: the table carried
 * `selection:bg-transparent`, so `::selection` painted nothing and dragging
 * across a row left the text looking untouched, which is indistinguishable from
 * being unselectable. Upstream can afford that class because a cell-selection
 * overlay paints the highlight instead; this editor does not register
 * BlockSelectionPlugin, so nothing did.
 *
 * Needs a real browser twice over: `::selection` is a pseudo-element, and the
 * selection itself only exists once something has been dragged across a layout.
 */
import { expect, test, type Page } from "@playwright/test";
import { openEditor } from "./support/harness";

const TABLE = `<table border=1 style='border-collapse:collapse'>
 <tr><td style='width:200px'><p>Neisseria gonorrhoeae</p></td><td style='width:200px'><p>Not Detected</p></td><td style='width:200px'><p>200 CFU</p></td></tr>
 <tr><td style='width:200px'><p>Chlamydia trachomatis</p></td><td style='width:200px'><p>Detected</p></td><td style='width:200px'><p>400 CFU</p></td></tr>
</table><p>After the table</p>`;

/**
 * Well clear of the column-resize handle, which straddles a cell's left edge by
 * 4px each way — a drag started on it resizes the column instead of selecting,
 * and reads as "selection is broken".
 */
const INSET_PX = 20;

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

/**
 * One drag, on a page of its own.
 *
 * Deliberately not several drags on one page: a previous selection leaves the
 * editor with state that anchors the next one at a block boundary, so the
 * second measurement stops describing what a user dragging once would get.
 */
async function dragBetween(page: Page, from: number, to: number) {
  await openEditor(page, TABLE);

  const cells = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-slate-editor] table td:not(.w-2)")).map((cell) => {
      const box = cell.getBoundingClientRect();
      return {
        left: Math.round(box.left),
        right: Math.round(box.right),
        y: Math.round(box.top + box.height / 2),
      };
    })
  );

  await page.mouse.move(cells[from].left + INSET_PX, cells[from].y);
  await page.mouse.down();
  // To the far side of the target cell, not a fixed 60px in.
  //
  // A cell's text is vertically CENTRED now, as it is in a browser, so a drag
  // taken across the middle of a row lands ON the text rather than below it —
  // and a fixed offset therefore stopped mid-word instead of running past the
  // end of the line.
  await page.mouse.move(cells[to].right - INSET_PX, cells[to].y, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(150);

  const selection = await page.evaluate(() => {
    const selected = window.getSelection()!;
    return {
      text: selected.toString().replace(/\s+/g, " ").trim(),
      ranges: selected.rangeCount,
    };
  });

  const highlight = await page.evaluate(() => {
    const cell = document.querySelector("[data-slate-editor] table td:not(.w-2)")!;
    const paragraph = document.querySelectorAll("[data-slate-editor] > div")[1];
    return {
      cell: getComputedStyle(cell, "::selection").backgroundColor,
      paragraph: getComputedStyle(paragraph, "::selection").backgroundColor,
    };
  });

  await page.keyboard.press("Control+C");
  await page.waitForTimeout(200);
  const clipboard = await page.evaluate(async () =>
    (await navigator.clipboard.readText()).replace(/\s+/g, " ").trim()
  );

  return { ...selection, highlight, clipboard };
}

test.describe("selecting text in a table", () => {
  // The highlight, which is the thing that was actually missing.
  test("a drag inside one cell", async ({ page }) => {
    const withinCell = await dragBetween(page, 0, 0);
    expect
      .soft(withinCell.highlight.cell, "selected text in a cell is actually tinted")
      .not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    expect
      .soft(withinCell.highlight.cell, "and tinted the same as everywhere else in the editor")
      .toBe(withinCell.highlight.paragraph);
    expect
      .soft(withinCell.ranges, `a drag inside one cell selects that cell’s text — ${withinCell.text}`)
      .toBe(1);
    expect.soft(withinCell.clipboard.length, "and Ctrl+C copies it").toBeGreaterThan(0);
    expect.soft(withinCell.text, "and Ctrl+C copies it").toContain(withinCell.clipboard);
  });

  test("a drag across a row", async ({ page }) => {
    const row = await dragBetween(page, 0, 2);
    expect.soft(row.ranges, "a drag across a row selects the whole row").toBe(1);
    expect.soft(row.text, "a drag across a row selects the whole row").toContain("Not Detected");
    expect.soft(row.text, "a drag across a row selects the whole row").toContain("200 CFU");
    expect.soft(row.clipboard, "and copies the whole row").toContain("Not Detected");
    expect.soft(row.clipboard, "and copies the whole row").toContain("200 CFU");
  });

  test("a drag down a column", async ({ page }) => {
    const column = await dragBetween(page, 1, 4);
    expect.soft(column.ranges, "a drag down a column selects the whole column").toBe(1);
    expect.soft(column.text, "a drag down a column selects the whole column").toContain("Detected");
    expect.soft(column.clipboard, "and copies it").toContain("Detected");
  });
});
