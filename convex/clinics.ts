import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./model/staff";

const MAX_CLINICS = 500;
const MAX_GROUPS = 200;
const DEPENDENT_BATCH_SIZE = 500;

const clinicGroupView = v.object({
  groupId: v.id("clinicGroups"),
  key: v.string(),
  name: v.string(),
  isActive: v.boolean(),
});

const clinicView = v.object({
  clinicId: v.id("clinics"),
  name: v.string(),
  googleSheetId: v.string(),
  externalClinicId: v.union(v.string(), v.null()),
  isActive: v.boolean(),
  clinicGroupId: v.id("clinicGroups"),
  clinicGroupName: v.string(),
});

const clinicInputFields = {
  name: v.string(),
  googleSheetId: v.string(),
  clinicGroupId: v.id("clinicGroups"),
};

function cleanRequiredText(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new Error(`${label} is required.`);
  }
  return trimmed;
}

function groupKeyFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function requireGroup(ctx: MutationCtx, clinicGroupId: Id<"clinicGroups">) {
  const group = await ctx.db.get("clinicGroups", clinicGroupId);
  if (group === null) {
    throw new Error("Clinic group was not found.");
  }
  return group;
}

async function assertGoogleSheetIdAvailable(
  ctx: MutationCtx,
  googleSheetId: string,
  ignoreClinicId?: Id<"clinics">
) {
  const existing = await ctx.db
    .query("clinics")
    .withIndex("by_googleSheetId", (query) => query.eq("googleSheetId", googleSheetId))
    .first();

  if (existing !== null && existing._id !== ignoreClinicId) {
    throw new Error("Another clinic already uses this Google Sheet.");
  }
}

async function assertClinicNameAvailable(
  ctx: MutationCtx,
  clinicGroupId: Id<"clinicGroups">,
  name: string,
  ignoreClinicId?: Id<"clinics">
) {
  const existing = await ctx.db
    .query("clinics")
    .withIndex("by_clinicGroupId_and_name", (query) =>
      query.eq("clinicGroupId", clinicGroupId).eq("name", name)
    )
    .first();

  if (existing !== null && existing._id !== ignoreClinicId) {
    throw new Error("A clinic with this name already exists in the selected group.");
  }
}

export const listGroups = query({
  args: {},
  returns: v.object({
    groups: v.array(clinicGroupView),
    limit: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const rows = await ctx.db
      .query("clinicGroups")
      .withIndex("by_key")
      .take(MAX_GROUPS + 1);
    const groups = rows.slice(0, MAX_GROUPS).map((group) => ({
      groupId: group._id,
      key: group.key,
      name: group.name,
      isActive: group.isActive,
    }));
    groups.sort((a, b) => a.name.localeCompare(b.name));

    return { groups, limit: MAX_GROUPS, hasMore: rows.length > MAX_GROUPS };
  },
});

export const createGroup = mutation({
  args: { name: v.string() },
  returns: clinicGroupView,
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const name = cleanRequiredText(args.name, "Group name");
    const key = groupKeyFromName(name);
    if (key === "") {
      throw new Error("Group name must contain letters or numbers.");
    }

    const existingByKey = await ctx.db
      .query("clinicGroups")
      .withIndex("by_key", (query) => query.eq("key", key))
      .first();
    const scannedGroups = await ctx.db.query("clinicGroups").withIndex("by_key").take(MAX_GROUPS);
    const existingByName = scannedGroups.find(
      (group) => group.name.toLowerCase() === name.toLowerCase()
    );

    if (existingByKey !== null || existingByName !== undefined) {
      throw new Error("A clinic group with this name already exists.");
    }

    const groupId = await ctx.db.insert("clinicGroups", { key, name, isActive: true });
    return { groupId, key, name, isActive: true };
  },
});

export const list = query({
  args: {},
  returns: v.object({
    clinics: v.array(clinicView),
    limit: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const rows = await ctx.db
      .query("clinics")
      .withIndex("by_clinicGroupId_and_name")
      .take(MAX_CLINICS + 1);

    const groupNameById = new Map<Id<"clinicGroups">, string>();
    const clinics = [];
    for (const row of rows.slice(0, MAX_CLINICS)) {
      let groupName = groupNameById.get(row.clinicGroupId);
      if (groupName === undefined) {
        const group = await ctx.db.get("clinicGroups", row.clinicGroupId);
        groupName = group?.name ?? "Unknown group";
        groupNameById.set(row.clinicGroupId, groupName);
      }
      clinics.push({
        clinicId: row._id,
        name: row.name,
        googleSheetId: row.googleSheetId,
        externalClinicId: row.externalClinicId ?? null,
        isActive: row.isActive,
        clinicGroupId: row.clinicGroupId,
        clinicGroupName: groupName,
      });
    }
    clinics.sort(
      (a, b) => a.clinicGroupName.localeCompare(b.clinicGroupName) || a.name.localeCompare(b.name)
    );

    return { clinics, limit: MAX_CLINICS, hasMore: rows.length > MAX_CLINICS };
  },
});

export const create = mutation({
  args: {
    ...clinicInputFields,
    externalClinicId: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
  },
  returns: v.object({ clinicId: v.id("clinics") }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const name = cleanRequiredText(args.name, "Clinic name");
    const googleSheetId = cleanRequiredText(args.googleSheetId, "Google Sheet ID");
    await requireGroup(ctx, args.clinicGroupId);
    await assertGoogleSheetIdAvailable(ctx, googleSheetId);
    await assertClinicNameAvailable(ctx, args.clinicGroupId, name);

    const clinicId = await ctx.db.insert("clinics", {
      name,
      googleSheetId,
      clinicGroupId: args.clinicGroupId,
      externalClinicId: args.externalClinicId?.trim() || undefined,
      isActive: args.isActive ?? true,
    });

    return { clinicId };
  },
});

export const update = mutation({
  args: {
    clinicId: v.id("clinics"),
    ...clinicInputFields,
    externalClinicId: v.union(v.string(), v.null()),
    isActive: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const clinic = await ctx.db.get("clinics", args.clinicId);
    if (clinic === null) {
      throw new Error("Clinic was not found.");
    }

    const name = cleanRequiredText(args.name, "Clinic name");
    const googleSheetId = cleanRequiredText(args.googleSheetId, "Google Sheet ID");
    await requireGroup(ctx, args.clinicGroupId);
    await assertGoogleSheetIdAvailable(ctx, googleSheetId, args.clinicId);
    await assertClinicNameAvailable(ctx, args.clinicGroupId, name, args.clinicId);

    await ctx.db.patch(args.clinicId, {
      name,
      googleSheetId,
      clinicGroupId: args.clinicGroupId,
      isActive: args.isActive,
      externalClinicId: args.externalClinicId?.trim() || undefined,
    });

    return null;
  },
});

async function deleteColumnMappings(ctx: MutationCtx, clinicId: Id<"clinics">) {
  while (true) {
    const rows = await ctx.db
      .query("clinicColumnMappings")
      .withIndex("by_clinicId_and_purpose", (query) => query.eq("clinicId", clinicId))
      .take(DEPENDENT_BATCH_SIZE);
    if (rows.length === 0) return;

    for (const row of rows) {
      await ctx.db.delete("clinicColumnMappings", row._id);
    }
  }
}

async function deleteQaGroupAssignments(ctx: MutationCtx, clinicId: Id<"clinics">) {
  while (true) {
    const rows = await ctx.db
      .query("clinicQaGroupAssignments")
      .withIndex("by_clinicId_and_qaGroupId", (query) => query.eq("clinicId", clinicId))
      .take(DEPENDENT_BATCH_SIZE);
    if (rows.length === 0) return;

    for (const row of rows) {
      await ctx.db.delete("clinicQaGroupAssignments", row._id);
    }
  }
}

async function deleteReportingScopeLinks(ctx: MutationCtx, clinicId: Id<"clinics">) {
  while (true) {
    const rows = await ctx.db
      .query("reportingScopeClinics")
      .withIndex("by_clinicId_and_reportingScopeId", (query) => query.eq("clinicId", clinicId))
      .take(DEPENDENT_BATCH_SIZE);
    if (rows.length === 0) return;

    for (const row of rows) {
      await ctx.db.delete("reportingScopeClinics", row._id);
    }
  }
}

export const remove = mutation({
  args: { clinicId: v.id("clinics") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const clinic = await ctx.db.get("clinics", args.clinicId);
    if (clinic === null) {
      throw new Error("Clinic was not found.");
    }

    await deleteColumnMappings(ctx, args.clinicId);
    await deleteQaGroupAssignments(ctx, args.clinicId);
    await deleteReportingScopeLinks(ctx, args.clinicId);
    await ctx.db.delete("clinics", args.clinicId);

    return null;
  },
});
