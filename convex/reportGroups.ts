import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { appError } from "./model/appErrors";
import {
  assertGroupNameAvailable,
  cleanGroupName,
  loadOwnedReportGroup,
  MAX_GROUPS_PER_USER,
  resolveGroupMembers,
  type ReportGroupDoc,
  type ReportGroupDraft,
} from "./model/reportGroups";
import { requireOperator } from "./model/staff";

// Saved selections of the clients and clinics an operator runs reports over.
// A group holds whole clients beside single clinics; a run it is chosen for
// reads the clinics of the caller that the group covers, so a group can only
// ever narrow what the account already works on.

const reportGroupView = v.object({
  groupId: v.id("reportGroups"),
  name: v.string(),
  clientIds: v.array(v.id("clients")),
  clinicIds: v.array(v.id("clinics")),
});

const reportGroupDraftArgs = {
  name: v.string(),
  clientIds: v.array(v.id("clients")),
  clinicIds: v.array(v.id("clinics")),
};

function viewOf(row: ReportGroupDoc) {
  return {
    groupId: row._id,
    name: row.name,
    clientIds: row.clientIds,
    clinicIds: row.clinicIds,
  };
}

async function groupsOfUser(ctx: MutationCtx, userId: Id<"users">): Promise<ReportGroupDoc[]> {
  return await ctx.db
    .query("reportGroups")
    .withIndex("by_ownerUserId", (query) => query.eq("ownerUserId", userId))
    .collect();
}

/** The groups of the caller, in name order. */
export const list = query({
  args: {},
  returns: v.object({ groups: v.array(reportGroupView) }),
  handler: async (ctx) => {
    const { userId } = await requireOperator(ctx);
    const rows = await ctx.db
      .query("reportGroups")
      .withIndex("by_ownerUserId", (query) => query.eq("ownerUserId", userId))
      .collect();

    rows.sort((a, b) => a.name.localeCompare(b.name));
    return { groups: rows.map(viewOf) };
  },
});

export const create = mutation({
  args: reportGroupDraftArgs,
  returns: reportGroupView,
  handler: async (ctx, args) => {
    const { userId } = await requireOperator(ctx);

    const name = cleanGroupName(args.name);
    const members = await resolveGroupMembers(ctx, args);
    await assertGroupNameAvailable(ctx, userId, name, null);

    const existing = await groupsOfUser(ctx, userId);
    if (existing.length >= MAX_GROUPS_PER_USER) {
      throw appError({ code: "REPORT_GROUP_LIMIT", limit: MAX_GROUPS_PER_USER });
    }

    const now = Date.now();
    const draft: ReportGroupDraft = { name, ...members };
    const groupId = await ctx.db.insert("reportGroups", {
      ownerUserId: userId,
      ...draft,
      createdAt: now,
      updatedAt: now,
    });

    return viewOf({
      _id: groupId,
      _creationTime: now,
      ownerUserId: userId,
      ...draft,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const save = mutation({
  args: { groupId: v.id("reportGroups"), ...reportGroupDraftArgs },
  returns: reportGroupView,
  handler: async (ctx, args) => {
    const { userId } = await requireOperator(ctx);
    const row = await loadOwnedReportGroup(ctx, userId, args.groupId);

    const name = cleanGroupName(args.name);
    const members = await resolveGroupMembers(ctx, args);
    await assertGroupNameAvailable(ctx, userId, name, row._id);

    const updatedAt = Date.now();
    await ctx.db.patch(row._id, { name, ...members, updatedAt });

    return viewOf({ ...row, name, ...members, updatedAt });
  },
});

export const remove = mutation({
  args: { groupId: v.id("reportGroups") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId } = await requireOperator(ctx);
    const row = await loadOwnedReportGroup(ctx, userId, args.groupId);
    await ctx.db.delete("reportGroups", row._id);
    return null;
  },
});
