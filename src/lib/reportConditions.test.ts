import { describe, expect, it } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";
import type { QueryCtx } from "../../convex/_generated/server";
import {
  assertConditionKind,
  cleanConditionSet,
  defaultConditionsFor,
  evaluatePendingAudit,
  evaluateReadyToUpload,
  isImplementedOperation,
  MAX_MARKER_LENGTH,
  MAX_MARKERS_PER_RULE,
  resolveConditionsForClinics,
  type PendingAuditConditions,
  type ReadyToUploadConditions,
  type ReportConditionSet,
} from "../../convex/model/reportConditions";

import { hasEnabledCriterion, normalizeMarker } from "./reportConditions";

// Legacy sheet layout: L = 11, M = 12, then the column mapping of the test
// clinic. The rules never read past these columns.
const COLUMNS = { updateStatus: 13, uploadStatus: 14, verificationType: 15 };

type RowValues = {
  l?: string;
  m?: string;
  verification?: string;
  updateStatus?: string;
  uploadStatus?: string;
};

function sheetRow(values: RowValues): string[] {
  const row = Array.from({ length: 16 }, () => "");
  row[11] = values.l ?? "";
  row[12] = values.m ?? "";
  row[COLUMNS.updateStatus] = values.updateStatus ?? "";
  row[COLUMNS.uploadStatus] = values.uploadStatus ?? "";
  row[COLUMNS.verificationType] = values.verification ?? "";
  return row;
}

// The union return type is narrowed here so the tests read the concrete rule
// fields without casts.
function pendingAuditDefaults(): PendingAuditConditions {
  const conditions = defaultConditionsFor("pending-audit");
  if (conditions.kind !== "pending-audit") throw new Error("Expected pending-audit conditions.");
  return conditions;
}

function readyToUploadDefaults(): ReadyToUploadConditions {
  const conditions = defaultConditionsFor("ready-to-upload");
  if (conditions.kind !== "ready-to-upload")
    throw new Error("Expected ready-to-upload conditions.");
  return conditions;
}

describe("defaultConditionsFor", () => {
  it("reproduces the legacy ready-to-upload markers", () => {
    const conditions = readyToUploadDefaults();
    expect(conditions.executionDone.markers).toEqual(["DONE"]);
    expect(conditions.updateStatusDone.markers).toEqual(["DONE"]);
    expect(conditions.uploadStatusTerminalExclude.markers).toEqual(["UPLOADED", "DONE BY"]);
    expect(conditions.uploadReady.markers).toEqual(["EMPTY"]);
    expect(conditions.uploadReview.markers).toEqual([
      "CHECK",
      "ERROR",
      "UPLOAD INCOMPLETE",
      "NOT UPLOADED",
    ]);
  });

  it("reproduces the legacy pending-audit rules", () => {
    const conditions = pendingAuditDefaults();
    expect(conditions.verificationType.values).toEqual(["FBD", "ELG"]);
    expect(conditions.executionHit.lDoneMarkers).toEqual(["DONE"]);
    expect(conditions.executionHit.lCheckMarkers).toEqual(["CHECK"]);
    expect(conditions.executionHit.mNotFoundMarkers).toEqual(["NOT FOUND"]);
    expect(conditions.updateStatusExclude.markers).toContain("DONE");
    expect(conditions.uploadStatusAllowed).toEqual({
      enabled: true,
      values: ["EMPTY", "UNCHECKED"],
      match: "exact",
    });
  });
});

describe("evaluatePendingAudit with the default conditions", () => {
  const conditions = pendingAuditDefaults();

  it("keeps a done row whose upload status is EMPTY", () => {
    const outcome = evaluatePendingAudit(
      sheetRow({
        l: "DONE",
        verification: "FBD",
        updateStatus: "IN PROGRESS",
        uploadStatus: "EMPTY",
      }),
      COLUMNS,
      conditions,
      "all"
    );
    expect(outcome).toEqual({ kept: true, reason: null });
  });

  it("keeps the L CHECK plus M NOT FOUND branch", () => {
    const outcome = evaluatePendingAudit(
      sheetRow({
        l: "CHECK",
        m: "NOT FOUND",
        verification: "ELG",
        updateStatus: "WAITING",
        uploadStatus: "UNCHECKED",
      }),
      COLUMNS,
      conditions,
      "all"
    );
    expect(outcome.kept).toBe(true);
  });

  it("drops rows whose verification is neither FBD nor ELG", () => {
    const outcome = evaluatePendingAudit(
      sheetRow({
        l: "DONE",
        verification: "MEDICAL PLAN",
        updateStatus: "WAITING",
        uploadStatus: "EMPTY",
      }),
      COLUMNS,
      conditions,
      "all"
    );
    expect(outcome).toEqual({ kept: false, reason: "verification_mismatch" });
  });

  it("requires an exact verification match when a specific filter is set", () => {
    const row = sheetRow({
      l: "DONE",
      verification: "FBD EXTRA",
      updateStatus: "WAITING",
      uploadStatus: "EMPTY",
    });
    expect(evaluatePendingAudit(row, COLUMNS, conditions, "fbd")).toEqual({
      kept: false,
      reason: "verification_mismatch",
    });

    const exact = sheetRow({
      l: "DONE",
      verification: "fbd",
      updateStatus: "WAITING",
      uploadStatus: "EMPTY",
    });
    expect(evaluatePendingAudit(exact, COLUMNS, conditions, "fbd").kept).toBe(true);
  });

  it("drops an excluded update status", () => {
    const outcome = evaluatePendingAudit(
      sheetRow({
        l: "DONE",
        verification: "FBD",
        updateStatus: "DONE",
        uploadStatus: "EMPTY",
      }),
      COLUMNS,
      conditions,
      "all"
    );
    expect(outcome).toEqual({ kept: false, reason: "update_status_excluded" });
  });

  it("drops an upload status outside the allowed list", () => {
    const outcome = evaluatePendingAudit(
      sheetRow({
        l: "DONE",
        verification: "FBD",
        updateStatus: "WAITING",
        uploadStatus: "CHECK",
      }),
      COLUMNS,
      conditions,
      "all"
    );
    expect(outcome).toEqual({ kept: false, reason: "upload_status_not_allowed" });
  });

  it("drops rows that are shorter than the mapped columns", () => {
    const shortRow = Array.from({ length: COLUMNS.verificationType }, () => "DONE");
    expect(evaluatePendingAudit(shortRow, COLUMNS, conditions, "all")).toEqual({
      kept: false,
      reason: "too_short",
    });
  });

  it("keeps every row when all criteria are disabled", () => {
    const disabled: ReportConditionSet = {
      kind: "pending-audit",
      verificationType: { enabled: false, values: [] },
      executionHit: { enabled: false, lDoneMarkers: [], lCheckMarkers: [], mNotFoundMarkers: [] },
      updateStatusExclude: { enabled: false, markers: [] },
      uploadStatusAllowed: { enabled: false, values: [], match: "exact" },
    };
    expect(evaluatePendingAudit(sheetRow({}), COLUMNS, disabled, "all")).toEqual({
      kept: true,
      reason: null,
    });
  });

  it("ignores a disabled update status exclusion", () => {
    const relaxed: ReportConditionSet = {
      ...conditions,
      updateStatusExclude: { enabled: false, markers: ["DONE"] },
    };
    const outcome = evaluatePendingAudit(
      sheetRow({ l: "DONE", verification: "FBD", updateStatus: "DONE", uploadStatus: "EMPTY" }),
      COLUMNS,
      relaxed,
      "all"
    );
    expect(outcome.kept).toBe(true);
  });

  it("uses contains matching when the upload rule asks for it", () => {
    const relaxed: ReportConditionSet = {
      ...conditions,
      uploadStatusAllowed: { enabled: true, values: ["UNCHECK"], match: "contains" },
    };
    const outcome = evaluatePendingAudit(
      sheetRow({
        l: "DONE",
        verification: "FBD",
        updateStatus: "WAITING",
        uploadStatus: "UNCHECKED",
      }),
      COLUMNS,
      relaxed,
      "all"
    );
    expect(outcome.kept).toBe(true);
  });
});

describe("evaluateReadyToUpload with the default conditions", () => {
  const conditions = readyToUploadDefaults();
  const columns = { updateStatus: COLUMNS.updateStatus, uploadStatus: COLUMNS.uploadStatus };

  it("marks a DONE/DONE/EMPTY row ready", () => {
    const outcome = evaluateReadyToUpload(
      sheetRow({ l: "DONE", updateStatus: "DONE", uploadStatus: "EMPTY" }),
      columns,
      conditions
    );
    expect(outcome).toEqual({ bucket: "ready", reason: "kept_ready" });
  });

  it.each(["CHECK", "ERROR", "UPLOAD INCOMPLETE"])(
    "sends an upload status of %s to review",
    (uploadStatus) => {
      const outcome = evaluateReadyToUpload(
        sheetRow({ l: "DONE", updateStatus: "DONE", uploadStatus }),
        columns,
        conditions
      );
      expect(outcome).toEqual({ bucket: "review", reason: "kept_review" });
    }
  );

  it("drops NOT UPLOADED as terminal, shadowing its review marker", () => {
    // Legacy behavior: the terminal markers match with `includes`, so
    // "NOT UPLOADED" hits "UPLOADED" first and never reaches the review list.
    const outcome = evaluateReadyToUpload(
      sheetRow({ l: "DONE", updateStatus: "DONE", uploadStatus: "NOT UPLOADED" }),
      columns,
      conditions
    );
    expect(outcome).toEqual({ bucket: null, reason: "upload_terminal" });
  });

  it("drops terminal upload statuses before the ready and review markers", () => {
    const outcome = evaluateReadyToUpload(
      sheetRow({ l: "DONE", updateStatus: "DONE", uploadStatus: "UPLOADED" }),
      columns,
      conditions
    );
    expect(outcome).toEqual({ bucket: null, reason: "upload_terminal" });
  });

  it("drops rows where column L is not done", () => {
    const outcome = evaluateReadyToUpload(
      sheetRow({ l: "CHECK", updateStatus: "DONE", uploadStatus: "EMPTY" }),
      columns,
      conditions
    );
    expect(outcome).toEqual({ bucket: null, reason: "col_l_not_done" });
  });

  it("drops rows where the update status is not done", () => {
    const outcome = evaluateReadyToUpload(
      sheetRow({ l: "DONE", updateStatus: "WAITING", uploadStatus: "EMPTY" }),
      columns,
      conditions
    );
    expect(outcome).toEqual({ bucket: null, reason: "update_status_not_done" });
  });

  it("drops rows that are shorter than the mapped columns", () => {
    const shortRow = Array.from({ length: COLUMNS.uploadStatus }, () => "DONE");
    expect(evaluateReadyToUpload(shortRow, columns, conditions)).toEqual({
      bucket: null,
      reason: "too_short",
    });
  });

  it("returns no bucket when the upload status matches nothing", () => {
    const outcome = evaluateReadyToUpload(
      sheetRow({ l: "DONE", updateStatus: "DONE", uploadStatus: "WHATEVER" }),
      columns,
      conditions
    );
    expect(outcome).toEqual({ bucket: null, reason: "upload_no_match" });
  });

  it("ignores a disabled execution rule", () => {
    const relaxed: ReportConditionSet = {
      ...conditions,
      executionDone: { enabled: false, markers: [] },
    };
    const outcome = evaluateReadyToUpload(
      sheetRow({ l: "", updateStatus: "DONE", uploadStatus: "EMPTY" }),
      columns,
      relaxed
    );
    expect(outcome).toEqual({ bucket: "ready", reason: "kept_ready" });
  });
});

describe("cleanConditionSet", () => {
  it("trims, uppercases, and dedupes markers", () => {
    const cleaned = cleanConditionSet({
      kind: "pending-audit",
      verificationType: { enabled: true, values: [" fbd ", "FBD", "elg"] },
      executionHit: {
        enabled: true,
        lDoneMarkers: ["done"],
        lCheckMarkers: [],
        mNotFoundMarkers: [],
      },
      updateStatusExclude: { enabled: true, markers: ["  ", ""] },
      uploadStatusAllowed: { enabled: true, values: [" empty "], match: "exact" },
    });
    if (cleaned.kind !== "pending-audit") throw new Error("Expected pending-audit conditions.");

    expect(cleaned.verificationType.values).toEqual(["FBD", "ELG"]);
    expect(cleaned.executionHit.lDoneMarkers).toEqual(["DONE"]);
    expect(cleaned.updateStatusExclude.markers).toEqual([]);
    expect(cleaned.uploadStatusAllowed).toEqual({
      enabled: true,
      values: ["EMPTY"],
      match: "exact",
    });
  });

  it("truncates long markers and caps the count per rule", () => {
    const long = "x".repeat(MAX_MARKER_LENGTH + 10);
    const many = Array.from({ length: MAX_MARKERS_PER_RULE + 5 }, (_, index) => `marker ${index}`);
    const cleaned = cleanConditionSet({
      kind: "ready-to-upload",
      executionDone: { enabled: true, markers: [long, ...many] },
      updateStatusDone: { enabled: true, markers: [] },
      uploadStatusTerminalExclude: { enabled: true, markers: [] },
      uploadReady: { enabled: true, markers: [] },
      uploadReview: { enabled: true, markers: [] },
    });
    if (cleaned.kind !== "ready-to-upload") throw new Error("Expected ready-to-upload conditions.");

    expect(cleaned.executionDone.markers).toHaveLength(MAX_MARKERS_PER_RULE);
    expect(cleaned.executionDone.markers[0]).toBe("X".repeat(MAX_MARKER_LENGTH));
    expect(cleaned.executionDone.markers[1]).toBe("MARKER 0");
  });
});

describe("assertConditionKind", () => {
  it("accepts a matching operation and rejects a mismatch", () => {
    const conditions = pendingAuditDefaults();
    expect(() => assertConditionKind(conditions, "pending-audit")).not.toThrow();
    expect(() => assertConditionKind(conditions, "ready-to-upload")).toThrow();
  });
});

describe("isImplementedOperation", () => {
  it("knows which report types have conditions", () => {
    expect(isImplementedOperation("pending-audit")).toBe(true);
    expect(isImplementedOperation("ready-to-upload")).toBe(true);
    expect(isImplementedOperation("pending-execution")).toBe(false);
  });
});

type ConditionRow = {
  userId: string;
  operationKey: string;
  clinicId: Id<"clinics"> | null;
  conditions: ReportConditionSet;
};

type IndexQuery = {
  eq: (field: string, value: unknown) => IndexQuery;
  take: (limit: number) => Promise<ConditionRow[]>;
};

// Minimal stand-in for the Convex query builder. The real code only calls
// eq().eq().take(), and the tests hand it the rows of one user and operation.
function fakeCtx(rows: ConditionRow[]): QueryCtx {
  const query: IndexQuery = {
    eq: () => query,
    take: async (limit) => rows.slice(0, limit),
  };
  return {
    db: {
      query: () => ({
        withIndex: (_index: string, range: (q: IndexQuery) => unknown) => {
          range(query);
          return query;
        },
      }),
    },
  } as unknown as QueryCtx;
}

describe("resolveConditionsForClinics", () => {
  const userId = "user-1" as Id<"users">;
  const clinicId = "clinic-1" as Id<"clinics">;

  it("falls back to the code default when nothing is stored", async () => {
    const resolved = await resolveConditionsForClinics(fakeCtx([]), userId, "pending-audit");

    expect(resolved.defaultIsCustom).toBe(false);
    expect(resolved.defaultConditions).toEqual(defaultConditionsFor("pending-audit"));
    expect(resolved.byClinicId.size).toBe(0);
  });

  it("returns the stored default and the clinic override", async () => {
    const customDefault: ReportConditionSet = pendingAuditDefaults();
    const override: ReportConditionSet = {
      ...pendingAuditDefaults(),
      updateStatusExclude: { enabled: false, markers: [] },
    };
    const resolved = await resolveConditionsForClinics(
      fakeCtx([
        { userId, operationKey: "pending-audit", clinicId: null, conditions: customDefault },
        { userId, operationKey: "pending-audit", clinicId, conditions: override },
      ]),
      userId,
      "pending-audit"
    );

    expect(resolved.defaultIsCustom).toBe(true);
    expect(resolved.defaultConditions).toEqual(customDefault);
    expect(resolved.byClinicId.get(clinicId)).toEqual(override);
  });

  it("skips a stored row whose kind does not match the operation", async () => {
    const resolved = await resolveConditionsForClinics(
      fakeCtx([
        {
          userId,
          operationKey: "pending-audit",
          clinicId: null,
          conditions: readyToUploadDefaults(),
        },
      ]),
      userId,
      "pending-audit"
    );

    expect(resolved.defaultIsCustom).toBe(false);
    expect(resolved.defaultConditions).toEqual(defaultConditionsFor("pending-audit"));
  });
});

describe("normalizeMarker", () => {
  it("trims, uppercases, and truncates to the stored length", () => {
    expect(normalizeMarker("  done  ")).toBe("DONE");
    expect(normalizeMarker("x".repeat(MAX_MARKER_LENGTH + 5))).toBe("X".repeat(MAX_MARKER_LENGTH));
    expect(normalizeMarker("   ")).toBe("");
  });
});

describe("hasEnabledCriterion", () => {
  it("is false for a pending-audit set with every rule disabled", () => {
    const disabled: ReportConditionSet = {
      kind: "pending-audit",
      verificationType: { enabled: false, values: [] },
      executionHit: { enabled: false, lDoneMarkers: [], lCheckMarkers: [], mNotFoundMarkers: [] },
      updateStatusExclude: { enabled: false, markers: [] },
      uploadStatusAllowed: { enabled: false, values: [], match: "exact" },
    };
    expect(hasEnabledCriterion(disabled)).toBe(false);
    expect(hasEnabledCriterion(pendingAuditDefaults())).toBe(true);
  });

  it("is false for a ready-to-upload set with every rule disabled", () => {
    const disabled: ReportConditionSet = {
      kind: "ready-to-upload",
      executionDone: { enabled: false, markers: [] },
      updateStatusDone: { enabled: false, markers: [] },
      uploadStatusTerminalExclude: { enabled: false, markers: [] },
      uploadReady: { enabled: false, markers: [] },
      uploadReview: { enabled: false, markers: [] },
    };
    expect(hasEnabledCriterion(disabled)).toBe(false);
    expect(hasEnabledCriterion(readyToUploadDefaults())).toBe(true);
  });
});
