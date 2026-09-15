"use client";

import { useRef, useState, type MouseEvent } from "react";

import { cn } from "@/lib/utils";

/**
 * One line of text that shows its full content on press. The cards of narrow
 * screens cut long values with the ellipsis, and a press is the only way to read
 * what is behind it. Only a clipped text takes the press: a text that already
 * fits lets it through, so the control behind keeps working.
 */
export function TruncatedText({ children, className }: { children: string; className?: string }) {
  const element = useRef<HTMLSpanElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  function handlePress(event: MouseEvent<HTMLSpanElement>) {
    const node = element.current;
    if (node === null) return;

    const isClipped = node.scrollWidth > node.clientWidth;
    if (!isClipped && !isExpanded) return;

    event.stopPropagation();
    setIsExpanded((expanded) => !expanded);
  }

  return (
    <span
      ref={element}
      onClick={handlePress}
      className={cn(
        "block",
        isExpanded ? "whitespace-normal wrap-anywhere" : "truncate",
        className
      )}
    >
      {children}
    </span>
  );
}
