"use client";

import { createSlatePlugin, type NodeEntry, type SlateEditor, type TElement } from "platejs";

import { blockFontSize, isBlankLine } from "../lib/block-font-size";

/**
 * Give every paragraph the size its own text is set in, and take it away again
 * from any that has no single size to speak of.
 *
 * The size goes on the BLOCK because that is what a line box is measured
 * against: every line carries a STRUT in the block's own font, so a paragraph
 * of 10px text sitting on the editable's 18px base is 18px tall however small
 * its text is. FontSizePlugin injects `fontSize` into paragraphs (see
 * components/font-kit.tsx), so writing it here draws it, and `blockStyle`
 * writes the same value into the saved HTML — where it outranks the print
 * page's own `body p {font-size: 15px}`, keeping the page and the screen the
 * same shape.
 *
 * `editor.children` is re-read each turn because `setNodes` replaces the node,
 * and consecutive blank lines take their size from the one above.
 */
function sizeBlocks(editor: SlateEditor): boolean {
  const resized = eachParagraph(editor, (node, previous, next, at) => {
    const fontSize = blockFontSize(node, previous, next);
    if (fontSize === (node as { fontSize?: string }).fontSize) return false;
    editor.tf.setNodes({ fontSize } as Partial<TElement>, { at });
    return true;
  });
  if (resized) return true;

  // A blank line's size goes on its empty run as well — the state Enter leaves
  // one in — because the run is what the toolbar reads and what typing
  // continues. With it only on the block, a blank line between two 12pt lines
  // drew 12pt tall but named itself the editor's base, and the text typed on it
  // came out at that base. Word's blank paragraph keeps its size on its
  // paragraph mark and types in it.
  //
  // Only once every block has SETTLED: a run's size is the line's own from then
  // on, so writing one mid-way would freeze an answer read off a sibling that
  // had not been sized yet — the last of three blank lines between 10px and
  // 30px text kept the 30px it was given on the first pass.
  return eachParagraph(editor, (node, _previous, _next, at) => {
    const fontSize = (node as { fontSize?: string }).fontSize;
    if (!fontSize || !isBlankLine(node)) return false;
    let marked = false;
    (node.children as { fontSize?: string }[]).forEach((run, j) => {
      if (run.fontSize) return;
      editor.tf.setNodes({ fontSize } as Partial<TElement>, { at: [...at, j] });
      marked = true;
    });
    return marked;
  });
}

/** Every paragraph, with its neighbours; true when `apply` changed any. */
function eachParagraph(
  editor: SlateEditor,
  apply: (node: TElement, previous: TElement | undefined, next: TElement | undefined, at: number[]) => boolean
): boolean {
  let changed = false;

  const visit = (children: readonly TElement[], path: number[]) => {
    for (let i = 0; i < children.length; i++) {
      const node = children[i];
      if (!node || !Array.isArray(node.children)) continue;

      if (node.type === "p") {
        if (apply(node, children[i - 1], children[i + 1], [...path, i])) changed = true;
        continue;
      }

      // Into tables and list items too: a table ROW is exactly where this was
      // asked for, and a cell's paragraph is measured the same way as any other.
      visit(node.children as TElement[], [...path, i]);
    }
  };

  visit(editor.children as TElement[], []);

  return changed;
}

/** More passes than any document needs to settle; a guard, not a budget. */
const MAX_INITIAL_PASSES = 100;

/**
 * Runs on the EDITOR node rather than on each paragraph: a blank line is sized
 * from the lines around it, a paragraph cannot see its neighbours, and editing
 * one line does not mark the next dirty. Slate walks the root on every change,
 * which is exactly the pass this needs.
 *
 * `normalizeInitialValue` covers opening a document: Plate only force-normalizes
 * at init when asked to, and this editor does not ask. It repeats the pass
 * itself until nothing changes, as the root normalization does, so a blank
 * line's run is sized before anyone puts a caret on it.
 */
export const BlockFontSizePlugin = createSlatePlugin({
  key: "blockFontSize",
  normalizeInitialValue: ({ editor }) => {
    for (let pass = 0; pass < MAX_INITIAL_PASSES && sizeBlocks(editor); pass++);
  },
  extendEditor: ({ editor }) => {
    const originalNormalizeNode = editor.normalizeNode as (entry: NodeEntry) => void;

    editor.normalizeNode = (entry: NodeEntry) => {
      const [, path] = entry;

      // Re-normalization carries on from here: every setNodes marks the root
      // dirty again, so the pass repeats until nothing changes.
      if (path.length === 0 && sizeBlocks(editor as SlateEditor)) return;

      originalNormalizeNode(entry);
    };

    return editor;
  },
});
