import { describe, expect, it } from "vitest";

import {
  carrierMatchers,
  carrierMatchesAny,
  disabledCarrierMatchers,
  type CarrierBot,
  type CarrierMatcher,
} from "./carrierBots";

function bot(
  partial: Partial<CarrierBot> & Pick<CarrierBot, "name" | "pattern" | "status">
): CarrierBot {
  return partial;
}

// The unmatched card lists a row only when no usable bot takes it and no
// disabled bot would have taken it either. That is the rule executeReport
// applies when it fills unmatchedCarrierRows.
function shouldListAsUnmatched(
  carrierCell: string,
  usableMatchers: CarrierMatcher[],
  disabledMatchers: CarrierMatcher[]
): boolean {
  if (carrierMatchesAny(carrierCell, usableMatchers)) return false;
  if (carrierMatchesAny(carrierCell, disabledMatchers)) return false;
  return true;
}

describe("disabledCarrierMatchers", () => {
  it("builds matchers for bots whose status the report cannot run", () => {
    const matchers = disabledCarrierMatchers([
      bot({ name: "Aetna", pattern: "(?i)Aetna", status: "Disabled" }),
      bot({ name: "MetLife", pattern: "(?i)MetLife", status: "Active" }),
    ]);

    expect(matchers.map((matcher) => matcher.name)).toEqual(["Aetna"]);
    expect(matchers[0]?.matches("Aetna PPO")).toBe(true);
  });

  it("skips disabled bots whose pattern this app will not run", () => {
    const matchers = disabledCarrierMatchers([
      bot({ name: "Broken", pattern: "(MA|MASSACHUSETTS)+", status: "Disabled" }),
    ]);

    expect(matchers).toEqual([]);
  });
});

describe("unmatched rows and disabled bots", () => {
  it("keeps a row off the unmatched list when only a disabled bot matches it", () => {
    const bots = [
      bot({ name: "Aetna", pattern: "(?i)Aetna", status: "Disabled" }),
      bot({ name: "MetLife", pattern: "(?i)MetLife", status: "Active" }),
    ];
    const { matchers: usable } = carrierMatchers(bots);
    const disabled = disabledCarrierMatchers(bots);

    // Before the fix, a disabled-only match was treated as unmatched because
    // usable matchers never saw that bot. The inactive-carriers card already
    // explains those rows, so they must stay off the unmatched list.
    expect(shouldListAsUnmatched("Aetna", usable, disabled)).toBe(false);
    expect(shouldListAsUnmatched("MetLife", usable, disabled)).toBe(false);
    expect(shouldListAsUnmatched("United Concordia", usable, disabled)).toBe(true);
    expect(shouldListAsUnmatched("", usable, disabled)).toBe(true);
  });
});
