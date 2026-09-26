/**
 * Does the font-size box show the number the document's author set?
 *
 * Reported by name: "currently main doc has font size 10 but after paste our
 * editor show 13". Both numbers described the same text. Word measures type in
 * POINTS and the editor used to convert every pasted size into whole CSS
 * pixels, so a 10pt paragraph arrived as `13px` — and 13px is not even 10pt,
 * which is 13.333px, so the text was drawn 2.5% small as well as misnamed.
 *
 * Only a browser can answer this. The number comes out of the control's own
 * React state, which needs the caret in real text with a real selection, and
 * the size it should agree with is what `getComputedStyle` says the run is
 * actually drawn at. jsdom has neither.
 *
 * What is pinned here, in the order a reader meets it:
 *
 *  - a Word paste is NAMED on Word's scale (10pt reads 10) and DRAWN at Word's
 *    size (13.33px, to a hundredth of a pixel);
 *  - a legacy document stating px is named on that same one scale, so the box
 *    never shows two different scales in one document;
 *  - setting a size writes points, and the ± steps by a whole point.
 *
 * See lib/font-size.ts, which owns the rule, and
 * tests/browser/font-size-fidelity, which compares every run in a document
 * against a bare iframe.
 */
import { expect, test, type Page } from "@playwright/test";
import { getHtml, openEditor } from "./support/harness";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

/** A Word clipboard whose body is 10pt, stated the way Word states it. */
const WORD_10PT =
  `<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><style><!--
p.MsoNormal {margin:0cm; font-size:10.0pt; font-family:"Calibri",sans-serif;}
--></style></head><body>` +
  `<p class=MsoNormal><span style='font-size:10.0pt;font-family:"Calibri",sans-serif'>` +
  `Impression: no acute abnormality.</span></p></body></html>`;

async function open(page: Page, initialHtml: string) {
  await openEditor(page, initialHtml);
  await page.waitForTimeout(200);
}

/**
 * The font-size box. It is the only text input in the toolbar — ToolbarButton
 * puts a control's label in a Radix tooltip, which is not an accessible name.
 */
const BOX = '.rte-scope input[type="text"][data-plate-focus="true"]';

/**
 * Select the first line of text and let the control catch up.
 *
 * A click alone lands the caret wherever the pointer did, which on an empty
 * part of the line is not in the run at all. A SELECTION is what makes
 * `editor.api.marks()` report the run's own size rather than the block's, and
 * taking the whole line means a size set here lands on the whole run rather
 * than on one character.
 */
async function selectFirstLine(page: Page) {
  await page.click("[data-slate-editor] [data-slate-string]");
  await page.keyboard.press("Home");
  // Let slate-react take in the caret Home left before extending from it. It
  // reads `selectionchange` on a throttle and, on its next render, puts the DOM
  // selection back to what it last read — so a Shift+End pressed inside that
  // window was undone to the collapsed caret, the size then went on as a
  // pending mark only, and this file failed ~1 run in 6. The legacy script had
  // the same race; it is timing, not what is being tested here.
  await page.waitForTimeout(150);
  await page.keyboard.down("Shift");
  await page.keyboard.press("End");
  await page.keyboard.up("Shift");
  await page.waitForTimeout(250);
}

/**
 * The font-size widget's own + / - buttons.
 *
 * Scoped to the div that holds the box: the Insert menu's trigger is a Plus
 * icon too, and it comes first in the toolbar.
 */
const stepper = (page: Page, icon: string) =>
  page
    .locator(
      `.rte-scope div:has(> input[data-plate-focus="true"]) > button:has(svg.lucide-${icon})`,
    )
    .first();

/** The size, to a hundredth of a pixel, the first run is actually drawn at. */
const drawnPx = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const el = document.querySelector(
      "[data-slate-editor] [data-slate-string]",
    )!;
    return Math.round(parseFloat(getComputedStyle(el).fontSize) * 100) / 100;
  });

async function pasteWord(page: Page, source: string) {
  await page.click("[data-slate-editor]");
  await page.evaluate(async (src) => {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([src], { type: "text/html" }),
        "text/plain": new Blob(["x"], { type: "text/plain" }),
      }),
    ]);
  }, source);
  await page.keyboard.press("Control+V");
  await page.waitForTimeout(700);
}

// A 10pt Word paragraph is named 10 and drawn at 10pt. The whole complaint.
test.describe("a 10pt Word paste", () => {
  test.beforeEach(async ({ page }) => {
    await open(page, "");
    await pasteWord(page, WORD_10PT);
    await selectFirstLine(page);
  });

  test("a 10pt Word paragraph is named 10, not 13", async ({ page }) => {
    expect(await page.inputValue(BOX)).toBe("10");
  });

  test("and is drawn at 10pt exactly, which is 13.33px at 96dpi", async ({
    page,
  }) => {
    const px = await drawnPx(page);
    expect(Math.abs(px - (10 * 96) / 72), `${px}px`).toBeLessThanOrEqual(0.01);
  });

  test("and is SAVED in the points the document stated, so the print matches", async ({
    page,
  }) => {
    const saved = await getHtml(page);
    expect(saved).toContain("font-size: 10pt");
    expect(saved).not.toMatch(/font-size:\s*13px/);
  });
});

// A legacy document states px. It is left in px and named on the one scale.
test.describe("a legacy document stating px", () => {
  test.beforeEach(async ({ page }) => {
    await open(
      page,
      '<p style="font-size: 15px"><span style="font-size: 15px">Legacy body text</span></p>',
    );
    await selectFirstLine(page);
  });

  test("a stored 15px run is named 11.25 — what 15px is in points", async ({
    page,
  }) => {
    expect(await page.inputValue(BOX)).toBe("11.25");
  });

  test("and is still drawn at the 15px it was saved at", async ({ page }) => {
    const px = await drawnPx(page);
    expect(Math.abs(px - 15), `${px}px`).toBeLessThanOrEqual(0.01);
  });

  // The size on the node is untouched, so opening a stored document and saving
  // it does not rewrite every size in it. ~70 live installations have these.
  test("and open + save leaves the px in the document, not points", async ({
    page,
  }) => {
    const saved = await getHtml(page);
    expect(saved).toContain("font-size: 15px");
    expect(saved).not.toContain("11.25pt");
  });
});

// Setting a size writes points, and ± steps by a whole point. Each step builds
// on the one before, so they share one page and fail softly.
test("setting a size writes points, and ± steps by a whole point", async ({
  page,
}) => {
  await open(page, "<p><span>Findings</span></p>");
  await selectFirstLine(page);

  const base = await page.inputValue(BOX);
  expect
    .soft(
      base,
      "an unsized run is named 13.5 — the editable's own 18px, in points",
    )
    .toBe("13.5");

  await page.fill(BOX, "12");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  await selectFirstLine(page);

  const set = await page.inputValue(BOX);
  const setPx = await drawnPx(page);
  expect.soft(set, "typing 12 sets 12 POINTS, drawn at 16px").toBe("12");
  expect
    .soft(
      Math.abs(setPx - 16),
      `typing 12 sets 12 POINTS, drawn at 16px — drawn ${setPx}px`,
    )
    .toBeLessThanOrEqual(0.01);

  // The + button, which steps the number the box shows.
  await stepper(page, "plus").click();
  await page.waitForTimeout(300);
  await selectFirstLine(page);

  const stepped = await page.inputValue(BOX);
  const steppedPx = await drawnPx(page);
  expect.soft(stepped, "and + steps it by one point, to 13pt").toBe("13");
  expect
    .soft(
      Math.abs(steppedPx - (13 * 96) / 72),
      `and + steps it by one point, to 13pt — drawn ${steppedPx}px`,
    )
    .toBeLessThanOrEqual(0.01);

  const saved = await getHtml(page);
  expect
    .soft(saved, "and what it saved is points")
    .toContain("font-size: 13pt");
});
