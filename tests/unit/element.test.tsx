/**
 * `<trodad-rich-text-editor>` — the no-JavaScript integration.
 *
 * A server-rendered page writes the tag with the stored HTML escaped inside it
 * and gets an editor that posts like a <textarea>. That contract is what these
 * tests hold: the initial document comes from the escaped text content, the
 * value tracks the editor, a submit never posts stale HTML, and reset restores
 * what the page was rendered with.
 *
 * Real form submission (FormData from ElementInternals) is exercised in the
 * browser suite — jsdom does not implement form-associated custom elements.
 */
import { act } from "react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { defineRichTextEditorElement, RichTextEditorElement, TAG_NAME } from "@/element";

/** What `{{ $html }}` in a server template (or any escaping template engine) writes. */
const escape = (html: string) =>
  html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function render(markup: string) {
  await act(async () => {
    document.body.innerHTML = markup;
  });
  return document.querySelector(TAG_NAME) as RichTextEditorElement;
}

describe(`<${TAG_NAME}>`, () => {
  beforeAll(() => defineRichTextEditorElement());
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("registers once, and a second define is a no-op", () => {
    expect(customElements.get(TAG_NAME)).toBe(RichTextEditorElement);
    expect(() => defineRichTextEditorElement()).not.toThrow();
  });

  it("opens the document written, escaped, inside the tag", async () => {
    const el = await render(
      `<form><${TAG_NAME} name="body">${escape("<p><strong>Stored</strong> report</p>")}</${TAG_NAME}></form>`
    );
    expect(el.querySelector("[data-slate-editor]")).not.toBeNull();
    expect(el.value).toContain("<strong>Stored</strong>");
    // The escaped source must not be left behind as visible text.
    expect(el.textContent).not.toContain("&lt;");
  });

  it("takes the initial document from a value attribute too", async () => {
    const el = await render(
      `<${TAG_NAME} value="${escape("<p>From attribute</p>").replace(/"/g, "&quot;")}"></${TAG_NAME}>`
    );
    expect(el.value).toBe("<p>From attribute</p>");
  });

  it("carries the editor's scope class, so the scoped stylesheet applies", async () => {
    const el = await render(`<${TAG_NAME}></${TAG_NAME}>`);
    expect(el.classList.contains("rte-scope")).toBe(true);
  });

  it("setting value replaces the document", async () => {
    const el = await render(`<${TAG_NAME}>${escape("<p>Old</p>")}</${TAG_NAME}>`);
    await act(async () => {
      el.value = "<p>Replaced</p>";
    });
    expect(el.value).toBe("<p>Replaced</p>");
    expect(el.textContent).toContain("Replaced");
  });

  it("flush returns the current HTML without waiting for the debounce", async () => {
    const el = await render(`<${TAG_NAME}>${escape("<p>Now</p>")}</${TAG_NAME}>`);
    expect(el.flush()).toBe("<p>Now</p>");
  });

  it("maps its attributes onto the editor", async () => {
    const el = await render(
      `<${TAG_NAME} placeholder="Write the findings…" min-height="321"></${TAG_NAME}>`
    );
    const editable = el.querySelector<HTMLElement>("[data-slate-editor]")!;
    expect(editable.style.minHeight).toBe("321px");
    expect(el.textContent).toContain("Write the findings…");
  });

  it("posts under its name where the browser lacks form-associated elements", async () => {
    // jsdom has no ElementInternals.setFormValue — the Safari < 16.4 case —
    // so this exercises the hidden-textarea fallback end to end.
    const el = await render(
      `<form><${TAG_NAME} name="content">${escape("<p>Posted</p>")}</${TAG_NAME}></form>`
    );
    const form = el.closest("form")!;
    expect(new FormData(form).get("content")).toBe("<p>Posted</p>");

    await act(async () => {
      el.value = "<p>Changed</p>";
    });
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(new FormData(form).getAll("content")).toEqual(["<p>Changed</p>"]);
  });

  it('format="json" opens and posts the Plate value as JSON', async () => {
    const value = [{ type: "p", children: [{ text: "Stored as JSON" }] }];
    const el = await render(
      `<form><${TAG_NAME} name="doc" format="json">${escape(JSON.stringify(value))}</${TAG_NAME}></form>`
    );
    expect(el.getHtml()).toBe("<p>Stored as JSON</p>");
    expect(JSON.parse(el.value)).toEqual(value);
    expect(JSON.parse(String(new FormData(el.closest("form")!).get("doc")))).toEqual(value);

    await act(async () => el.setHtml("<p>Edited</p>"));
    expect(JSON.parse(el.flush())).toEqual([{ type: "p", children: [{ text: "Edited" }] }]);
  });

  it("form reset restores the document the page was rendered with", async () => {
    const el = await render(`<${TAG_NAME}>${escape("<p>Original</p>")}</${TAG_NAME}>`);
    await act(async () => {
      el.value = "<p>Edited</p>";
    });
    await act(async () => {
      el.formResetCallback();
    });
    expect(el.value).toBe("<p>Original</p>");
  });

  it("unmounts when removed, and keeps its editor when only moved", async () => {
    const el = await render(
      `<div id="a"><${TAG_NAME}>${escape("<p>Kept</p>")}</${TAG_NAME}></div><div id="b"></div>`
    );
    await act(async () => {
      document.getElementById("b")!.appendChild(el);
      await Promise.resolve();
    });
    expect(el.querySelector("[data-slate-editor]")).not.toBeNull();
    expect(el.value).toBe("<p>Kept</p>");

    await act(async () => {
      el.remove();
      await Promise.resolve();
    });
    expect(el.querySelector("[data-slate-editor]")).toBeNull();
  });
});
