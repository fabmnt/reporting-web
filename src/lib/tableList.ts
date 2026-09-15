// Admin lists filter and page in the browser: the backend caps every list, so
// the whole filtered set is already in memory and a page change costs no read.
export const TABLE_PAGE_SIZE = 20;

export type TablePage<T> = {
  rows: T[];
  // The requested page, clamped to the pages that exist, so a narrower filter
  // never leaves the table on a page past the end of the list.
  page: number;
  pageCount: number;
  total: number;
  // 1-based positions of the first and last row on the page. Both are 0 when
  // the filtered list is empty.
  first: number;
  last: number;
};

export function tablePage<T>(rows: T[], page: number): TablePage<T> {
  const pageCount = Math.max(1, Math.ceil(rows.length / TABLE_PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pageCount);
  const start = (current - 1) * TABLE_PAGE_SIZE;
  const pageRows = rows.slice(start, start + TABLE_PAGE_SIZE);

  return {
    rows: pageRows,
    page: current,
    pageCount,
    total: rows.length,
    first: rows.length === 0 ? 0 : start + 1,
    last: start + pageRows.length,
  };
}

// The status every list offers: clients and clinics both carry an active flag.
export type StatusFilter = "all" | "active" | "inactive";

export function matchesStatusFilter(isActive: boolean, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  return isActive === (filter === "active");
}
