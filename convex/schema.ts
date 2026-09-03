import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const staffRole = v.union(v.literal("admin"), v.literal("operator"), v.literal("viewer"));
export const staffStatus = v.union(v.literal("active"), v.literal("disabled"));
const columnPurpose = v.union(
  v.literal("updateStatus"),
  v.literal("uploadStatus"),
  v.literal("fileUrl"),
  v.literal("verificationType"),
  v.literal("url"),
  v.literal("conditionalFormatting")
);
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
  }).index("by_userId", ["userId"]),

  reportingOperations: defineTable({
    key: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    isActive: v.boolean(),
  }).index("by_key", ["key"]),

  userReportingOperationGrants: defineTable({
    userId: v.id("users"),
    reportingOperationId: v.id("reportingOperations"),
  }).index("by_userId_and_reportingOperationId", ["userId", "reportingOperationId"]),

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
    messagingThreadId: v.optional(v.string()),
    workflowAssigneeExternalId: v.optional(v.string()),
    workflowAssigneeName: v.optional(v.string()),
  })
    .index("by_externalClinicId", ["externalClinicId"])
    .index("by_clientId_and_name", ["clientId", "name"])
    .index("by_googleSheetId", ["googleSheetId"]),

  clinicColumnMappings: defineTable({
    clinicId: v.id("clinics"),
    purpose: columnPurpose,
    columnName: v.string(),
  }).index("by_clinicId_and_purpose", ["clinicId", "purpose"]),

  reportingScopes: defineTable({
    clientId: v.id("clients"),
    key: v.string(),
    name: v.string(),
    isActive: v.boolean(),
  })
    .index("by_key", ["key"])
    .index("by_clientId_and_name", ["clientId", "name"]),

  reportingScopeClinics: defineTable({
    reportingScopeId: v.id("reportingScopes"),
    clinicId: v.id("clinics"),
    position: v.number(),
  })
    .index("by_reportingScopeId_and_clinicId", ["reportingScopeId", "clinicId"])
    .index("by_clinicId_and_reportingScopeId", ["clinicId", "reportingScopeId"]),

  userReportingScopeGrants: defineTable({
    userId: v.id("users"),
    reportingScopeId: v.id("reportingScopes"),
  }).index("by_userId_and_reportingScopeId", ["userId", "reportingScopeId"]),

  qaGroups: defineTable({
    key: v.string(),
    name: v.string(),
    isActive: v.boolean(),
  }).index("by_key", ["key"]),

  clinicQaGroupAssignments: defineTable({
    clinicId: v.id("clinics"),
    qaGroupId: v.id("qaGroups"),
  })
    .index("by_clinicId_and_qaGroupId", ["clinicId", "qaGroupId"])
    .index("by_qaGroupId_and_clinicId", ["qaGroupId", "clinicId"]),

  reportRuns: defineTable({
    initiatedByUserId: v.id("users"),
    reportingOperationId: v.id("reportingOperations"),
    reportingScopeId: v.id("reportingScopes"),
    status: reportRunStatus,
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    processedClinicCount: v.number(),
    succeededClinicCount: v.number(),
    failedClinicCount: v.number(),
    errorMessage: v.optional(v.string()),
  })
    .index("by_initiatedByUserId_and_startedAt", ["initiatedByUserId", "startedAt"])
    .index("by_reportingScopeId_and_startedAt", ["reportingScopeId", "startedAt"])
    .index("by_status_and_startedAt", ["status", "startedAt"]),
});
