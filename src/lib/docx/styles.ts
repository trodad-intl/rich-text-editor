/**
 * What a .docx says a run, paragraph or table looks like, with its styles
 * resolved: document defaults, then the table style, then the paragraph style
 * and its `basedOn` chain, then the run's character style, then what the run
 * states itself — Word's own order. See lib/docx/read-docx.ts.
 */
import { child, childVal, children, descendant, flag, num, onOff, twipsToPt, wAttr } from "./xml";

export interface RunProps {
  font?: string;
  /** Points. */
  size?: number;
  /** `RRGGBB`, or `auto`. */
  color?: string;
  bold?: boolean;
  italic?: boolean;
  /** `single`, `double`, … or `none`. */
  underline?: string;
  strike?: boolean;
  highlight?: string;
  /** `RRGGBB` fill behind the run. */
  shading?: string;
  vertAlign?: string;
  /** Raised (positive) or lowered text, points. */
  position?: number;
  caps?: boolean;
  smallCaps?: boolean;
  hidden?: boolean;
  /** Character spacing, points. */
  spacing?: number;
}

export interface TabStop {
  /** Points from the text column's left edge. */
  pos: number;
  /** `left`, `center`, `right`, `decimal`, `bar` — or `clear`, which removes an inherited one. */
  val: string;
}

export interface Border {
  val: string;
  /** Points. */
  size: number;
  /** `RRGGBB` or `auto`. */
  color: string;
}

export type Side = "top" | "left" | "bottom" | "right";

export interface ParaProps {
  align?: string;
  /** All in points. */
  left?: number;
  right?: number;
  firstLine?: number;
  hanging?: number;
  before?: number;
  after?: number;
  beforeAuto?: boolean;
  afterAuto?: boolean;
  /** Twips for `auto` (240 = single), otherwise points. */
  line?: number;
  lineRule?: string;
  contextualSpacing?: boolean;
  tabs?: TabStop[];
  numId?: string;
  ilvl?: number;
  shading?: string;
  borders?: Partial<Record<Side, Border>>;
}

export interface TableProps {
  borders?: Partial<Record<Side | "insideH" | "insideV", Border>>;
  /** Cell margins, points. */
  margins?: Partial<Record<Side, number>>;
  align?: string;
  /** Points. */
  indent?: number;
}

function defined<T extends object>(value: T): T {
  for (const key of Object.keys(value) as (keyof T)[]) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}

export function mergeRun(...layers: (RunProps | undefined)[]): RunProps {
  return Object.assign({}, ...layers.filter(Boolean));
}

/** Later layers win; tab stops accumulate, and a `clear` stop removes the one it names. */
export function mergePara(...layers: (ParaProps | undefined)[]): ParaProps {
  const out: ParaProps = {};
  for (const layer of layers) {
    if (!layer) continue;
    const { tabs, borders, ...rest } = layer;
    Object.assign(out, rest);
    if (borders) out.borders = { ...out.borders, ...borders };
    if (tabs) {
      let merged = (out.tabs ?? []).filter((stop) => !tabs.some((t) => Math.abs(t.pos - stop.pos) < 0.5));
      merged = merged.concat(tabs.filter((t) => t.val !== "clear"));
      out.tabs = merged.sort((a, b) => a.pos - b.pos);
    }
  }
  return out;
}

export function mergeTable(...layers: (TableProps | undefined)[]): TableProps {
  const out: TableProps = {};
  for (const layer of layers) {
    if (!layer) continue;
    const { borders, margins, ...rest } = layer;
    Object.assign(out, rest);
    if (borders) out.borders = { ...out.borders, ...borders };
    if (margins) out.margins = { ...out.margins, ...margins };
  }
  return out;
}

export function readBorder(el: Element | null): Border | undefined {
  if (!el) return undefined;
  const val = wAttr(el, "val") ?? "single";
  return { val, size: (num(wAttr(el, "sz")) ?? 4) / 8, color: wAttr(el, "color") ?? "auto" };
}

/** A side, under the name a document may use for it: `left`/`start`, `right`/`end`. */
function sideOf(el: Element | null, side: string): Element | null {
  if (side === "left") return child(el, "left") ?? child(el, "start");
  if (side === "right") return child(el, "right") ?? child(el, "end");
  return child(el, side);
}

export function readBorders<S extends string>(el: Element | null, sides: readonly S[]): Partial<Record<S, Border>> | undefined {
  if (!el) return undefined;
  const out: Partial<Record<S, Border>> = {};
  for (const side of sides) {
    const border = readBorder(sideOf(el, side));
    if (border) out[side] = border;
  }
  return out;
}

/** Cell margins (`w:tblCellMar` / `w:tcMar`), in points. */
export function readMargins(el: Element | null): Partial<Record<Side, number>> | undefined {
  if (!el) return undefined;
  const out: Partial<Record<Side, number>> = {};
  for (const side of ["top", "left", "bottom", "right"] as const) {
    const w = num(wAttr(sideOf(el, side), "w"));
    if (w !== undefined) out[side] = twipsToPt(w);
  }
  return out;
}

function fill(shd: Element | null): string | undefined {
  const value = wAttr(shd, "fill");
  return value && value !== "auto" ? value : undefined;
}

export class StyleSheet {
  private styles = new Map<string, Element>();
  private defaultParagraphStyle: string | undefined;
  private defaultTableStyle: string | undefined;
  private major: string | undefined;
  private minor: string | undefined;
  readonly defaultRun: RunProps;
  readonly defaultPara: ParaProps;

  constructor(stylesXml: Document | null, themeXml: Document | null) {
    const fontScheme = themeXml ? descendant(themeXml.documentElement, "fontScheme") : null;
    this.major = descendant(child(fontScheme, "majorFont"), "latin")?.getAttribute("typeface") || undefined;
    this.minor = descendant(child(fontScheme, "minorFont"), "latin")?.getAttribute("typeface") || undefined;

    const root = stylesXml?.documentElement ?? null;
    for (const style of children(root, "style")) {
      const id = wAttr(style, "styleId");
      if (!id) continue;
      this.styles.set(id, style);
      if (flag(wAttr(style, "default"))) {
        if (wAttr(style, "type") === "paragraph") this.defaultParagraphStyle = id;
        if (wAttr(style, "type") === "table") this.defaultTableStyle = id;
      }
    }

    const defaults = child(root, "docDefaults");
    // What Word itself falls back to when a document states nothing at all.
    this.defaultRun = mergeRun({ font: "Times New Roman", size: 10 }, this.readRun(child(child(defaults, "rPrDefault"), "rPr")));
    this.defaultPara = this.readPara(child(child(defaults, "pPrDefault"), "pPr"));
  }

  /** A run's properties as stated — only what this `w:rPr` says. */
  readRun(rPr: Element | null): RunProps {
    if (!rPr) return {};
    const fonts = child(rPr, "rFonts");
    const theme = wAttr(fonts, "asciiTheme") ?? wAttr(fonts, "hAnsiTheme");
    const font = theme ? this.themeFont(theme) : (wAttr(fonts, "ascii") ?? wAttr(fonts, "hAnsi") ?? undefined);
    const size = num(childVal(rPr, "sz"));
    const underline = child(rPr, "u");
    const strike = onOff(child(rPr, "strike"));
    const dstrike = onOff(child(rPr, "dstrike"));
    const highlight = childVal(rPr, "highlight");
    return defined<RunProps>({
      font,
      size: size === undefined ? undefined : size / 2,
      color: childVal(rPr, "color") ?? undefined,
      bold: onOff(child(rPr, "b")),
      italic: onOff(child(rPr, "i")),
      underline: underline ? (wAttr(underline, "val") ?? "single") : undefined,
      strike: strike ?? dstrike,
      highlight: highlight && highlight !== "none" ? highlight : undefined,
      shading: fill(child(rPr, "shd")),
      vertAlign: childVal(rPr, "vertAlign") ?? undefined,
      position: ((value) => (value === undefined ? undefined : value / 2))(num(childVal(rPr, "position"))),
      caps: onOff(child(rPr, "caps")),
      smallCaps: onOff(child(rPr, "smallCaps")),
      hidden: onOff(child(rPr, "vanish")),
      spacing: ((value) => (value === undefined ? undefined : twipsToPt(value)))(num(childVal(rPr, "spacing"))),
    });
  }

  /** A paragraph's properties as stated — only what this `w:pPr` says. */
  readPara(pPr: Element | null): ParaProps {
    if (!pPr) return {};
    const ind = child(pPr, "ind");
    const spacing = child(pPr, "spacing");
    const numPr = child(pPr, "numPr");
    const tabs = child(pPr, "tabs");
    const twips = (value: string | null) => ((n) => (n === undefined ? undefined : twipsToPt(n)))(num(value));
    const lineRule = wAttr(spacing, "lineRule") ?? undefined;
    const line = num(wAttr(spacing, "line"));
    return defined<ParaProps>({
      align: childVal(pPr, "jc") ?? undefined,
      left: twips(wAttr(ind, "left") ?? wAttr(ind, "start")),
      right: twips(wAttr(ind, "right") ?? wAttr(ind, "end")),
      firstLine: twips(wAttr(ind, "firstLine")),
      hanging: twips(wAttr(ind, "hanging")),
      before: twips(wAttr(spacing, "before")),
      after: twips(wAttr(spacing, "after")),
      beforeAuto: flag(wAttr(spacing, "beforeAutospacing")),
      afterAuto: flag(wAttr(spacing, "afterAutospacing")),
      line: line === undefined ? undefined : lineRule && lineRule !== "auto" ? twipsToPt(line) : line,
      lineRule: line === undefined ? undefined : (lineRule ?? "auto"),
      contextualSpacing: onOff(child(pPr, "contextualSpacing")),
      tabs: tabs
        ? children(tabs, "tab").map((tab) => ({
            pos: twipsToPt(num(wAttr(tab, "pos")) ?? 0),
            val: wAttr(tab, "val") ?? "left",
          }))
        : undefined,
      numId: childVal(numPr, "numId") ?? undefined,
      ilvl: num(childVal(numPr, "ilvl")),
      shading: fill(child(pPr, "shd")),
      borders: readBorders(child(pPr, "pBdr"), ["top", "left", "bottom", "right"] as const),
    });
  }

  readTable(tblPr: Element | null): TableProps {
    if (!tblPr) return {};
    const ind = child(tblPr, "tblInd");
    const indent = num(wAttr(ind, "w"));
    return defined<TableProps>({
      borders: readBorders(child(tblPr, "tblBorders"), ["top", "left", "bottom", "right", "insideH", "insideV"] as const),
      margins: readMargins(child(tblPr, "tblCellMar")),
      align: childVal(tblPr, "jc") ?? undefined,
      indent: indent === undefined || wAttr(ind, "type") === "pct" ? undefined : twipsToPt(indent),
    });
  }

  /** The chain of a style and everything it is based on, base first. */
  private chain(id: string | undefined): Element[] {
    const out: Element[] = [];
    const seen = new Set<string>();
    let current = id ? this.styles.get(id) : undefined;
    while (current && !seen.has(wAttr(current, "styleId") ?? "")) {
      seen.add(wAttr(current, "styleId") ?? "");
      out.unshift(current);
      const base = childVal(current, "basedOn");
      current = base ? this.styles.get(base) : undefined;
    }
    return out;
  }

  paragraphStyle(id: string | null | undefined): { id: string; name: string; run: RunProps; para: ParaProps; heading?: number } {
    const styleId = id && this.styles.has(id) ? id : this.defaultParagraphStyle;
    const chain = this.chain(styleId);
    const name = childVal(chain[chain.length - 1], "name") ?? "Normal";
    const heading = /^heading ([1-6])$/i.exec(name);
    return {
      id: styleId ?? "Normal",
      name,
      run: mergeRun(...chain.map((s) => this.readRun(child(s, "rPr")))),
      para: mergePara(...chain.map((s) => this.readPara(child(s, "pPr")))),
      heading: heading ? Number(heading[1]) : undefined,
    };
  }

  characterStyle(id: string | null | undefined): RunProps {
    if (!id) return {};
    return mergeRun(...this.chain(id).map((s) => this.readRun(child(s, "rPr"))));
  }

  tableStyle(id: string | null | undefined): { table: TableProps; run: RunProps; para: ParaProps } {
    const chain = this.chain(id && this.styles.has(id) ? id : this.defaultTableStyle);
    return {
      table: mergeTable(...chain.map((s) => this.readTable(child(s, "tblPr")))),
      run: mergeRun(...chain.map((s) => this.readRun(child(s, "rPr")))),
      para: mergePara(...chain.map((s) => this.readPara(child(s, "pPr")))),
    };
  }

  private themeFont(theme: string): string | undefined {
    return theme.startsWith("major") ? this.major : this.minor;
  }
}
