/**
 * Shared by the two integrations for server-rendered forms — `mount()` and
 * `<trodad-rich-text-editor>` — which both keep a form field filled with the
 * document.
 */
import type { Value } from "platejs";
import type { WordImportOptions } from "./components/word-import-toolbar-button";

/** What the form field carries: the HTML, or the Plate value as JSON. */
export type DocumentFormat = "html" | "json";

export function serializeForForm(format: DocumentFormat, html: string, value: Value): string {
  return format === "json" ? JSON.stringify(value) : html;
}

/**
 * The CSRF token a page advertises in `<meta name="csrf-token">`, the
 * convention Rails and several PHP frameworks use. Undefined when there is none.
 */
export function csrfFromMeta(): string | undefined {
  if (typeof document === "undefined") return undefined;
  return document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || undefined;
}

/**
 * Word-import options with the page's CSRF token added to the conversion
 * request, so a same-origin endpoint behind CSRF protection works without
 * extra wiring. Only applies when there is a `url` to send it to, and never
 * overrides a header the caller set.
 */
export function withCsrf(
  wordImport: WordImportOptions | false | undefined,
  token: string | undefined,
  header = "X-CSRF-TOKEN"
): WordImportOptions | false | undefined {
  if (!wordImport || !wordImport.url || !token) return wordImport;
  const headers = { ...(wordImport.headers ?? {}) };
  const already = Object.keys(headers).some((h) => h.toLowerCase() === header.toLowerCase());
  if (!already) headers[header] = token;
  return { ...wordImport, headers };
}
