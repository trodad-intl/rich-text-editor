/**
 * Does a pasted Word table fill the editor?
 *
 * Word states a table at the width of a PAGE — the 6.5in text column of a
 * Letter page is 624px — while this editor is as wide as its container.
 * Reproducing those numbers literally left a pasted table sitting in the left
 * half of the screen with the right half blank, even though the serializer
 * emits every table as `width: 100%` and each print stretches it across the
 * page. Only a real browser can show that: jsdom does no layout.
 */
import { expect, test, type Page } from "@playwright/test";
import { openEditor } from "./support/harness";

const WORD_TABLE = `<table class=MsoNormalTable border=0 cellspacing=0 cellpadding=0 width=624 style='width:468.0pt;border-collapse:collapse'>
 <tr><td width=170 style='width:127.5pt'><p>Haemoglobin</p></td><td width=20 style='width:15.0pt'><p>:</p></td><td width=120 style='width:90.0pt'><p>13.5</p></td><td width=120 style='width:90.0pt'><p>gm/dl</p></td><td width=194 style='width:145.5pt'><p>13.0 - 17.0</p></td></tr>
 <tr><td width=170 style='width:127.5pt'><p>ESR</p></td><td width=20 style='width:15.0pt'><p>:</p></td><td width=120 style='width:90.0pt'><p>12</p></td><td width=120 style='width:90.0pt'><p>mm/1st hr</p></td><td width=194 style='width:145.5pt'><p>0 - 15</p></td></tr>
</table>`;

/** The same table with no width stated anywhere — Word writes plenty of these. */
const NO_WIDTHS = `<table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0 style='border-collapse:collapse'>
 <tr><td><p>Test</p></td><td><p>Result</p></td><td><p>Unit</p></td></tr>
 <tr><td><p>Haemoglobin</p></td><td><p>13.5</p></td><td><p>gm/dl</p></td></tr>
</table>`;

const STATED = [170, 20, 120, 120, 194];

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

/** Paste `html` and measure what the editor did with it. */
async function pasteInto(page: Page, html: string) {
  await openEditor(page);
  await page.click("[data-slate-editor]");
  await page.evaluate(async (source) => {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([source], { type: "text/html" }),
        "text/plain": new Blob([""], { type: "text/plain" }),
      }),
    ]);
  }, html);
  await page.keyboard.press("Control+V");
  await page.waitForTimeout(400);

  const measured = await page.evaluate(() => {
    const editable = document.querySelector("[data-slate-editor]")!;
    const table = editable.querySelector("table")!;
    const block = table.closest('[data-slate-node="element"]')!;
    return {
      block: block.clientWidth,
      scrollWidth: block.scrollWidth,
      cells: Array.from(editable.querySelectorAll("table tr:first-child td:not(.w-2)")).map((c) =>
        Math.round(c.getBoundingClientRect().width)
      ),
    };
  });
  const total = measured.cells.reduce((a, b) => a + b, 0);
  return { ...measured, total };
}

for (const viewport of [1440, 1024]) {
  test.describe(`@${viewport}`, () => {
    test.use({ viewport: { width: viewport, height: 900 } });

    test(`@${viewport}: the pasted table spans the editor, not half of it`, async ({ page }) => {
      const { block, total } = await pasteInto(page, WORD_TABLE);
      expect(total, `${total}px of ${block}px`).toBeGreaterThan(block - 24);
    });

    test(`@${viewport}: nothing overflows into a scrollbar`, async ({ page }) => {
      const { block, scrollWidth } = await pasteInto(page, WORD_TABLE);
      expect(scrollWidth).toBeLessThanOrEqual(block);
    });

    test(`@${viewport}: the columns keep Word's proportions`, async ({ page }) => {
      const { cells, total } = await pasteInto(page, WORD_TABLE);
      const statedTotal = STATED.reduce((a, b) => a + b, 0);
      expect(cells).toHaveLength(STATED.length);
      const held = cells.every(
        (width, i) => Math.abs(width / total - STATED[i] / statedTotal) < 0.01
      );
      expect(held, cells.join(" / ")).toBe(true);
    });
  });
}

test.describe("a table stating no widths", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("a table stating no widths at all also fills the editor", async ({ page }) => {
    const { block, total } = await pasteInto(page, NO_WIDTHS);
    expect(total, `${total}px of ${block}px`).toBeGreaterThan(block - 24);
  });

  test("and splits it evenly", async ({ page }) => {
    const { cells } = await pasteInto(page, NO_WIDTHS);
    expect(Math.max(...cells) - Math.min(...cells), cells.join(" / ")).toBeLessThanOrEqual(1);
  });
});
