import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import { clinicSheetColumns } from "./model/clinicSheetColumns";
import { reportConditionSet } from "./model/reportConditions";
import { reportEngine, reportTypeBucket } from "./model/reportTypes";

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

  // The credentials a client's sheets are read with instead of the deployment
  // wide OAuth account. The key never leaves the server: no query returns it,
  // and only the internal functions that mint a Google token read it.
  googleServiceAccounts: defineTable({
    email: v.string(),
    privateKey: v.string(),
    // How many clients read their sheets with this account, so the accounts
    // list and the delete confirmation do not have to read the clients table
    // once per account. Every mutation that links or unlinks a client writes it
    // in the same transaction. It stays optional until
    // migrations/backfillServiceAccountClientCounts has run everywhere, so this
    // push does not reject rows the deployment already holds.
    clientCount: v.optional(v.number()),
  }).index("by_email", ["email"]),

  clients: defineTable({
    key: v.string(),
    name: v.string(),
    isActive: v.boolean(),
    // The service account this client's sheets are read with. Missing means the
    // app falls back to its own Google account, which is how every client was
    // read before service accounts existed.
    serviceAccountId: v.optional(v.id("googleServiceAccounts")),
    // How many clinics the client owns, so the client list does not have to
    // read the clinics table to count them. Every mutation that adds, moves or
    // deletes a clinic writes it in the same transaction. It stays optional
    // until migrations/backfillClientClinicCounts has run: Convex refuses a
    // push whose schema rejects documents the deployment already holds. Tighten
    // this to v.number() after the backfill.
    clinicCount: v.optional(v.number()),
  })
    .index("by_key", ["key"])
    // Deleting a service account reads the clients that point at it, so the
    // links can be cleared in the same transaction.
    .index("by_serviceAccountId", ["serviceAccountId"]),

  clinics: defineTable({
    // The Control Central id the carrier API reads a clinic's bots with. Every
    // write sets it and the screens ask for it, but the field stays optional
    // until the directory import has backfilled the rows that predate it: Convex
    // refuses a push whose schema rejects documents the deployment already
    // holds, and the import can only run once this schema is live. Tighten this
    // to v.string() after the import has run everywhere.
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
    // The clinics list pages through this one when it is not narrowed to a
    // client, so the whole directory is listed in name order.
    .index("by_name", ["name"])
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
    // Reports stored before this field existed are row reports.
    engine: v.optional(reportEngine),
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
    // The range the run covers. It is stored on the record because the run
    // action is given the id alone and reads the rest from here, and because a
    // run the operator cancelled is read back the same way. Runs written before
    // the record carried a range have none.
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    processedClinicCount: v.number(),
    succeededClinicCount: v.number(),
    failedClinicCount: v.number(),
    errorMessage: v.optional(v.string()),
  })
    .index("by_initiatedByUserId_and_startedAt", ["initiatedByUserId", "startedAt"])
    .index("by_clientId_and_startedAt", ["clientId", "startedAt"])
    .index("by_status_and_startedAt", ["status", "startedAt"]),
});
