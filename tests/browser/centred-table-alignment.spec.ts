/**
 * A table the document only asked to PLACE in the middle of the page.
 *
 * The three-signature block at the foot of a document is a three-column table,
 * each cell left aligned, and the table itself centred on the page — which
 * Word, LibreOffice and legacy HTML write the pre-CSS way, as
 * `<div align=center>`, `<center>`, or a `text-align:center` on the wrapper.
 *
 * `inlineLegacyAlignment` restates those as CSS and pushes them down onto the
 * blocks inside, because a `<div>` is not a node in this editor and would take
 * its alignment with it when unwrapped. The selector reached straight through
 * the table into the paragraphs in its cells, so a signature block that reads
 * left aligned in the document arrived centred here.
 *
 * A browser does not do that: its own stylesheet says `table { text-align:
 * start }`, so the alignment stops at the table. That is what is measured
 * below — the same markup in a bare iframe, which is both what the document
 * showed the author and what the legacy editor put on screen.
 */
import { expect, test, type Page } from "@playwright/test";
import { openEditor, setHtml } from "./support/harness";

/** Left-aligned cells, three columns, no borders — a signature row. */
const SIGNATURES = [
  ["Quality  Technologist", "Department of Quality Assurance", "Riverside Community Services Company Ltd"],
  ["Dr. Sam Q. Rivera", "MBA. D. Econ, M.Phil (Business Laws)", "Professor &amp; Head"],
  ["DR. Alex J. Morgan-Reed", "MBA, MCPA(Fin. Acct), M.Phil (Business Law)", "Professor"],
];

const TABLE =
  `<table border=0 cellspacing=0 cellpadding=0 width=900 style='border-collapse:collapse'><tr>` +
  SIGNATURES.map(
    (lines) =>
      `<td valign=top style='padding:0cm 5.4pt'>` +
      lines.map((line) => `<p class=MsoNormal>${line}</p>`).join("") +
      `</td>`
  ).join("") +
  `</tr></table>`;

/**
 * `loose` marks the cases with a paragraph outside the table (`div > p`) — the
 * legacy script checked that half only when the bare browser found one, which
 * is this case alone.
 */
const CASES: { name: string; html: string; loose?: boolean }[] = [
  { name: "a table centred with div align=center", html: `<html><body><div align=center>${TABLE}</div></body></html>` },
  { name: "a table centred with <center>", html: `<html><body><center>${TABLE}</center></body></html>` },
  {
    name: "a table centred with CSS on the wrapper",
    html: `<html><body><div style='text-align:center'>${TABLE}</div></body></html>`,
  },
  {
    // The other half of the rule: alignment stated INSIDE the table is the
    // document aligning its text, and must still come through.
    name: "a row that really does centre its cells",
    html: `<html><body><table border=0><tr align=center><td><p class=MsoNormal>Dr. Sam Q. Rivera</p></td></tr></table></body></html>`,
  },
  {
    name: "a paragraph beside the table, which the wrapper really does align",
    html: `<html><body><div align=center><p class=MsoNormal>END OF REPORT</p>${TABLE}</div></body></html>`,
    loose: true,
  },
];

/** Chrome spells a centred table cell `-webkit-center`; it means `center`. */
const normalize = (align: string | null) => (align === "-webkit-center" ? "center" : align);

test.use({
  viewport: { width: 1200, height: 900 },
  permissions: ["clipboard-read", "clipboard-write"],
});

/** The alignment of a cell's paragraph and a loose one, in the bare browser and in the editor. */
async function alignments(page: Page, html: string) {
  await openEditor(page);

  /** What the document showed: the browser rendering the markup untouched. */
  const document_ = await page.evaluate(async (source) => {
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:absolute;left:-9999px;width:1200px;height:800px";
    document.body.append(frame);
    frame.contentDocument!.open();
    frame.contentDocument!.write(source);
    frame.contentDocument!.close();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const cell = frame.contentDocument!.querySelector("td p");
    const loose = frame.contentDocument!.querySelector("div > p");
    const read = (node: Element | null) =>
      node ? frame.contentWindow!.getComputedStyle(node).textAlign : null;
    const result = { cell: read(cell), loose: read(loose) };
    frame.remove();
    return result;
  }, html);

  await setHtml(page, "<p></p>");
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

  const editor = await page.evaluate(() => {
    const editable = document.querySelector("[data-slate-editor]")!;
    const cell = editable.querySelector('td [data-slate-node="element"]');
    const loose = Array.from(editable.querySelectorAll(':scope > [data-slate-node="element"]')).find(
      (block) => block.textContent!.trim()
    );
    const read = (node: Element | null | undefined) => (node ? getComputedStyle(node).textAlign : null);
    return { cell: read(cell), loose: read(loose) };
  });

  return { document_, editor };
}

test.describe("A centred table keeps its cells' own alignment", () => {
  for (const { name, html, loose } of CASES) {
    test(`${name}: the cells read as the document reads them`, async ({ page }) => {
      const { document_, editor } = await alignments(page, html);
      expect(normalize(editor.cell), `document ${document_.cell} | editor ${editor.cell}`).toBe(
        normalize(document_.cell)
      );
    });

    if (loose) {
      test(`${name}: and a paragraph outside the table still takes the alignment`, async ({ page }) => {
        const { document_, editor } = await alignments(page, html);
        expect(document_.loose, "the bare browser finds a paragraph outside the table").not.toBeNull();
        expect(normalize(editor.loose), `document ${document_.loose} | editor ${editor.loose}`).toBe(
          normalize(document_.loose)
        );
      });
    }
  }
});
