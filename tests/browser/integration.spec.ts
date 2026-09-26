/**
 * The no-React integration paths, against the built standalone bundle.
 *
 * A server-rendered page uses this package in one of two ways: it writes the
 * `<trodad-rich-text-editor>` element into a form, or it calls the global
 * `TrodadRichTextEditor.mount()`. Neither involves a line of React on the
 * page, and both depend on things jsdom does not model faithfully — a real
 * form-associated custom element, real cascade across a whole page, real
 * popper positioning — so they are checked here, in a browser.
 */
import { expect, test, type Page } from "@playwright/test";
import { openEditor, openPage } from "./support/harness";

/** What a server template's `{{ $html }}` (htmlspecialchars) writes for a stored document. */
const templateEscape = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

/** A stored document body with markup, an attribute and an entity in it. */
const STORED =
  '<h2>Impression</h2><p>Liver <strong>normal</strong> in size &amp; echotexture.</p>' +
  '<p style="text-align: center">No focal lesion.</p>';

const STYLESHEET = '<link rel="stylesheet" href="/dist/rich-text-editor.css">';
const BUNDLE = '<script type="module" src="/dist/standalone/rich-text-editor.js"></script>';

/** A bare page with `body` in it, the plain stylesheet and the standalone bundle. */
function page_(body: string, head = ""): string {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="csrf-token" content="test-token">
${STYLESHEET}
${head}
</head>
<body>
${body}
${BUNDLE}
</body></html>`;
}

/** The element in a form, its initial document written the way a server template writes it. */
const FORM_PAGE = page_(`
<form id="f" action="/store" method="POST">
  <trodad-rich-text-editor name="content" min-height="300">
    ${templateEscape(STORED)}
  </trodad-rich-text-editor>
  <button type="submit">Save</button>
</form>`);

/** Open `html` and wait until the element's editor has mounted. */
async function openElementPage(page: Page, html: string) {
  await openPage(page, html);
  await page.waitForSelector("trodad-rich-text-editor [data-slate-editor]");
  await page.waitForTimeout(150);
}

/** Put the caret at the end of the last block and type `text`. */
async function typeAtEnd(page: Page, text: string) {
  await page.click("[data-slate-editor] [data-slate-node='element'] >> nth=-1");
  await page.keyboard.press("End");
  await page.keyboard.type(text);
}

test.describe("<trodad-rich-text-editor> in a form", () => {
  test("renders the document it was given as escaped text content", async ({ page }) => {
    await openElementPage(page, FORM_PAGE);
    const editable = page.locator("trodad-rich-text-editor [data-slate-editor]");
    await expect(editable.locator("h2")).toHaveText("Impression");
    await expect(editable.locator("strong")).toHaveText("normal");
    await expect(editable).toContainText("in size & echotexture.");
    await expect(editable).toContainText("No focal lesion.");
    // The escaped markup must not leak through as visible text.
    await expect(editable).not.toContainText("<strong>");
  });

  test("new FormData(form) carries the document under its name", async ({ page }) => {
    await openElementPage(page, FORM_PAGE);
    const { posted, value, internals } = await page.evaluate(() => {
      const form = document.getElementById("f") as HTMLFormElement;
      const el = document.querySelector("trodad-rich-text-editor") as any;
      return {
        posted: new FormData(form).get("content"),
        value: el.value as string,
        // The real ElementInternals path, not the fallback <textarea>.
        internals: !document.querySelector("[data-rich-text-editor-field]"),
      };
    });
    expect(internals, "Chromium takes the ElementInternals path").toBe(true);
    expect(typeof posted).toBe("string");
    expect(posted).toContain("<h2>Impression</h2>");
    expect(posted).toContain("<strong>normal</strong>");
    expect(posted).toContain("&amp; echotexture");
    expect(posted).toBe(value);
  });

  test("a submit straight after typing carries the typed text, without waiting for the debounce", async ({
    page,
  }) => {
    await openElementPage(page, FORM_PAGE);
    await typeAtEnd(page, " TYPED");
    // Synchronously, in one task: read FormData, then submit and read it again
    // inside the page's own submit handler — well inside the 250ms debounce.
    const result = await page.evaluate(() => {
      const form = document.getElementById("f") as HTMLFormElement;
      const beforeSubmit = String(new FormData(form).get("content"));
      let inHandler: string | null = null;
      form.addEventListener(
        "submit",
        (e) => {
          e.preventDefault();
          inHandler = String(new FormData(form).get("content"));
        },
        { once: true }
      );
      form.requestSubmit();
      return { beforeSubmit, inHandler: inHandler as string | null };
    });
    // Recorded, not asserted: it only shows the debounce had not fired yet,
    // which depends on machine speed.
    test.info().annotations.push({
      type: "debounce pending before submit",
      description: String(!result.beforeSubmit.includes("TYPED")),
    });
    expect(result.inHandler).not.toBeNull();
    expect(result.inHandler).toContain("No focal lesion. TYPED");
  });

  test("form.reset() restores the original document", async ({ page }) => {
    await openElementPage(page, FORM_PAGE);
    const original = await page.evaluate(() =>
      String(new FormData(document.getElementById("f") as HTMLFormElement).get("content"))
    );
    await typeAtEnd(page, " TYPED");
    await page.waitForTimeout(400);
    const edited = await page.evaluate(() =>
      String(new FormData(document.getElementById("f") as HTMLFormElement).get("content"))
    );
    expect(edited, "the edit reached the form before the reset").toContain("TYPED");

    await page.evaluate(() => (document.getElementById("f") as HTMLFormElement).reset());
    await page.waitForTimeout(150);

    const editable = page.locator("trodad-rich-text-editor [data-slate-editor]");
    await expect(editable).not.toContainText("TYPED");
    await expect(editable.locator("h2")).toHaveText("Impression");
    await expect(editable.locator("strong")).toHaveText("normal");
    const after = await page.evaluate(() => ({
      posted: String(new FormData(document.getElementById("f") as HTMLFormElement).get("content")),
      value: (document.querySelector("trodad-rich-text-editor") as any).value as string,
    }));
    expect(after.posted).toBe(original);
    expect(after.value).toBe(original);
  });

  test("an edit fires input events on the element", async ({ page }) => {
    await openElementPage(page, FORM_PAGE);
    await page.evaluate(() => {
      (window as any).__inputs = 0;
      document
        .querySelector("trodad-rich-text-editor")!
        .addEventListener("input", (e) => {
          if (e.target instanceof HTMLElement && e.target.localName === "trodad-rich-text-editor")
            (window as any).__inputs++;
        });
    });
    await typeAtEnd(page, " TYPED");
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => (window as any).__inputs)).toBeGreaterThan(0);
  });
});

test("the standalone build exposes its global", async ({ page }) => {
  await openElementPage(page, FORM_PAGE);
  const globals = await page.evaluate(() => {
    const w = window as any;
    return {
      trodad: typeof w.TrodadRichTextEditor,
      mount: typeof w.TrodadRichTextEditor?.mount,
      converters: typeof w.TrodadRichTextEditor?.htmlToValue,
    };
  });
  expect(globals.trodad).toBe("object");
  expect(globals.mount).toBe("function");
  expect(globals.converters).toBe("function");
});

test.describe("the plain stylesheet on a bare page", () => {
  test("the editor renders, and preflight stays inside .rte-scope", async ({ page }) => {
    await openEditor(page, "<h1>Inside heading</h1><ul><li>Inside item</li></ul>", {
      bootstrap: false,
    });
    await expect(page.locator("[data-slate-editor]")).toBeVisible();
    await expect(page.locator("[data-slate-editor]")).toContainText("Inside item");

    // The host page's own content, outside the editor.
    const outside = await page.evaluate(() => {
      const h1 = document.createElement("h1");
      h1.textContent = "Page heading";
      const ul = document.createElement("ul");
      ul.innerHTML = "<li>Page item</li>";
      document.body.prepend(h1, ul);
      const h = getComputedStyle(h1);
      const u = getComputedStyle(ul);
      return {
        h1FontSize: h.fontSize,
        h1FontWeight: h.fontWeight,
        ulListStyle: u.listStyleType,
        ulPaddingLeft: u.paddingLeft,
        ulMarginTop: u.marginTop,
      };
    });
    expect(outside.h1FontSize).toBe("32px");
    expect(outside.h1FontWeight).toBe("700");
    expect(outside.ulListStyle).toBe("disc");
    expect(outside.ulPaddingLeft).toBe("40px");
    expect(outside.ulMarginTop).toBe("16px");
  });
});

test.describe("toolbar menus", () => {
  /** Open the turn-into menu and measure its content and popper wrapper. */
  async function openMenu(page: Page, head = "") {
    await openElementPage(
      page,
      page_(
        `<form id="f"><trodad-rich-text-editor name="body">${templateEscape("<p>Menu test</p>")}</trodad-rich-text-editor></form>`,
        head
      )
    );
    await page.click("[data-slate-editor] [data-slate-node='element']");
    await page.locator('button:has-text("Text")').first().click();
    const menu = page.locator('[role="menu"]');
    await expect(menu).toBeVisible();
    return page.evaluate(() => {
      const content = document.querySelector('[role="menu"]')!;
      const wrapper = content.closest("[data-radix-popper-content-wrapper]") as HTMLElement | null;
      const r = content.getBoundingClientRect();
      return {
        wrapped: !!wrapper,
        zIndex: wrapper ? getComputedStyle(wrapper).zIndex : null,
        rect: { x: r.x, y: r.y, right: r.right, bottom: r.bottom, w: r.width, h: r.height },
        vw: window.innerWidth,
        vh: window.innerHeight,
      };
    });
  }

  test("the turn-into menu opens inside the viewport, above the page", async ({ page }) => {
    const m = await openMenu(page);
    expect(m.wrapped).toBe(true);
    expect(m.rect.w).toBeGreaterThan(0);
    expect(m.rect.h).toBeGreaterThan(0);
    expect(m.rect.x).toBeGreaterThanOrEqual(0);
    expect(m.rect.y).toBeGreaterThanOrEqual(0);
    expect(m.rect.right).toBeLessThanOrEqual(m.vw);
    expect(m.rect.bottom).toBeLessThanOrEqual(m.vh);
    expect(m.zIndex).toBe("50");
  });

  test("--rte-popover-z-index on :root sets the menu's z-index", async ({ page }) => {
    const m = await openMenu(page, "<style>:root { --rte-popover-z-index: 999; }</style>");
    expect(m.zIndex).toBe("999");
  });

  test("the table menu opens too", async ({ page }) => {
    await openElementPage(
      page,
      page_(`<trodad-rich-text-editor name="body">${templateEscape("<p>x</p>")}</trodad-rich-text-editor>`)
    );
    await page.click("[data-slate-editor] [data-slate-node='element']");
    // The table trigger has no text; it is the dropdown whose tooltip says "Table".
    const triggers = page.locator('button[aria-haspopup="menu"]');
    const count = await triggers.count();
    let opened = false;
    for (let i = 0; i < count && !opened; i++) {
      const t = triggers.nth(i);
      await t.hover();
      const tip = await page
        .locator('[role="tooltip"]')
        .first()
        .textContent({ timeout: 1500 })
        .catch(() => null);
      if (tip?.trim() === "Table") {
        await t.click();
        opened = true;
      }
    }
    expect(opened, "found the Table trigger").toBe(true);
    const menu = page.locator('[role="menu"]');
    await expect(menu).toBeVisible();
    const box = (await menu.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(900);
    const z = await menu.evaluate(
      (el) => getComputedStyle(el.closest("[data-radix-popper-content-wrapper]")!).zIndex
    );
    expect(z).toBe("50");
  });
});
