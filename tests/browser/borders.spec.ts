/**
 * Does a borderless Word table stay borderless — on screen and in the saved HTML?
 *
 * Word uses borderless tables purely to align label / value columns (a form-
 * style header is exactly that). Drawing a grid for them is wrong in the editor and
 * wrong in print.
 */
import { expect, test, type Page } from "@playwright/test";
import { EDITOR, openEditor } from "./support/harness";

const cell = (text: string) =>
  `<td style='border:none;padding:0cm 5.4pt'><p class=MsoNormal>${text}</p></td>`;
const ROWS = [
  ["Rate", "85 b/min"],
  ["Rhythm", "Regular"],
  ["P-Wave", "Normal"],
  ["Impression", "Findings are within normal limit."],
];
const BORDERLESS =
  `<table class=MsoNormalTable border=0 cellspacing=0 cellpadding=0 style='border-collapse:collapse;border:none'>` +
  ROWS.map(([k, v]) => `<tr>${cell(k)}${cell(":")}${cell(v)}</tr>`).join("") +
  `</table>`;
const BORDERED =
  `<table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0 style='border-collapse:collapse'>` +
  `<tr><td style='border:solid windowtext 1.0pt'><p>Test</p></td><td style='border:solid windowtext 1.0pt'><p>Result</p></td></tr></table>`;

/** Every drawn border width of every cell, and the HTML the editor saves. */
async function borderWidths(page: Page, html: string) {
  await openEditor(page, html);
  return page.evaluate((sel) => {
    const cells = Array.from(document.querySelectorAll("[data-slate-editor] table td:not(.w-2)"));
    const widths = cells.map((c) => {
      const cs = getComputedStyle(c);
      // The visible line is drawn on the ::before overlay, not the td itself.
      const pb = getComputedStyle(c, "::before");
      return [cs.borderTopWidth, cs.borderBottomWidth, pb.borderTopWidth, pb.borderBottomWidth].map(
        (v) => parseFloat(v) || 0
      );
    });
    // Serialize through the editor rather than reading the textarea, which
    // still holds the seeded HTML until a change flushes it.
    return { widths, saved: (window as any).TrodadRichTextEditor.getHtml(sel) as string };
  }, EDITOR);
}

test.describe("a borderless Word table", () => {
  test("borderless table renders with NO visible cell borders", async ({ page }) => {
    const off = await borderWidths(page, BORDERLESS);
    expect(Math.max(...off.widths.flat()), "max border width").toBe(0);
  });

  // Every border declaration in the saved HTML is an explicit `border: 0`.
  // Stated rather than omitted because the print pages supply the border-style
  // Word leaves off, and an edge left unsaid picks that up at CSS's `medium`
  // width — silence prints as a 3px black box.
  test("borderless table saves without borders", async ({ page }) => {
    const off = await borderWidths(page, BORDERLESS);
    const declarations = off.saved.match(/border(-top|-right|-bottom|-left)?:[^;"]*/g) ?? [];
    expect(declarations.length, "no border declarations at all").toBeGreaterThan(0);
    for (const d of declarations) expect(d).toMatch(/^border:\s*0$/);
  });

  test('borderless table saves without border="1"', async ({ page }) => {
    const off = await borderWidths(page, BORDERLESS);
    expect(off.saved).not.toContain('border="1"');
  });

  test("borderless content survives", async ({ page }) => {
    const off = await borderWidths(page, BORDERLESS);
    expect(off.saved).toContain("85 b/min");
    expect(off.saved).toContain("Impression");
  });
});

test.describe("a bordered Word table", () => {
  test("a genuinely bordered table still shows borders", async ({ page }) => {
    const on = await borderWidths(page, BORDERED);
    expect(Math.max(...on.widths.flat()), "max border width").toBeGreaterThan(0);
  });

  test("bordered table saves with borders", async ({ page }) => {
    const on = await borderWidths(page, BORDERED);
    expect(on.saved).toMatch(/border(-top|-right|-bottom|-left)?:\s*1px/);
  });
});
