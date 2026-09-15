import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

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
      {/* The badge keeps its own column and the name takes what is left, so a
          long name or subtitle cannot widen the card past the screen. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
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
    // A flex row would take the width of its nowrap label and value, which
    // widens the whole card past the screen. Grid columns that start at zero
    // keep the row's own width at zero, so the label and the value truncate
    // inside their shares instead of pushing the card out of the screen.
    <div className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] items-center gap-3">
      {label ? (
        // The cap keeps a long sheet header from taking the room of its value.
        <dt className="max-w-32 truncate text-xs text-muted-foreground">{label}</dt>
      ) : null}
      <dd
        className={cn(
          "flex min-w-0 items-center justify-end gap-2 empty:hidden",
          // A row without a label is a control, so it lines up with the card edge.
          label ? null : "col-span-full"
        )}
      >
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
