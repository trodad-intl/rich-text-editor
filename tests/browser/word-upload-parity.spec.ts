/**
 * An uploaded .docx comes out as the same document pasted from LibreOffice — in
 * a real browser, where line spacing is converted against the real font's
 * metrics and rules are drawn at their real widths.
 *
 * jsdom measures no font, so the unit twin (tests/unit/docx-paste-parity.test.ts)
 * converts every gap against one fallback metric and cannot see a gap measured
 * against the wrong font. This is where that shows.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { EDITOR, openEditor } from "./support/harness";
import { readerShape } from "../unit/support/reader-shape";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/libreoffice");
const fixture = (name: string, ext: string, encoding: BufferEncoding = "utf8") => fs.readFileSync(path.join(FIXTURES, `${name}.${ext}`), encoding);

const value = (page: Page) => page.evaluate((sel) => (window as any).TrodadRichTextEditor.getValue(sel), EDITOR);

async function pasted(page: Page, name: string) {
  await openEditor(page);
  await page.click("[data-slate-editor]");
  await page.evaluate(
    ({ html, rtf }) => {
      const data = new DataTransfer();
      data.setData("text/html", html);
      data.setData("text/rtf", rtf);
      document.querySelector("[data-slate-editor]")!.dispatchEvent(
        new InputEvent("beforeinput", { inputType: "insertFromPaste", dataTransfer: data, bubbles: true, cancelable: true })
      );
    },
    { html: fixture(name, "html"), rtf: fixture(name, "rtf", "latin1") }
  );
  await page.waitForTimeout(600);
  return value(page);
}

async function uploaded(page: Page, name: string) {
  await openEditor(page);
  await page.setInputFiles('input[accept=".doc,.docx"]', path.join(FIXTURES, `${name}.docx`));
  await expect(page.getByText(`Loaded: ${name}.docx`)).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(300);
  return value(page);
}

for (const name of ["report", "tables"]) {
  test(`upload = LibreOffice paste: ${name}`, async ({ page }) => {
    const fromPaste = readerShape(await pasted(page, name));
    const fromUpload = readerShape(await uploaded(page, name));
    expect(fromUpload).toEqual(fromPaste);
  });
}
