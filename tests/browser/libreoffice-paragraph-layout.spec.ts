/**
 * Lines copied out of LibreOffice, outside a table: as far apart as the document has them?
 *
 * A document's "Test platform" block — five 9pt lines in the document's default
 * Calibri, single-spaced, no space between them — stands 14.67px a line in
 * LibreOffice's own layout of the .docx (`--convert-to pdf`, `pdftotext
 * -bbox-layout`). It pasted 20px a line: 0.73 of a line in the editor's own face
 * plus the editor's 4px of padding above and below. "Line spacing 1" then opened
 * it to 24px. See src/lib/word-line-gap.ts, `extractDocumentSpacing` in
 * src/lib/table-widths.ts and src/lib/font-face.ts; the arithmetic is pinned in
 * tests/unit/libreoffice-paragraph-layout.test.ts.
 *
 * The HTML is LibreOffice's own clipboard, trimmed — captured through its
 * transferable (UNO). The RTF is cut down to what is read from it. The async
 * clipboard API cannot carry RTF, so the paste is the `beforeinput` Chrome
 * fires for a real one.
 *
 * One paste flow feeds every check — paste, choose "1", save and reopen, print,
 * then a Word paste — so it runs once in beforeAll and the tests read its
 * results, in order, in one worker.
 */
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { getHtml, openEditor, setHtml } from "./support/harness";

/** The package's read-only stylesheet: what a print page draws saved HTML with. */
const PRINT_CSS = fs.readFileSync(path.join(process.cwd(), "dist/content.css"), "utf8");

/** LibreOffice's own line pitch for these lines, in px. */
const LIBRE_OFFICE_PITCH = 14.67;

const LINES: [string, string][] = [
  ["<u>Test\nplatform:</u>", "{\\ul Test platform:}"],
  [
    "PCR\nkit\t\t: CE IVD Marked RevoDx STI Pathogen Detection Kit,Turkey",
    "PCR kit\\tab\\tab : CE IVD Marked RevoDx STI Pathogen Detection Kit,Turkey",
  ],
  [
    "DNA\nExtraction\t: CE IVD marked Gene Proof pathogen free DNA isolation\nkit, Czech Republic",
    "DNA Extraction\\tab : CE IVD marked Gene Proof pathogen free DNA isolation kit, Czech Republic",
  ],
  ["Instrument\t:\nCFX Opus 96 Real-time PCR System", "Instrument\\tab : CFX Opus 96 Real-time PCR System"],
  ["Probe\t\t:\nTaqMan probe", "Probe\\tab\\tab : TaqMan probe"],
];

const LIBRE_OFFICE = `<!DOCTYPE html><html><head><meta http-equiv="content-type" content="text/html; charset=utf-8"/>
<meta name="generator" content="LibreOffice 24.2.7.2 (Linux)"/>
<style type="text/css">
p { line-height: 115%; text-align: left; orphans: 2; widows: 2; margin-bottom: 0.1in; direction: ltr; background: transparent }
</style></head><body lang="en-US" dir="ltr">
${LINES.map(([html]) => `<p style="line-height: 100%; margin-bottom: 0in"><font size="2" style="font-size: 9pt">${html}</font></p>`).join("\n")}
</body></html>`;

const RTF =
  String.raw`{\rtf1\ansi\deff4{\fonttbl{\f0\froman\fprq2\fcharset0 Times New Roman;}{\f4\froman\fprq2\fcharset0 Calibri;}}{\stylesheet{\s0 Normal;}}` +
  LINES.map(([, rtf]) => String.raw`\pard\plain \s0\f4\sl276\slmult1\sa200\sl240\slmult1\sa0{\fs18 ` + rtf + String.raw`}\par`).join("") +
  "}";

/** The same lines as Word writes them: a Word paste keeps the editor's own spacing. */
const WORD = `<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><style><!--
p.MsoNormal {margin:0cm; font-size:9.0pt; font-family:"Calibri",sans-serif;}
--></style></head><body>${LINES.map(([html]) => `<p class=MsoNormal>${html.replace(/\n/g, " ").replace(/\t/g, '<span style="mso-tab-count:1">&nbsp;&nbsp;&nbsp;</span>')}</p>`).join("")}</body></html>`;

interface Measured {
  pitch: number[];
  padding: string;
  font: string;
}

test.describe.configure({ mode: "default" });

let context: BrowserContext;
let page: Page;
let natural: number;
let expected: number;
let pasted: Measured;
let ticked: string[];
let afterOne: Measured;
let reopened: Measured;
let printed: Measured;
let word: Measured;

/** Empty the editor and paste `html` (and `rtf`) as Chrome's `beforeinput` for a real paste. */
async function paste(html: string, rtf: string | null) {
  await setHtml(page, "");
  await page.click("[data-slate-editor]");
  await page.evaluate(
    ({ html, rtf }) => {
      const data = new DataTransfer();
      data.setData("text/html", html);
      if (rtf) data.setData("text/rtf", rtf);
      data.setData("text/plain", "x");
      document.querySelector("[data-slate-editor]")!.dispatchEvent(
        new InputEvent("beforeinput", {
          inputType: "insertFromPaste",
          dataTransfer: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { html, rtf },
  );
  await page.waitForTimeout(800);
}

/** Line to line, px, from each line's first character; and the second line's padding and font. */
function measure(frameId: string | null = null): Promise<Measured> {
  return page.evaluate((frameId) => {
    const doc = frameId ? (document.getElementById(frameId) as HTMLIFrameElement).contentDocument! : document;
    const root = frameId ? doc.querySelector(".rte-content")! : doc.querySelector("[data-slate-editor]")!;
    const blocks = Array.from(root.children).filter((b) => /\S/.test(b.textContent!));
    const firstText = (b: Element) => {
      const walker = doc.createTreeWalker(b, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null)
        if (/\S/.test(n.data)) return n;
      return null;
    };
    const tops = blocks.map((b) => {
      const t = firstText(b)!;
      const i = t.data.search(/\S/);
      const r = doc.createRange();
      r.setStart(t, i);
      r.setEnd(t, i + 1);
      return r.getBoundingClientRect().top;
    });
    const cs = getComputedStyle(blocks[1]);
    return {
      pitch: tops.slice(1).map((t, i) => Math.round((t - tops[i]) * 100) / 100),
      padding: `${cs.paddingTop}/${cs.paddingBottom}`,
      font: getComputedStyle(firstText(blocks[1])!.parentElement!).fontFamily,
    };
  }, frameId);
}

const allNear = (pitch: number[], target: number, slack: number) =>
  pitch.length === 4 && pitch.every((p) => Math.abs(p - target) <= slack);

async function setUp(browser: Browser) {
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await context.newPage();
  await openEditor(page);

  natural = await page.evaluate(() => {
    const d = document.createElement("div");
    d.textContent = "Hg";
    d.style.cssText = "position:absolute;left:-9999px;font-family:Calibri;font-size:1000px;line-height:normal";
    document.body.append(d);
    const ratio = d.getBoundingClientRect().height / 1000;
    d.remove();
    return ratio;
  });
  expected = natural * 12; // 9pt, single, in Calibri

  await paste(LIBRE_OFFICE, RTF);
  pasted = await measure();

  // Choose "1" on all five lines: nothing may move — it is what they already are.
  await page.evaluate(() => {
    const blocks = Array.from(document.querySelectorAll('[data-slate-editor] > [data-slate-node="element"]'));
    const strings = (b: Element) => b.querySelectorAll("[data-slate-string]");
    const first = strings(blocks[0])[0].firstChild!;
    const lastStrings = strings(blocks[blocks.length - 1]);
    const last = lastStrings[lastStrings.length - 1].firstChild as Text;
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(last, last.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.waitForTimeout(300);
  await page.locator("button:has(svg.lucide-wrap-text)").first().click();
  await page.waitForTimeout(300);
  ticked = await page.evaluate(() =>
    [...document.querySelectorAll('[role="menuitemradio"]')]
      .filter((i) => i.getAttribute("aria-checked") === "true")
      .map((i) => i.textContent!.trim()),
  );
  await page.locator('[role="menuitemradio"]', { hasText: /^1$/ }).first().click();
  await page.waitForTimeout(400);
  afterOne = await measure();

  const saved = await getHtml(page);
  await setHtml(page, saved);
  await page.waitForTimeout(400);
  reopened = await measure();

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
    { html: saved, css: PRINT_CSS },
  );
  await page.waitForTimeout(300);
  printed = await measure("print");

  // A Word paste is not LibreOffice's: it keeps the editor's own paragraph spacing.
  await paste(WORD, "{\\rtf1\\ansi x}");
  word = await measure();
}

test.beforeAll(async ({ browser }) => {
  await setUp(browser);
});

test.afterAll(async () => {
  await context?.close();
});

test.describe("LibreOffice lines outside a table", () => {
  test("the browser can measure Calibri's natural line", () => {
    expect(natural > 1 && natural < 2, `natural = ${natural}`).toBe(true);
  });

  test("pasted: each line one single line of Calibri apart, as in the document", () => {
    expect(
      allNear(pasted.pitch, expected, 0.1),
      `expected ${expected.toFixed(2)}px | editor ${pasted.pitch.join("/")}px`,
    ).toBe(true);
  });

  test("pasted: within 0.1px of LibreOffice's own layout", () => {
    expect(
      allNear(pasted.pitch, LIBRE_OFFICE_PITCH, 0.1),
      `LibreOffice ${LIBRE_OFFICE_PITCH}px | editor ${pasted.pitch.join("/")}px`,
    ).toBe(true);
  });

  test("pasted: no editor padding on a line the document spaces", () => {
    expect(pasted.padding).toBe("0px/0px");
  });

  test("pasted: set in the document's font", () => {
    expect(pasted.font).toMatch(/Calibri/);
  });

  test("the control names the gap 1", () => {
    expect(ticked.length === 1 && ticked[0] === "1", `menu shows ${JSON.stringify(ticked)}`).toBe(true);
  });

  test('choosing "1" moves nothing', () => {
    expect(
      JSON.stringify(afterOne.pitch) === JSON.stringify(pasted.pitch),
      `before ${pasted.pitch.join("/")} | after ${afterOne.pitch.join("/")}`,
    ).toBe(true);
  });

  test("a save and reopen keeps it", () => {
    expect(
      allNear(reopened.pitch, expected, 0.1) && reopened.padding === "0px/0px",
      `reopened ${reopened.pitch.join("/")}px, padding ${reopened.padding}`,
    ).toBe(true);
  });

  test("the print page draws it where the editor does", () => {
    expect(
      allNear(printed.pitch, expected, 0.1) && printed.padding === "0px/0px",
      `printed ${printed.pitch.join("/")}px, padding ${printed.padding}`,
    ).toBe(true);
  });

  test("a Word paste keeps the editor's own paragraph padding", () => {
    expect(word.padding).toBe("4px/4px");
  });
});
