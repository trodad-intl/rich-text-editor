/**
 * A document copied out of LibreOffice: does it land where the document has it?
 *
 * Measured against the document itself: LibreOffice's own layout of the .docx
 * this fixture was cut from puts every value column at 2in (192px) — by default
 * half-inch stops (`BPD`), by a ruler stop at 1548 twips (`Number`, `Status`),
 * by a hanging indent's own stop (`Placenta`) and by 53 leading spaces (the
 * `No retro-placental` line). Each of those is something the paste used to lose:
 * the ruler stop is only in the RTF, the hanging indent read as a 2in indent,
 * the spaces sat outside the run's `<font face>`, and the lines are "Heading 3"
 * — which the editor drew with its own tight letter-spacing. See
 * src/lib/office-tab-stops.ts and src/lib/whitespace.ts.
 *
 * The HTML is LibreOffice's own clipboard, trimmed — captured through its
 * transferable (UNO), soft-wrap newlines and all. The RTF is cut down to what
 * is read from it: each paragraph's text, `\tx` stops and `\li`/`\fi` indents.
 * The async clipboard API cannot carry RTF, so the paste is the `beforeinput`
 * Chrome fires for a real one.
 *
 * One paste and one print render feed every check, so they are done once in
 * beforeAll and the tests run in order in one worker.
 */
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { getHtml, openEditor } from "./support/harness";

/** The package's read-only stylesheet: what a print page draws saved HTML with. */
const PRINT_CSS = fs.readFileSync(path.join(process.cwd(), "dist/content.css"), "utf8");

const F = '<font face="Calibri, serif"><font size="3" style="font-size: 12pt">';
const HTML = `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN"><html><head>
<meta http-equiv="content-type" content="text/html; charset=utf-8"/><meta name="generator" content="LibreOffice 24.2.7.2 (Linux)"/>
<style type="text/css">h3.western { font-family: "Times New Roman", serif; font-style: italic }
h2.western { font-family: "Times New Roman", serif; font-size: 12pt; font-style: italic; font-weight: bold }
h3 { line-height: 100%; margin-top: 0in; margin-bottom: 0in } h2 { line-height: 100%; margin-top: 0in; margin-bottom: 0in }</style>
</head><body lang="en-US" dir="ltr">
<h3 class="western">${F}<span style="font-style: normal">BPD\t\t\t\t</span></font></font><font color="#ff0000">${F}<span style="font-style: normal"><b>89</b></span></font></font></font>${F}<span style="font-style: normal">
mm</span></font></font></h3>
<h3 class="western" style="margin-right: -0.5in">${F}<span style="font-style: normal">Number
\t\t\tSingle </span></font></font>
</h3>
<h3 class="western" style="margin-right: -0.5in">${F}<span style="font-style: normal"><b>Status
\t\t              Alive</b></span></font></font></h3>
<h3 class="western" style="text-indent: -2in; margin-left: 2in">${F}<span style="font-style: normal">Placenta
\tFundal </span></font></font></h3>
<h3 class="western" style="text-indent: -2in; margin-left: 2in">${" ".repeat(5)}
${" ".repeat(47)}${F}<span style="font-style: normal">No
 retro-placental    collection is seen.   </span></font></font>
</h3>
<h2 class="western"><font color="#000080"><font face="Calibri, serif"><span style="font-style: normal">Amniotic
Fluid\t\t             Adequate in amount</span></font></font></h2>
</body></html>`;

const RTF = String.raw`{\rtf1\ansi\deff0\deftab720{\fonttbl{\f0\fswiss Calibri;}}{\stylesheet{\s3 Heading 3;}}
\pard\plain\s3 BPD\tab\tab\tab\tab 89 mm\par
\pard\plain\s3\tx1548 Number \tab\tab\tab Single \par
\pard\plain\s3\tx1548{\b Status \tab\tab              Alive}\par
\pard\plain\s3\li2880\fi-2880 Placenta \tab Fundal \par
\pard\plain\s3\li2880\fi-2880                                                      No  retro-placental    collection is seen.\par
\pard\plain\s2 Amniotic Fluid\tab\tab             Adequate in amount\par}`;

interface Line {
  label: string;
  tag: string;
  afterTabs: number | null;
  value: number | null;
  font: string;
}

test.describe.configure({ mode: "default" });

let context: BrowserContext;
let page: Page;
let editor: Line[];
let placentaFlush: boolean;
let printed: Line[];

/**
 * Per line, from the block's left edge: where the text after the last tab run
 * starts (`afterTabs`), and where the first word after the line's leading gap
 * starts (`value`) — the column the document lines up.
 */
function lines(rootSelector: string, frameId?: string): Promise<Line[]> {
  return page.evaluate(
    ({ rootSelector, frameId }) => {
      const doc = frameId ? (document.getElementById(frameId) as HTMLIFrameElement).contentDocument! : document;
      const root = doc.querySelector(rootSelector)!;
      return Array.from(root.children).map((block) => {
        const left = block.getBoundingClientRect().left;
        const xAt = (node: Text, i: number) => {
          const range = doc.createRange();
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          return Math.round(range.getBoundingClientRect().left - left);
        };
        const text = block.textContent!;
        const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        const leadingGap = /^[\s ]/.test(text);
        let afterTabs: number | null = null,
          value: number | null = null,
          inGap = false,
          lastWasTab = false;
        for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
          for (let i = 0; i < node.data.length; i++) {
            const c = node.data[i];
            if (lastWasTab && c !== "\t") afterTabs = xAt(node, i);
            lastWasTab = c === "\t";
            if (c === "\t" || (leadingGap && value === null && /[\s ]/.test(c))) {
              inGap = true;
              continue;
            }
            if (inGap && value === null && /\S/.test(c) && c !== " ") value = xAt(node, i);
          }
        }
        const firstRun = (walker.root as Element).querySelector("span") ?? block;
        return {
          label: text.trim().split(/[\s ]+/)[0],
          tag: block.tagName,
          afterTabs,
          value,
          font: getComputedStyle(firstRun).fontFamily,
        };
      });
    },
    { rootSelector, frameId },
  );
}

const byLabel = (rows: Line[], label: string): Partial<Line> => rows.find((row) => row.label === label) ?? {};
const near = (x: unknown, target: number) => typeof x === "number" && Math.abs(x - target) <= 2;

async function setUp(browser: Browser) {
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await context.newPage();
  await openEditor(page);
  await page.click("[data-slate-editor]");
  await page.evaluate(
    ({ html, rtf }) => {
      const data = new DataTransfer();
      data.setData("text/html", html);
      data.setData("text/rtf", rtf);
      data.setData("text/plain", "BPD");
      document.querySelector("[data-slate-editor]")!.dispatchEvent(
        new InputEvent("beforeinput", {
          inputType: "insertFromPaste",
          dataTransfer: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { html: HTML, rtf: RTF },
  );
  await page.waitForTimeout(800);

  editor = await lines("[data-slate-editor]");
  placentaFlush =
    editor.every((row) => row.label !== "Placenta") ||
    (await page.evaluate(() => {
      const block = Array.from(document.querySelectorAll("[data-slate-editor] > *")).find((b) =>
        b.textContent!.includes("Placenta"),
      )!;
      return parseFloat(getComputedStyle(block).marginLeft) === 0;
    }));

  // On the print page, from what was saved.
  const saved = await getHtml(page);
  await page.evaluate(
    ({ html, css }) => {
      const frame = document.createElement("iframe");
      frame.id = "print";
      frame.style.cssText = "position:absolute;left:-9999px;width:1200px;height:1400px";
      document.body.append(frame);
      frame.contentDocument!.open();
      frame.contentDocument!.write(
        `<!doctype html><html><head><style>
      body { margin:0; font-size:15px; font-family:Calibri,"Arial Narrow",Arial,sans-serif }
      ${css}
    </style></head><body><div class="rte-content" style="width:1100px">${html}</div></body></html>`,
      );
      frame.contentDocument!.close();
    },
    { html: saved, css: PRINT_CSS },
  );
  await page.waitForTimeout(200);
  printed = await lines(".rte-content", "print");
}

test.beforeAll(async ({ browser }) => {
  await setUp(browser);
});

test.afterAll(async () => {
  await context?.close();
});

test.describe("a LibreOffice paste, laid out as the document has it", () => {
  test("BPD: default half-inch stops put the value at 2in (192px)", () => {
    expect(near(byLabel(editor, "BPD").value, 192), `${byLabel(editor, "BPD").value}px`).toBe(true);
  });

  test("Number: the ruler stop from the RTF puts the value at 192px", () => {
    expect(near(byLabel(editor, "Number").value, 192), `${byLabel(editor, "Number").value}px`).toBe(true);
  });

  test("Status: the ruler stop takes its tabs to 144px, where its spaces start", () => {
    expect(near(byLabel(editor, "Status").afterTabs, 144), `${byLabel(editor, "Status").afterTabs}px`).toBe(true);
  });

  test("Placenta: the hanging indent's own stop puts the value at 192px", () => {
    expect(near(byLabel(editor, "Placenta").value, 192), `${byLabel(editor, "Placenta").value}px`).toBe(true);
  });

  test("…and the line starts where the document starts it, not 2in in", () => {
    expect(placentaFlush).toBe(true);
  });

  test("No retro-placental: 53 leading spaces in the run's own font reach 192px", () => {
    expect(near(byLabel(editor, "No").value, 192), `${byLabel(editor, "No").value}px`).toBe(true);
  });

  test("Amniotic Fluid: its tabs end at 144px, where its spaces start", () => {
    expect(near(byLabel(editor, "Amniotic").afterTabs, 144), `${byLabel(editor, "Amniotic").afterTabs}px`).toBe(
      true,
    );
  });

  test("every line is in the run's own Calibri, not the style block's Times New Roman", () => {
    expect(
      editor.every((row) => /^Calibri/.test(row.font)),
      editor.map((row) => row.font.split(",")[0]).join(" / "),
    ).toBe(true);
  });

  test('the document\'s "Heading" lines are paragraphs, drawn in its own type', () => {
    expect(
      editor.every((row) => row.tag !== "H2" && row.tag !== "H3"),
      editor.map((row) => row.tag).join(" "),
    ).toBe(true);
  });

  test("the print page draws every line where the editor does", () => {
    const mismatches = editor.filter((row) => {
      const other = byLabel(printed, row.label);
      return (
        !(near(other.value, row.value ?? -99) || (row.value === null && other.value === null)) ||
        !(near(other.afterTabs, row.afterTabs ?? -99) || (row.afterTabs === null && other.afterTabs === null))
      );
    });
    expect(
      mismatches.length,
      mismatches
        .map(
          (row) =>
            `${row.label}: editor ${row.value}/${row.afterTabs}, print ${byLabel(printed, row.label).value}/${byLabel(printed, row.label).afterTabs}`,
        )
        .join("; "),
    ).toBe(0);
  });
});
