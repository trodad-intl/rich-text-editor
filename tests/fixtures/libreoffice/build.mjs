/**
 * Builds the .docx files the upload/paste parity tests use, and what
 * LibreOffice writes for each — the HTML and the RTF it puts on the clipboard
 * for a copy of the document.
 *
 * Regenerate with `node tests/fixtures/libreoffice/build.mjs` (needs LibreOffice's
 * `soffice` on the PATH). The outputs are committed, so the tests themselves
 * never need LibreOffice.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const W =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const run = (text, rPr = "") =>
  text
    .split(/(\t)/)
    .filter(Boolean)
    .map((part) => `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ""}${part === "\t" ? "<w:tab/>" : `<w:t xml:space="preserve">${part}</w:t>`}</w:r>`)
    .join("");
const para = (runs, pPr = "") => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${runs}</w:p>`;
const spacing = (after, line, rule = "auto", before = 0) =>
  `<w:spacing w:before="${before}" w:after="${after}" w:line="${line}" w:lineRule="${rule}"/>`;
const borders = (val, sz) =>
  ["top", "left", "bottom", "right", "insideH", "insideV"].map((s) => `<w:${s} w:val="${val}" w:sz="${sz}" w:space="0" w:color="auto"/>`).join("");
const cell = (content, tcPr = "") => `<w:tc>${tcPr ? `<w:tcPr>${tcPr}</w:tcPr>` : ""}${content}</w:tc>`;
const table = (tblPr, cols, rows) =>
  `<w:tbl><w:tblPr>${tblPr}</w:tblPr><w:tblGrid>${cols.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>` +
  rows.map((cells) => `<w:tr>${cells.join("")}</w:tr>`).join("") +
  `</w:tbl>`;

const B = "<w:b/>";
const CENTRED = '<w:jc w:val="center"/>';

/** Word's own defaults: Calibri 11pt, 8pt after each paragraph, lines at 1.08. */
const STYLES =
  `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>` +
  `<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
  `<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:pPr>${spacing(0, 240)}</w:pPr>` +
  `<w:tblPr><w:tblBorders>${borders("single", 4)}</w:tblBorders><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>`;

const DOCUMENTS = {
  report:
    para(run("TEST RESULT", `<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/>${B}<w:color w:val="C00000"/><w:sz w:val="32"/>`), `${CENTRED}${spacing(120, 276)}`) +
    para(run("Test Name\t: Multiplex PCR for Detection of STDs Pathogens"), spacing(0, 240)) +
    para(run("Specimen\t: Endocervical swab"), spacing(0, 240)) +
    para(run("Method\t: Real Time PCR", `<w:sz w:val="20"/>`), spacing(0, 240)) +
    para("") +
    para(run("One and a half lines, 12pt before and 6pt after.", "<w:i/>"), spacing(120, 360, "auto", 240)) +
    para(run("Double spaced, underlined.", "<w:u w:val=\"single\"/>"), spacing(0, 480)) +
    para(run("Exactly 14pt.", `<w:color w:val="0070C0"/>`), spacing(0, 280, "exact")) +
    para(run("Name     Value (five spaces)"), spacing(0, 240)) +
    para(run("Left 0.5in, first line 0.25in, justified text in a paragraph."), `<w:ind w:left="720" w:firstLine="360"/><w:jc w:val="both"/>`) +
    para(run("Limit of Detection: 200 CFU/mL", `<w:sz w:val="18"/>`)),

  tables:
    para(run("Table Grid, with 1.5 and double spaced rows"), spacing(0, 240)) +
    table(`<w:tblStyle w:val="TableGrid"/>`, [3000, 3000], [
      [cell(para(run("Test", B), CENTRED), `<w:shd w:val="clear" w:color="auto" w:fill="D9D9D9"/>`), cell(para(run("Result", B), CENTRED), `<w:shd w:val="clear" w:color="auto" w:fill="D9D9D9"/>`)],
      [cell(para(run("Haemoglobin"), spacing(0, 360))), cell(para(run("13.5 g/dL"), spacing(0, 360)))],
      [cell(para(run("Platelets"), spacing(0, 480))), cell(para(run("250 x10^9/L"), spacing(0, 480)))],
      [cell(para(run("Within normal limits"), CENTRED), `<w:gridSpan w:val="2"/>`)],
    ]) +
    para(run("Outset, ¾pt"), spacing(0, 240)) +
    table(`<w:tblBorders>${borders("outset", 6)}</w:tblBorders>`, [3000, 3000], [
      [cell(para(run("Pathogen Type", B), CENTRED), `<w:tcBorders>${borders("outset", 6)}</w:tcBorders>`), cell(para(run("Result", B), CENTRED), `<w:tcBorders>${borders("outset", 6)}</w:tcBorders>`)],
      [cell(para(run("Neisseria gonorrhoeae")), `<w:tcBorders>${borders("outset", 6)}</w:tcBorders>`), cell(para(run("Not Detected"), CENTRED), `<w:tcBorders>${borders("outset", 6)}</w:tcBorders>`)],
    ]) +
    para(run("Double, ¾pt"), spacing(0, 240)) +
    table(`<w:tblBorders>${borders("double", 6)}</w:tblBorders>`, [3000, 3000], [[cell(para(run("A"))), cell(para(run("B")))]]) +
    para(run("Thick, 1½pt"), spacing(0, 240)) +
    table(`<w:tblBorders>${borders("thick", 12)}</w:tblBorders>`, [3000, 3000], [[cell(para(run("C"))), cell(para(run("D")))]]) +
    para(run("End."), spacing(0, 240)),
};

async function docx(body) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}` +
      `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`
  );
  zip.file("word/styles.xml", `<?xml version="1.0" encoding="UTF-8"?><w:styles ${W}>${STYLES}</w:styles>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "lo-profile-"));
try {
  for (const [name, body] of Object.entries(DOCUMENTS)) {
    fs.writeFileSync(path.join(DIR, `${name}.docx`), await docx(body));
    for (const format of ["html", "rtf"]) {
      execFileSync("soffice", [`-env:UserInstallation=file://${profile}`, "--headless", "--convert-to", format, `${name}.docx`, "--outdir", DIR], {
        cwd: DIR,
        stdio: "ignore",
      });
    }
    console.log(`built ${name}.docx, ${name}.html, ${name}.rtf`);
  }
} finally {
  fs.rmSync(profile, { recursive: true, force: true });
}
