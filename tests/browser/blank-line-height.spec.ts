/**
 * Is a blank line as tall as the text around it?
 *
 * Only a real browser can answer: the height of an empty line is its STRUT, the
 * invisible line box the browser gives the element, and jsdom does no layout.
 * Every blank line used to measure the same — the editable's 18px base — so a
 * 10px document and a 30px document had the identical gap between paragraphs.
 */
import { expect, test, type Page } from "@playwright/test";
import { getHtml, openEditor } from "./support/harness";

interface Line {
  text: string;
  height: number;
  fontSize: string;
}

async function open(page: Page, initialHtml: string) {
  await openEditor(page, initialHtml);
  await page.waitForTimeout(200);
}

const lines = (page: Page): Promise<Line[]> =>
  page.evaluate(() =>
    Array.from(document.querySelector("[data-slate-editor]")!.children).map(
      (el) => ({
        text: el.textContent!.trim(),
        height: Math.round(el.getBoundingClientRect().height),
        fontSize: getComputedStyle(el).fontSize,
      }),
    ),
  );

const sized = (px: number, text: string) =>
  `<p><span style="font-size: ${px}px">${text}</span></p>`;
const BLANK = "<p><br/></p>";

test.describe("a blank line between sized text, on the way in", () => {
  const DOC =
    sized(10, "ten") +
    BLANK +
    sized(30, "thirty") +
    BLANK +
    sized(30, "thirty again");

  test("a blank line after 10px text is drawn at 10px", async ({ page }) => {
    await open(page, DOC);
    const [, small] = await lines(page);
    expect(small.fontSize).toBe("10px");
  });

  test("a blank line after 30px text is drawn at 30px", async ({ page }) => {
    await open(page, DOC);
    const [, , , large] = await lines(page);
    expect(large.fontSize).toBe("30px");
  });

  test("so the two gaps are no longer the same height", async ({ page }) => {
    await open(page, DOC);
    const [, small, , large] = await lines(page);
    expect(
      large.height,
      `${small.height}px vs ${large.height}px`,
    ).toBeGreaterThan(small.height);
  });
});

// A document that states no sizes is untouched: the base, as before.
test("an unsized document keeps the editor base", async ({ page }) => {
  await open(page, "<p>plain</p>" + BLANK + "<p>more</p>");
  const [, blank] = await lines(page);
  expect(blank.fontSize).toBe("14.6667px"); // 11pt
});

test.describe("typing: Enter after sized text, and the toolbar aimed at a blank line", () => {
  /** Open a 10px line and press Enter at its end; returns the new blank line. */
  async function enterAfterTen(page: Page): Promise<Line> {
    await open(page, sized(10, "ten"));
    await page.click("[data-slate-editor] > div");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200);
    return (await lines(page))[1];
  }

  // The caret is on that blank line; set 36 from the toolbar.
  //
  // The box reads and writes POINTS, the scale Word states type on (see
  // lib/font-size.ts), so 36 there is 36pt — which `getComputedStyle` reports
  // back as the 48px it resolves to.
  async function setThirtySix(page: Page): Promise<Line> {
    const input = page.locator('input[data-plate-focus="true"]');
    await input.click();
    await input.fill("36");
    await input.press("Enter");
    await page.waitForTimeout(250);
    return (await lines(page))[1];
  }

  test("Enter at the end of a 10px line makes a 10px blank line", async ({
    page,
  }) => {
    const typed = await enterAfterTen(page);
    expect(typed.fontSize).toBe("10px");
  });

  test("setting a size with the caret on a blank line resizes that line", async ({
    page,
  }) => {
    await enterAfterTen(page);
    const resized = await setThirtySix(page);
    expect(resized.fontSize).toBe("48px");
  });

  test("and it is taller than the 10px line it followed", async ({ page }) => {
    const typed = await enterAfterTen(page);
    const resized = await setThirtySix(page);
    expect(
      resized.height,
      `${typed.height}px -> ${resized.height}px`,
    ).toBeGreaterThan(typed.height);
  });

  test("the saved HTML states the gap it prints with", async ({ page }) => {
    await enterAfterTen(page);
    await setThirtySix(page);
    expect(await getHtml(page)).toContain('<p style="font-size: 36pt">');
  });
});

// A blank line in an OPENED document, between two 12pt lines. It used to be
// sized on its block only — drawn 12pt tall while the toolbar named the base and
// typing came out at it — and `<p><br/></p>` read back as a break, two lines
// tall. Word's blank paragraph is one line, and it types in its own size.
test.describe("a blank line in an opened document", () => {
  const TWELVE = (text: string) => `<p><span style="font-size: 12pt">${text}</span></p>`;
  const DOC = TWELVE("One") + BLANK + TWELVE("Two");

  async function caretOnBlank(page: Page) {
    await open(page, DOC);
    await page.click("[data-slate-editor] > div >> nth=1");
    await page.waitForTimeout(150);
  }

  test("is one line, as tall as the text beside it", async ({ page }) => {
    await open(page, DOC);
    const [one, blank] = await lines(page);
    expect(blank.height).toBe(one.height);
  });

  test("the toolbar names its size, not the editor's base", async ({ page }) => {
    await caretOnBlank(page);
    expect(await page.inputValue('input[data-plate-focus="true"]')).toBe("12");
  });

  test("text typed on it comes out in that size, on that one line", async ({ page }) => {
    await caretOnBlank(page);
    await page.keyboard.type("abc");
    await page.waitForTimeout(200);
    const [one, typed] = await lines(page);
    expect(typed.text).toBe("abc");
    expect(typed.fontSize).toBe("16px");
    expect(typed.height).toBe(one.height);
    expect(await getHtml(page)).toContain('<span style="font-size: 12pt">abc</span>');
  });
});
