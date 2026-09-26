/**
 * Is the text the size the document set it in?
 *
 * Reported as "the table header is perfect but the table body is large after
 * paste", and that is exactly the shape of it: Word states a header's size on
 * the span (it is bold and bigger, so it has a run of its own) and leaves the
 * body to `p.MsoNormal {font-size:11.0pt}`. A size stated on a BLOCK inherits
 * in CSS but reaches no Plate node — only a text leaf carries one — so the body
 * fell back to the editable's 18px base and came out bigger than the header's
 * own text.
 *
 * The reference is the browser's own rendering of the same markup in a clean
 * iframe, which is what the old editor showed and what the printed document
 * shows. Compared EXACTLY, to a hundredth of a pixel: a stated point size is
 * kept in points (see lib/font-size.ts), so the editor hands the browser the
 * same value the iframe got and gets back the same fraction. The tolerance used
 * to be a whole pixel, because every size was converted to whole px first — an
 * 11pt run was 14.67px in the iframe and 15px here, and a 10pt one was named 13
 * by the font-size control.
 */
import { expect, test, type Page } from "@playwright/test";
import { getHtml, openEditor } from "./support/harness";

/** Word's own markup for a results table, header sized on the span, body not. */
const WORD =
  `<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><style>` +
  `<!-- p.MsoNormal {margin:0cm; font-size:11.0pt; font-family:"Times New Roman",serif;} --></style></head><body>` +
  `<table class=MsoTableGrid border=1 cellspacing=0 style='border-collapse:collapse'>` +
  `<tr><td style='border:solid windowtext 1.0pt;padding:0cm 5.4pt'><p class=MsoNormal align=center style='text-align:center'><b><span style='font-size:14.0pt'>Pathogen Name</span></b></p></td>` +
  `<td style='border:solid windowtext 1.0pt;padding:0cm 5.4pt'><p class=MsoNormal align=center style='text-align:center'><b><span style='font-size:14.0pt'>Result</span></b></p></td></tr>` +
  `<tr><td style='border:solid windowtext 1.0pt;padding:0cm 5.4pt'><p class=MsoNormal>Measles morbillivirus</p></td>` +
  `<td style='border:solid windowtext 1.0pt;padding:0cm 5.4pt'><p class=MsoNormal align=center style='text-align:center'>Detected</p></td></tr>` +
  `<tr><td style='border:solid windowtext 1.0pt;padding:0cm 5.4pt'><p class=MsoNormal><span style='font-size:9.0pt'>Limit of detection</span></p></td>` +
  `<td style='border:solid windowtext 1.0pt;padding:0cm 5.4pt'><p class=MsoNormal><span style='font-size:9.0pt'>200 CFU/mL</span></p></td></tr>` +
  `</table><p class=MsoNormal>Comment: within normal limits.</p></body></html>`;

/**
 * The same table with the body's size only in the `<style>` block — Word's own
 * default table style, which is where a document that names no size on the
 * paragraph gets one. It is not an inline style until JuicePlugin has run, and
 * `transformData` is piped in REVERSE registration order, so this is the case
 * that catches a pass registered in the wrong place.
 */
const WORD_TABLE_STYLE =
  `<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><style>` +
  `<!-- table.MsoNormalTable {mso-style-name:"Table Normal"; font-size:10.0pt;} p.MsoNormal {margin:0cm;} --></style></head><body>` +
  `<table class=MsoNormalTable border=1 cellspacing=0 style='border-collapse:collapse'>` +
  `<tr><td style='border:solid windowtext 1.0pt;padding:0cm 5.4pt'><p class=MsoNormal><b><span style='font-size:14.0pt'>Pathogen Name</span></b></p></td></tr>` +
  `<tr><td style='border:solid windowtext 1.0pt;padding:0cm 5.4pt'><p class=MsoNormal>Measles morbillivirus</p></td></tr>` +
  `</table></body></html>`;

/** A stored document body, which states its sizes on the blocks a browser inherits from. */
const STORED =
  `<p style="font-size: 20px">LABORATORY REPORT</p>` +
  `<table border="1" style="border-collapse: collapse; font-size: 12px"><tbody>` +
  `<tr><td style="padding: 2px 5px"><p>Measles morbillivirus</p></td>` +
  `<td style="padding: 2px 5px; font-size: 16px"><p>Detected</p></td></tr>` +
  `</tbody></table><p style="font-size: 12px">Comment: within normal limits.</p>`;

type Run = [text: string, size: number];

/**
 * Every run of text in the document, with the size it is actually drawn at.
 * Handed to the page as source, so it can run against the editor and against
 * an iframe's document alike.
 */
const MEASURE = `(root, win) => {
  const out = [];
  const walker = (root.ownerDocument ?? root).createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.data.trim();
    if (!text) continue;
    const el = node.parentElement;
    if (!el || el.closest('[contenteditable=false]')) continue;
    // To a hundredth of a pixel, not to the nearest one: the point of this is
    // that a pasted point size is no longer rounded on the way in.
    out.push([
      text.slice(0, 24),
      Math.round(parseFloat(win.getComputedStyle(el).fontSize) * 100) / 100,
    ]);
  }
  return out;
}`;

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

/** What the browser draws for `html` on its own, in a clean iframe. */
async function truthOf(page: Page, html: string): Promise<Run[]> {
  return page.evaluate(
    async ([source, measure]) => {
      const frame = document.createElement("iframe");
      frame.style.cssText = "position:absolute;left:-9999px;width:1200px;height:900px";
      document.body.append(frame);
      frame.contentDocument!.open();
      frame.contentDocument!.write(source);
      frame.contentDocument!.close();
      await new Promise((resolve) => setTimeout(resolve, 80));
      // eslint-disable-next-line no-eval
      const sizes = (0, eval)(`(${measure})`)(frame.contentDocument!.body, frame.contentWindow);
      frame.remove();
      return sizes;
    },
    [html, MEASURE] as const
  );
}

/** Every run in the editor, measured the same way. */
async function measureEditor(page: Page): Promise<Run[]> {
  return page.evaluate(
    (measure) =>
      // eslint-disable-next-line no-eval
      (0, eval)(`(${measure})`)(document.querySelector("[data-slate-editor]"), window),
    MEASURE
  );
}

/** Put `html` on the clipboard as Word would and paste it into the editor. */
async function paste(page: Page, html: string) {
  await page.click("[data-slate-editor]");
  await page.evaluate(async (source) => {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([source], { type: "text/html" }),
        "text/plain": new Blob(["x"], { type: "text/plain" }),
      }),
    ]);
  }, html);
  await page.keyboard.press("Control+V");
  await page.waitForTimeout(700);
}

/** Open an empty editor, paste `html`, and measure both renderings. */
async function pasted(page: Page, html: string) {
  page.on("pageerror", (e) => console.log("PAGEERROR", String(e)));
  await openEditor(page);
  const truth = await truthOf(page, html);
  await paste(page, html);
  return { truth, mine: await measureEditor(page) };
}

/** Same runs, same text, each within a hundredth of a pixel. */
function expectSameSizes(truth: Run[], mine: Run[]) {
  const detail = truth.map(([t, s], i) => `${t}=${s}/${mine[i]?.[1] ?? "-"}`).join(" ");
  expect(mine.map(([text]) => text), detail).toEqual(truth.map(([text]) => text));
  truth.forEach(([text, size], i) => {
    expect(Math.abs(mine[i][1] - size), `${text}: ${detail}`).toBeLessThanOrEqual(0.01);
  });
}

test.describe("Pasted from Word", () => {
  test("word paste: every run is the size the document set it in", async ({ page }) => {
    const { truth, mine } = await pasted(page, WORD);
    expectSameSizes(truth, mine);
  });

  test("and the body is not drawn bigger than the header above it", async ({ page }) => {
    const { mine } = await pasted(page, WORD);
    expect(mine[2][1], `header ${mine[0][1]}px | body ${mine[2][1]}px`).toBeLessThan(mine[0][1]);
  });

  test("word paste, size in the style block: every run is the size the document set it in", async ({
    page,
  }) => {
    const { truth, mine } = await pasted(page, WORD_TABLE_STYLE);
    expectSameSizes(truth, mine);
  });
});

test.describe("Opened from the database", () => {
  async function stored(page: Page) {
    page.on("pageerror", (e) => console.log("PAGEERROR", String(e)));
    await openEditor(page, STORED);
    const truth = await truthOf(page, STORED);
    await page.waitForTimeout(200);
    return { truth, mine: await measureEditor(page) };
  }

  test("stored document: every run is the size the document set it in", async ({ page }) => {
    const { truth, mine } = await stored(page);
    expectSameSizes(truth, mine);
  });

  test("and saving it does not write the sizes out of the document", async ({ page }) => {
    await stored(page);
    const saved = await getHtml(page);
    for (const size of ["20px", "12px", "16px"]) {
      expect(saved, saved.slice(0, 120)).toContain(`font-size: ${size}`);
    }
  });
});
