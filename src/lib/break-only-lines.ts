import type { TElement, TText, Value } from "platejs";

/**
 * A line holding nothing but one `<br>`, opened as the one empty line it is.
 *
 * HTML draws `<p><br></p>` one line tall — a `<br>` that ends a block adds no
 * line of its own — and so does Word, whose blank paragraph is one line. Plate's
 * deserializer reads it as a paragraph holding `"\n"`, and the editable draws
 * that as TWO lines: the break, then the line after it. So every blank line a
 * saved document or a paste brought in stood twice as tall here as it printed.
 * Measured: 56px against the 32px of a blank line made with Enter. Typing on
 * one kept the break too, so the text went in on the second line and the
 * paragraph stayed two lines tall for good.
 *
 * So on the way IN — opening, `setHtml`, the Word import and a paste — a
 * paragraph whose whole text is that one `"\n"` becomes `""`, its runs' marks
 * kept. Not in normalization: Shift+Enter on an empty line types the same
 * `"\n"` on purpose, and a JSON document keeps it as typed.
 */
export function openBreakOnlyLines(nodes: Value): Value {
  return nodes.map(openNode) as Value;
}

function isBreakOnlyLine(node: TElement): boolean {
  if (node.type !== "p") return false;
  const children = node.children as (TElement | TText)[];
  return (
    children.every((child) => "text" in child) &&
    children.map((child) => (child as TText).text).join("") === "\n"
  );
}

function openNode(node: any): any {
  if (!node || !Array.isArray(node.children)) return node;
  if (isBreakOnlyLine(node)) {
    return {
      ...node,
      children: node.children.map((child: TText) => (child.text === "\n" ? { ...child, text: "" } : child)),
    };
  }
  // Into tables and list items too: a cell's `<p><br></p>` is the same line.
  return { ...node, children: node.children.map(openNode) };
}
