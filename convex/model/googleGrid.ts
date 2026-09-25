// One grid of cells: the rows of a range, each row a list of cell texts.
export type SheetGrid = string[][];

// Google answers a range as whatever the cells hold: text, numbers, booleans or
// nothing at all. The report compares text, so every cell is read as one. The
// fetch client and the googleapis client both answer with rows, so both read
// them through this.
export function toSheetGrid(values: unknown): SheetGrid {
  if (!Array.isArray(values)) return [];
  return values.map((row) =>
    Array.isArray(row)
      ? row.map((cell) => (cell === null || cell === undefined ? "" : String(cell)))
      : []
  );
}
