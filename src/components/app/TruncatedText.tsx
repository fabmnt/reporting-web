"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

import { cn } from "@/lib/utils";

/**
 * One line of text that shows its full content when the reader asks for it: a
 * press on a phone, Enter or Space on a keyboard. The text becomes a control
 * only where it is actually clipped, so a value that already fits adds no tab
 * stop to the page.
 *
 * Pass isPressOnly for text inside a button, like the cells of a row card: a
 * button must not hold a focusable descendant, so those reveal on press and
 * their full text arrives with the row itself.
 */
export function TruncatedText({
  children,
  className,
  isPressOnly = false,
}: {
  children: string;
  className?: string;
  isPressOnly?: boolean;
}) {
  const element = useRef<HTMLSpanElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isClipped, setIsClipped] = useState(false);

  // Only a measurement knows whether the text is clipped. A window that gets
  // resized afterwards can leave the answer behind, which costs at most a tab
  // stop on a value that fits.
  useEffect(() => {
    const node = element.current;
    if (node !== null) setIsClipped(node.scrollWidth > node.clientWidth);
  }, [children]);

  const isControl = !isPressOnly && (isClipped || isExpanded);

  function toggle(event: MouseEvent<HTMLSpanElement> | KeyboardEvent<HTMLSpanElement>) {
    const node = element.current;
    if (node === null) return;

    // A text that fits has nothing to reveal, so the press reaches whatever
    // sits behind it.
    if (!isExpanded && node.scrollWidth <= node.clientWidth) return;

    event.stopPropagation();
    setIsExpanded((expanded) => !expanded);
  }

  return (
    <span
      ref={element}
      onClick={toggle}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        toggle(event);
      }}
      role={isControl ? "button" : undefined}
      tabIndex={isControl ? 0 : undefined}
      className={cn(
        "block outline-none",
        isControl && "cursor-pointer focus-visible:ring-3 focus-visible:ring-ring",
        isExpanded ? "whitespace-normal wrap-anywhere" : "truncate",
        className
      )}
    >
      {children}
    </span>
  );
}
