/**
 * The component speaks both formats: HTML or a Plate value in, both out.
 *
 * An app may store either — HTML to render anywhere without the editor, the
 * Plate value to keep the exact document model — so every way in (initial
 * props, setHtml/setValue) and every way out (the three callbacks, getHtml/
 * getValue, flush) is held to agree with the other format.
 */
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  htmlToValue,
  RichTextEditor,
  valueToHtml,
  type RichTextChange,
  type RichTextEditorHandle,
  type RichTextEditorProps,
} from "@/index";

const VALUE = [
  { type: "h2", children: [{ text: "Title" }] },
  { type: "p", children: [{ text: "Plain and " }, { text: "bold", bold: true }] },
];
const HTML = "<h2>Title</h2><p>Plain and <strong>bold</strong></p>";

let root: Root | null = null;

async function render(props: RichTextEditorProps) {
  const handle = createRef<RichTextEditorHandle>();
  const host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host);
    root.render(<RichTextEditor ref={handle} {...props} />);
  });
  return { handle: handle.current!, host };
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("opening a document", () => {
  it("from HTML", async () => {
    const { handle } = await render({ initialHtml: HTML });
    expect(handle.getValue()).toEqual(VALUE);
  });

  it("from a Plate value", async () => {
    const { handle } = await render({ initialValue: VALUE as any });
    expect(handle.getHtml()).toBe(HTML);
  });

  it("from a Plate value serialized as JSON, as it comes out of a database", async () => {
    const { handle } = await render({ initialValue: JSON.stringify(VALUE) });
    expect(handle.getHtml()).toBe(HTML);
  });

  it("prefers the value when both are given", async () => {
    const { handle } = await render({ initialValue: VALUE as any, initialHtml: "<p>ignored</p>" });
    expect(handle.getHtml()).toBe(HTML);
  });

  it("opens an empty document for invalid JSON instead of crashing", async () => {
    const { handle, host } = await render({ initialValue: "{not json" });
    expect(host.querySelector("[data-slate-editor]")).not.toBeNull();
    expect(handle.getHtml()).toBe("<p><br/></p>");
  });
});

describe("reporting changes", () => {
  it("flush fires all three callbacks with matching formats", async () => {
    const onChange = vi.fn<(c: RichTextChange) => void>();
    const onChangeHtml = vi.fn<(html: string) => void>();
    const onChangeValue = vi.fn();
    const { handle } = await render({ initialHtml: HTML, onChange, onChangeHtml, onChangeValue });

    let returned = "";
    await act(async () => {
      returned = handle.flush();
    });

    expect(returned).toBe(HTML);
    expect(onChangeHtml).toHaveBeenCalledWith(HTML);
    expect(onChangeValue).toHaveBeenCalledWith(VALUE);
    expect(onChange).toHaveBeenCalledWith({ html: HTML, value: VALUE });
  });

  it("setValue replaces the document and reports it in both formats", async () => {
    const onChange = vi.fn<(c: RichTextChange) => void>();
    const { handle } = await render({ initialHtml: "<p>Old</p>", onChange });
    await act(async () => handle.setValue(VALUE as any));
    expect(handle.getHtml()).toBe(HTML);
    expect(onChange).toHaveBeenLastCalledWith({ html: HTML, value: VALUE });
  });

  it("setHtml replaces the document and reports it in both formats", async () => {
    const onChange = vi.fn<(c: RichTextChange) => void>();
    const { handle } = await render({ initialValue: VALUE as any, onChange });
    await act(async () => handle.setHtml("<p>New</p>"));
    expect(onChange).toHaveBeenLastCalledWith({
      html: "<p>New</p>",
      value: [{ type: "p", children: [{ text: "New" }] }],
    });
  });
});

describe("options", () => {
  it("readOnly renders the document without a toolbar or editing", async () => {
    const { host } = await render({ initialHtml: HTML, readOnly: true });
    expect(host.textContent).toContain("Title");
    expect(host.querySelector('[role="toolbar"]')).toBeNull();
    expect(host.querySelector("[data-slate-editor]")?.getAttribute("contenteditable")).toBe("false");
  });

  it("toolbar={false} hides the toolbar but keeps editing", async () => {
    const { host } = await render({ initialHtml: HTML, toolbar: false });
    expect(host.querySelector('[role="toolbar"]')).toBeNull();
    expect(host.querySelector("[data-slate-editor]")?.getAttribute("contenteditable")).toBe("true");
  });

  it("fontFamilies replaces the font picker's entries, and [] hides it", async () => {
    const { host } = await render({ fontFamilies: [{ label: "Brand", value: "Inter, sans-serif" }] });
    const picker = host.querySelector<HTMLSelectElement>('select[aria-label="Font"]')!;
    expect([...picker.options].map((o) => o.textContent)).toEqual(["Brand"]);

    await act(async () => root?.unmount());
    const again = await render({ fontFamilies: [] });
    expect(again.host.querySelector('select[aria-label="Font"]')).toBeNull();
  });

  it("wordImport={false} removes the Word import button", async () => {
    const withButton = await render({});
    expect(withButton.host.querySelector('input[type="file"][accept=".doc,.docx"]')).not.toBeNull();
    await act(async () => root?.unmount());
    const without = await render({ wordImport: false });
    expect(without.host.querySelector('input[type="file"][accept=".doc,.docx"]')).toBeNull();
  });
});

describe("converters", () => {
  it("htmlToValue gives what the editor would open", () => {
    expect(htmlToValue(HTML)).toEqual(VALUE);
  });

  it("valueToHtml gives what the editor would save", () => {
    expect(valueToHtml(VALUE as any)).toBe(HTML);
    expect(valueToHtml(JSON.stringify(VALUE))).toBe(HTML);
  });

  it("round-trips", () => {
    expect(valueToHtml(htmlToValue(HTML))).toBe(HTML);
  });
});
