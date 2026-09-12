import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import type { ConditionBucket, ConditionClause } from "../../../convex/model/reportConditions";
import { BucketEditor } from "./BucketEditor";

function clause(values: string[]): ConditionClause {
  return { column: "L", operator: "contains", values };
}

function Harness() {
  const [bucket, setBucket] = useState<ConditionBucket>({
    bucketKey: "audit",
    catchAll: false,
    expression: {
      filters: [clause(["FIRST"]), clause(["SECOND"]), clause(["THIRD"])],
      groups: [],
    },
  });
  return <BucketEditor bucket={bucket} canCatchAll={false} onChange={setBucket} disabled={false} />;
}

describe("BucketEditor", () => {
  it("keeps an uncommitted draft with its clause when a middle one is removed", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const inputs = screen.getAllByRole("textbox", { name: "Values" });
    expect(inputs).toHaveLength(3);
    await user.type(inputs[2]!, "DRAFT");

    // Removing the middle clause must leave the draft of the third one alone.
    await user.click(screen.getAllByRole("button", { name: "Remove condition" })[1]!);

    const remaining = screen.getAllByRole("textbox", { name: "Values" });
    expect(remaining).toHaveLength(2);
    expect(remaining[1]).toHaveValue("DRAFT");
  });
});
