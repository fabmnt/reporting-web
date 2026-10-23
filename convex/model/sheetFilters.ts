import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { appError } from "./appErrors";
import { cleanConditionSet, type ConditionExpression } from "./reportConditions";

export const MAX_SHEET_FILTERS = 100;
export const MAX_SHEET_FILTER_NAME_LENGTH = 60;
export const MAX_SHEET_FILTER_DESCRIPTION_LENGTH = 200;

export type SheetFilterDraft = {
  name: string;
  description: string;
  expression: ConditionExpression;
};

// A sheet filter is one rule, so it is stored as the expression a report type
// keeps inside a single row group. Cleaning goes through that path, which is
// what drops blank markers and enforces the clause limits.
export function cleanSheetFilterDraft(draft: SheetFilterDraft): SheetFilterDraft {
  const name = draft.name.trim().slice(0, MAX_SHEET_FILTER_NAME_LENGTH);
  if (name === "") throw appError({ code: "SHEET_FILTER_NAME_REQUIRED" });

  const cleaned = cleanConditionSet({
    buckets: [{ bucketKey: "filter", catchAll: false, expression: draft.expression }],
  });
  const expression = cleaned.buckets[0]?.expression ?? { filters: [], groups: [] };

  return {
    name,
    description: draft.description.trim().slice(0, MAX_SHEET_FILTER_DESCRIPTION_LENGTH),
    expression,
  };
}

type NameCtx = QueryCtx | MutationCtx;

export async function assertSheetFilterNameAvailable(
  ctx: NameCtx,
  name: string,
  exceptId: Id<"sheetFilters"> | null
): Promise<void> {
  const rows = await ctx.db.query("sheetFilters").withIndex("by_name").take(MAX_SHEET_FILTERS);
  const taken = rows.some(
    (row) => row._id !== exceptId && row.name.toLowerCase() === name.toLowerCase()
  );
  if (taken) throw appError({ code: "SHEET_FILTER_NAME_TAKEN", name });
}

export async function assertSheetFilterRoom(ctx: NameCtx): Promise<void> {
  const rows = await ctx.db.query("sheetFilters").withIndex("by_name").take(MAX_SHEET_FILTERS);
  if (rows.length >= MAX_SHEET_FILTERS) {
    throw appError({ code: "SHEET_FILTER_LIMIT", limit: MAX_SHEET_FILTERS });
  }
}
