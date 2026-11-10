import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const get = internalQuery({
  args: { clinicId: v.id("clinics") },
  returns: v.union(
    v.null(),
    v.object({
      spreadsheetId: v.string(),
      credentialKey: v.string(),
      titles: v.array(v.string()),
      fetchedAt: v.number(),
    })
  ),
  handler: async (ctx, { clinicId }) => {
    const row = await ctx.db
      .query("sheetTabCache")
      .withIndex("by_clinicId", (q) => q.eq("clinicId", clinicId))
      .unique();
    return row === null
      ? null
      : {
          spreadsheetId: row.spreadsheetId,
          credentialKey: row.credentialKey,
          titles: row.titles,
          fetchedAt: row.fetchedAt,
        };
  },
});

export const put = internalMutation({
  args: {
    clinicId: v.id("clinics"),
    spreadsheetId: v.string(),
    credentialKey: v.string(),
    titles: v.array(v.string()),
    fetchedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("sheetTabCache")
      .withIndex("by_clinicId", (q) => q.eq("clinicId", args.clinicId))
      .unique();
    if (row === null) await ctx.db.insert("sheetTabCache", args);
    else if (row.fetchedAt <= args.fetchedAt) await ctx.db.replace(row._id, args);
    return null;
  },
});
