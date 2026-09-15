import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/context";

/**
 * The page controls of a list that pages in the browser. Renders nothing for
 * an empty list, where the list shows its own "nothing here" message instead.
 */
export function TablePagination({
  page,
  pageCount,
  first,
  last,
  total,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  first: number;
  last: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const { t } = useI18n();

  if (total === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-muted-foreground tabular-nums">
        {t.common.pagination.range(first, last, total)}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft data-icon="inline-start" aria-hidden="true" />
          {t.common.pagination.previous}
        </Button>
        <span className="text-xs text-muted-foreground tabular-nums">
          {t.common.pagination.page(page, pageCount)}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          {t.common.pagination.next}
          <ChevronRight data-icon="inline-end" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
