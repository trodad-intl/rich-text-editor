/**
 * Reading WordprocessingML: the namespaces, element walking and units the
 * .docx reader needs. See lib/docx/read-docx.ts.
 */

export const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

export function parseXml(source: string | null | undefined): Document | null {
  if (!source) return null;
  const doc = new DOMParser().parseFromString(source, "application/xml");
  return doc.getElementsByTagName("parsererror").length ? null : doc;
}

/** Child elements, by local name when one is given — a document may bind `w:` to any prefix. */
export function children(el: Element | null | undefined, name?: string): Element[] {
  const out: Element[] = [];
  if (!el) return out;
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (!name || c.localName === name) out.push(c);
  }
  return out;
}

export function child(el: Element | null | undefined, name: string): Element | null {
  if (!el) return null;
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (c.localName === name) return c;
  }
  return null;
}

/** The first descendant with this local name, in any namespace. */
export function descendant(el: Element | null | undefined, name: string): Element | null {
  return el ? (el.getElementsByTagNameNS("*", name)[0] ?? null) : null;
}

/** A `w:` attribute. */
export function wAttr(el: Element | null | undefined, name: string): string | null {
  if (!el) return null;
  return el.getAttributeNS(W_NS, name) ?? el.getAttribute(`w:${name}`);
}

/** An `r:` attribute — a relationship id. */
export function rAttr(el: Element | null | undefined, name: string): string | null {
  if (!el) return null;
  return el.getAttributeNS(R_NS, name) ?? el.getAttribute(`r:${name}`);
}

/** `w:val` of the named child. */
export function childVal(el: Element | null | undefined, name: string): string | null {
  return wAttr(child(el, name), "val");
}

/** A number-valued attribute, or undefined. */
export function num(value: string | null | undefined): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * An on/off property: `<w:b/>` is on, `<w:b w:val="0"/>` is off, and an absent
 * element says nothing at all — undefined, so a lower layer can decide.
 */
export function onOff(el: Element | null): boolean | undefined {
  if (!el) return undefined;
  return flag(wAttr(el, "val")) ?? true;
}

/** An on/off attribute value: `1`/`true`/`on` or `0`/`false`/`off`; undefined when absent. */
export function flag(value: string | null | undefined): boolean | undefined {
  if (value === null || value === undefined) return undefined;
  return !(value === "0" || value === "false" || value === "off" || value === "none");
}

/** Twentieths of a point (twips) to points. */
export const twipsToPt = (twips: number) => twips / 20;

/** English Metric Units to CSS pixels. */
export const emuToPx = (emu: number) => emu / 9525;

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}
