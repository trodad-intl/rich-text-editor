/**
 * List numbering from `word/numbering.xml`: which marker a list paragraph
 * shows — `1.`, `a)`, `iv.`, a bullet — counted the way Word counts it, and the
 * indent and marker font its level states. See lib/docx/read-docx.ts.
 */
import type { ParaProps, RunProps, StyleSheet } from "./styles";
import { child, childVal, children, num, wAttr } from "./xml";

export interface ListLevel {
  /** The marker as Word shows it: `1.`, `a)`, `·`. */
  marker: string;
  ordered: boolean;
  /** This item's own number, and how its level counts: `decimal`, `lowerLetter`, … */
  value: number;
  format: string;
  para: ParaProps;
  run: RunProps;
  /** Word's `mso-list` ids, which only have to be consistent within one paste. */
  listId: number;
  level: number;
}

interface LevelDef {
  start: number;
  format: string;
  text: string;
  restart?: number;
  pPr: Element | null;
  rPr: Element | null;
}

/**
 * Symbol and Wingdings bullets are private-use characters that only mean
 * something in their own font. Word's HTML writes them as the plain character
 * they look like, which is also what tells the paste a list is not numbered.
 */
const BULLETS: Record<string, string> = {
  "\uF0B7": "·",
  "\uF0A7": "§",
  "\uF0D8": "Ø",
  "\uF0FC": "ü",
  "\uF076": "v",
  "\uF0A8": "¨",
};

export class Numbering {
  private abstracts = new Map<string, Map<number, LevelDef>>();
  private nums = new Map<string, { abstractId: string; overrides: Map<number, Partial<LevelDef>> }>();
  private counters = new Map<string, (number | undefined)[]>();
  private ids = new Map<string, number>();

  constructor(
    xml: Document | null,
    private styles: StyleSheet
  ) {
    const root = xml?.documentElement ?? null;
    for (const abstract of children(root, "abstractNum")) {
      const id = wAttr(abstract, "abstractNumId");
      if (id !== null) this.abstracts.set(id, readLevels(abstract));
    }
    for (const n of children(root, "num")) {
      const id = wAttr(n, "numId");
      const abstractId = childVal(n, "abstractNumId");
      if (id === null || abstractId === null) continue;
      const overrides = new Map<number, Partial<LevelDef>>();
      for (const o of children(n, "lvlOverride")) {
        const ilvl = num(wAttr(o, "ilvl")) ?? 0;
        const start = num(childVal(o, "startOverride"));
        const lvl = child(o, "lvl");
        overrides.set(ilvl, { ...(lvl ? readLevel(lvl) : {}), ...(start !== undefined ? { start } : {}) });
      }
      this.nums.set(id, { abstractId, overrides });
    }
  }

  /** The next marker of this list at this level, advancing its counters. Null when it is not a list. */
  next(numId: string | undefined, ilvl = 0): ListLevel | null {
    if (!numId || numId === "0") return null;
    const n = this.nums.get(numId);
    const levels = n ? this.abstracts.get(n.abstractId) : undefined;
    if (!n || !levels) return null;
    const def = (level: number): LevelDef | undefined => {
      const base = levels.get(level);
      const override = n.overrides.get(level);
      return base || override ? ({ start: 1, format: "decimal", text: "", pPr: null, rPr: null, ...base, ...override } as LevelDef) : undefined;
    };
    const own = def(ilvl);
    if (!own) return null;

    const counters = this.counters.get(numId) ?? [];
    counters[ilvl] = counters[ilvl] === undefined ? own.start : counters[ilvl]! + 1;
    // A level starting again resets every level below it.
    for (let deeper = ilvl + 1; deeper < 9; deeper++) {
      const restart = def(deeper)?.restart;
      if (restart === undefined || restart > ilvl) counters[deeper] = undefined;
    }
    this.counters.set(numId, counters);

    const bullet = own.format === "bullet";
    const marker = bullet
      ? [...own.text].map((c) => BULLETS[c] ?? c).join("")
      : own.text.replace(/%([1-9])/g, (_, d: string) => {
          const level = Number(d) - 1;
          const value = counters[level] ?? def(level)?.start ?? 1;
          return formatNumber(value, def(level)?.format ?? "decimal");
        });

    if (!this.ids.has(n.abstractId)) this.ids.set(n.abstractId, this.ids.size);
    return {
      marker,
      ordered: !bullet && own.format !== "none",
      value: counters[ilvl]!,
      format: own.format,
      para: this.styles.readPara(own.pPr),
      run: this.styles.readRun(own.rPr),
      listId: this.ids.get(n.abstractId)!,
      level: ilvl + 1,
    };
  }
}

function readLevel(lvl: Element): Partial<LevelDef> {
  const out: Partial<LevelDef> = {};
  const start = num(childVal(lvl, "start"));
  if (start !== undefined) out.start = start;
  const format = childVal(lvl, "numFmt");
  if (format) out.format = format;
  const text = childVal(lvl, "lvlText");
  if (text !== null) out.text = text;
  const restart = num(childVal(lvl, "lvlRestart"));
  if (restart !== undefined) out.restart = restart - 1;
  if (child(lvl, "pPr")) out.pPr = child(lvl, "pPr");
  if (child(lvl, "rPr")) out.rPr = child(lvl, "rPr");
  return out;
}

function readLevels(abstract: Element): Map<number, LevelDef> {
  const levels = new Map<number, LevelDef>();
  for (const lvl of children(abstract, "lvl")) {
    const ilvl = num(wAttr(lvl, "ilvl")) ?? 0;
    levels.set(ilvl, { start: 1, format: "decimal", text: "", pPr: null, rPr: null, ...readLevel(lvl) });
  }
  return levels;
}

function formatNumber(value: number, format: string): string {
  switch (format) {
    case "lowerLetter":
      return letters(value);
    case "upperLetter":
      return letters(value).toUpperCase();
    case "lowerRoman":
      return roman(value);
    case "upperRoman":
      return roman(value).toUpperCase();
    case "decimalZero":
      return value < 10 ? `0${value}` : String(value);
    case "none":
      return "";
    default:
      return String(value);
  }
}

/** a…z, then aa…zz, as Word counts. */
function letters(value: number): string {
  const n = Math.max(1, value);
  const letter = String.fromCharCode(97 + ((n - 1) % 26));
  return letter.repeat(Math.floor((n - 1) / 26) + 1);
}

function roman(value: number): string {
  const table: [number, string][] = [
    [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
    [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
  ];
  let n = Math.max(1, Math.floor(value));
  let out = "";
  for (const [size, digits] of table) {
    while (n >= size) {
      out += digits;
      n -= size;
    }
  }
  return out;
}
