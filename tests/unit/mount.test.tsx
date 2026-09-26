/**
 * Integration: the host-page-facing mount API.
 *
 * Proves the parts that have nothing to do with Plate itself — that React
 * actually attaches to a plain div inside an ordinary form, that the hidden
 * textarea ends up carrying HTML, and that a submit flushes the debounce
 * instead of posting stale content.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { act } from "react";
import api from "@/mount";

function buildPage(initialHtml = "") {
  document.body.innerHTML = `
    <form id="f" action="/store" method="POST">
      <textarea name="content" id="content" hidden>${initialHtml}</textarea>
      <div class="rte-scope" id="content_editor"></div>
      <button type="submit">Create</button>
    </form>`;
  return {
    form: document.getElementById("f") as HTMLFormElement,
    textarea: document.getElementById("content") as HTMLTextAreaElement,
  };
}

/**
 * A stored document body with no block wrapper.
 *
 * Plate wraps stray root-level runs in a paragraph only when the fragment mixes
 * blocks and inlines, so a body that is inline all the way down stayed a list of
 * text nodes at the root — not a document. slate-react threw reading children
 * off one while painting, which took the whole editor down and left the page
 * with a dead box where the document should be. See `toRenderableValue`.
 */
describe("opening a document stored without a block wrapper", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  const BODIES: Record<string, string> = {
    "bare text": "Normal study.",
    "a bare span": "<span>Normal study.</span>",
    "bare bold": "<b>Normal study.</b>",
    "an empty div": "<div></div>",
  };

  for (const [name, body] of Object.entries(BODIES)) {
    it(`renders ${name} instead of taking the editor down`, async () => {
      const { textarea } = buildPage(body);
      await act(async () => {
        api.mount("#content_editor", { textarea: "#content" });
      });

      expect(document.querySelector("[data-slate-editor]")).not.toBeNull();
      expect(api.getHtml("#content_editor")).toContain("<p>");
      expect(textarea).not.toBeNull();
    });
  }

  it("keeps the text, in the paragraph it was missing", async () => {
    buildPage("Normal study.");
    await act(async () => {
      api.mount("#content_editor", { textarea: "#content" });
    });
    expect(api.getHtml("#content_editor")).toBe("<p>Normal study.</p>");
  });
});

describe("mount API", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("the standalone build exposes it as a global", async () => {
    const { default: standalone } = await import("@/standalone");
    expect(typeof api.mount).toBe("function");
    expect(window.TrodadRichTextEditor).toBe(standalone);
    for (const fn of ["mount", "destroy", "getHtml", "setHtml", "getValue", "setValue"] as const) {
      expect(standalone[fn]).toBe(api[fn]);
    }
    for (const fn of ["fitTablesToPage", "htmlToValue", "valueToHtml"] as const) {
      expect(typeof standalone[fn]).toBe("function");
    }
  });

  it("format: json — reads and writes the Plate value as JSON", async () => {
    const value = [{ type: "p", children: [{ text: "From JSON", bold: true }] }];
    const { form, textarea } = buildPage(JSON.stringify(value).replace(/</g, "&lt;"));
    await act(async () => {
      api.mount("#content_editor", { textarea: "#content", format: "json" });
    });
    expect(api.getHtml("#content_editor")).toBe("<p><strong>From JSON</strong></p>");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(JSON.parse(textarea.value)).toEqual(value);
    expect(api.getValue("#content_editor")).toEqual(value);
  });

  it("mounts into a plain div and renders an editable surface", async () => {
    buildPage("<p>Existing</p>");
    await act(async () => {
      api.mount("#content_editor", { textarea: "#content" });
    });
    const container = document.getElementById("content_editor")!;
    expect(container.querySelector("[data-slate-editor]")).not.toBeNull();
    expect(container.textContent).toContain("Existing");
  });

  it("seeds the editor from the textarea's existing HTML", async () => {
    buildPage("<p><strong>Seeded</strong></p>");
    await act(async () => {
      api.mount("#content_editor", { textarea: "#content" });
    });
    const html = api.getHtml("#content_editor");
    expect(html).toContain("<strong>Seeded</strong>");
  });

  it("writes HTML back into the textarea on submit, bypassing the debounce", async () => {
    const { form, textarea } = buildPage("<p>Report text</p>");
    await act(async () => {
      api.mount("#content_editor", { textarea: "#content" });
    });
    // Nothing has flushed yet — the debounce has not fired.
    textarea.value = "STALE";
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(textarea.value).not.toBe("STALE");
    expect(textarea.value).toContain("Report text");
  });

  it("setHtml replaces the document, like a legacy editor's set-code call", async () => {
    const { textarea } = buildPage("<p>Old</p>");
    await act(async () => {
      api.mount("#content_editor", { textarea: "#content" });
    });
    await act(async () => {
      api.setHtml("#content_editor", "<p>Replaced</p>");
    });
    expect(textarea.value).toContain("Replaced");
    expect(textarea.value).not.toContain("Old");
  });

  it("destroy unmounts and detaches the submit listener", async () => {
    const { form, textarea } = buildPage("<p>X</p>");
    await act(async () => {
      api.mount("#content_editor", { textarea: "#content" });
    });
    await act(async () => {
      api.destroy("#content_editor");
    });
    expect(document.getElementById("content_editor")!.innerHTML).toBe("");
    textarea.value = "UNTOUCHED";
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(textarea.value).toBe("UNTOUCHED");
  });
});
