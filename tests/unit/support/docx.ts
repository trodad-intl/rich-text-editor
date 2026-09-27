/**
 * A .docx built in memory, for the Word-import tests: WordprocessingML body
 * markup in, the zipped package out.
 */
import JSZip from "jszip";

const W = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"`;

/** A 1x1 transparent PNG. */
export const PNG_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

export interface DocxParts {
  /** The inside of `<w:body>`. */
  body: string;
  /** The inside of `<w:styles>`. */
  styles?: string;
  /** The inside of `<w:numbering>`. */
  numbering?: string;
  defaultTabStop?: number;
  /** Extra relationships of the document part: `[id, type suffix, target, external]`. */
  rels?: [string, string, string, boolean?][];
  media?: Record<string, string>;
}

export async function buildDocx(parts: DocxParts): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
      `<Default Extension="png" ContentType="image/png"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
  );
  const rels: [string, string, string, boolean?][] = [
    ["rIdStyles", "styles", "styles.xml"],
    ["rIdSettings", "settings", "settings.xml"],
    ["rIdNumbering", "numbering", "numbering.xml"],
    ...(parts.rels ?? []),
  ];
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      rels
        .map(
          ([id, type, target, external]) =>
            `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"${external ? ' TargetMode="External"' : ""}/>`
        )
        .join("") +
      `</Relationships>`
  );
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${parts.body}</w:body></w:document>`);
  zip.file("word/styles.xml", `<?xml version="1.0" encoding="UTF-8"?><w:styles ${W}>${parts.styles ?? ""}</w:styles>`);
  zip.file("word/numbering.xml", `<?xml version="1.0" encoding="UTF-8"?><w:numbering ${W}>${parts.numbering ?? ""}</w:numbering>`);
  zip.file(
    "word/settings.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:settings ${W}><w:defaultTabStop w:val="${parts.defaultTabStop ?? 720}"/></w:settings>`
  );
  for (const [path, base64] of Object.entries(parts.media ?? {})) zip.file(`word/${path}`, base64, { base64: true });
  return zip.generateAsync({ type: "arraybuffer" });
}

/** One run: `rPr` markup and text; `\t` becomes `<w:tab/>`. */
export function run(text: string, rPr = ""): string {
  const pieces = text.split("\t").map((piece) => (piece ? `<w:t xml:space="preserve">${piece}</w:t>` : ""));
  return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}${pieces.join("<w:tab/>")}</w:r>`;
}

export function para(runs: string, pPr = ""): string {
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${runs}</w:p>`;
}
