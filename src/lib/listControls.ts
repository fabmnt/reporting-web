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
  held: PageHold<T> | null;
  goPrevious: (hold: PageHold<T>) => void;
  // Called with the cursor of the page that was just read.
  goNext: (continueCursor: string, hold: PageHold<T>) => void;
  // Back to the first page, which is where a list whose filters changed starts.
  // The page on screen is handed over with it, because the page held from an
  // earlier move is not the one the reader is looking at.
  reset: (hold: PageHold<T>) => void;
};

// Where in the pages read so far the reader is. One value, because the cursor
// in use is the one at the index: moved apart, the index can pass the end of
// the list and the cursor falls back to the first page.
type PageState<T> = {
  cursors: (string | null)[];
  index: number;
  pending: "previous" | "next" | null;
  held: PageHold<T> | null;
};

/**
 * The pages a reader has walked through in a list the server pages with a
 * cursor. Convex cursors only move forward, so the pages already read are kept
 * and Previous walks back through them; a list whose filters changed starts
 * over at the first page, and keeps showing the rows it had until the new ones
 * arrive.
 */
export function useCursorPages<T>(): CursorPages<T> {
  const [state, setState] = useState<PageState<T>>({
    cursors: [null],
    index: 0,
    pending: null,
    held: null,
  });

  function goNext(continueCursor: string, hold: PageHold<T>) {
    setState((current) => {
      // A second press before the page lands reads the result the first press
      // ran with, so the cursor it holds is the one already in use: it asks for
      // the page on its way, and counting it twice would leave the index past
      // the last cursor.
      if (current.cursors[current.index] === continueCursor) return current;

      return {
        cursors: [...current.cursors.slice(0, current.index + 1), continueCursor],
        index: current.index + 1,
        pending: "next",
        held: hold,
      };
    });
  }

  function goPrevious(hold: PageHold<T>) {
    setState((current) =>
      current.index === 0
        ? current
        : { ...current, index: current.index - 1, pending: "previous", held: hold }
    );
  }

  function reset(hold: PageHold<T>) {
    // The rows on screen stay, until the filtered page arrives.
    setState({ cursors: [null], index: 0, pending: null, held: hold });
  }

  return {
    cursor: state.cursors[state.index] ?? null,
    index: state.index,
    canGoPrevious: state.index > 0,
    pending: state.pending,
    held: state.held,
    goPrevious,
    goNext,
    reset,
  };
}
