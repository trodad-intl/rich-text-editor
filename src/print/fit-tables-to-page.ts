/**
 * Shrink wide document tables to the printable width before printing.
 *
 * The editor lays tables out `fixed` with pixel column widths, so a table drawn
 * wider than the paper would print cut off. This re-expresses every column of
 * such a table as a PERCENTAGE of the page and pins the table to `width: 100%`,
 * keeping the proportions the author drew. Tables that already fit are left
 * exactly as they are.
 *
 * Call it just before `window.print()` (or before your print engine measures
 * the page), on the element that wraps the rendered HTML.
 *
 * THE CONVERSION IS PER COLUMN, NOT PER CELL, and it has to cover every column.
 * A cell is not a column: a row reading `Status | : | Paid.` over a
 * five-column grid is three cells, the first of them spanning three columns.
 * Mapping measured cell widths onto <col> elements by CELL index wrote those
 * three percentages onto columns 0-2 and left columns 3 and 4 at the px widths
 * they came with — a hard minimum inside a table pinned to `width: 100%`. Fixed
 * layout gives the px columns what they ask for and the percentage ones what is
 * left, which was nothing: column 0 measured 0px and printed one letter per line.
 */

export interface FitTablesOptions {
  /** Where to look. Default: `document`. */
  root?: ParentNode;
  /** Which tables to fit. Default: tables inside `.rte-content`. */
  selector?: string;
  /**
   * Printable width in CSS px. Default 746: A4 (210mm ≈ 793px) minus 0.25in
   * side margins (≈ 48px).
   */
  printableWidth?: number;
}

interface GridCell {
  cell: HTMLTableCellElement;
  col: number;
  span: number;
}

interface Grid {
  cells: GridCell[];
  columns: number;
}

/**
 * Every cell with the column it starts at and the number it covers.
 *
 * A row's cells do not line up with the columns as soon as anything spans: a
 * colspan moves the cells after it along the row, and a rowspan moves the cells
 * of the rows BELOW it. So the grid is walked with an occupancy map, which is
 * the only reading that survives both.
 */
function gridOf(rows: HTMLTableRowElement[]): Grid {
  const taken = new Set<string>();
  const cells: GridCell[] = [];
  let columns = 0;
  rows.forEach((r, y) => {
    let x = 0;
    for (const c of Array.from(r.cells)) {
      while (taken.has(`${y}:${x}`)) x++;
      const span = c.colSpan || 1;
      const down = c.rowSpan || 1;
      for (let dy = 0; dy < down; dy++) {
        for (let dx = 0; dx < span; dx++) taken.add(`${y + dy}:${x + dx}`);
      }
      cells.push({ cell: c, col: x, span });
      x += span;
      if (x > columns) columns = x;
    }
  });
  return { cells, columns };
}

/**
 * The <col> governing each column, one entry per column. A <col span="2">
 * governs two of them, so it is listed twice — the array is indexed by COLUMN,
 * which is the only thing a percentage can be written against.
 */
function colsByColumn(t: HTMLTableElement): HTMLTableColElement[] {
  let colgroup: Element | null = null;
  for (const child of Array.from(t.children)) {
    if (child.tagName === "COLGROUP") colgroup = child;
  }
  const out: HTMLTableColElement[] = [];
  if (!colgroup) return out;
  for (const c of Array.from(colgroup.getElementsByTagName("col"))) {
    for (let i = 0; i < (c.span || 1); i++) out.push(c);
  }
  return out;
}

/**
 * How wide each column is drawn right now.
 *
 * A <col> carries a box of its own — the column's — so when the colgroup
 * accounts for the whole grid it is the exact answer. Failing that the widths
 * come from the cells: a cell covering one column states that column outright,
 * and one covering several is shared evenly over those of them nothing else has
 * spoken for.
 */
function columnWidths(grid: Grid, cols: HTMLTableColElement[]): number[] {
  if (cols.length === grid.columns) {
    return cols.map((c) => c.getBoundingClientRect().width);
  }
  const ws: (number | undefined)[] = new Array(grid.columns);
  const spanning: [GridCell, number][] = [];
  for (const p of grid.cells) {
    const w = p.cell.getBoundingClientRect().width;
    if (p.span === 1) {
      if (ws[p.col] === undefined) ws[p.col] = w;
    } else {
      spanning.push([p, w]);
    }
  }
  for (const [p, w] of spanning) {
    const unknown: number[] = [];
    let known = 0;
    for (let i = p.col; i < p.col + p.span; i++) {
      if (ws[i] === undefined) unknown.push(i);
      else known += ws[i]!;
    }
    if (!unknown.length) continue;
    const each = Math.max(0, w - known) / unknown.length;
    for (const i of unknown) ws[i] = each;
  }
  return Array.from({ length: grid.columns }, (_, j) => ws[j] ?? 0);
}

export function fitTablesToPage(options: FitTablesOptions = {}): void {
  const {
    root = document,
    selector = ".rte-content table",
    printableWidth = 746,
  } = options;

  root.querySelectorAll<HTMLTableElement>(selector).forEach((t) => {
    if (getComputedStyle(t).tableLayout !== "fixed") return;
    if (Math.round(t.getBoundingClientRect().width) <= printableWidth) return;
    const rows = Array.from(t.rows);
    if (!rows.length) return;
    const grid = gridOf(rows);
    if (!grid.columns) return;
    const cols = colsByColumn(t);
    const ws = columnWidths(grid, cols);
    const total = ws.reduce((a, b) => a + b, 0);
    if (total <= 0) return;
    const pct = ws.map((w) => (w / total) * 100);

    // A <col> takes the share of the columns it governs, so a two-column <col>
    // is written once with both.
    const share = new Map<HTMLTableColElement, number>();
    cols.forEach((c, i) => share.set(c, (share.get(c) ?? 0) + pct[i]));
    share.forEach((w, c) => {
      c.style.width = `${w.toFixed(4)}%`;
    });

    // And so does a cell, over the columns IT covers. Every cell, spanning or
    // not: a px width left inline on one is a minimum the percentages would
    // otherwise have to fit around, which is the failure described above.
    for (const p of grid.cells) {
      let w = 0;
      for (let i = p.col; i < p.col + p.span; i++) w += pct[i] ?? 0;
      p.cell.style.width = `${w.toFixed(4)}%`;
    }

    // `important`, because it has to beat the `width: auto !important` in
    // content.css. That rule lets a table narrower than the page keep the
    // natural width the editor draws it at — but a table just re-expressed in
    // PERCENTAGE columns has to be told what those are a percentage OF. Left at
    // `auto` they are indeterminate and the table collapses to its content.
    t.style.setProperty("width", "100%", "important");
  });
}
