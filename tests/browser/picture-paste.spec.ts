/**
 * Pasting a picture, in a real browser.
 *
 * jsdom cannot answer this one: the file path runs through a paste HANDLER, a
 * placeholder node and an async read of the File, none of which happen there.
 *
 * What was wrong: Word puts three things on the clipboard at once — HTML that
 * names the picture by a path on the machine doing the copying
 * (`file:///C:/…/clip_image001.png`), the bytes in the RTF flavour, and an
 * image rendition of the selection. Plate inserts a pasted image file only when
 * the clipboard carries NO html:
 *
 *   if (files.length > 0 && !types.includes('text/html')) …
 *
 * Word's clipboard has html, so the files were ignored; the html named a file
 * the browser may not read; and the paste inserted NOTHING AT ALL, with the
 * bytes sitting on the clipboard the whole time.
 *
 * The rule has to stay narrow, and the header-table case is why: what Windows
 * renders for a selection is a picture of the WHOLE selection, so a header
 * table would come back as one flat image of the entire header in place of the
 * document.
 */
import { expect, test, type Page } from "@playwright/test";
import { EDITOR, openEditor, setHtml } from "./support/harness";

/** A 4x4 PNG — the QR code, as far as this test is concerned. */
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAHUlEQVR42mP8z8BQz0AEYBxVSF+F/xkYGP4TowsAeYUH/WrKZ1UAAAAASUVORK5CYII=";

/** Word's clipboard html for a picture copied on its own. */
const PICTURE_ONLY =
  `<html xmlns:v="urn:schemas-microsoft-com:vml"><body><span style='mso-ignore:vglayout'>` +
  `<!--[if gte vml 1]><v:shape id="Picture_x0020_1" o:spid="_x0000_s1026" type="#_x0000_t75">` +
  `<v:imagedata src="file:///C:/Temp/clip_image001.png"/></v:shape><![endif]-->` +
  `<img width=96 height=96 src="file:///C:/Temp/clip_image001.png" v:shapes="Picture_x0020_1">` +
  `</span></body></html>`;

/** …and for the document header: contact details in one cell, the QR in the next. */
const HEADER =
  `<html xmlns:v="urn:schemas-microsoft-com:vml"><body><table border=1 style='border-collapse:collapse'><tr>` +
  `<td style='padding:2px'><p class=MsoNormal>Ref: A0000000001</p></td>` +
  `<td style='padding:2px'><img width=96 src="file:///C:/Temp/clip_image001.png" v:shapes="Picture_x0020_1"></td>` +
  `</tr></table></body></html>`;

/** Paste a clipboard built in the page, the way the browser really delivers one. */
async function paste(page: Page, html: string, withFile: boolean): Promise<string> {
  await openEditor(page);
  await setHtml(page, "<p>start</p>");
  await page.waitForTimeout(80);
  await page.click('[data-slate-editor] [data-slate-node="element"]');
  await page.keyboard.press("End");
  await page.waitForTimeout(60);

  return page.evaluate(
    async ({ html, withFile, PNG_B64, sel }) => {
      const editable = document.querySelector("[data-slate-editor]")!;
      const dt = new DataTransfer();
      if (html) dt.setData("text/html", html);
      if (withFile) {
        const bytes = Uint8Array.from(atob(PNG_B64), (c) => c.charCodeAt(0));
        dt.items.add(new File([bytes], "image.png", { type: "image/png" }));
      }
      editable.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })
      );
      // slate-react ignores `paste` where beforeinput is supported, which
      // is every browser this runs in; a real paste delivers both.
      editable.dispatchEvent(
        new InputEvent("beforeinput", {
          inputType: "insertFromPaste",
          dataTransfer: dt,
          bubbles: true,
          cancelable: true,
        })
      );
      await new Promise((r) => setTimeout(r, 700));
      return (window as any).TrodadRichTextEditor.getHtml(sel) as string;
    },
    { html, withFile, PNG_B64, sel: EDITOR }
  );
}

test.describe("pasting a picture", () => {
  test("a screenshot pastes as a picture, stored as a data URL", async ({ page }) => {
    const html = await paste(page, "", true);
    expect(html).toContain("data:image/png;base64,");
  });

  test("a Word picture whose bytes are on the clipboard is pasted from them", async ({ page }) => {
    const html = await paste(page, PICTURE_ONLY, true);
    expect(html).toContain("data:image/png;base64,");
  });

  test("and not as the file:// path the browser cannot read", async ({ page }) => {
    const html = await paste(page, PICTURE_ONLY, true);
    expect(html).not.toContain("file:///");
  });

  // It will not render, but the document said a picture belongs there.
  test("with no bytes anywhere, the reference is kept rather than the picture deleted", async ({
    page,
  }) => {
    const html = await paste(page, PICTURE_ONLY, false);
    expect(html).toContain("file:///");
  });
});

test.describe("a header table with a picture in it", () => {
  test("a header table still pastes as the table", async ({ page }) => {
    const html = await paste(page, HEADER, true);
    expect(html).toContain("<table");
    expect(html).toContain("Ref: A0000000001");
  });

  // The clipboard image renders the entire selection, text and all.
  test("and NOT as one flat picture of the whole selection", async ({ page }) => {
    const html = await paste(page, HEADER, true);
    expect(html).not.toContain("data:image/png;base64,");
  });

  test("and its QR keeps the reference Word gave it", async ({ page }) => {
    const html = await paste(page, HEADER, true);
    expect(html).toContain("file:///");
  });
});
