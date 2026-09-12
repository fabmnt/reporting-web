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
  it("reproduces the legacy ready-to-upload rules", () => {
    const conditions = readyToUploadDefaults();
    expect(conditions.executionDone.markers).toEqual(["DONE"]);
    expect(conditions.updateStatusAllowed.markers).toEqual(["DONE", "NOT FOUND"]);
    expect(conditions.uploadStatusTerminalExclude.markers).toEqual([
      "UPLOADED",
      "DONE BY DR",
      "DONE BY DIVA",
    ]);
    expect(conditions.uploadReady.markers).toEqual(["EMPTY"]);
    expect(conditions.uploadReview).toEqual({ enabled: true, catchAll: true, markers: [] });
  });

  it("reproduces the legacy pending-audit rules", () => {
    const conditions = pendingAuditDefaults();
    // Legacy TODOS applies no verification condition, so the rule starts off.
    expect(conditions.verificationType).toEqual({ enabled: false, values: ["FBD", "ELG"] });
    expect(conditions.executionHit).toEqual({
      enabled: true,
      lDoneMarkers: ["DONE"],
      mExcludeMarkers: ["NO ACTION", "EMPTY", "NEXT VERIFICATION ON"],
      lCheckMarkers: ["CHECK"],
      mNotFoundMarkers: ["NOT FOUND"],
    });
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

  it("keeps rows regardless of the verification value while the rule is off", () => {
    // Legacy TODOS has no verification condition.
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
    expect(outcome).toEqual({ kept: true, reason: null });
  });

  it("filters by verification with contains when a specific filter is set", () => {
    const row = sheetRow({
      l: "DONE",
      verification: "FBD EXTRA",
      updateStatus: "WAITING",
      uploadStatus: "EMPTY",
    });
    expect(evaluatePendingAudit(row, COLUMNS, conditions, "fbd").kept).toBe(true);

    const other = sheetRow({
      l: "DONE",
      verification: "ELG",
      updateStatus: "WAITING",
      uploadStatus: "EMPTY",
    });
    expect(evaluatePendingAudit(other, COLUMNS, conditions, "fbd")).toEqual({
      kept: false,
      reason: "verification_mismatch",
    });
  });

  it("drops a done row whose column M is excluded", () => {
    const outcome = evaluatePendingAudit(
      sheetRow({
        l: "DONE",
        m: "NO ACTION | 01/01/2025",
        updateStatus: "WAITING",
        uploadStatus: "EMPTY",
      }),
      COLUMNS,
      conditions,
      "all"
    );
    expect(outcome).toEqual({ kept: false, reason: "l_m_condition_failed" });
  });

  it("only excludes an update status on an exact match", () => {
    // Legacy uses exact equality, so DONE BY DR is not the excluded DONE.
    const outcome = evaluatePendingAudit(
      sheetRow({
        l: "DONE",
        updateStatus: "DONE BY DR",
        uploadStatus: "EMPTY",
      }),
      COLUMNS,
      conditions,
      "all"
    );
    expect(outcome).toEqual({ kept: true, reason: null });
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
      executionHit: {
        enabled: false,
        lDoneMarkers: [],
        mExcludeMarkers: [],
        lCheckMarkers: [],
        mNotFoundMarkers: [],
      },
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

  it("drops NOT UPLOADED as terminal", () => {
    // Terminal markers match with `includes`, so "NOT UPLOADED" hits
    // "UPLOADED" first and is ignored before reaching review.
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

  it("marks an EMPTY row ready when the update status is NOT FOUND", () => {
    const outcome = evaluateReadyToUpload(
      sheetRow({ l: "DONE", updateStatus: "NOT FOUND", uploadStatus: "EMPTY" }),
      columns,
      conditions
    );
    expect(outcome).toEqual({ bucket: "ready", reason: "kept_ready" });
  });

  it("drops an EMPTY row whose update status is not accepted", () => {
    const outcome = evaluateReadyToUpload(
      sheetRow({ l: "DONE", updateStatus: "WAITING", uploadStatus: "EMPTY" }),
      columns,
      conditions
    );
    expect(outcome).toEqual({ bucket: null, reason: "update_status_not_allowed" });
  });

  it("drops rows that are shorter than the mapped columns", () => {
    const shortRow = Array.from({ length: COLUMNS.uploadStatus }, () => "DONE");
    expect(evaluateReadyToUpload(shortRow, columns, conditions)).toEqual({
      bucket: null,
      reason: "too_short",
    });
  });

  it("sends an unmatched upload status to review while catch all is on", () => {
    const outcome = evaluateReadyToUpload(
      sheetRow({ l: "DONE", updateStatus: "DONE", uploadStatus: "WHATEVER" }),
      columns,
      conditions
    );
    expect(outcome).toEqual({ bucket: "review", reason: "kept_review" });
  });

  it("returns no bucket when catch all is off and the markers do not match", () => {
    const marked: ReportConditionSet = {
      ...conditions,
      uploadReview: { enabled: true, catchAll: false, markers: ["CHECK"] },
    };
    const outcome = evaluateReadyToUpload(
      sheetRow({ l: "DONE", updateStatus: "DONE", uploadStatus: "WHATEVER" }),
      columns,
      marked
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
        mExcludeMarkers: [" no action "],
        lCheckMarkers: [],
        mNotFoundMarkers: [],
      },
      updateStatusExclude: { enabled: true, markers: ["  ", ""] },
      uploadStatusAllowed: { enabled: true, values: [" empty "], match: "exact" },
    });
    if (cleaned.kind !== "pending-audit") throw new Error("Expected pending-audit conditions.");

    expect(cleaned.verificationType.values).toEqual(["FBD", "ELG"]);
    expect(cleaned.executionHit.lDoneMarkers).toEqual(["DONE"]);
    expect(cleaned.executionHit.mExcludeMarkers).toEqual(["NO ACTION"]);
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
      updateStatusAllowed: { enabled: true, markers: [] },
      uploadStatusTerminalExclude: { enabled: true, markers: [] },
      uploadReady: { enabled: true, markers: [] },
      uploadReview: { enabled: true, catchAll: true, markers: [] },
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
  [Symbol.asyncIterator]: () => AsyncIterator<ConditionRow>;
};

// Minimal stand-in for the Convex query builder. The resolver only calls
// eq().eq() and then iterates the result, and the tests hand it the rows of one
// user and operation.
function fakeCtx(rows: ConditionRow[]): QueryCtx {
  const query: IndexQuery = {
    eq: () => query,
    async *[Symbol.asyncIterator]() {
      for (const row of rows) yield row;
    },
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

  it("considers every stored row, past the old fixed cap", async () => {
    const rows: ConditionRow[] = Array.from({ length: 600 }, (_, index) => ({
      userId,
      operationKey: "pending-audit",
      clinicId: `clinic-${index}` as Id<"clinics">,
      conditions: pendingAuditDefaults(),
    }));
    const lastClinicId = "clinic-599" as Id<"clinics">;

    const resolved = await resolveConditionsForClinics(fakeCtx(rows), userId, "pending-audit");

    expect(resolved.byClinicId.size).toBe(600);
    expect(resolved.byClinicId.get(lastClinicId)).toBeDefined();
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
      executionHit: {
        enabled: false,
        lDoneMarkers: [],
        mExcludeMarkers: [],
        lCheckMarkers: [],
        mNotFoundMarkers: [],
      },
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
      updateStatusAllowed: { enabled: false, markers: [] },
      uploadStatusTerminalExclude: { enabled: false, markers: [] },
      uploadReady: { enabled: false, markers: [] },
      uploadReview: { enabled: false, catchAll: true, markers: [] },
    };
    expect(hasEnabledCriterion(disabled)).toBe(false);
    expect(hasEnabledCriterion(readyToUploadDefaults())).toBe(true);
  });
});
