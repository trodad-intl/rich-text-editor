/**
 * Loading a read .docx into the editor: the reader's clipboard pasted into an
 * emptied document, through the same `insertData` a Ctrl+V of that content out
 * of Word runs. Nothing about the paste is changed for it. See
 * lib/docx/read-docx.ts.
 */
import { EMPTY_VALUE } from "../html-serializer";
import type { SlateEditor, TElement, TText } from "platejs";
import type { DocxClipboard } from "./read-docx";

export function loadDocxClipboard(editor: SlateEditor, clipboard: DocxClipboard): void {
  editor.tf.setValue(EMPTY_VALUE);
  editor.tf.select(editor.api.start([])!);
  editor.tf.insertData(asDataTransfer(clipboard));

  // A document that opens with a list or a table cannot be merged into the empty
  // line it was pasted into, so that line is left in front of it. It is the
  // emptied editor's, not the document's: an import replaces the document.
  const [first, second] = editor.children as TElement[];
  if (second && second.type !== "p" && first?.type === "p" && isEmptyLine(first)) {
    editor.tf.removeNodes({ at: [0] });
  }
}

function isEmptyLine(block: TElement): boolean {
  return (block.children as (TElement | TText)[]).every((c) => "text" in c && !c.text);
}

/** The clipboard as the `DataTransfer` a paste hands `insertData`. */
function asDataTransfer({ html, rtf, text }: DocxClipboard): DataTransfer {
  const data: Record<string, string> = { "text/html": html, "text/rtf": rtf, "text/plain": text };
  return {
    types: Object.keys(data),
    getData: (type: string) => data[type] ?? "",
    setData: () => undefined,
    files: [],
    items: [],
  } as unknown as DataTransfer;
}

