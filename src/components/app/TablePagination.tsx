import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";

/**
 * The page controls of a list the server reads one page at a time. A cursor
 * only moves forward, so there is no page to jump to and no total to report:
 * the control steps through the pages read so far and names the rows on screen.
 *
 * A page the list could not fill, or one a search left empty, still offers that
 * step: the rows behind it were read and the ones ahead have not been, so
 * hiding the control there would end the list early. Nothing is rendered when
 * there is no page to move to in either direction.
 */
export function TablePagination({
  first,
  last,
  canPrevious,
  canNext,
  pending,
  onPrevious,
  onNext,
}: {
  first: number;
  last: number;
  canPrevious: boolean;
  canNext: boolean;
  // The control the reader pressed, while the page behind it loads. The rows on
  // screen stay where they are, so the wait shows here instead of the table
  // emptying and the reader being sent back to the top.
  pending: "previous" | "next" | null;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const { t } = useI18n();

  if (!canPrevious && !canNext) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      {last < first ? null : (
        <p className="text-xs text-muted-foreground tabular-nums">
          {t.common.pagination.rows(first, last)}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!canPrevious || pending !== null}
          onClick={onPrevious}
        >
          {pending === "previous" ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <ChevronLeft data-icon="inline-start" aria-hidden="true" />
          )}
          {t.common.pagination.previous}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!canNext || pending !== null}
          onClick={onNext}
        >
          {t.common.pagination.next}
          {pending === "next" ? (
            <Spinner data-icon="inline-end" />
          ) : (
            <ChevronRight data-icon="inline-end" aria-hidden="true" />
          )}
        </Button>
      </div>
    </div>
  );
}
