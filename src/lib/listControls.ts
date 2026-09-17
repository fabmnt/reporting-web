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

export type CursorPages = {
  // What the query reads from; null asks for the first page.
  cursor: string | null;
  // How many pages the reader has moved forward, 0 being the first.
  index: number;
  canGoPrevious: boolean;
  goPrevious: () => void;
  // Called with the cursor of the page that was just read.
  goNext: (continueCursor: string) => void;
  // Back to the first page, which is where a list whose filters changed starts.
  reset: () => void;
};

/**
 * The pages a reader has walked through in a list the server pages with a
 * cursor. Convex cursors only move forward, so the pages already read are kept
 * and Previous walks back through them; a list whose filters changed starts
 * over at the first page.
 */
export function useCursorPages(): CursorPages {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [index, setIndex] = useState(0);

  function goNext(continueCursor: string) {
    setCursors((current) => [...current.slice(0, index + 1), continueCursor]);
    setIndex((current) => current + 1);
  }

  function goPrevious() {
    setIndex((current) => Math.max(0, current - 1));
  }

  function reset() {
    setCursors([null]);
    setIndex(0);
  }

  return {
    cursor: cursors[index] ?? null,
    index,
    canGoPrevious: index > 0,
    goPrevious,
    goNext,
    reset,
  };
}
