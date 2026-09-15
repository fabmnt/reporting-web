import type { ReactNode } from "react";

/**
 * One record of a table, rendered as a card. Tables stay sideways-scrollable
 * only on wide screens, so narrow screens read the same record as labelled
 * rows instead of swiping a clipped table.
 */
export function DataCard({
  title,
  subtitle,
  badge,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          {/* A record name can be one long word, so it wraps instead of painting
              outside the card. */}
          <span className="text-sm font-medium wrap-anywhere">{title}</span>
          {subtitle ? (
            <span className="truncate text-xs text-muted-foreground">{subtitle}</span>
          ) : null}
        </div>
        {badge}
      </div>
      {children ? <dl className="flex flex-col gap-2 border-t pt-3">{children}</dl> : null}
    </li>
  );
}

/** A label on the left and its control or value on the right. */
export function DataCardRow({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      {/* Sheet headers can be long, so the label is capped and the value keeps
          at least the rest of the row. */}
      {label ? (
        <dt className="max-w-[55%] shrink-0 truncate text-xs text-muted-foreground">{label}</dt>
      ) : null}
      <dd className="flex min-w-0 flex-1 items-center justify-end gap-2 empty:hidden">
        {children}
      </dd>
    </div>
  );
}

/** The list that holds the cards, shown only where the table is not. */
export function DataCardList({ children }: { children: ReactNode }) {
  return <ul className="grid gap-3 md:grid-cols-2 lg:hidden">{children}</ul>;
}

/** Wraps the table so it is replaced by the cards on narrow screens. */
export function DataTableFrame({ children }: { children: ReactNode }) {
  return <div className="hidden overflow-hidden rounded-lg border lg:block">{children}</div>;
}
