import { useRef, useState } from "react";

// The search runs on the server, so the box waits for the typist to pause
// instead of paying for a query per letter.
const SEARCH_DEBOUNCE_MS = 300;

export type SearchText = {
  // What the input shows, which changes on every keystroke.
  text: string;
  // What the list queries with, once typing has paused.
  query: string;
  change: (value: string) => void;
};

/**
 * The search box of a list, held twice: the text the input shows and the text
 * the query runs with. The second follows the first after a short pause, so
 * typing a word costs one query rather than one per letter.
 */
export function useSearchText(): SearchText {
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function change(value: string) {
    setText(value);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setQuery(value.trim());
    }, SEARCH_DEBOUNCE_MS);
  }

  return { text, query, change };
}

/** The page on screen, handed over when the reader moves to another one. */
export type PageHold<T> = {
  rows: T[];
  canGoNext: boolean;
};

export type HeldPage<T> = PageHold<T> & {
  // The page the rows belong to, which is the one the reader was reading.
  index: number;
};

export type CursorPages<T> = {
  // What the query reads from; null asks for the first page.
  cursor: string | null;
  // How many pages the reader has moved forward, 0 being the first.
  index: number;
  canGoPrevious: boolean;
  // Which way the reader moved while that page loads, so the control they
  // pressed is the one that says so.
  pending: "previous" | "next" | null;
  // The page to keep showing while the next one loads. A cursor change empties
  // the query result, and a table that unmounts for it collapses the page and
  // jumps the reader to the top.
  held: HeldPage<T> | null;
  goPrevious: (hold: PageHold<T>) => void;
  // Called with the cursor of the page that was just read.
  goNext: (continueCursor: string, hold: PageHold<T>) => void;
  // Back to the first page, which is where a list whose filters changed starts.
  reset: () => void;
};

/**
 * The pages a reader has walked through in a list the server pages with a
 * cursor. Convex cursors only move forward, so the pages already read are kept
 * and Previous walks back through them; a list whose filters changed starts
 * over at the first page, and keeps showing the rows it had until the new ones
 * arrive.
 */
export function useCursorPages<T>(): CursorPages<T> {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [index, setIndex] = useState(0);
  const [pending, setPending] = useState<"previous" | "next" | null>(null);
  const [held, setHeld] = useState<HeldPage<T> | null>(null);

  function goNext(continueCursor: string, hold: PageHold<T>) {
    setHeld({ ...hold, index });
    setPending("next");
    setCursors((current) => [...current.slice(0, index + 1), continueCursor]);
    setIndex((current) => current + 1);
  }

  function goPrevious(hold: PageHold<T>) {
    setHeld({ ...hold, index });
    setPending("previous");
    setIndex((current) => Math.max(0, current - 1));
  }

  function reset() {
    setCursors([null]);
    setIndex(0);
    setPending(null);
  }

  return {
    cursor: cursors[index] ?? null,
    index,
    canGoPrevious: index > 0,
    pending,
    held,
    goPrevious,
    goNext,
    reset,
  };
}
