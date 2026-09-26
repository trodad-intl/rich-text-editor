/**
 * A tab pasted out of a Word document: is it drawn at the editor's own gap?
 *
 * The editor's stops are Word's default half inch, so a line that uses only
 * default stops keeps Word's tab count and must sit exactly where the same line
 * opened from a saved document sits — and the print page must draw it there too.
 * Ruler stops and hanging indents are measured in office-paste-layout.spec.ts;
 * the counts themselves are checked in tests/unit/word-tabs.test.ts.
 *
 * The pastes and the print render run once, in order, in beforeAll; each check
 * reads their results.
 */
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { getHtml, openEditor, setHtml } from "./support/harness";

/** The package's read-only stylesheet: the editor's font and `tab-size`, as a print page draws them. */
const PRINT_CSS = fs.readFileSync(path.join(process.cwd(), "dist/content.css"), "utf8");

const nbsp = (count: number) => "&nbsp;".repeat(count);

const WORD = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
xmlns:w="urn:schemas-microsoft-com:office:word"><head><style>
<!-- p.MsoNormal {margin:0cm; font-size:11.0pt; font-family:"Calibri",sans-serif;} --></style></head>
<body lang=EN-US>
<p class=MsoNormal>Test Name<span style='mso-tab-count:2'>${nbsp(13)} </span>: RT-PCR</p>
<p class=MsoNormal><span style='font-size:11.0pt;mso-tab-count:1'>${nbsp(6)} </span>Indented: yes</p>
</body></html>`;

/** The same lines, as a document already saved with those tabs opens. */
const DOCUMENT =
  '<p style="font-size: 11pt"><span style="font-size: 11pt; font-family: Calibri, sans-serif">Test Name<span style="white-space: pre">\t\t</span>: RT-PCR</span></p>' +
  '<p style="font-size: 11pt"><span style="font-size: 11pt; font-family: Calibri, sans-serif"><span style="white-space: pre">\t</span>Indented: yes</span></p>';

// Out of LibreOffice: its clipboard carries RTF as well as HTML, which is what
// makes Plate's docx cleaner run — and that cleaner used to delete every span
// holding only tabs, so these lines pasted as `BPD89 mm`. The async clipboard
// API cannot write RTF, so the paste is built by hand — as the `beforeinput`
// Chrome fires for a real one, which is the event Slate inserts rich HTML from.
const LIBRE_OFFICE = `<html><head><meta name="generator" content="LibreOffice 24.2.7.2 (Linux)"/></head><body lang="en-US">
<h3 class="western"><font face="Calibri, serif"><font size="3" style="font-size: 12pt"><span style="font-style: normal">BPD\t\t\t\t</span></font></font><font color="#ff0000"><font face="Calibri, serif"><font size="3" style="font-size: 12pt"><span style="font-style: normal"><b>89</b></span></font></font></font><font face="Calibri, serif"><font size="3" style="font-size: 12pt"><span style="font-style: normal">
mm</span></font></font></h3>
<h3 class="western"><font face="Calibri, serif"><font size="3" style="font-size: 12pt"><span style="font-style: normal">FL\t\t\t\t</span></font></font><font color="#ff0000"><font face="Calibri, serif"><font size="3" style="font-size: 12pt"><span style="font-style: normal"><b>66</b></span></font></font></font><font face="Calibri, serif"><font size="3" style="font-size: 12pt"><span style="font-style: normal">
mm</span></font></font></h3>
<h3 class="western"><font face="Calibri, serif"><font size="3" style="font-size: 12pt"><span style="font-style: normal">Number
\t\t\tSingle </span></font></font></h3></body></html>`;

test.describe.configure({ mode: "default" });

let context: BrowserContext;
let page: Page;
let pasted: (number | null)[];
let pastedHtml: string;
let opened: (number | null)[];
let reopened: string;
let printed: (number | null)[];
let libre: string[];
let libreNumbers: (number | null)[];

/** Where each line's colon sits, in the blocks `selector` matches, from the block's left edge. */
const colonsIn = (selector: string) =>
  page.evaluate((selector) => {
    const colonX = (block: Element) => {
      const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        const index = node.data.indexOf(":");
        if (index < 0) continue;
        const range = block.ownerDocument.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        return Math.round(range.getBoundingClientRect().left - block.getBoundingClientRect().left);
      }
      return null;
    };
    return Array.from(document.querySelectorAll(selector))
      .filter((block) => block.textContent!.includes(":"))
      .map(colonX);
  }, selector);

async function setUp(browser: Browser) {
  context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  page = await context.newPage();

  // Pasted from Word.
  await openEditor(page);
  await page.click("[data-slate-editor]");
  await page.evaluate(async (h) => {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([h], { type: "text/html" }),
        "text/plain": new Blob(["Test Name\t\t: RT-PCR\n\tIndented: yes"], { type: "text/plain" }),
      }),
    ]);
  }, WORD);
  await page.keyboard.press("Control+V");
  await page.waitForTimeout(600);
  pasted = await colonsIn("[data-slate-editor] > *");
  pastedHtml = await getHtml(page);

  // The same lines, as a document already saved with those tabs opens.
  await openEditor(page);
  await setHtml(page, DOCUMENT);
  await page.waitForTimeout(250);
  opened = await colonsIn("[data-slate-editor] > *");
  reopened = await getHtml(page);

  // On the print page.
  await page.evaluate(
    ({ html, css }) => {
      const frame = document.createElement("iframe");
      frame.id = "print";
      frame.style.cssText = "position:absolute;left:-9999px;width:1000px;height:1400px";
      document.body.append(frame);
      frame.contentDocument!.open();
      frame.contentDocument!.write(
        `<!doctype html><html><head><style>
      body { margin:0; font-size:15px; font-family:Calibri,"Arial Narrow",Arial,sans-serif }
      ${css}
    </style></head><body><div class="rte-content" style="width:900px">${html}</div></body></html>`,
      );
      frame.contentDocument!.close();
    },
    { html: pastedHtml, css: PRINT_CSS },
  );
  await page.waitForTimeout(150);
  printed = await page.evaluate(() => {
    const doc = (document.getElementById("print") as HTMLIFrameElement).contentDocument!;
    return Array.from(doc.querySelectorAll(".rte-content > *")).map((block) => {
      const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        const index = node.data.indexOf(":");
        if (index < 0) continue;
        const range = doc.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + 1);
        return Math.round(range.getBoundingClientRect().left - block.getBoundingClientRect().left);
      }
      return null;
    });
  });

  // Out of LibreOffice, RTF and all.
  await openEditor(page);
  await page.click("[data-slate-editor]");
  await page.evaluate((html) => {
    const data = new DataTransfer();
    data.setData("text/html", html);
    data.setData("text/rtf", "{\\rtf1\\ansi USG}");
    data.setData("text/plain", "BPD\t\t\t\t89 mm\nFL\t\t\t\t66 mm\nNumber \t\t\tSingle");
    document.querySelector("[data-slate-editor]")!.dispatchEvent(
      new InputEvent("beforeinput", {
        inputType: "insertFromPaste",
        dataTransfer: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, LIBRE_OFFICE);
  await page.waitForTimeout(600);
  libre = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-slate-editor] > *")).map((block) => block.textContent!),
  );
  libreNumbers = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-slate-editor] > *"))
      .filter((b) => /\d/.test(b.textContent!))
      .map((block) => {
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
          const index = node.data.search(/\d/);
          if (index < 0) continue;
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, index + 1);
          return Math.round(range.getBoundingClientRect().left - block.getBoundingClientRect().left);
        }
        return null;
      }),
  );
}

test.beforeAll(async ({ browser }) => {
  await setUp(browser);
});

test.afterAll(async () => {
  await context?.close();
});

test.describe("a tab pasted from Word", () => {
  test("a pasted Word tab is drawn at the editor's standard gap, like a saved one", () => {
    expect(
      pasted.length === 2 && pasted.every((x, i) => Math.abs(x! - opened[i]!) <= 1),
      `pasted ${pasted.join("/")}px, saved ${opened.join("/")}px`,
    ).toBe(true);
  });

  test("the tab Plate's cleaner used to leave as &nbsp; is a tab now", () => {
    expect(
      pastedHtml.includes('<span style="white-space: pre">\t</span>Indented') && !pastedHtml.includes("&nbsp;"),
      pastedHtml,
    ).toBe(true);
  });

  test("the print page draws the gap where the editor does", () => {
    expect(
      printed.length === 2 && printed.every((x, i) => Math.abs(x! - pasted[i]!) <= 1),
      `printed ${printed.join("/")}px, editor ${pasted.join("/")}px`,
    ).toBe(true);
  });

  test("a document being opened keeps exactly the tabs it was saved with", () => {
    expect(reopened).toBe(DOCUMENT);
  });
});

test.describe("a tab pasted from LibreOffice", () => {
  test("a LibreOffice paste, RTF and all, keeps every tab", () => {
    expect(
      libre.includes("BPD\t\t\t\t89 mm") &&
        libre.includes("FL\t\t\t\t66 mm") &&
        libre.some((t) => t.startsWith("Number \t\t\tSingle")),
      JSON.stringify(libre),
    ).toBe(true);
  });

  test("…drawn as a gap, not closed up", () => {
    expect(
      libreNumbers.length === 2 && libreNumbers[0]! > 150 && Math.abs(libreNumbers[0]! - libreNumbers[1]!) <= 1,
      `numbers at ${libreNumbers.join("/")}px`,
    ).toBe(true);
  });
});
