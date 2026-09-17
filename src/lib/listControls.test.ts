import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useCursorPages } from "./listControls";

describe("useCursorPages", () => {
  it("counts a page asked for twice only once", () => {
    const { result } = renderHook(() => useCursorPages<string>());

    // A rapid double click reaches the hook twice before the first page lands,
    // so both presses hold the cursor of the page already on its way.
    act(() => {
      result.current.goNext("cursor-1", { rows: ["row-1"], index: 0 });
      result.current.goNext("cursor-1", { rows: ["row-1"], index: 0 });
    });

    expect(result.current.cursor).toBe("cursor-1");
    expect(result.current.index).toBe(1);
  });

  it("walks back to a page it has read", () => {
    const { result } = renderHook(() => useCursorPages<string>());

    act(() => result.current.goNext("cursor-1", { rows: ["row-1"], index: 0 }));
    act(() => result.current.goNext("cursor-2", { rows: ["row-2"], index: 1 }));
    act(() => result.current.goPrevious({ rows: ["row-3"], index: 2 }));

    expect(result.current.cursor).toBe("cursor-1");
    expect(result.current.index).toBe(1);
    expect(result.current.held).toEqual({ rows: ["row-3"], index: 2 });
    expect(result.current.pending).toBe("previous");
  });

  it("keeps the page on screen when the filters change", () => {
    const { result } = renderHook(() => useCursorPages<string>());

    act(() => result.current.goNext("cursor-1", { rows: ["row-1"], index: 0 }));
    act(() => result.current.goNext("cursor-2", { rows: ["row-2"], index: 1 }));
    // The reader is on the third page now, and it is that page the filter
    // change has to leave on screen, not the one the last move held.
    act(() => result.current.reset({ rows: ["row-3"], index: 2 }));

    expect(result.current.cursor).toBeNull();
    expect(result.current.index).toBe(0);
    expect(result.current.pending).toBeNull();
    expect(result.current.held).toEqual({ rows: ["row-3"], index: 2 });
  });
});
