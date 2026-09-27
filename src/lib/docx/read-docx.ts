/**
 * A .docx file, read in the browser, as the clipboard LibreOffice would have
 * put on a copy of it: the HTML LibreOffice writes, an RTF carrying the
 * document's default tab stop, and the plain text.
 *
 * Why a clipboard and not a document of its own: pasting from an office suite
 * is the path this editor already lays out faithfully — tab stops, space runs,
 * sizes, colours, tables, lists — through the HTML plugin's transforms. The
 * Word-import button hands this to that same path (`insertData`), so an
 * uploaded file comes out exactly as the same content copied out of LibreOffice
 * and pasted, with nothing about the paste changed. Mammoth, which the button
 * used before, reads a .docx for its structure alone and drops everything it
 * is styled with.
 *
 * LibreOffice's, not Word's: the paste reads a clipboard by its shape and by
 * who wrote it, and a LibreOffice paste is the one laid out closest to the
 * document — each paragraph spaced by the document's own margins instead of
 * the editor's padding, a 3D border as wide as LibreOffice draws it, a gap
 * measured against the font of the text it spaces. Its shape, written here:
 *  - `<meta name="generator" content="LibreOffice">`, which is how the paste
 *    knows it, and LibreOffice's `p { margin-bottom: 0.1in; line-height: 115% }`
 *  - a paragraph: `<p align="center" style="line-height: 108%; margin-bottom: 0.11in">`,
 *    lengths in inches to the hundredth, a multiple as a whole percentage
 *  - a run: `<font color="#c00000"><font face="Calibri, sans-serif"><font size="2" style="font-size: 11pt"><b>`
 *  - a tab as a tab character, spaces as typed, a blank paragraph as `<br/>`
 *  - a table: `<col width>`s, and on each cell its borders — `2.25pt outset #000000`,
 *    three lines' worth for a 3D or double rule, `1px` for anything of ¾pt or
 *    less — its padding in inches and its background
 *
 * Where LibreOffice's own HTML loses something, the document's value is written
 * instead: a cell paragraph's line spacing (LibreOffice leaves it to its RTF,
 * which the paste reads back by matching text), a list as `<ul>`/`<ol>`.
 *
 * Not read: headers and footers, footnotes, comments, text boxes and shapes,
 * page size and margins — none of which a copy of the body carries either.
 */
import { Numbering, type ListLevel } from "./numbering";
import {
  mergePara,
  mergeRun,
  mergeTable,
  readBorders,
  readMargins,
  StyleSheet,
  type Border,
  type ParaProps,
  type RunProps,
  type Side,
  type TableProps,
} from "./styles";
import {
  child,
  childVal,
  children,
  descendant,
  emuToPx,
  escapeAttr,
  escapeHtml,
  num,
  parseXml,
  rAttr,
  twipsToPt,
  wAttr,
} from "./xml";

export interface DocxClipboard {
  html: string;
  rtf: string;
  text: string;
}

interface Relationship {
  type: string;
  target: string;
  external: boolean;
}

/** Pictures a browser can draw. EMF and WMF cannot be, so they are left out. */
const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  webp: "image/webp",
};

/** Word's highlight names, as the colours they are. */
const HIGHLIGHT: Record<string, string> = {
  yellow: "#ffff00",
  green: "#00ff00",
  cyan: "#00ffff",
  magenta: "#ff00ff",
  blue: "#0000ff",
  red: "#ff0000",
  darkBlue: "#000080",
  darkCyan: "#008080",
  darkGreen: "#008000",
  darkMagenta: "#800080",
  darkRed: "#800000",
  darkYellow: "#808000",
  darkGray: "#808080",
  lightGray: "#c0c0c0",
  black: "#000000",
  white: "#ffffff",
};

/** `fontTable.xml`'s families, as the generic name LibreOffice puts after a font. */
const GENERIC_FAMILIES: Record<string, string> = {
  roman: "serif",
  swiss: "sans-serif",
  modern: "monospace",
  script: "cursive",
  decorative: "fantasy",
};

/** Word's own cell margins, when neither the table nor its style states any. */
const DEFAULT_CELL_MARGINS: TableProps = { margins: { top: 0, left: 5.4, bottom: 0, right: 5.4 } };

const OL_TYPES: Record<string, string> = { lowerLetter: "a", upperLetter: "A", lowerRoman: "i", upperRoman: "I" };

export async function readDocxAsClipboard(data: ArrayBuffer | Uint8Array): Promise<DocxClipboard> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(data);
  const read = async (path: string | undefined) => (path ? ((await zip.file(path)?.async("string")) ?? null) : null);

  const packageRels = relationships(parseXml(await read("_rels/.rels")), "");
  const main = find(packageRels, "/officeDocument")?.target ?? "word/document.xml";
  const dir = main.includes("/") ? main.slice(0, main.lastIndexOf("/") + 1) : "";
  const documentXml = parseXml(await read(main));
  const body = child(documentXml?.documentElement, "body");
  if (!body) throw new Error("This file is not a Word document.");

  const rels = relationships(parseXml(await read(`${dir}_rels/${main.slice(dir.length)}.rels`)), dir);
  const part = async (type: string, fallback: string) => parseXml(await read(find(rels, type)?.target ?? `${dir}${fallback}`));
  const styles = new StyleSheet(await part("/styles", "styles.xml"), await part("/theme", "theme/theme1.xml"));
  const numbering = new Numbering(await part("/numbering", "numbering.xml"), styles);
  const settings = await part("/settings", "settings.xml");
  const fontTable = await part("/fontTable", "fontTable.xml");
  const families = new Map<string, string>();
  for (const font of children(fontTable?.documentElement, "font")) {
    const generic = GENERIC_FAMILIES[childVal(font, "family") ?? ""];
    const name = wAttr(font, "name");
    if (name && generic) families.set(name.toLowerCase(), generic);
  }

  const media = new Map<string, string>();
  for (const [id, rel] of rels) {
    if (!rel.type.endsWith("/image") || rel.external) continue;
    const mime = IMAGE_TYPES[rel.target.split(".").pop()?.toLowerCase() ?? ""];
    const file = zip.file(rel.target);
    if (mime && file) media.set(id, `data:${mime};base64,${await file.async("base64")}`);
  }

  const writer = new ClipboardWriter(styles, numbering, media, rels, families);
  const { html, text } = writer.blocks(children(body), {});
  const defaultTab = num(childVal(settings?.documentElement, "defaultTabStop")) ?? 720;

  return {
    html: wrapClipboardHtml(html),
    rtf: `{\\rtf1\\ansi\\deff0\\deftab${Math.round(defaultTab)}{\\fonttbl{\\f0 Times New Roman;}}}`,
    text,
  };
}

function relationships(xml: Document | null, dir: string): Map<string, Relationship> {
  const out = new Map<string, Relationship>();
  for (const rel of children(xml?.documentElement, "Relationship")) {
    const id = rel.getAttribute("Id");
    const target = rel.getAttribute("Target");
    if (!id || !target) continue;
    const external = rel.getAttribute("TargetMode") === "External";
    out.set(id, { type: rel.getAttribute("Type") ?? "", target: external ? target : resolvePath(dir, target), external });
  }
  return out;
}

function find(rels: Map<string, Relationship>, type: string): Relationship | undefined {
  for (const rel of rels.values()) if (rel.type.endsWith(type)) return rel;
  return undefined;
}

function resolvePath(dir: string, target: string): string {
  const parts: string[] = [];
  for (const segment of (target.startsWith("/") ? target.slice(1) : dir + target).split("/")) {
    if (segment === "..") parts.pop();
    else if (segment && segment !== ".") parts.push(segment);
  }
  return parts.join("/");
}

function wrapClipboardHtml(body: string): string {
  return (
    `<!DOCTYPE html><html><head><meta http-equiv="content-type" content="text/html; charset=utf-8"/><title></title>` +
    `<meta name="generator" content="LibreOffice"/><style type="text/css">` +
    `p { direction: ltr; margin-bottom: 0.1in; widows: 2; orphans: 2; text-align: left; line-height: 115%; background: transparent }` +
    `</style></head><body lang="en-US" dir="ltr">${body}</body></html>`
  );
}

interface Context {
  /** A table style's run and paragraph properties, for the paragraphs in its cells. */
  table?: { run: RunProps; para: ParaProps };
}

interface Part {
  html: string;
  text: string;
  /** Whether it shows anything — text, a tab, a break, a picture. */
  content: boolean;
}

interface Paragraph {
  el: Element;
  /** In a table cell, where the paste reads line spacing from the RTF rather than the HTML. */
  inCell: boolean;
  styleId: string | null;
  heading?: number;
  para: ParaProps;
  /** What the paragraph's runs start from: the defaults, the table style and the paragraph style. */
  run: RunProps;
  list: ListLevel | null;
}

interface Field {
  instruction: string;
  inResult: boolean;
  linkOpen: boolean;
}

class ClipboardWriter {
  /** Complex fields (`w:fldChar`) can nest, and span runs. */
  private fields: Field[] = [];

  constructor(
    private styles: StyleSheet,
    private numbering: Numbering,
    private media: Map<string, string>,
    private rels: Map<string, Relationship>,
    private families: Map<string, string>
  ) {}

  /** A run of block-level content: paragraphs and tables. */
  blocks(elements: Element[], ctx: Context): { html: string; text: string } {
    const items: (Paragraph | Element)[] = [];
    for (const el of flattenBlocks(elements)) {
      items.push(el.localName === "p" ? this.resolveParagraph(el, ctx) : el);
    }

    // "Don't add space between paragraphs of the same style": the margins
    // between them are zero.
    for (let i = 1; i < items.length; i++) {
      const previous = items[i - 1];
      const current = items[i];
      if (previous instanceof Element || current instanceof Element) continue;
      if (current.para.contextualSpacing && previous.styleId === current.styleId) {
        current.para = { ...current.para, before: 0, beforeAuto: false };
        previous.para = { ...previous.para, after: 0, afterAuto: false };
      }
    }

    const html: string[] = [];
    const text: string[] = [];
    for (let i = 0; i < items.length; ) {
      const item = items[i];
      let part: Part;
      if (item instanceof Element) {
        part = this.table(item);
        i++;
      } else if (item.list) {
        const group: Paragraph[] = [];
        for (let next = items[i]; next && !(next instanceof Element) && next.list; next = items[++i]) group.push(next);
        part = this.list(group);
      } else {
        part = this.paragraph(item);
        i++;
      }
      html.push(part.html);
      text.push(part.text);
    }
    return { html: html.join(""), text: text.join("\n") };
  }

  private resolveParagraph(p: Element, ctx: Context): Paragraph {
    const pPr = child(p, "pPr");
    const styleId = childVal(pPr, "pStyle");
    const style = this.styles.paragraphStyle(styleId);
    const direct = this.styles.readPara(pPr);
    const list = this.numbering.next(direct.numId ?? style.para.numId, direct.ilvl ?? style.para.ilvl ?? 0);
    return {
      el: p,
      inCell: !!ctx.table,
      styleId,
      heading: style.heading,
      // Word's order: defaults, the table style, the list level, the paragraph
      // style, then what the paragraph states itself.
      para: mergePara(this.styles.defaultPara, ctx.table?.para, list?.para, style.para, direct),
      run: mergeRun(this.styles.defaultRun, ctx.table?.run, style.run),
      list,
    };
  }

  private paragraph(p: Paragraph): Part {
    const { html, text } = this.paragraphContent(p);
    const tag = p.heading ? `h${p.heading}` : "p";
    return { html: `<${tag}${alignAttr(p.para)} style="${paragraphCss(p.para, p.inCell)}">${html}</${tag}>`, text, content: true };
  }

  /** A paragraph's runs; an empty one is LibreOffice's blank line, `<br/>`. */
  private paragraphContent(p: Paragraph): { html: string; text: string } {
    const inner = this.inline(children(p.el), p.run);
    const closing = this.closeFieldLinks();
    if (inner.content) return { html: inner.html + closing, text: inner.text };
    return { html: `${inner.html}${closing}<br/>`, text: "" };
  }

  /**
   * Consecutive list paragraphs as nested `<ul>`/`<ol>`, each item a paragraph,
   * as LibreOffice writes a list.
   */
  private list(items: Paragraph[]): Part {
    let html = "";
    const text: string[] = [];
    const open: { level: number; tag: string }[] = [];
    const start = (p: Paragraph) => {
      const tag = p.list!.ordered ? "ol" : "ul";
      const type = OL_TYPES[p.list!.format];
      open.push({ level: p.list!.level, tag });
      return `<${tag}${type && tag === "ol" ? ` type="${type}"` : ""}${tag === "ol" && p.list!.value !== 1 ? ` start="${p.list!.value}"` : ""}>`;
    };

    for (const p of items) {
      const level = p.list!.level;
      const tag = p.list!.ordered ? "ol" : "ul";
      while (open.length && open[open.length - 1].level > level) html += `</li></${open.pop()!.tag}>`;
      const top = open[open.length - 1];
      if (top && top.level === level && top.tag === tag) html += "</li>";
      else {
        if (top && top.level === level) html += `</li></${open.pop()!.tag}>`;
        html += start(p);
      }
      const { html: content, text: line } = this.paragraphContent(p);
      // The list draws the indent, as it does for any list in this editor.
      const { left: _left, firstLine: _firstLine, hanging: _hanging, ...rest } = p.para;
      html += `<li><p${alignAttr(rest)} style="${paragraphCss(rest, p.inCell)}">${content}</p>`;
      text.push(`${p.list!.marker}\t${line}`);
    }
    while (open.length) html += `</li></${open.pop()!.tag}>`;
    return { html, text: text.join("\n"), content: true };
  }

  /** Inline content: runs, and the elements that wrap them. */
  private inline(nodes: Element[], base: RunProps): Part {
    let html = "";
    let text = "";
    let content = false;

    // Consecutive runs of one format are written as one, as LibreOffice writes
    // them. A document splits its runs wherever spell-check, revisions or an
    // edit happened to — `Shamsun`, ` `, `Nahar` — and an element holding one
    // space is one the docx cleaner deletes as empty: the words ran together.
    // Bookmarks and proofing marks between the runs do not part them.
    let pending: { inner: string; props: RunProps; key: string } | null = null;
    const flush = () => {
      if (!pending) return;
      // Still one space on its own (its format differs from both sides): as a
      // no-break space, as LibreOffice writes it, the element is not empty.
      html += this.wrapRun(pending.inner === " " ? "&nbsp;" : pending.inner, pending.props);
      pending = null;
    };
    const add = (part: Part) => {
      flush();
      html += part.html;
      text += part.text;
      content ||= part.content;
    };

    for (const node of nodes) {
      switch (node.localName) {
        case "r": {
          const run = this.run(node, base);
          if (run.before) add({ html: run.before, text: "", content: run.shown });
          if (run.inner) {
            const key = this.wrapRun("\u0000", run.props);
            if (pending?.key === key) pending.inner += run.inner;
            else {
              flush();
              pending = { inner: run.inner, props: run.props, key };
            }
            text += run.text;
            content ||= run.content;
          }
          if (run.after) add({ html: run.after, text: "", content: run.shown });
          break;
        }
        case "hyperlink": {
          const inner = this.inline(children(node), base);
          const rel = this.rels.get(rAttr(node, "id") ?? "");
          add(rel?.external && inner.content ? { ...inner, html: `<a href="${escapeAttr(rel.target)}">${inner.html}</a>` } : inner);
          break;
        }
        case "fldSimple": {
          const inner = this.inline(children(node), base);
          const href = hyperlinkOf(wAttr(node, "instr"));
          add(href && inner.content ? { ...inner, html: `<a href="${escapeAttr(href)}">${inner.html}</a>` } : inner);
          break;
        }
        case "ins":
        case "moveTo":
        case "smartTag":
        case "customXml":
        case "dir":
        case "bdo":
          add(this.inline(children(node), base));
          break;
        case "sdt":
          add(this.inline(children(child(node, "sdtContent")), base));
          break;
        case "oMath":
        case "oMathPara": {
          const math = Array.from(node.getElementsByTagNameNS("*", "t"), (t) => t.textContent ?? "").join("");
          add({ html: escapeHtml(math), text: math, content: !!math });
          break;
        }
        // Deleted text, bookmarks, proofing marks, the paragraph's own properties.
        default:
          break;
      }
    }
    flush();
    return { html, text, content };
  }

  /**
   * A run's content, formatted by `props`, and what goes outside that
   * formatting: field boundaries, and pictures — inside `<font>` the paste
   * drops a picture altogether. `shown` says whether the outside shows anything.
   */
  private run(r: Element, base: RunProps): { before: string; inner: string; after: string; text: string; content: boolean; shown: boolean; props: RunProps } {
    const rPr = child(r, "rPr");
    const props = mergeRun(base, this.styles.characterStyle(childVal(rPr, "rStyle")), this.styles.readRun(rPr));

    let inner = "";
    let text = "";
    let content = false;
    /** Field boundaries, written outside the run's formatting. */
    let before = "";
    let after = "";
    let shown = false;
    const emit = (html: string, plain: string) => {
      inner += html;
      text += plain;
      content = true;
    };

    for (const c of children(r)) {
      if (c.localName === "fldChar") {
        const marker = this.fieldChar(wAttr(c, "fldCharType"));
        if (inner) after += marker;
        else before += marker;
        continue;
      }
      if (c.localName === "instrText") {
        const field = this.fields[this.fields.length - 1];
        if (field && !field.inResult) field.instruction += c.textContent ?? "";
        continue;
      }
      // Inside a field's instruction nothing is shown: `PAGE`, `TOC \o "1-3"`.
      if (this.inFieldInstruction() || props.hidden) continue;

      switch (c.localName) {
        case "t": {
          const value = c.textContent ?? "";
          if (value) emit(textHtml(value), value);
          break;
        }
        case "tab":
          emit("\t", "\t");
          break;
        case "br":
        case "cr": {
          const type = wAttr(c, "type");
          if (type !== "page" && type !== "column") emit("<br/>", "\n");
          break;
        }
        case "noBreakHyphen":
          emit("\u2011", "\u2011");
          break;
        case "sym": {
          let code = Number.parseInt(wAttr(c, "char") ?? "", 16);
          if (!Number.isFinite(code)) break;
          if (code >= 0xf000) code -= 0xf000;
          const char = String.fromCharCode(code);
          const font = wAttr(c, "font");
          emit(font ? `<font face="${escapeAttr(font)}">${escapeHtml(char)}</font>` : escapeHtml(char), char);
          break;
        }
        case "drawing":
        case "pict":
        case "AlternateContent": {
          const picture = this.picture(c);
          if (!picture) break;
          if (inner) after += picture;
          else before += picture;
          shown = true;
          break;
        }
        default:
          break;
      }
    }
    return { before, inner, after, text, content, shown, props };
  }

  /**
   * A run's content in LibreOffice's markup, outermost first:
   * `<font color><font face><font size><b><i><u>`. Every run states its font
   * and size — LibreOffice leaves out whatever matches its default style and
   * lets the paste recover it from the RTF, which this clipboard does not carry.
   */
  private wrapRun(inner: string, props: RunProps): string {
    let html = inner;
    // Raised and lowered text is how LibreOffice writes a sub- or superscript it
    // sized itself; the editor has no other way to draw text off the baseline.
    const shift = props.vertAlign ?? (props.position ? (props.position > 0 ? "superscript" : "subscript") : undefined);
    if (props.strike) html = `<strike>${html}</strike>`;
    if (props.underline && props.underline !== "none") html = `<u>${html}</u>`;
    if (props.italic) html = `<i>${html}</i>`;
    if (props.bold) html = `<b>${html}</b>`;
    if (shift === "superscript") html = `<sup>${html}</sup>`;
    if (shift === "subscript") html = `<sub>${html}</sub>`;

    const span: string[] = [];
    const background = props.highlight ? HIGHLIGHT[props.highlight] : props.shading ? `#${props.shading.toLowerCase()}` : undefined;
    if (background) span.push(`background: ${background}`);
    if (props.spacing) span.push(`letter-spacing: ${inches(props.spacing)}`);
    if (props.caps) span.push("text-transform: uppercase");
    if (props.smallCaps) span.push("font-variant: small-caps");
    if (span.length) html = `<span style="${span.join("; ")}">${html}</span>`;

    if (props.size) html = `<font size="${fontSizeAttr(props.size)}" style="font-size: ${points(props.size)}">${html}</font>`;
    if (props.font) {
      const generic = this.families.get(props.font.toLowerCase()) ?? guessFamily(props.font);
      html = `<font face="${escapeAttr(props.font)}, ${generic}">${html}</font>`;
    }
    if (props.color && props.color !== "auto") html = `<font color="#${props.color.toLowerCase()}">${html}</font>`;
    return html;
  }

  private fieldChar(type: string | null): string {
    if (type === "begin") {
      this.fields.push({ instruction: "", inResult: false, linkOpen: false });
      return "";
    }
    const field = this.fields[this.fields.length - 1];
    if (!field) return "";
    if (type === "separate") {
      field.inResult = true;
      const href = hyperlinkOf(field.instruction);
      if (href && !this.inFieldInstruction()) {
        field.linkOpen = true;
        return `<a href="${escapeAttr(href)}">`;
      }
      return "";
    }
    if (type === "end") {
      this.fields.pop();
      return field.linkOpen ? "</a>" : "";
    }
    return "";
  }

  private inFieldInstruction(): boolean {
    return this.fields.some((field) => !field.inResult);
  }

  /** A link a field opened in this paragraph ends with it: an `<a>` cannot span two. */
  private closeFieldLinks(): string {
    let out = "";
    for (const field of this.fields) {
      if (field.linkOpen) {
        out += "</a>";
        field.linkOpen = false;
      }
    }
    return out;
  }

  /** A picture: DrawingML (`w:drawing`) or the VML older files use (`w:pict`). */
  private picture(el: Element): string {
    if (el.localName === "AlternateContent") {
      return this.picture(child(el, "Choice") ?? el) || this.picture(child(el, "Fallback") ?? el);
    }
    const blip = descendant(el, "blip");
    if (blip) {
      const src = this.media.get(rAttr(blip, "embed") ?? "");
      if (!src) return "";
      const extent = descendant(el, "extent");
      const width = Math.round(emuToPx(num(extent?.getAttribute("cx")) ?? 0));
      const height = Math.round(emuToPx(num(extent?.getAttribute("cy")) ?? 0));
      return img(src, width, height);
    }
    const imagedata = descendant(el, "imagedata");
    if (imagedata) {
      const src = this.media.get(rAttr(imagedata, "id") ?? "");
      if (!src) return "";
      const style = descendant(el, "shape")?.getAttribute("style") ?? "";
      const length = (name: string) => {
        const match = new RegExp(`${name}:\\s*([\\d.]+)(pt|px|in)`).exec(style);
        if (!match) return 0;
        const value = Number.parseFloat(match[1]);
        return Math.round(match[2] === "px" ? value : match[2] === "in" ? value * 96 : (value * 96) / 72);
      };
      return img(src, length("width"), length("height"));
    }
    return "";
  }

  private table(tbl: Element): Part {
    const tblPr = child(tbl, "tblPr");
    const style = this.styles.tableStyle(childVal(tblPr, "tblStyle"));
    const props = mergeTable(DEFAULT_CELL_MARGINS, style.table, this.styles.readTable(tblPr));
    const grid = children(child(tbl, "tblGrid"), "gridCol").map((col) => twipsToPt(num(wAttr(col, "w")) ?? 0));

    interface Cell {
      el: Element;
      col: number;
      span: number;
      merge?: "restart" | "continue";
      rowspan: number;
    }
    const rows = flattenRows(children(tbl));
    const layout: Cell[][] = rows.map((tr) => {
      let col = num(childVal(child(tr, "trPr"), "gridBefore")) ?? 0;
      return flattenCells(children(tr)).map((tc) => {
        const tcPr = child(tc, "tcPr");
        const span = num(childVal(tcPr, "gridSpan")) ?? 1;
        const vMerge = child(tcPr, "vMerge");
        const cell: Cell = {
          el: tc,
          col,
          span,
          merge: vMerge ? (wAttr(vMerge, "val") === "restart" ? "restart" : "continue") : undefined,
          rowspan: 1,
        };
        col += span;
        return cell;
      });
    });
    layout.forEach((cells, r) => {
      for (const cell of cells) {
        if (cell.merge !== "restart") continue;
        for (let below = r + 1; below < layout.length; below++) {
          const next = layout[below].find((c) => c.col === cell.col);
          if (next?.merge !== "continue") break;
          cell.rowspan++;
        }
      }
    });

    const columns = Math.max(grid.length, ...layout.map((cells) => cells.reduce((end, c) => Math.max(end, c.col + c.span), 0)));
    const widthOf = (col: number, span: number) => grid.slice(col, col + span).reduce((sum, w) => sum + w, 0);
    const tableWidth = widthOf(0, grid.length);
    const cellCtx: Context = { table: { run: style.run, para: style.para } };
    const spacing = num(wAttr(child(tblPr, "tblCellSpacing"), "w"));

    let html =
      `<table` +
      (tableWidth ? ` width="${px(tableWidth)}"` : "") +
      (props.align === "center" ? ` align="center"` : props.align === "right" || props.align === "end" ? ` align="right"` : "") +
      ` cellpadding="${px(props.margins?.left ?? 0)}" cellspacing="${spacing ? Math.max(1, px(twipsToPt(spacing))) : 0}"` +
      (props.indent && props.align !== "center" ? ` style="margin-left: ${inches(props.indent)}"` : "") +
      `>` +
      grid.map((w) => `<col width="${px(w)}"/>`).join("");
    const text: string[] = [];

    layout.forEach((cells, r) => {
      const trPr = child(rows[r], "trPr");
      const height = num(wAttr(child(trPr, "trHeight"), "val"));
      html += `<tr valign="top">`;
      const rowText: string[] = [];

      cells.forEach((cell, i) => {
        if (cell.merge === "continue") return;
        const tcPr = child(cell.el, "tcPr");
        const own = readBorders(child(tcPr, "tcBorders"), ["top", "left", "bottom", "right"] as const) ?? {};
        const edge = (side: Side): Border | undefined => {
          if (own[side]) return own[side];
          const outer =
            side === "top" ? r === 0
            : side === "bottom" ? r + cell.rowspan >= layout.length
            : side === "left" ? cell.col === 0
            : cell.col + cell.span >= columns;
          return props.borders?.[outer ? side : side === "top" || side === "bottom" ? "insideH" : "insideV"];
        };
        const margins = { ...props.margins, ...readMargins(child(tcPr, "tcMar")) };
        const width = widthOf(cell.col, cell.span);
        const shading = wAttr(child(tcPr, "shd"), "fill");
        const background = shading && shading !== "auto" ? `#${shading.toLowerCase()}` : undefined;
        const valign = childVal(tcPr, "vAlign");

        const css = [
          ...(background ? [`background: ${background}`] : []),
          ...sidesCss("border", (["top", "bottom", "left", "right"] as const).map((side) => borderCss(edge(side)))),
          ...sidesCss("padding", [margins.top ?? 0, margins.bottom ?? 0, margins.left ?? 0, margins.right ?? 0].map(inches)),
        ].join("; ");
        const attrs =
          (width ? ` width="${px(width)}"` : "") +
          (height && i === 0 ? ` height="${px(twipsToPt(height))}"` : "") +
          (cell.span > 1 ? ` colspan="${cell.span}"` : "") +
          (cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : "") +
          (background ? ` bgcolor="${background}"` : "") +
          (valign === "center" ? ` valign="middle"` : valign === "bottom" ? ` valign="bottom"` : "");

        const inner = this.blocks(children(cell.el).filter((c) => c.localName !== "tcPr"), cellCtx);
        html += `<td${attrs} style="${css}">${inner.html || `<p><br/></p>`}</td>`;
        rowText.push(inner.text.replace(/\n/g, " "));
      });
      html += "</tr>";
      text.push(rowText.join("\t"));
    });

    return { html: `${html}</table>`, text: text.join("\n"), content: true };
  }
}

/** Paragraphs and tables, out of the wrappers a document can put them in. */
function flattenBlocks(elements: Element[]): Element[] {
  const out: Element[] = [];
  for (const el of elements) {
    if (el.localName === "p" || el.localName === "tbl") out.push(el);
    else if (el.localName === "sdt") out.push(...flattenBlocks(children(child(el, "sdtContent"))));
    else if (["customXml", "ins", "moveTo"].includes(el.localName)) out.push(...flattenBlocks(children(el)));
  }
  return out;
}

function flattenRows(elements: Element[]): Element[] {
  const out: Element[] = [];
  for (const el of elements) {
    if (el.localName === "tr") out.push(el);
    else if (el.localName === "sdt") out.push(...flattenRows(children(child(el, "sdtContent"))));
    else if (el.localName === "customXml") out.push(...flattenRows(children(el)));
  }
  return out;
}

function flattenCells(elements: Element[]): Element[] {
  const out: Element[] = [];
  for (const el of elements) {
    if (el.localName === "tc") out.push(el);
    else if (el.localName === "sdt") out.push(...flattenCells(children(child(el, "sdtContent"))));
    else if (el.localName === "customXml") out.push(...flattenCells(children(el)));
  }
  return out;
}

/** The URL of a `HYPERLINK "…"` field, or null for any other field and for an in-document link. */
function hyperlinkOf(instruction: string | null | undefined): string | null {
  const match = /^\s*HYPERLINK\s+(?!\\l)"([^"]+)"/i.exec(instruction ?? "");
  return match ? match[1] : null;
}

/**
 * Text as LibreOffice writes it: spaces as typed, a no-break space as `&nbsp;`.
 * Two or more no-break spaces together are written as the spaces they look
 * like: as `&nbsp;`s the paste drops the whole run — `Name` + five of them +
 * `Value` came out `NameValue` — while a run of spaces it keeps.
 */
function textHtml(value: string): string {
  return escapeHtml(value).replace(/[ \u00a0]{2,}|\u00a0/g, (run) => (run === "\u00a0" ? "&nbsp;" : " ".repeat(run.length)));
}

/** A paragraph's alignment, as LibreOffice's `align` attribute. */
function alignAttr(p: ParaProps): string {
  const align = p.align === "both" || p.align === "distribute" ? "justify" : p.align === "end" ? "right" : p.align;
  return align === "center" || align === "right" || align === "justify" ? ` align="${align}"` : "";
}

/**
 * A paragraph's style as LibreOffice writes it: always its line spacing and the
 * space under it, the rest where it has any.
 */
function paragraphCss(p: ParaProps, inCell = false): string {
  const parts = [`line-height: ${lineHeight(p, inCell)}`];
  const before = p.beforeAuto ? 14 : (p.before ?? 0);
  if (before) parts.push(`margin-top: ${inches(before)}`);
  parts.push(`margin-bottom: ${inches(p.afterAuto ? 14 : (p.after ?? 0))}`);
  if (p.left) parts.push(`margin-left: ${inches(p.left)}`);
  if (p.right) parts.push(`margin-right: ${inches(p.right)}`);
  const indent = p.hanging ? -p.hanging : p.firstLine;
  if (indent) parts.push(`text-indent: ${inches(indent)}`);
  if (p.shading) parts.push(`background: #${p.shading.toLowerCase()}`);
  if (p.borders) {
    for (const side of ["top", "bottom", "left", "right"] as const) {
      const border = p.borders[side];
      if (border && border.val !== "nil" && border.val !== "none") parts.push(`border-${side}: ${borderCss(border)}`);
    }
  }
  // Not LibreOffice's (its HTML leaves a paragraph's own stops to its RTF), but
  // what the paste reads a paragraph's stops from first.
  if (p.tabs?.length) {
    const stops = p.tabs.map((stop) => {
      const alignment = stop.val === "end" ? "right" : stop.val === "start" || stop.val === "num" ? "left" : stop.val;
      return `${alignment === "left" ? "" : `${alignment} `}${points(stop.pos)}`;
    });
    parts.push(`tab-stops: ${stops.join(" ")}`);
  }
  return parts.join("; ");
}

/**
 * A multiple as a whole percentage (1.08 is `108%`), a fixed leading in inches,
 * as LibreOffice's HTML writes them. In a cell, the exact values its RTF states
 * — `\sl259\slmult1`, `\sl280` — which is where the paste reads a cell's
 * spacing from: 1.0792 lines, 14pt.
 */
function lineHeight(p: ParaProps, inCell: boolean): string {
  if (p.line === undefined) return "100%";
  if (p.lineRule === "auto") {
    const percent = (p.line / 240) * 100;
    return `${inCell ? Math.round(percent * 100) / 100 : Math.round(percent)}%`;
  }
  return inCell && p.lineRule === "exact" ? points(p.line) : inches(p.line);
}

/** LibreOffice's border styles for a document's. */
const BORDER_STYLES: Record<string, string> = {
  single: "solid",
  thick: "solid",
  double: "double",
  triple: "double",
  dotted: "dotted",
  dashed: "dashed",
  outset: "outset",
  inset: "inset",
  threeDEmboss: "ridge",
  threeDEngrave: "groove",
};

/**
 * How many of a border's lines LibreOffice counts in its width: a double rule
 * and a 3D one are two lines and the gap between them, three lines wide; a
 * thick one and an embossed one two.
 */
const BORDER_LINES: Record<string, number> = {
  double: 3,
  triple: 3,
  outset: 3,
  inset: 3,
  thick: 2,
  threeDEmboss: 2,
  threeDEngrave: 2,
};

/**
 * A border as LibreOffice's HTML writes it — `2.25pt outset #000000`: width
 * first, `1px` for anything of ¾pt or less, then style, then colour.
 */
function borderCss(border: Border | undefined): string {
  if (!border || border.val === "nil" || border.val === "none") return "none";
  const style =
    BORDER_STYLES[border.val] ??
    (/thin|thick|double/i.test(border.val) ? "double"
    : /dash/i.test(border.val) ? "dashed"
    : /dot/i.test(border.val) ? "dotted"
    : "solid");
  const width = border.size * (BORDER_LINES[border.val] ?? (style === "double" ? 3 : 1));
  const color = border.color === "auto" ? "#000000" : `#${border.color.toLowerCase()}`;
  return `${width <= 0.75 ? "1px" : `${width.toFixed(2)}pt`} ${style} ${color}`;
}

/** Four sides of `border` or `padding`, in LibreOffice's order — one value when they agree. */
function sidesCss(property: string, [top, bottom, left, right]: string[]): string[] {
  if (top === bottom && top === left && top === right) return [`${property}: ${top}`];
  if (property === "padding" && top === bottom && left === right) return [`padding: ${top} ${left}`];
  return [`${property}-top: ${top}`, `${property}-bottom: ${bottom}`, `${property}-left: ${left}`, `${property}-right: ${right}`];
}

/** A length in inches, to the hundredth, as LibreOffice writes one: `0.11in`, `0in`, `1in`. */
function inches(pointsValue: number): string {
  const value = Math.round((pointsValue / 72) * 100) / 100;
  return `${value === 0 ? 0 : value}in`;
}

function points(value: number): string {
  return `${Math.round(value * 100) / 100}pt`;
}

/** Points as CSS pixels. */
function px(pointsValue: number): number {
  return Math.round((pointsValue * 96) / 72);
}

/** HTML's `<font size>` for a size in points, as LibreOffice writes it beside the real one. */
function fontSizeAttr(size: number): number {
  return size < 9 ? 1 : size < 12 ? 2 : size < 14 ? 3 : size < 18 ? 4 : size < 24 ? 5 : size < 36 ? 6 : 7;
}

/** The generic family for a font `fontTable.xml` does not describe. */
function guessFamily(font: string): string {
  return /times|georgia|cambria|garamond|book|serif|palatino|century|minion|baskerville/i.test(font) && !/sans/i.test(font)
    ? "serif"
    : "sans-serif";
}

function img(src: string, width: number, height: number): string {
  return `<img src="${src}"${width ? ` width="${width}"` : ""}${height ? ` height="${height}"` : ""} border="0"/>`;
}
