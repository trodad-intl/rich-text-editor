/**
 * The "Upload Word" button, and which converter it hands the file to.
 *
 * Not a detail: Mammoth reads a .docx for its structure and drops every direct
 * format the document states — colour, size, alignment — so a red heading
 * imported BLACK no matter how carefully the rest of this editor preserves
 * colour, and nothing downstream could put back what never arrived. The server
 * route (LibreOffice) states all three in spellings the pipeline reads.
 *
 * A real .docx never gets that far: the browser reads it itself and loads it
 * through the paste path (lib/docx/read-docx.ts, tests/unit/docx-import.test.ts).
 * The uploads below are a two-byte "PK" the reader cannot read, so they test
 * what happens after it gives up — which is the order these converters keep.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { act } from "react";
import api, { type MountOptions } from "@/mount";
import { buildDocx, para, run } from "./support/docx";

const { mammothConvert } = vi.hoisted(() => ({ mammothConvert: vi.fn() }));
vi.mock("mammoth", () => ({
  default: { convertToHtml: mammothConvert },
  convertToHtml: mammothConvert,
}));

/** What LibreOffice returns for a .docx whose heading is red. */
const LIBREOFFICE_HTML =
  `<p align="center" style="margin-bottom: 0in">` +
  `<font color="#ff0000"><font size="4" style="font-size: 16pt"><b>MOLECULAR BIOLOGY REPORT</b></font></font></p>`;

/** What Mammoth returns for the very same file. */
const MAMMOTH_HTML = `<p><strong>MOLECULAR BIOLOGY REPORT</strong></p>`;

function mount(options: Partial<MountOptions> = {}) {
  document.body.innerHTML = `
    <form id="f"><textarea id="content" hidden></textarea>
    <div class="rte-scope" id="content_editor"></div></form>`;
  return act(async () => {
    api.mount("#content_editor", { textarea: "#content", ...options });
  });
}

async function upload(fileName: string, contents: BlobPart = "PK") {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File([contents], fileName);
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  // The reading, the conversion and the load that follows are all promises:
  // wait for the button to say it is done, not a fixed number of ticks.
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(document.body.textContent).not.toContain("Converting");
  });
}

function serverReturning(html: string) {
  return vi.fn(async () => ({ ok: true, json: async () => ({ html }) }) as unknown as Response);
}

describe("uploading a Word file", () => {
  it("reads a real .docx in the browser, with no server and no Mammoth", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const docx = await buildDocx({
        body: para(run("MOLECULAR BIOLOGY REPORT", `<w:b/><w:color w:val="FF0000"/><w:sz w:val="32"/>`), `<w:jc w:val="center"/>`),
      });
      await mount({ wordImport: { url: "/tools/word-to-html" } });
      await upload("report.docx", docx);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(mammothConvert).not.toHaveBeenCalled();
      const html = api.getHtml("#content_editor");
      expect(html).toContain("MOLECULAR BIOLOGY REPORT");
      expect(html).toContain("color: rgb(255, 0, 0)");
      expect(html).toContain("font-size: 16pt");
      expect(html).toContain("text-align: center");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  beforeEach(() => {
    document.body.innerHTML = "";
    mammothConvert.mockReset();
    mammothConvert.mockResolvedValue({ value: MAMMOTH_HTML, messages: [] });
  });

  it("sends a .docx the browser cannot read to LibreOffice, which keeps the colour", async () => {
    const fetchMock = serverReturning(LIBREOFFICE_HTML);
    vi.stubGlobal("fetch", fetchMock);

    await mount({ wordImport: { url: "/tools/word-to-html" } });
    await upload("report.docx");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mammothConvert).not.toHaveBeenCalled();

    const html = api.getHtml("#content_editor");
    expect(html).toContain("MOLECULAR BIOLOGY REPORT");
    // The whole point: red on the way in, red on the way out.
    expect(html).toContain("color: rgb(255, 0, 0)");
    // And the two formats Mammoth drops along with it.
    expect(html).toContain("font-size: 16pt");
    expect(html).toContain("text-align: center");
  });

  it("sends a .doc there too, as it always did", async () => {
    const fetchMock = serverReturning(LIBREOFFICE_HTML);
    vi.stubGlobal("fetch", fetchMock);

    await mount({ wordImport: { url: "/tools/word-to-html" } });
    await upload("report.doc");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(api.getHtml("#content_editor")).toContain("color: rgb(255, 0, 0)");
  });

  it("falls back to Mammoth for a .docx when there is no route to ask", async () => {
    // Formatting is lost that way — but an import still works where the server
    // converter is not configured, which is what it did before.
    await mount();
    await upload("report.docx");

    expect(mammothConvert).toHaveBeenCalledTimes(1);
    expect(api.getHtml("#content_editor")).toContain("MOLECULAR BIOLOGY REPORT");
  });

  it("falls back to Mammoth for a .docx when the conversion fails", async () => {
    const fetchMock = vi.fn(
      async () => ({ ok: false, json: async () => ({ message: "no" }) }) as unknown as Response
    );
    vi.stubGlobal("fetch", fetchMock);

    await mount({ wordImport: { url: "/tools/word-to-html" } });
    await upload("report.docx");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mammothConvert).toHaveBeenCalledTimes(1);
    expect(api.getHtml("#content_editor")).toContain("MOLECULAR BIOLOGY REPORT");
  });

  it("says so for a .doc it cannot convert, which the browser cannot read at all", async () => {
    await mount();
    await upload("report.doc");

    expect(mammothConvert).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("not configured");
  });

  it("sends the headers given, and the page's <meta> CSRF token", async () => {
    const fetchMock = serverReturning(LIBREOFFICE_HTML);
    vi.stubGlobal("fetch", fetchMock);
    const meta = document.createElement("meta");
    meta.name = "csrf-token";
    meta.content = "from-meta";
    document.head.appendChild(meta);
    try {
      await mount({ wordImport: { url: "/convert", headers: { Authorization: "Bearer t" } } });
      await upload("report.docx");
      const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
      expect(init.headers).toEqual({ Authorization: "Bearer t", "X-CSRF-TOKEN": "from-meta" });
    } finally {
      meta.remove();
      vi.unstubAllGlobals();
    }
  });

  it("uses a custom convert() instead of any request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const convert = vi.fn(async () => LIBREOFFICE_HTML);
    try {
      await mount({ wordImport: { convert } });
      await upload("report.doc");
      expect(convert).toHaveBeenCalledOnce();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(api.getHtml("#content_editor")).toContain("MOLECULAR BIOLOGY REPORT");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
