import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import { clinicSheetColumns } from "./model/clinicSheetColumns";
import { reportConditionSet } from "./model/reportConditions";
import { reportTypeBucket } from "./model/reportTypes";

export const staffRole = v.union(v.literal("admin"), v.literal("operator"));
export const staffStatus = v.union(v.literal("active"), v.literal("disabled"));
// The language the user picked in the app. Missing means "follow the device".
export const staffLanguage = v.union(v.literal("en"), v.literal("es"));
const reportRunStatus = v.union(
  v.literal("pending"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled")
);

export default defineSchema({
  ...authTables,

  staffProfiles: defineTable({
    userId: v.id("users"),
    displayName: v.string(),
    role: staffRole,
    status: staffStatus,
    assignedClinicIds: v.optional(v.array(v.id("clinics"))),
    language: v.optional(staffLanguage),
  }).index("by_userId", ["userId"]),

  // One-shot links an administrator hands out so a person can choose their own
  // password. Only the hash of the token is stored, and creating a new link
  // deletes the previous one for that user.
  passwordSetupLinks: defineTable({
    userId: v.id("users"),
    tokenHash: v.string(),
    expiresAt: v.number(),
    createdByUserId: v.id("users"),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_userId", ["userId"]),

  clients: defineTable({
    key: v.string(),
    name: v.string(),
    isActive: v.boolean(),
  }).index("by_key", ["key"]),

  clinics: defineTable({
    externalClinicId: v.optional(v.string()),
    clientId: v.id("clients"),
    name: v.string(),
    googleSheetId: v.string(),
    isActive: v.boolean(),
    sheetColumns: v.optional(clinicSheetColumns),
    qaGroupKeys: v.optional(v.array(v.string())),
  })
    .index("by_externalClinicId", ["externalClinicId"])
    .index("by_clientId_and_name", ["clientId", "name"])
    .index("by_googleSheetId", ["googleSheetId"]),

  // Report types the row-report pipeline runs. A row lands in the first bucket
  // whose expression matches it, in bucket order. `ownerUserId: null` is a
  // built-in type: administrators edit it and every operator can run it. A set
  // owner keeps the type private to that account.
  reportTypes: defineTable({
    ownerUserId: v.union(v.id("users"), v.null()),
    name: v.string(),
    description: v.string(),
    // Keys stay stable across renames and reorders, so stored conditions keep
    // pointing at the right group.
    buckets: v.array(reportTypeBucket),
    conditions: reportConditionSet,
    // Shows the verification-type picker on the run form.
    usesVerificationFilter: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_ownerUserId", ["ownerUserId"]),

  reportRuns: defineTable({
    initiatedByUserId: v.id("users"),
    // The type may be renamed or deleted later, so the name travels with the
    // run.
    reportTypeId: v.id("reportTypes"),
    reportTypeName: v.string(),
    clientId: v.optional(v.id("clients")),
    status: reportRunStatus,
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    processedClinicCount: v.number(),
    succeededClinicCount: v.number(),
    failedClinicCount: v.number(),
    errorMessage: v.optional(v.string()),
  })
    .index("by_initiatedByUserId_and_startedAt", ["initiatedByUserId", "startedAt"])
    .index("by_clientId_and_startedAt", ["clientId", "startedAt"])
    .index("by_status_and_startedAt", ["status", "startedAt"]),
});
