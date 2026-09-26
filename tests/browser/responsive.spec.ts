/**
 * Does a pasted table reflow when the window gets small?
 *
 * Column widths are fixed at paste time, in pixels, against the editor as it
 * was then. Rendered as pixels they are a FLOOR: shrink the window and the
 * table keeps its width while the block around it grows a horizontal
 * scrollbar. Rendered as a share of the table they shrink with it.
 *
 * Only a real browser can answer this, and only by resizing it.
 */
import { expect, test, type Page } from "@playwright/test";
import { openEditor } from "./support/harness";

const COLUMNS = ["Test", "Result", "Unit", "Biological Reference Interval", "Method", "Remarks"];
const WIDTHS = [150, 80, 70, 160, 100, 64];

const cell = (text: string, width: number) =>
  `<td width=${width} style='width:${(width * 0.75).toFixed(1)}pt;border:solid windowtext 1.0pt;padding:0cm 5.4pt'>` +
  `<p><span style='font-size:9.0pt'>${text}</span></p></td>`;

const WORD = `<table border=1 cellspacing=0 cellpadding=0 width=624 style='width:468.0pt;border-collapse:collapse'>
 <tr>${COLUMNS.map((c, i) => cell(c, WIDTHS[i])).join("")}</tr>
 <tr>${["Haemoglobin", "13.5", "gm/dl", "13.0 - 17.0", "Photometric", "Normal"]
   .map((t, i) => cell(t, WIDTHS[i]))
   .join("")}</tr>
</table>`;

/** The share of the table each column should hold, whatever the window. */
const STATED_TOTAL = WIDTHS.reduce((a, b) => a + b, 0);
const SHARES = WIDTHS.map((w) => w / STATED_TOTAL);

test.use({
  viewport: { width: 1440, height: 900 },
  permissions: ["clipboard-read", "clipboard-write"],
});

/** Open an empty editor and paste `html` into it as Word would. */
async function openAndPaste(page: Page, html: string, plain: string, settle: number) {
  await openEditor(page);
  await page.click("[data-slate-editor]");
  await page.evaluate(
    async ([source, text]) => {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([source], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
    },
    [html, plain] as const
  );
  await page.keyboard.press("Control+V");
  await page.waitForTimeout(settle);
}

const measure = (page: Page) =>
  page.evaluate(() => {
    const editable = document.querySelector("[data-slate-editor]")!;
    const table = editable.querySelector("table")!;
    const block = table.closest('[data-slate-node="element"]')!;
    const cells = Array.from(editable.querySelectorAll("table tr:first-child td:not(.w-2)")).map(
      (c) => Math.round(c.getBoundingClientRect().width)
    );
    return {
      block: block.clientWidth,
      blockScrolls: block.scrollWidth > block.clientWidth,
      pageScrolls: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      table: Math.round(table.getBoundingClientRect().width),
      cells,
    };
  });

test.describe("A pasted table reflows with the window", () => {
  // Full width first: the table must render at exactly the widths it was pasted
  // with, or "responsive" has been bought by making the normal case wrong.
  test("at full width the table fills the editor as before", async ({ page }) => {
    await openAndPaste(page, WORD, "", 400);
    const wide = await measure(page);
    const detail = `table ${wide.table}px of block ${wide.block}px`;
    expect(wide.table, detail).toBeGreaterThan(wide.block - 24);
    expect(wide.blockScrolls, detail).toBe(false);
  });

  for (const width of [1024, 768, 500, 380]) {
    /** Paste at full width, then shrink the window to `width`. */
    async function shrunk(page: Page) {
      await openAndPaste(page, WORD, "", 400);
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(250);
      return measure(page);
    }

    test(`@${width}: the table shrinks to the window instead of scrolling`, async ({ page }) => {
      const got = await shrunk(page);
      const detail = `table ${got.table}px of block ${got.block}px`;
      expect(got.blockScrolls, detail).toBe(false);
      expect(got.pageScrolls, detail).toBe(false);
      expect(got.table, detail).toBeLessThanOrEqual(got.block);
    });

    test(`@${width}: and every column keeps its share of it`, async ({ page }) => {
      const got = await shrunk(page);
      const total = got.cells.reduce((a, b) => a + b, 0);
      const detail = got.cells.join(" / ");
      got.cells.forEach((cellWidth, i) => {
        expect(Math.abs(cellWidth / total - SHARES[i]), `column ${i}: ${detail}`).toBeLessThan(0.01);
      });
    });
  }
});

// A cell that WRAPS keeps its row's borders.
//
// This is the shape a label/value header table takes as the window narrows: a field
// that fitted on one line — "Delivery Date: 26-11-2025" — becomes two, the row
// grows, and every border in that row has to grow with it. A cell's rules are
// drawn on a `::before` overlay rather than on the cell itself, so nothing
// guarantees that on its own: an overlay that stayed the height the row used to
// be would draw the row's rules across the middle of it, which reads as a
// broken top border and a row that has lost its box.
test.describe("A cell that wraps keeps its row's borders", () => {
  const header = (label: string, value: string) =>
    `<tr style='height:14.2pt'>` +
    [label, value]
      .map(
        (t) =>
          `<td style='border:solid windowtext 1.0pt;padding:0cm 5.4pt'>` +
          `<p><span style='font-size:11.0pt'>${t}</span></p></td>`
      )
      .join("") +
    `</tr>`;
  const HEADER =
    `<table border=1 cellspacing=0 width=624 style='width:468.0pt;border-collapse:collapse'>` +
    header("Inv. ID :", "3500000") +
    header("Delivery Date:", "MR ABDUL KARIM CHOWDHURY 26-11-2025 10:45 AM") +
    header("Bed/ward:", "ICU-05") +
    `</table>`;

  /**
   * Every cell: its row's height, and the box its rules are actually drawn on.
   *
   * `offset` is the half that broke the grid. The rules live on an overlay, and
   * an absolutely positioned overlay with no offsets falls back to its STATIC
   * position — which, now that a cell's content is vertically centred, is
   * halfway down a cell whose neighbour has wrapped. So in a row of one-line
   * fields beside a two-line one, every one-line cell drew its box 10px low and
   * 10px past the bottom of the row, and the header table came apart.
   */
  const rules = (page: Page) =>
    page.evaluate(() =>
      [...document.querySelectorAll("[data-slate-editor] tr")].flatMap((row) => {
        const height = Math.round(row.getBoundingClientRect().height);
        return [...row.children]
          .filter((c) => /^t[dh]$/i.test(c.tagName) && !c.classList.contains("w-2"))
          .map((cell) => {
            const drawn = getComputedStyle(cell, "::before");
            return {
              row: height,
              drawn: Math.round(parseFloat(drawn.height) || 0),
              offset: Math.round(parseFloat(drawn.top) || 0),
            };
          });
      })
    );

  for (const width of [1280, 560, 380, 320]) {
    // The reported case needs no narrow window: one long field in a row of
    // short ones is enough for the row to be two lines deep while its other
    // cells are one.
    async function cellsAt(page: Page) {
      await openAndPaste(page, HEADER, "x", 700);
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(300);
      return rules(page);
    }

    test(`@${width}: every cell's rules are drawn the full height of its row`, async ({ page }) => {
      const cells = await cellsAt(page);
      const detail = cells.map((c) => `${c.row}/${c.drawn}`).join(" ");
      expect(cells.length, detail).toBeGreaterThan(0);
      for (const c of cells) expect(Math.abs(c.drawn - c.row), detail).toBeLessThanOrEqual(1);
    });

    test(`@${width}: and from the top of the cell, so the grid still lines up`, async ({ page }) => {
      const cells = await cellsAt(page);
      expect(cells.map((c) => c.offset)).toEqual(cells.map(() => 0));
    });

    if (width <= 380) {
      test(`@${width}: and a field that no longer fits really has wrapped`, async ({ page }) => {
        const cells = await cellsAt(page);
        const heights = [...new Set(cells.map((c) => c.row))];
        expect(heights.length, `row heights ${heights.join(", ")}`).toBeGreaterThan(1);
      });
    }
  }
});
