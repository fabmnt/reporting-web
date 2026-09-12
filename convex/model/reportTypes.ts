import { ConvexError, v } from "convex/values";
import type { Infer } from "convex/values";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  bucketCatalog,
  defaultConditionsFor,
  REPORT_BUCKETS,
  type ReportConditionSet,
} from "./reportConditions";

export const reportTypeBucket = v.object({ key: v.string(), label: v.string() });
export type ReportTypeBucket = Infer<typeof reportTypeBucket>;

export const MAX_BUCKETS_PER_TYPE = 5;
export const MAX_TYPE_NAME_LENGTH = 60;
export const MAX_TYPE_DESCRIPTION_LENGTH = 200;

// What the create dialog offers: start from one empty group, or copy the rules
// of a built-in report as a working starting point.
export const reportTypeTemplate = v.union(
  v.literal("blank"),
  v.literal("pending-audit"),
  v.literal("ready-to-upload")
);
export type ReportTypeTemplate = Infer<typeof reportTypeTemplate>;

export function nextBucketKey(buckets: ReadonlyArray<ReportTypeBucket>): string {
  let highest = 0;
  for (const bucket of buckets) {
    const match = /^b(\d+)$/.exec(bucket.key);
    if (match === null) continue;
    highest = Math.max(highest, Number(match[1]));
  }
  return `b${highest + 1}`;
}

export function defaultBucketLabel(index: number): string {
  return `Group ${index + 1}`;
}

// Keeps a condition set aligned with its bucket list: expressions for removed
// groups are dropped, new groups start empty, and only the last group of a
// multi-group type can catch all.
export function conditionsForBuckets(
  buckets: ReadonlyArray<ReportTypeBucket>,
  conditions: ReportConditionSet
): ReportConditionSet {
  const byKey = new Map(conditions.buckets.map((bucket) => [bucket.bucketKey, bucket]));
  const catalog = bucketCatalog(buckets);
  return {
    buckets: buckets.map((bucket, index) => {
      const existing = byKey.get(bucket.key);
      return {
        bucketKey: bucket.key,
        catchAll: catalog[index]?.canCatchAll === true && (existing?.catchAll ?? false),
        expression: existing?.expression ?? { filters: [], groups: [] },
      };
    }),
  };
}

export function reportTypeTemplateFor(template: ReportTypeTemplate): {
  buckets: ReportTypeBucket[];
  conditions: ReportConditionSet;
} {
  if (template === "blank") {
    const buckets: ReportTypeBucket[] = [{ key: "b1", label: defaultBucketLabel(0) }];
    return { buckets, conditions: conditionsForBuckets(buckets, { buckets: [] }) };
  }
  return {
    buckets: REPORT_BUCKETS[template].map((bucket) => ({ key: bucket.key, label: bucket.label })),
    conditions: defaultConditionsFor(template),
  };
}

export function cleanTypeName(name: string): string {
  const cleaned = name.trim().slice(0, MAX_TYPE_NAME_LENGTH);
  if (cleaned === "") {
    throw new ConvexError({ code: "INVALID_CONFIG", message: "The report type needs a name." });
  }
  return cleaned;
}

export function cleanTypeDescription(description: string): string {
  return description.trim().slice(0, MAX_TYPE_DESCRIPTION_LENGTH);
}

export function cleanTypeBuckets(buckets: ReadonlyArray<ReportTypeBucket>): ReportTypeBucket[] {
  if (buckets.length === 0) {
    throw new ConvexError({
      code: "INVALID_CONFIG",
      message: "A report type needs at least one row group.",
    });
  }
  if (buckets.length > MAX_BUCKETS_PER_TYPE) {
    throw new ConvexError({
      code: "INVALID_CONFIG",
      message: `A report type supports up to ${MAX_BUCKETS_PER_TYPE} row groups.`,
    });
  }
  const seen = new Set<string>();
  const cleaned: ReportTypeBucket[] = [];
  for (const bucket of buckets) {
    const key = bucket.key.trim();
    if (key === "" || seen.has(key)) {
      throw new ConvexError({
        code: "INVALID_CONFIG",
        message: "Row group keys must be unique and non-empty.",
      });
    }
    seen.add(key);
    cleaned.push({ key, label: bucket.label.trim().slice(0, MAX_TYPE_NAME_LENGTH) || key });
  }
  return cleaned;
}

export type ReportTypeDoc = {
  _id: Id<"reportTypes">;
  userId: Id<"users">;
  name: string;
  description: string;
  buckets: ReportTypeBucket[];
  conditions: ReportConditionSet;
  createdAt: number;
  updatedAt: number;
};

// A report type is only usable by its owner, so someone else's id reads as
// missing.
export async function loadOwnedReportType(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  reportTypeId: Id<"reportTypes">
): Promise<ReportTypeDoc> {
  const row = await ctx.db.get("reportTypes", reportTypeId);
  if (row === null || row.userId !== userId) {
    throw new ConvexError({ code: "NOT_FOUND", message: "This report type does not exist." });
  }
  return row;
}
