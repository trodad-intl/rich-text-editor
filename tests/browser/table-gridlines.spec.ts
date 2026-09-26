/**
 * Can you SEE a borderless table?
 *
 * A gridline is drawn on every edge a table leaves blank, so the author can
 * tell where the cells are, and nothing prints it. The documents these
 * tables come from are full of borderless ones — Word's usual way of lining up
 * a label / colon / value column is a table with every rule turned off — and
 * the editor drew them exactly as the printed page shows them, which is to
 * say invisibly: nothing on screen told a three-column table from three runs of
 * text, and there was nothing to aim a column-resize drag at.
 *
 * A browser test because this is a question about pseudo-elements and computed
 * styles, and because the other half of it is that the SAVED HTML must not
 * gain a single one of these lines.
 */
import { expect, test, type Page } from "@playwright/test";
import { getHtml, openEditor } from "./support/harness";

/** Word's spelling of a borderless layout table: the label / colon / value grid. */
const BORDERLESS = `<table class=MsoNormalTable border=0 cellspacing=0 cellpadding=0 style='border-collapse:collapse;border:none'>
  <tr><td style='border:none;padding:0cm 5.4pt'><p>Rate</p></td><td style='border:none;padding:0cm 5.4pt'><p>:</p></td><td style='border:none;padding:0cm 5.4pt'><p>85 b/min</p></td></tr>
  <tr><td style='border:none;padding:0cm 5.4pt'><p>Rhythm</p></td><td style='border:none;padding:0cm 5.4pt'><p>:</p></td><td style='border:none;padding:0cm 5.4pt'><p>Regular</p></td></tr>
</table>`;

const BORDERED = `<table border=1 cellspacing=0 cellpadding=2>
  <tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr>
</table>`;

interface Cell {
  document: string[];
  guide: string[];
  guideColor: string;
  onTheCell: boolean;
}

/**
 * Each cell's four sides, twice over: what the DOCUMENT draws (::before) and
 * what the editor adds to help you read it (::after). Kept apart on purpose —
 * tests/browser/table-border-design measures the first against a bare
 * browser's rendering of the same markup, where a dash this editor invented has
 * no business.
 */
const measure = (page: Page): Promise<Cell[][]> =>
  page.evaluate(() => {
    const SIDES = ["top", "right", "bottom", "left"];
    const rule = (el: Element, pseudo: string, side: string) => {
      const cs = getComputedStyle(el, pseudo);
      const width = Math.round(parseFloat(cs.getPropertyValue(`border-${side}-width`)) || 0);
      const style = cs.getPropertyValue(`border-${side}-style`);
      return width === 0 || style === "none" ? "-" : `${width}px ${style}`;
    };

    const rows = Array.from(document.querySelectorAll("[data-slate-editor] tr"));
    return rows.map((row) =>
      Array.from(row.children)
        .filter((c) => /^t[dh]$/i.test(c.tagName) && !c.classList.contains("w-2"))
        .map((cell) => {
          const box = cell.getBoundingClientRect();
          const cs = getComputedStyle(cell, "::after");
          return {
            document: SIDES.map((s) => rule(cell, "::before", s)),
            guide: SIDES.map((s) => rule(cell, "::after", s)),
            guideColor: cs.borderBottomColor,
            // Where the dashes actually land. An absolutely positioned
            // box with no offsets falls back to its STATIC position, and
            // ::after's is AFTER the content — so without `inset-0` the
            // guide is drawn a whole cell-height below its cell, which
            // reads as a stray tick under the table and is invisible to
            // any check that only asks what the border looks like.
            onTheCell:
              cs.top === "0px" &&
              cs.left === "0px" &&
              Math.round(parseFloat(cs.width)) === Math.round(box.width) &&
              Math.round(parseFloat(cs.height)) === Math.round(box.height),
          };
        })
    );
  });

async function open(page: Page, initialHtml: string) {
  page.on("pageerror", (e) => console.log("PAGEERROR", String(e)));
  await openEditor(page, initialHtml);
  await page.waitForTimeout(250);
  return measure(page);
}

// A borderless table: the document draws nothing, the editor draws dashes.
test.describe("A borderless table", () => {
  const every = (grid: Cell[][], fn: (cell: Cell, r: number, c: number) => boolean) =>
    grid.every((row, r) => row.every((cell, c) => fn(cell, r, c)));

  // Plate's collapse emulation hands a cell its bottom and right, plus a top
  // in the first row and a left in the first column, so every edge of the
  // grid is guided exactly once and no interior line is doubled.
  const [top, right, bottom, left] = [0, 1, 2, 3];
  // The same 1px solid rule the table would have if it were bordered — a
  // pencil line, not a different kind of line. Only its colour says it is the
  // editor's and not the document's.
  const drawn = (s: string) => s === "1px solid";

  test("the table is there", async ({ page }) => {
    const grid = await open(page, BORDERLESS);
    const detail = JSON.stringify(grid.map((r) => r.length));
    expect(grid.length, detail).toBe(2);
    expect(grid[0].length, detail).toBe(3);
  });

  test("the document still draws no rule anywhere — the saved HTML is unchanged", async ({ page }) => {
    const grid = await open(page, BORDERLESS);
    expect(grid.flat().map((cell) => cell.document)).toEqual(
      grid.flat().map(() => ["-", "-", "-", "-"])
    );
  });

  test("every cell guides the two edges it owns", async ({ page }) => {
    const grid = await open(page, BORDERLESS);
    expect(
      every(grid, (cell) => drawn(cell.guide[bottom]) && drawn(cell.guide[right])),
      JSON.stringify(grid[0][0].guide)
    ).toBe(true);
  });

  test("the first row guides the top of the table, and no other row does", async ({ page }) => {
    const grid = await open(page, BORDERLESS);
    expect(
      every(grid, (cell, r) => drawn(cell.guide[top]) === (r === 0)),
      JSON.stringify(grid.map((row) => row.map((cell) => cell.guide[top])))
    ).toBe(true);
  });

  test("the first column guides the left of the table, and no other column does", async ({
    page,
  }) => {
    const grid = await open(page, BORDERLESS);
    expect(
      every(grid, (cell, _r, c) => drawn(cell.guide[left]) === (c === 0)),
      JSON.stringify(grid.map((row) => row.map((cell) => cell.guide[left])))
    ).toBe(true);
  });

  test("and each cell's guide is drawn on that cell, not below it", async ({ page }) => {
    const grid = await open(page, BORDERLESS);
    expect(grid.flat().map((cell) => cell.onTheCell)).toEqual(grid.flat().map(() => true));
  });

  // A pencil line, not the document's ink: it has to read as lighter than a
  // real rule or the borderless table looks like a bordered one.
  test("and it is drawn in pencil, far lighter than the text it sits around", async ({ page }) => {
    const grid = await open(page, BORDERLESS);
    const ink = await page.evaluate(
      () => getComputedStyle(document.querySelector("[data-slate-editor]")!).color
    );
    //
    // Composited over the page, because the guide states its colour as an alpha
    // over the editor's ink — and Chrome reports that as `color(srgb r g b / a)`
    // with the channels 0-1, not as an `rgb()` with them 0-255.
    const luminance = (c: string) => {
      const n = c.match(/[\d.]+/g)!.map(Number);
      const scale = c.startsWith("color(") ? 255 : 1;
      const [r, g, b] = n.slice(0, 3).map((v) => v * scale);
      const a = n[3] ?? 1;
      const over = (v: number) => 255 * (1 - a) + v * a;
      return 0.2126 * over(r) + 0.7152 * over(g) + 0.0722 * over(b);
    };
    expect(
      luminance(grid[0][0].guideColor),
      `${grid[0][0].guideColor} against ${ink}`
    ).toBeGreaterThan(luminance(ink) + 150);
  });

  test("and none of it reaches the saved HTML", async ({ page }) => {
    await open(page, BORDERLESS);
    const html = await getHtml(page);
    expect(html, html.slice(0, 120)).toContain("border: 0");
    expect(html, html.slice(0, 120)).not.toMatch(/border-(top|right|bottom|left):/);
  });

  test("which still says the table is borderless", async ({ page }) => {
    await open(page, BORDERLESS);
    const html = await getHtml(page);
    expect(html, html.slice(0, 80)).toContain('<table border="0"');
  });
});

// A table with real rules needs no help and gets none.
test.describe("A bordered table", () => {
  test("a bordered table draws its own rules", async ({ page }) => {
    const grid = await open(page, BORDERED);
    expect(
      grid.every((row) => row.every((cell) => cell.document.some((side) => side !== "-"))),
      JSON.stringify(grid[0][0].document)
    ).toBe(true);
  });

  test("and gets no guides on top of them", async ({ page }) => {
    const grid = await open(page, BORDERED);
    expect(grid.flat().map((cell) => cell.guide)).toEqual(
      grid.flat().map(() => ["-", "-", "-", "-"])
    );
  });
});
