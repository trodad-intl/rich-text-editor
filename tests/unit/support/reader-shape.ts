/**
 * What a reader sees of an editor value: text and its formatting, blocks and
 * their spacing, cells and their rules. Widths and ids are left out. For the
 * upload/paste parity tests.
 *
 * Two spellings are read as the same thing, because they draw the same thing:
 * a font's fallback family (LibreOffice writes `Calibri, serif` for one run and
 * `Calibri, sans-serif` for the next; a run that names no font takes the RTF's
 * bare `Calibri`), and a size left unstated beside the editor's own 11pt.
 */
export function readerShape(nodes: any[]): unknown[] {
  return nodes.map((node) => {
    if ("text" in node) {
      const { text, color, bold, italic, underline, backgroundColor } = node;
      return strip({ text, fontSize: size(node.fontSize), fontFamily: family(node.fontFamily), color, bold, italic, underline, backgroundColor });
    }
    const { type, lineHeight, align, indent, marginTop, marginBottom, documentSpacing, borders, background, colSpan, rowSpan } = node;
    return strip({
      type,
      lineHeight,
      align,
      fontSize: node.type === "p" ? size(node.fontSize) : undefined,
      indent,
      marginTop,
      marginBottom,
      documentSpacing,
      borders,
      background,
      colSpan,
      rowSpan,
      children: readerShape(node.children),
    });
  });
}

function family(value: string | undefined): string | undefined {
  return value?.split(",")[0].replace(/["']/g, "").trim();
}

function size(value: string | undefined): string {
  return value ?? "11pt";
}

function strip(o: Record<string, unknown>) {
  for (const key of Object.keys(o)) if (o[key] === undefined) delete o[key];
  return o;
}
