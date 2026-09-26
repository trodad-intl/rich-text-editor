/**
 * A document pasted as PLAIN TEXT — does it still say the same thing once it
 * is printed?
 *
 * The reference is the browser's own contenteditable, and that is not an
 * approximation of the editor that saved the legacy HTML, it IS that editor:
 * its paste handler returned early when the clipboard carried no HTML
 * ("plain-text paste -> let the browser handle it"). So whatever Chrome writes
 * into a bare contenteditable is exactly what these documents used to be saved as, and what the print pages have
 * always rendered.
 *
 * What was wrong: this editor kept the tabs and the space runs in its model and
 * showed them correctly — it is `white-space: pre-wrap` — and then serialized
 * them raw. HTML collapses every run to one space and drops it at the edges of
 * a block, so `<p> </p>` was an empty block and `<p>        RESULT</p>` was a
 * flush-left heading. The document read right in the editor and printed flat.
 *
 * Everything below is measured in the PRINT context — the stored HTML dropped
 * into `.content.main_data` with the rules a real host print page applies —
 * because that is where the difference
 * showed.
 *
 * One paste, one native paste, and two print renders feed every check, so they
 * are done once in beforeAll and the tests run in order in one worker.
 */
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { openEditor } from "./support/harness";

/** The demo document: two tab-set columns, an indented heading, a spacer line. */
const TEXT = [
  "Test Name\t\t:  RT-PCR FOR COVID-19",
  "Specimen\t\t:  Nasopharyngeal Swab/Oropharyngeal Swab",
  "Collection Site\t\t: Riverside Community Services Company Ltd",
  "-------------------------------------------------------------------",
  " ",
  "                                                       RESULT",
  "Test Date\t: 26-01-2024",
  "Test Method\t:  rRT-PCR",
  "Result\t\t: Negative",
  "Comment\t: Please correlate clinically.",
].join("\n");

/** HTML another editor saved: its indentation is a run of &nbsp;. */
const LEGACY =
  "<p>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;RESULT</p><p>&nbsp;</p>";

interface PrintedLine {
  text: string;
  height: number;
  colon: number | null;
  firstLetter: number | null;
}

const lines = TEXT.split("\n");

/**
 * A run is saved as alternating U+00A0 and space — that is the only spelling
 * HTML keeps — so the text is compared as the line reads, not byte for byte.
 */
const unpadded = (text: string) => text.replaceAll(" ", " ");

test.describe.configure({ mode: "default" });

let context: BrowserContext;
let page: Page;
let editor: {
  saved: string;
  onScreen: { text: string; colon: number | null }[];
};
let printed: PrintedLine[];
let asBefore: PrintedLine[];
let legacy: { indent: number | null; blocks: number; saved: string };

async function setUp(browser: Browser) {
  context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  page = await context.newPage();
  await openEditor(page);

  /** Measuring tools, installed once in the page. */
  await page.evaluate(() => {
    const w = window as any;
    /** Where a character sits, relative to the block it is in. */
    w.__xOf = (block: Element, char: string) => {
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      for (
        let node = walker.nextNode() as Text | null;
        node;
        node = walker.nextNode() as Text | null
      ) {
        const index = node.data.indexOf(char);
        if (index < 0) continue;
        const range = block.ownerDocument.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        return Math.round(
          range.getBoundingClientRect().left -
            block.getBoundingClientRect().left,
        );
      }
      return null;
    };

    /** The stored HTML as a print page renders it. */
    w.__printed = async (html: string) => {
      const frame = document.createElement("iframe");
      frame.style.cssText =
        "position:absolute;left:-9999px;width:1000px;height:1400px";
      document.body.append(frame);
      const doc = frame.contentDocument!;
      doc.open();
      doc.write(
        `<!doctype html><html><head><style>
          body { margin:0; font-size:15px; font-family:Calibri,"Arial Narrow",Arial,sans-serif }
          .main_data p { margin:0; padding:0 }
        </style></head><body><div class="content main_data" style="width:900px">${html}</div></body></html>`,
      );
      doc.close();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const root = doc.querySelector(".main_data")!;
      const out = Array.from(root.children).map((block) => ({
        text: block.textContent,
        height: Math.round(block.getBoundingClientRect().height),
        colon: w.__xOf(block, ":"),
        firstLetter: w.__xOf(block, "R"),
      }));
      frame.remove();
      return out;
    };
  });

  /** This editor, pasting the document. The caret goes in first: writing to the
   *  clipboard needs the document focused. */
  await page.click("[data-slate-editor]");
  await page.evaluate(async (text) => {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": new Blob([text], { type: "text/plain" }),
      }),
    ]);
  }, TEXT);
  await page.keyboard.press("Control+V");
  await page.waitForTimeout(600);

  editor = await page.evaluate(() => {
    const w = window as any;
    return {
      saved: w.TrodadRichTextEditor.getHtml("#content_editor"),
      onScreen: Array.from(
        document.querySelectorAll("[data-slate-editor] > *"),
      ).map((block) => ({
        text: block.textContent!,
        colon: w.__xOf(block, ":"),
      })),
    };
  });

  /** What the old editor produced: Chrome pasting the same thing, untouched. */
  await page.evaluate(() => {
    const box = document.createElement("div");
    box.id = "native";
    box.contentEditable = "true";
    box.style.cssText =
      "width:900px;font-size:15px;font-family:Calibri,Arial,sans-serif";
    document.body.append(box);
  });
  await page.click("#native");
  await page.keyboard.press("Control+V");
  await page.waitForTimeout(300);
  const reference = await page.evaluate(() => {
    const box = document.querySelector("#native")!;
    const html = box.innerHTML;
    box.remove();
    return html;
  });

  printed = await page.evaluate(
    (html) => (window as any).__printed(html),
    editor.saved,
  );
  asBefore = await page.evaluate(
    (html) => (window as any).__printed(html),
    reference,
  );

  // The other half: HTML the OLD editor saved, opened here. Plate collapses
  // whitespace with JavaScript's \s, which counts U+00A0 where CSS does not, so
  // every one of these arrived with its indentation stripped.
  legacy = await page.evaluate(async (html) => {
    const w = window as any;
    w.TrodadRichTextEditor.setHtml("#content_editor", html);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const blocks = Array.from(
      document.querySelectorAll("[data-slate-editor] > *"),
    );
    return {
      indent: w.__xOf(blocks[0], "R"),
      blocks: blocks.length,
      saved: w.TrodadRichTextEditor.getHtml("#content_editor"),
    };
  }, LEGACY);
}

test.beforeAll(async ({ browser }) => {
  await setUp(browser);
});

test.afterAll(async () => {
  await context?.close();
});

test.describe("a plain-text document, printed", () => {
  test("every line of the document is still a line of the printed document", () => {
    expect(
      printed.length,
      `${printed.length} blocks, ${lines.length} lines`,
    ).toBe(lines.length);
  });

  test("no line lost a character of its own spacing", () => {
    // Line for line against as many lines as were printed — a missing line is
    // the check above's business.
    expect(printed.map((line) => unpadded(line.text))).toEqual(
      lines.slice(0, printed.length),
    );
  });

  test("the blank spacer line still opens a gap", () => {
    const spacer = printed[4];
    expect(spacer, "no fifth line").toBeDefined();
    expect(
      spacer.height,
      `${spacer?.height}px (a collapsed one is 0)`,
    ).toBeGreaterThan(10);
  });

  test("every line stands the same height", () => {
    const heights = [...new Set(printed.map((line) => line.height))];
    expect(heights, heights.join(", ")).toHaveLength(1);
  });

  test("the lines sit exactly as high as the old editor printed them", () => {
    const pass = printed.every(
      (line, i) => Math.abs(line.height - asBefore[i].height) <= 1,
    );
    expect(pass, `${printed[0].height}px vs ${asBefore[0].height}px`).toBe(
      true,
    );
  });

  test("the tabs still carry the value column to where the old editor put it", () => {
    const columns = [0, 1, 2, 6, 7, 8, 9];
    const pass = columns.every(
      (i) => Math.abs(printed[i].colon! - asBefore[i].colon!) <= 1,
    );
    expect(
      pass,
      columns.map((i) => `${printed[i].colon}/${asBefore[i].colon}`).join(" "),
    ).toBe(true);
  });

  test("the tabbed columns are a real gap, not the single space HTML collapses them to", () => {
    expect(
      printed[0].colon,
      `the colon sits ${printed[0].colon}px in`,
    ).toBeGreaterThan(100);
  });

  test("the indented heading is still indented, to the same place", () => {
    const heading = printed[5];
    const detail = `${heading.firstLetter}px vs ${asBefore[5].firstLetter}px`;
    expect(
      Math.abs(heading.firstLetter! - asBefore[5].firstLetter!),
      detail,
    ).toBeLessThanOrEqual(2);
    expect(heading.firstLetter, detail).toBeGreaterThan(150);
  });

  test("what the editor shows is what gets printed: same column, same order", () => {
    const pass =
      editor.onScreen.length === lines.length &&
      editor.onScreen[0].colon! > 100 &&
      editor.onScreen[0].colon! < editor.onScreen[2].colon!;
    expect(
      pass,
      editor.onScreen
        .slice(0, 3)
        .map((line) => line.colon)
        .join(" "),
    ).toBe(true);
  });
});

test.describe("a document the old editor saved", () => {
  // Collapsed, a leading run is not narrower — it is GONE, and the heading
  // starts at 0. Eight spaces of the editor's 18px text is about 37.
  test("a legacy document keeps the indentation it was written with", () => {
    expect(
      legacy.indent,
      `heading starts ${legacy.indent}px in`,
    ).toBeGreaterThan(25);
  });

  test("and is saved back with it, rather than flattened on the first edit", () => {
    expect(legacy.saved).toContain("&nbsp;");
    expect(legacy.saved).toContain("<p>&nbsp;</p>");
  });
});
