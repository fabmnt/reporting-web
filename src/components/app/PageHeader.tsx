import type { ReactNode } from "react";

export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    // The actions stay in the top right corner on every screen width, so a
    // narrow screen reads the title and its buttons on the same line.
    <div className="flex items-start justify-between gap-4">
      <h1 className="font-heading text-2xl font-medium tracking-tight">{title}</h1>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
