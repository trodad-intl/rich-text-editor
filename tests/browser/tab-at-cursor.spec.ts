/**
 * Where does Tab put a tab?
 *
 * At the caret. `@platejs/indent` binds Tab to move the whole BLOCK — it sets
 * `indent`, which the serializer writes as `margin-left: indent * 36pt` — so a
 * Tab pressed in the middle of a line moved the line 48px right and left the
 * text alone. A document is full of lines that put a value on a tab stop part-way
 * along, and typing one was impossible.
 *
 * The three cases that deliberately still reach the indent/list plugins are
 * checked too, because "fixed the tab key" must not mean "took the indent away".
 */
import { expect, test, type Page } from "@playwright/test";
import { getHtml, openEditor, setHtml } from "./support/harness";

/** The editor draws a paragraph as a div, so `p` is not a selector here. */
const PARA = "[data-slate-editor] .slate-p";

/** A tab, as the serializer writes one — see lib/whitespace.ts. */
const TAB = '<span style="white-space: pre">\t</span>';

/**
 * Load `html`, put the caret `right` characters into the block `selector`
 * matches, press `keys`, and hand back what the editor serializes.
 */
async function press(page: Page, html: string, selector: string, right: number, keys: string[]) {
  await openEditor(page);
  await setHtml(page, html);
  await page.waitForSelector(selector, { timeout: 5000 });
  await page.waitForTimeout(250);
  await page.click(selector);
  await page.waitForTimeout(120);
  await page.keyboard.press("Home");
  for (let i = 0; i < right; i++) await page.keyboard.press("ArrowRight");
  for (const key of keys) {
    await page.keyboard.press(key);
    await page.waitForTimeout(180);
  }
  return getHtml(page);
}

test.describe("Tab at the caret", () => {
  test("a Tab lands at the caret, not at the start of the line", async ({ page }) => {
    const html = await press(page, "<p>Findings of the study</p>", PARA, 8, ["Tab"]);
    expect(html).toBe(`<p>Findings${TAB} of the study</p>`);
  });

  test("a Tab at the start of a line is still a tab, not an indent", async ({ page }) => {
    const html = await press(page, "<p>Findings of the study</p>", PARA, 0, ["Tab"]);
    expect(html).toBe(`<p>${TAB}Findings of the study</p>`);
  });

  test("a heading takes one the same way", async ({ page }) => {
    const html = await press(page, "<h2>Technique here</h2>", "[data-slate-editor] h2", 4, ["Tab"]);
    expect(html).toBe(`<h2>Tech${TAB}nique here</h2>`);
  });

  // Matched loosely on purpose. Which cell a click lands in shifts with the
  // row-control cell the editable prepends, and Home/ArrowRight inside a cell do
  // not land on the same offset they do in a paragraph — neither of which this
  // is about. What it is about: the tab went in AFTER some text, not in front
  // of the line, which is the whole bug.
  test("so does a table cell", async ({ page }) => {
    const html = await press(
      page,
      "<table><tr><td>Alpha</td><td>Beta</td></tr></table>",
      "[data-slate-editor] td:nth-child(2)",
      2,
      ["Tab"]
    );
    expect(html).toMatch(/<td[^>]*><p>[^<]+<span style="white-space: pre">\t<\/span>/);
  });

  // As Word does: a selection within one line is replaced by the tab, where it
  // used to indent the whole line from its start.
  test("a Tab over a selected word replaces the word, not the line's indent", async ({ page }) => {
    const html = await press(page, "<p>Findings of the study</p>", PARA, 9, [
      "Shift+ArrowRight",
      "Shift+ArrowRight",
      "Tab",
    ]);
    expect(html).toBe(`<p>Findings ${TAB} the study</p>`);
  });

  test("a Tab over a run of spaces turns the spaces into a tab", async ({ page }) => {
    const html = await press(page, "<p>Name&nbsp; &nbsp; &nbsp;Value</p>", PARA, 4, [
      ...Array(5).fill("Shift+ArrowRight"),
      "Tab",
    ]);
    expect(html).toBe(`<p>Name${TAB}Value</p>`);
  });

  // One span, two tabs: the serializer wraps a RUN of whitespace, not each
  // character. See lib/whitespace.ts.
  test("two of them make two tabs", async ({ page }) => {
    const html = await press(page, "<p>AB</p>", PARA, 1, ["Tab", "Tab"]);
    expect(html).toBe('<p>A<span style="white-space: pre">\t\t</span>B</p>');
  });
});

test.describe("Tab still reaches the plugins underneath", () => {
  test("a list item still nests under the one above it", async ({ page }) => {
    const html = await press(
      page,
      "<ul><li>Alpha</li><li>Beta</li></ul>",
      "[data-slate-editor] li:nth-child(2)",
      2,
      ["Tab"]
    );
    expect(html).toBe("<ul><li>Alpha<ul><li>Beta</li></ul></li></ul>");
  });

  test("Shift+Tab still outdents the block", async ({ page }) => {
    const html = await press(page, '<p style="margin-left: 80px">Indented line</p>', PARA, 3, [
      "Shift+Tab",
    ]);
    expect(html).toBe('<p style="margin-left: 36pt">Indented line</p>');
  });

  test("Tab over a selection across lines still indents those lines", async ({ page }) => {
    const html = await press(page, "<p>Findings of the study</p><p>Second line</p>", PARA, 0, [
      "Shift+ArrowDown",
      "Tab",
    ]);
    expect(html).toBe(
      '<p style="margin-left: 36pt">Findings of the study</p><p style="margin-left: 36pt">Second line</p>'
    );
  });
});
