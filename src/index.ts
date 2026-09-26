/**
 * @trodad/rich-text-editor — a Plate-based rich text editor that reads and
 * writes HTML or Plate JSON, and takes a paste from Word, Excel or LibreOffice
 * without losing tables, fonts or spacing.
 *
 * Styles are not imported here; add them once in your app:
 *
 *   import "@trodad/rich-text-editor/style.css";
 */
export {
  RichTextEditor,
  DEFAULT_FONT_FAMILIES,
  type RichTextEditorProps,
  type RichTextEditorHandle,
  type RichTextChange,
  type FontFamilyOption,
  type PasteMode,
} from "./RichTextEditor";
export { default } from "./RichTextEditor";
export type { WordImportOptions } from "./components/word-import-toolbar-button";

export { htmlToValue, valueToHtml } from "./convert";
export { buildPlugins } from "./plugins";
export { isPlateValueEmpty, EMPTY_VALUE } from "./lib/html-serializer";

export { fitTablesToPage, type FitTablesOptions } from "./print/fit-tables-to-page";

export type { Value } from "platejs";
