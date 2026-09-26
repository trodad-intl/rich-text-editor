/**
 * Script-tag build: React, Plate and the editor in one ES module, for pages
 * with no bundler. Load it with the stylesheet, then either write the element
 *
 *   <link rel="stylesheet" href=".../rich-text-editor.css">
 *   <script type="module" src=".../standalone/rich-text-editor.js"></script>
 *
 *   <trodad-rich-text-editor name="body">{{ $html }}</trodad-rich-text-editor>
 *
 * or mount onto a hidden textarea yourself:
 *
 *   TrodadRichTextEditor.mount("#body_editor", { textarea: "#body" });
 */
import api, { type MountApi } from "./mount";
import { defineRichTextEditorElement } from "./element";
import { htmlToValue, valueToHtml } from "./convert";
import { fitTablesToPage } from "./print/fit-tables-to-page";

export interface StandaloneApi extends MountApi {
  fitTablesToPage: typeof fitTablesToPage;
  htmlToValue: typeof htmlToValue;
  valueToHtml: typeof valueToHtml;
}

const standalone: StandaloneApi = { ...api, fitTablesToPage, htmlToValue, valueToHtml };

declare global {
  interface Window {
    TrodadRichTextEditor: StandaloneApi;
  }
}

defineRichTextEditorElement();

window.TrodadRichTextEditor = standalone;

export default standalone;
