/**
 * Does the printed document look like the one in the editor?
 *
 * The editor is where a document is written, so it is the reference for
 * what the document IS — and the print page used to draw the same HTML with a
 * different font at a different size, a paragraph with no padding, a 1.1 line box
 * inside every cell, a 40px list indent and `table-layout: auto`, which spread a
 * 700px table across the whole page. This measures both and compares what a
 * reader would see.
 *
 * The print page is measured under PRINT media on purpose: its `body p` and
 * `table td` font declarations live inside `@media print`, so a screen-media
 * comparison would pass whether or not they were ever dealt with.
 *
 * Everything goes through the ROUND TRIP: the document is opened in the editor
 * and it is the editor's own serialized output that the print page is given,
 * which is exactly what the database holds.
 *
 * The editor is loaded WITH Bootstrap, because that is what decides how it
 * looks on a Bootstrap host page: the whole Tailwind sheet is emitted inside
 * `@layer`, and an unlayered Bootstrap declaration beats a layered one at any
 * specificity. So a heading is 500-weight and a list is indented 2rem here,
 * whatever the editor's own classes ask for — which is the reason this file
 * measures instead of asserting numbers read off a class list.
 *
 * The print page is a real host's: a server-rendered print view, its
 * head CSS extracted to tests/fixtures/host-print-page.css, with the
 * package's dist/content.css on top of it.
 */
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { EDITOR, openEditor, openPage } from "./support/harness";

const ROOT = process.cwd();

/** The <style> element in the print page's head, with its include resolved. */
const PRINT_PAGE_CSS = fs.readFileSync(path.join(ROOT, "tests/fixtures/host-print-page.css"), "utf8");

/** The package's read-only stylesheet: what a print page puts on top of its own. */
const PARITY_CSS = fs.readFileSync(path.join(ROOT, "dist/content.css"), "utf8");

/** The legacy script ran at this size, on Playwright's bundled Chromium. */
const VIEWPORT = { width: 1200, height: 900 };
test.use({ viewport: VIEWPORT });

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  return context.newPage();
}

/**
 * A document of the shape these pages carry — a sized and centred title, body text
 * that states NO size (the case the two pages disagreed about), a blank line, a
 * bordered Word table with Word's own cell gutter, a list — plus every other block
 * and mark the editor can produce, so a change to any of them is caught here.
 */
const REPORT =
  `<p style="text-align: center"><span style="font-size: 20px"><strong>CT SCAN OF BRAIN</strong></span></p>` +
  `<p>Plain axial sections of the brain were obtained.</p>` +
  `<p><br/></p>` +
  `<h1>Findings</h1><h2>Technique</h2><h3>Level three</h3>` +
  `<h4>Level four</h4><h5>Level five</h5><h6>Level six</h6>` +
  `<table border="1" cellspacing="0" style="border-collapse:collapse">` +
  `<tr><td style="border:solid windowtext 1.0pt;padding:0cm 5.4pt"><p><strong>Finding</strong></p></td>` +
  `<td style="border:solid windowtext 1.0pt;padding:0cm 5.4pt"><p>Impression</p></td></tr>` +
  `<tr><td style="border:solid windowtext 1.0pt;padding:0cm 5.4pt"><p>Ventricles are normal in size and shape with no evidence of midline shift.</p></td>` +
  `<td style="border:solid windowtext 1.0pt;padding:0cm 5.4pt"><p>Normal</p></td></tr></table>` +
  `<p>Advised:</p>` +
  `<ul><li>Clinical correlation</li><li>Follow up<ul><li>After six weeks</li></ul></li></ul>` +
  `<ol><li>Repeat if symptomatic</li></ol>` +
  `<blockquote>Reported on the images provided.</blockquote>` +
  `<hr />` +
  `<p><a href="https://example.test">reference</a> <code>ICD-10</code> <mark>note</mark> <em>lat.</em> <u>sic</u> <s>old</s></p>` +
  // Everything a document states about ITSELF, which is the half that has to travel
  // inline through the serializer: alignment, indent, an explicit line height,
  // colour and shading, sub/superscript — and the two table shapes a pasted
  // document actually uses, a bordered grid and the borderless label/value table
  // Word lines its columns up with.
  `<p style="text-align: right">Right aligned</p>` +
  `<p style="text-align: justify; margin-left: 80px">Indented and justified body text that is long enough to need a second line on the page.</p>` +
  `<p style="line-height: 2"><span style="font-size: 11pt">Eleven point on a double line.</span></p>` +
  `<p><span style="color: #c00000; background-color: #ffff00; font-family: 'Times New Roman', serif">Coloured</span> H<sub>2</sub>O and m<sup>3</sup></p>` +
  `<table border="0" cellspacing="0" style="border-collapse:collapse"><tr>` +
  `<td style="border:none;padding:0cm 5.4pt;width:120pt"><p>Specimen</p></td>` +
  `<td style="border:none;padding:0cm 5.4pt"><p>: Whole Blood</p></td></tr>` +
  `<tr><td colspan="2" style="border:none;padding:0cm 5.4pt;background:#eeeeee"><p>Spanned and shaded</p></td></tr></table>` +
  `<p>End of Report</p>`;

/**
 * What a reader can actually see, for every block and mark the document draws.
 *
 * The two DOMs are not the same shape — the editor wraps a table in a scroll box,
 * puts a control column in front of every row and the cell's gutter on a box
 * inside it, and gives a list item's content a `lic` div of its own — so each kind
 * of node is looked up by the selector that finds it on that side, and the gutter
 * is read off whichever box carries it.
 */
const MEASURE = `(root, sels) => {
  const round = (n) => Math.round(n * 10) / 10;
  const label = (el) => (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 28);
  const control = root.querySelector('td.w-2');
  const controlWidth = control ? control.getBoundingClientRect().width : 0;
  /** The space above and below a node, wherever it is declared. */
  const space = (el, boxCs, cs) => [
    (boxCs ? parseFloat(boxCs.paddingTop) : 0) + parseFloat(cs.marginTop),
    (boxCs ? parseFloat(boxCs.paddingBottom) : 0) + parseFloat(cs.marginBottom),
  ].join(' / ');
  const read = (el, kind) => {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const gutter = el.firstElementChild && el.firstElementChild.tagName === 'DIV' && kind === 'cell'
      ? getComputedStyle(el.firstElementChild) : cs;
    const out = {
      label: label(el),
      fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
      fontStyle: cs.fontStyle, lineHeight: cs.lineHeight, color: cs.color,
      textAlign: cs.textAlign, letterSpacing: cs.letterSpacing,
      textDecorationLine: cs.textDecorationLine,
      margin: [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft].join(' '),
      padding: [gutter.paddingTop, gutter.paddingRight, gutter.paddingBottom, gutter.paddingLeft].join(' '),
      height: round(rect.height),
    };
    if (kind === 'list') { out.listStyleType = cs.listStyleType; }
    if (kind === 'cell') { out.verticalAlign = cs.verticalAlign; out.width = round(rect.width); }
    if (kind === 'table') {
      out.tableLayout = cs.tableLayout;
      out.borderCollapse = cs.borderCollapse;
      out.width = round(rect.width - controlWidth);
      out.rows = el.rows.length;
      // The scroll box's own padding is the editor's gap around a table; on the
      // page it is the table's own margin. Compared as one number either way, and
      // the raw margin is dropped so the box is not counted twice.
      const box = el.closest('.slate-table');
      out.gap = space(el, box && getComputedStyle(box), cs);
      delete out.margin;
    }
    if (kind === 'rule') {
      // Same shape: HrElement hangs its py-6 on a wrapper the page has no
      // counterpart for, so what is compared is the total space around the rule.
      const box = el.parentElement && el.parentElement.getAttribute('contenteditable') === 'false'
        ? el.parentElement : null;
      out.gap = space(el, box && getComputedStyle(box), cs);
      delete out.margin;
    }
    if (kind === 'inline') { delete out.height; delete out.margin; }
    return out;
  };
  const out = {};
  for (const [kind, sel] of Object.entries(sels)) {
    out[kind] = [...root.querySelectorAll(sel)]
      .filter((el) => !el.classList.contains('w-2'))
      .map((el) => read(el, kind.replace(/[0-9]+$/, '')));
  }
  return out;
}`;

type Measured = Record<string, string | number>;

/** Same nodes, named the way each side spells them. */
const EDITOR_SELECTORS = {
  paragraph: ".slate-p",
  heading: "h1, h2, h3, h4, h5, h6",
  list: "ul, ol",
  item: "li",
  blockquote: "blockquote",
  rule: "hr",
  table: "table",
  row: "tr",
  cell: "td, th",
  inline: "a, code, mark, strong, em, u, s",
};
const PRINT_SELECTORS = { ...EDITOR_SELECTORS, paragraph: "p" };

function printHtml(body: string, css: string) {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>${css}</style>
<style>${PARITY_CSS}</style>
</head>
<body class="native-print-layout">
<div class="content main_data rte-content" id="rb" style="margin-top: 10px;">${body}</div>
</body></html>`;
}

/**
 * A blank line is the ONE thing the page deliberately does not copy.
 *
 * A reopened `<p><br/></p>` reads back into the editor as the text "\n", and the
 * editable is `white-space: pre-wrap`, so the editor draws it as TWO lines where
 * the same markup is one line everywhere it is read. That is a known editor
 * defect, left open on purpose — see the block-font-size notes, and do not close
 * it by dropping the block-ending `<br>`, which was tried and reverted (see the
 * editor-whitespace notes). The page is the side that is right, so it keeps the
 * single line the document asks for.
 */
const isBlankLine = (kind: string, node: Measured) => kind === "paragraph" && node.label === "";

/**
 * How much a laid-out value may differ.
 *
 * A pixel, except a table's height. The editor paints a cell's borders as an
 * inset `::before` overlay so that a border never changes the layout (see
 * components/ui/table-node.tsx); on paper they are REAL collapsed borders, and a
 * collapsed 1px rule adds half a pixel to the row above it and half to the row
 * below. That is about a pixel per row, and it is not something either side
 * should change: an overlay is what lets the editor draw a pencil guide on a
 * borderless table, and a real border is what a printer puts on the page.
 */
const slack = (kind: string, key: string, ed: Measured) =>
  kind === "table" && key === "height" ? 2 + (Number(ed.rows) || 0) : 1;

test.describe("the printed document looks like the one in the editor", () => {
  test.describe.configure({ mode: "default" });

  let editor: Record<string, Measured[]>;
  let print: Record<string, Measured[]>;

  test.beforeAll(async ({ browser }) => {
    const page = await newPage(browser);
    await openEditor(page, REPORT);

    // What the database would hold, and the width the editor drew it at.
    const stored = await page.evaluate(
      (sel) => (window as any).TrodadRichTextEditor.getHtml(sel) as string,
      EDITOR
    );
    const contentWidth = await page.evaluate(() => {
      const ed = document.querySelector("#content_editor [data-slate-editor]") as HTMLElement;
      const cs = getComputedStyle(ed);
      return ed.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    });
    editor = await page.evaluate(
      `(${MEASURE})(document.querySelector('#content_editor [data-slate-editor]'), ${JSON.stringify(EDITOR_SELECTORS)})`
    );

    await page.emulateMedia({ media: "print" });
    await openPage(page, printHtml(stored, PRINT_PAGE_CSS));
    await page.evaluate((w) => {
      document.getElementById("rb")!.style.width = `${w}px`;
    }, contentWidth);
    print = await page.evaluate(
      `(${MEASURE})(document.getElementById('rb'), ${JSON.stringify(PRINT_SELECTORS)})`
    );
    await page.context().close();
  });

  // One test per kind of node; every property of every node is its own soft
  // check, labelled `kind[i] "text" property` as the legacy script printed it.
  for (const kind of Object.keys(EDITOR_SELECTORS)) {
    test(kind, () => {
      const a = editor[kind];
      const b = print[kind];
      expect(b.length, `${kind}: same number of nodes — editor ${a.length}, print ${b.length}`).toBe(
        a.length
      );
      a.forEach((ed, i) => {
        const pr = b[i];
        for (const key of Object.keys(ed)) {
          if (key === "label" || key === "rows") continue;
          const label = `${kind}[${i}] "${ed.label}" ${key}`;
          const detail = `editor ${ed[key]} / print ${pr[key]}`;
          if (key === "height" || key === "width") {
            const diff = Math.abs(Number(ed[key]) - Number(pr[key]));
            if (diff > slack(kind, key, ed) && key === "height" && isBlankLine(kind, ed)) {
              test.info().annotations.push({
                type: "known",
                description: `${label} — the editor draws a reopened blank line as two lines (${detail})`,
              });
              continue;
            }
            expect.soft(diff, `${label} — ${detail}`).toBeLessThanOrEqual(slack(kind, key, ed));
          } else {
            expect.soft(ed[key], `${label} — ${detail}`).toBe(pr[key]);
          }
        }
      });
    });
  }
});

/**
 * Three tables of the shape a real document carries, serialized the way the editor
 * writes them: a `<colgroup>` in px and `width: 100%` on the table, which is what
 * the serializer emits for EVERY table (the editor takes its width from
 * `colSizes` and never puts one on the node).
 *
 * The first is a real header table — 205+249+222+230 = 906px of columns
 * against A4's ~718px of printable width. The second is comfortably narrower than
 * the page. The third is a real findings table: five columns, but three
 * cells to a row because the label spans the first three of them, which is the
 * shape a `SPANNED_COLS`-wide document is actually typed in.
 */
const WIDE_COLS = [205, 249, 222, 230];
const NARROW_COLS = [120, 140];
const cellsFor = (cols: number[]) =>
  cols
    .map(
      () =>
        `<td style="border: 0; border-top: 1px solid #000; border-right: 1px solid #000; border-bottom: 1px solid #000; border-left: 1px solid #000; padding: 0px 7.68px"><p style="font-size: 15px">Cell</p></td>`
    )
    .join("");
const tableFor = (cols: number[]) =>
  `<table border="1" style="border-collapse: collapse; width: 100%;"><colgroup>` +
  cols.map((w) => `<col style="width: ${w}px" />`).join("") +
  `</colgroup><tr>${cellsFor(cols)}</tr></table>`;

/**
 * `label | : | value` over five columns, the label spanning the first three —
 * 130+130+130+47+999 = 1436px, twice the printable width. The cells no longer line
 * up with the columns, which is the case that used to print column 0 at 0px wide
 * and "Uterus" one letter per line.
 */
const SPANNED_COLS = [130, 130, 130, 47, 999];
const SPANNED_CELLS = [3, 1, 1];
const spannedTable = () =>
  `<table border="0" style="border-collapse: collapse; width: 100%;"><colgroup>` +
  SPANNED_COLS.map((w) => `<col style="width: ${w}px" />`).join("") +
  `</colgroup>` +
  ["Uterus", "No of fetus"]
    .map(
      (label, row) =>
        `<tr>` +
        SPANNED_CELLS.map(
          (span, i) =>
            `<td${span > 1 ? ` colspan="${span}"` : ""} style="border: 0; padding: 0px 7.2px; vertical-align: top">` +
            `<p style="font-size: 15px">${[label, ":", row ? "Single." : "Gravid."][i]}</p></td>`
        ).join("") +
        `</tr>`
    )
    .join("") +
  `</table>`;

const A4_REPORT =
  tableFor(WIDE_COLS) +
  `<p>Between the tables.</p>` +
  tableFor(NARROW_COLS) +
  `<p>And before the spanned one.</p>` +
  spannedTable();

/**
 * `fromEditor` false is a page whose HTML was saved by another editor (legacy
 * HTML). The host page forks on exactly two things for it, and this reproduces
 * both: no `rte-content` class, and no parity stylesheet. The body is wrapped in a paragraph the way the host
 * template wraps it, too.
 *
 * The fit hook is the package's own `fitTablesToPage`, loaded from the
 * built standalone bundle and called with the selector the host page used.
 */
function fitHtml(css: string, fromEditor = true) {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>${css}</style>
${fromEditor ? `<style>${PARITY_CSS}</style>` : ""}
</head>
<body class="native-print-layout">
<div class="customer_copy report_page">
  <div class="content">
    <div class="content main_data${fromEditor ? " rte-content" : ""}" id="rb" style="width: 100%; margin-top: 10px;">${
      fromEditor ? A4_REPORT : `<p>${A4_REPORT} </p>`
    }</div>
  </div>
</div>
<script type="module" src="/dist/standalone/rich-text-editor.js"></script>
</body></html>`;
}

/** Open a fit page under screen media and wait for the package bundle. */
async function openFitPage(page: Page, html: string) {
  await page.emulateMedia({ media: "screen" });
  await openPage(page, html);
  await page.waitForFunction(() => !!(window as any).TrodadRichTextEditor);
}

const fitTablesToPage = (page: Page) =>
  page.evaluate(() =>
    (window as any).TrodadRichTextEditor.fitTablesToPage({ selector: ".main_data table" })
  );

/**
 * Does a table still fit the page once it is laid out at the width of one?
 *
 * This is the case the comparison above cannot see: it measures both sides at the
 * EDITOR's content width, where nothing is too wide for its container. A printed
 * page is ~718px, most pasted tables are wider than that, and the page
 * has a hook of its own — `fitTablesToPage()` — that re-expresses an
 * oversized table's columns as percentages so fixed layout can scale them down.
 *
 * That hook only ever ran on FIXED-layout tables, so before the document body was
 * laid out `fixed` it found none and did nothing. Now that it fires, its
 * `width: 100%` has to beat the `width: auto !important` that lets a NARROW table
 * keep the natural width the editor draws it at — otherwise the percentage columns
 * it just wrote have nothing to be a percentage of, and the table collapses to its
 * content: measured at 48% of the page, hugging the left, which is what a user
 * reported.
 *
 * Checked under screen media at a wide viewport, because that is where the hook
 * fires: on this page the shared print stylesheet is included INSIDE `@media
 * print`, so the 190mm page box does not exist until the printer does.
 */
const PRINTABLE_WIDTH = 605; // what `.report_page` is left with inside the A4 page box

test.describe("page fit", () => {
  test.describe.configure({ mode: "default" });

  type Fitted = { width: number; left: number; room: number; ratios: number[] };
  let wide: Fitted;
  let narrow: Fitted;
  let spanned: Fitted;
  let atPageWidth: { width: number; columns: number[] }[];

  const ratio = (ws: number[]) => {
    const t = ws.reduce((a, b) => a + b, 0);
    return ws.map((w) => Math.round((w / t) * 1000) / 10);
  };

  test.beforeAll(async ({ browser }) => {
    const page = await newPage(browser);
    await openFitPage(page, fitHtml(PRINT_PAGE_CSS));
    await fitTablesToPage(page);
    const got = await page.evaluate(() => {
      const host = document.getElementById("rb")!;
      const room = host.getBoundingClientRect();
      return [...host.querySelectorAll("table")].map((t) => {
        const r = t.getBoundingClientRect();
        return {
          width: Math.round(r.width),
          left: Math.round(r.left - room.left),
          room: Math.round(room.width),
          ratios: [...t.rows[0].cells].map((c) => c.getBoundingClientRect().width),
        };
      });
    });

    // The columns again, with the host squeezed to the printable width. The fit runs
    // under SCREEN media at whatever the window happens to be, and a leftover px
    // column only eats the whole table once there is less room than it asks for —
    // which is the printer, not the window the operator clicked Print in.
    atPageWidth = await page.evaluate((printable) => {
      (document.querySelector(".report_page") as HTMLElement).style.width = printable + "px";
      return [...document.querySelectorAll("#rb table")].map((t) => ({
        width: Math.round(t.getBoundingClientRect().width),
        columns: [...t.querySelectorAll("col")].map((c) => Math.round(c.getBoundingClientRect().width)),
      }));
    }, PRINTABLE_WIDTH);

    [wide, narrow, spanned] = got;
    await page.context().close();
  });

  test("page fit: an oversized table fills the page", () => {
    expect(Math.abs(wide.width - wide.room), `table ${wide.width} / room ${wide.room}`).toBeLessThanOrEqual(2);
  });

  test("page fit: an oversized table starts at the left margin", () => {
    expect(Math.abs(wide.left), `left ${wide.left}`).toBeLessThanOrEqual(2);
  });

  test("page fit: its column ratios survive being scaled down", () => {
    const want = ratio(WIDE_COLS);
    const have = ratio(wide.ratios);
    expect(
      have.every((r, i) => Math.abs(r - want[i]) <= 1.5),
      `${have.join("/")} want ${want.join("/")}`
    ).toBe(true);
  });

  // The parity half of the same rule: a table the page has room for is left at the
  // width the editor draws it at, rather than stretched to the full page.
  test("page fit: a table narrower than the page keeps its natural width", () => {
    const naturalNarrow = NARROW_COLS.reduce((a, b) => a + b, 0);
    expect(
      Math.abs(narrow.width - naturalNarrow),
      `table ${narrow.width} / natural ${naturalNarrow}`
    ).toBeLessThanOrEqual(2);
  });

  // A spanned table is fitted by COLUMN. Mapping the three cells of a row onto the
  // five <col> elements by cell index left columns 3 and 4 at 47px and 999px — a
  // hard 1046px minimum inside a table pinned to `width: 100%` — so the three
  // percentage columns were squeezed to nothing and the table ran off the page.
  test("page fit: a table with spanned columns fills the page, and no more", () => {
    expect(
      Math.abs(spanned.width - spanned.room),
      `table ${spanned.width} / room ${spanned.room}`
    ).toBeLessThanOrEqual(2);
  });

  test("page fit: every column of a spanned table survives the printable width", () => {
    const onPage = atPageWidth[2];
    expect(
      onPage.columns.length === SPANNED_COLS.length &&
        onPage.columns.every((w) => w > 0) &&
        onPage.width <= PRINTABLE_WIDTH + 2,
      `table ${onPage.width} / ${PRINTABLE_WIDTH}, columns ${onPage.columns.join("/")}`
    ).toBe(true);
  });

  test("page fit: a spanned table keeps its column ratios", () => {
    const wantSpanned = ratio(
      SPANNED_CELLS.map((span, i) => {
        const from = SPANNED_CELLS.slice(0, i).reduce((a, b) => a + b, 0);
        return SPANNED_COLS.slice(from, from + span).reduce((a, b) => a + b, 0);
      })
    );
    const have = ratio(spanned.ratios);
    expect(
      have.every((r, i) => Math.abs(r - wantSpanned[i]) <= 1.5),
      `${have.join("/")} want ${wantSpanned.join("/")}`
    ).toBe(true);
  });
});

/**
 * The fit hook selects `.main_data table`, and `.main_data` is on the body of
 * EVERY page the host prints — so pages holding legacy HTML run it too.
 *
 * What keeps it off them is its first line: `table-layout` has to compute to
 * `fixed`, and the only rule on this page that says so for a body table is
 * `.rte-content table`, which this editor's HTML alone gets. Nothing else may start
 * laying body tables out fixed, and the hook may never stop checking — either
 * would put it to work on legacy HTML it has never been measured against.
 *
 * (A table that states `table-layout: fixed` INLINE — some old MS-Word pastes do,
 * e.g. two real documents in the host's database — is fitted whatever the page, and always
 * has been. That is the hook doing its job on a table 1095px wide over a 605px
 * page, so it is deliberately not asserted away here.)
 */
test.describe("legacy HTML path", () => {
  test.describe.configure({ mode: "default" });

  type Snapshot = { layout: string; width: string; cols: string[]; cells: string[] }[];
  let before: Snapshot;
  let after: Snapshot;

  const snapshot = (page: Page) =>
    page.evaluate(() =>
      [...document.querySelectorAll("#rb table")].map((t) => ({
        layout: getComputedStyle(t).tableLayout,
        width: (t as HTMLElement).style.width,
        cols: [...t.querySelectorAll("col")].map((c) => c.style.width),
        cells: [...t.querySelectorAll("td")].map((c) => c.style.width),
      }))
    );

  test.beforeAll(async ({ browser }) => {
    const page = await newPage(browser);
    await openFitPage(page, fitHtml(PRINT_PAGE_CSS, false));
    before = await snapshot(page);
    await fitTablesToPage(page);
    after = await snapshot(page);
    await page.context().close();
  });

  test("legacy HTML path: a table is laid out auto, not fixed", () => {
    expect(before.length).toBeGreaterThan(0);
    expect(before.map((t) => t.layout)).toEqual(before.map(() => "auto"));
  });

  test("legacy HTML path: the fit hook leaves every table exactly as it found it", () => {
    expect(after).toEqual(before);
  });
});
