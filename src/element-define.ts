/**
 * `import "@trodad/rich-text-editor/element"` registers
 * <trodad-rich-text-editor> using your app's own React.
 */
import { defineRichTextEditorElement } from "./element";

defineRichTextEditorElement();

export { RichTextEditorElement, defineRichTextEditorElement, TAG_NAME } from "./element";
