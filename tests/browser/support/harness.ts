/**
 * The page every browser test drives: the BUILT standalone bundle mounted onto
 * a hidden textarea inside an ordinary form, on a Bootstrap 5 page.
 *
 * jsdom does no layout — getBoundingClientRect is all zeros there — so a
 * simulated drag or a measured line box proves nothing. These tests load the
 * real built assets over http in a real browser, which is the only way to
 * verify that dragging a column border moves the column.
 *
 * Bootstrap is loaded by default because the Bootstrap-hardened stylesheet is
 * the most demanding configuration the package ships: every conflict between
 * it and the editor shows up here rather than in a consumer's app. Pass
 * `{ bootstrap: false }` to test the plain stylesheet on a bare page.
 */
import type { Page } from "@playwright/test";

export const BASE_URL = `http://127.0.0.1:${process.env.PORT ?? 4178}`;

/** The mount target every harness page uses. */
export const EDITOR = "#content_editor";

export interface HarnessOptions {
  /** Load Bootstrap 5 and the Bootstrap-hardened stylesheet. Default true. */
  bootstrap?: boolean;
  /** Passed to mount(). Default 400. */
  minHeight?: number;
  /** Extra markup for <head>, e.g. a print stylesheet. */
  head?: string;
}

const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

export function harnessHtml(initialHtml = "", options: HarnessOptions = {}): string {
  const { bootstrap = true, minHeight = 400, head = "" } = options;
  const css = bootstrap
    ? `<link rel="stylesheet" href="/tests/fixtures/bootstrap-5.0.2.min.css">
<link rel="stylesheet" href="/dist/rich-text-editor.bootstrap.css">`
    : `<link rel="stylesheet" href="/dist/rich-text-editor.css">`;
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="csrf-token" content="test-token">
${css}
${head}
</head>
<body>
<div class="container">
  <form id="f" action="/store" method="POST">
    <div class="form-group">
      <label for="content">Content</label>
      <textarea name="content" id="content" hidden>${escapeText(initialHtml)}</textarea>
      <div class="rte-scope" id="content_editor"></div>
    </div>
    <button type="submit" class="btn btn-success btn-sm">Create</button>
  </form>
</div>
<script type="module" src="/dist/standalone/rich-text-editor.js"></script>
<script>
  window.__ready = new Promise((resolve) => {
    (function wait() {
      if (!window.TrodadRichTextEditor) return void setTimeout(wait, 20);
      window.TrodadRichTextEditor.mount('#content_editor', {
        textarea: '#content', minHeight: ${minHeight},
      });
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    })();
  });
</script>
</body></html>`;
}

let counter = 0;

/**
 * Serve `html` at a fresh URL on the test server and open it. Each call gets
 * its own path, so a test can open several pages without them colliding.
 */
export async function openPage(page: Page, html: string): Promise<void> {
  const url = `${BASE_URL}/__page/${++counter}`;
  await page.route(url, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: html })
  );
  await page.goto(url);
}

/** Open the harness with `initialHtml` in the textarea and wait for the editor. */
export async function openEditor(
  page: Page,
  initialHtml = "",
  options: HarnessOptions = {}
): Promise<void> {
  await openPage(page, harnessHtml(initialHtml, options));
  await page.evaluate(() => (window as any).__ready);
}

/** Replace the document through the public API. */
export async function setHtml(page: Page, html: string): Promise<void> {
  await page.evaluate(
    ([sel, h]) => (window as any).TrodadRichTextEditor.setHtml(sel, h),
    [EDITOR, html] as const
  );
}

/** Serialize now and return the HTML, through the public API. */
export async function getHtml(page: Page): Promise<string> {
  return page.evaluate((sel) => (window as any).TrodadRichTextEditor.getHtml(sel), EDITOR);
}
