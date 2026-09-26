/**
 * Are a pasted table's column widths reproduced exactly?
 */
import { expect, test } from "@playwright/test";
import { EDITOR, openEditor } from "./support/harness";

const cases: { name: string; html: string; expect: number[] | null }[] = [
  {
    name: "colgroup px 100/40/300",
    html: `<table><colgroup><col width="100"><col width="40"><col width="300"></colgroup><tr><td>Rate</td><td>:</td><td>85 b/min</td></tr></table>`,
    expect: [100, 40, 300],
  },
  {
    name: "Word pt 85/21/212  (=113/28/283px)",
    html: `<table border=1><tr><td style='width:85.0pt'>Rate</td><td style='width:21.0pt'>:</td><td style='width:212.0pt'>85 b/min</td></tr></table>`,
    expect: [113, 28, 283],
  },
  {
    name: "td px 10/20/60 (extreme)",
    html: `<table><tr><td style="width:10px">A</td><td style="width:20px">B</td><td style="width:60px">C</td></tr></table>`,
    expect: [10, 20, 60],
  },
  {
    name: "EQUAL widths stated 200/200/200",
    html: `<table><colgroup><col width="200"><col width="200"><col width="200"></colgroup><tr><td>Rate</td><td>:</td><td>85 b/min</td></tr></table>`,
    expect: [200, 200, 200],
  },
  // Proportional: there is no exact px answer, so the legacy script only
  // reported what it rendered and never failed on it. Kept as a report.
  {
    name: "percent 20/10/70",
    html: `<table><tr><td style="width:20%">Rate</td><td style="width:10%">:</td><td style="width:70%">85 b/min</td></tr></table>`,
    expect: null,
  },
];

test.describe("pasted column widths", () => {
  for (const c of cases) {
    test(c.name, async ({ page }) => {
      await openEditor(page, c.html);
      const got = await page.evaluate(() => {
        const cells = document.querySelectorAll(
          "[data-slate-editor] table tr:first-child td:not(.w-2)"
        );
        return Array.from(cells).map((cell) => Math.round(cell.getBoundingClientRect().width));
      });
      const colSizes = await page.evaluate((sel) => {
        const m = ((window as any).TrodadRichTextEditor.getHtml(sel) as string).match(/width: (\d+)px/g);
        return m ? m.map((x) => parseInt(x.replace(/\D/g, ""), 10)) : null;
      }, EDITOR);
      test.info().annotations.push(
        { type: "rendered", description: got.join(" / ") },
        { type: "saved colgroup", description: colSizes ? colSizes.join(" / ") : "none" }
      );
      if (c.expect) expect(got).toEqual(c.expect);
    });
  }
});
