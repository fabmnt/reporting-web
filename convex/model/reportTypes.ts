import { v } from "convex/values";
import type { Infer } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { appError } from "./appErrors";
import { cleanConditionSet, type ReportConditionSet } from "./reportConditions";

export const reportTypeBucket = v.object({ key: v.string(), label: v.string() });
export type ReportTypeBucket = Infer<typeof reportTypeBucket>;

// Which engine reads a report type. `rows` applies the stored conditions,
// `execute` runs those conditions too but only on the rows whose carrier cell
// matches one of the bots the Control Central API reports for the clinic, and
// `executeAll` runs the same conditions without asking the API, so every row
// they pick is listed whatever carrier it names.
export const reportEngine = v.union(
  v.literal("rows"),
  v.literal("execute"),
  v.literal("executeAll")
);
export type ReportEngine = Infer<typeof reportEngine>;

export function engineOf(row: { engine?: ReportEngine }): ReportEngine {
  return row.engine ?? "rows";
}

export const MAX_BUCKETS_PER_TYPE = 5;
export const MAX_TYPE_NAME_LENGTH = 60;
export const MAX_TYPE_DESCRIPTION_LENGTH = 200;

export type ReportTypeDoc = Doc<"reportTypes">;

// Everything an administrator or an owner edits about a report type.
export type ReportTypeDraft = {
  name: string;
  description: string;
  buckets: ReportTypeBucket[];
  conditions: ReportConditionSet;
  usesVerificationFilter: boolean;
};

// What the create dialog offers: one empty group, or a copy of the rules of a
// report type the caller can run.
export const reportTypeTemplate = v.union(
  v.literal("blank"),
  v.object({ fromReportTypeId: v.id("reportTypes") })
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

type BucketDefinition = { key: string; label: string };

// Only the last bucket of a multi-bucket report can catch all rows no earlier
// bucket took.
export function bucketCatalog(
  definitions: ReadonlyArray<BucketDefinition>
): Array<{ key: string; label: string; canCatchAll: boolean }> {
  return definitions.map((bucket, index) => ({
    key: bucket.key,
    label: bucket.label,
    canCatchAll: definitions.length > 1 && index === definitions.length - 1,
  }));
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

export function cleanTypeName(name: string): string {
  const cleaned = name.trim().slice(0, MAX_TYPE_NAME_LENGTH);
  if (cleaned === "") {
    throw appError({ code: "REPORT_TYPE_NAME_REQUIRED" });
  }
  return cleaned;
}

export function cleanTypeDescription(description: string): string {
  return description.trim().slice(0, MAX_TYPE_DESCRIPTION_LENGTH);
}

export function cleanTypeBuckets(buckets: ReadonlyArray<ReportTypeBucket>): ReportTypeBucket[] {
  if (buckets.length === 0) {
    throw appError({ code: "REPORT_TYPE_GROUP_REQUIRED" });
  }
  if (buckets.length > MAX_BUCKETS_PER_TYPE) {
    throw appError({ code: "REPORT_TYPE_GROUP_LIMIT", limit: MAX_BUCKETS_PER_TYPE });
  }
  const seen = new Set<string>();
  const cleaned: ReportTypeBucket[] = [];
  for (const bucket of buckets) {
    const key = bucket.key.trim();
    if (key === "" || seen.has(key)) {
      throw appError({ code: "REPORT_TYPE_GROUP_KEYS" });
    }
    seen.add(key);
    cleaned.push({ key, label: bucket.label.trim().slice(0, MAX_TYPE_NAME_LENGTH) || key });
  }
  return cleaned;
}

// The only validation path a stored definition goes through: buckets are
// authoritative, so the rules are rebuilt around them.
export function cleanTypeDraft(draft: ReportTypeDraft): ReportTypeDraft {
  const buckets = cleanTypeBuckets(draft.buckets);
  return {
    name: cleanTypeName(draft.name),
    description: cleanTypeDescription(draft.description),
    buckets,
    conditions: cleanConditionSet(conditionsForBuckets(buckets, draft.conditions)),
    usesVerificationFilter: draft.usesVerificationFilter,
  };
}

// The labels of a template are stored with the new type, so they arrive in the
// language the caller is working in.
function relabelBuckets(
  buckets: ReadonlyArray<ReportTypeBucket>,
  labels: ReadonlyArray<string> | undefined
): ReportTypeBucket[] {
  if (labels === undefined) return [...buckets];
  return cleanTypeBuckets(
    buckets.map((bucket, index) => ({ key: bucket.key, label: labels[index] ?? bucket.label }))
  );
}

// The draft of a new report type plus the engine it runs on, which comes from
// the type it copies: a copy of a carrier report stays a carrier report.
export type ReportTypeTemplateDraft = {
  draft: ReportTypeDraft;
  engine: ReportEngine;
};

export async function draftFromTemplate(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  name: string,
  template: ReportTypeTemplate,
  bucketLabels: ReadonlyArray<string> | undefined
): Promise<ReportTypeTemplateDraft> {
  if (template === "blank") {
    const buckets: ReportTypeBucket[] = [{ key: "b1", label: defaultBucketLabel(0) }];
    return {
      draft: {
        name,
        description: "",
        buckets: relabelBuckets(buckets, bucketLabels),
        conditions: conditionsForBuckets(buckets, { buckets: [] }),
        usesVerificationFilter: false,
      },
      // A type built from nothing reads rows with the shared condition engine.
      engine: "rows",
    };
  }

  const source = await loadRunnableReportType(ctx, userId, template.fromReportTypeId);
  return {
    draft: {
      name,
      description: source.description,
      buckets: relabelBuckets(source.buckets, bucketLabels),
      conditions: source.conditions,
      usesVerificationFilter: source.usesVerificationFilter,
    },
    engine: engineOf(source),
  };
}

// A report type is usable by its owner or, for a built-in, by every operator,
// so anything else reads as missing.
export async function loadRunnableReportType(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  reportTypeId: Id<"reportTypes">
): Promise<ReportTypeDoc> {
  const row = await ctx.db.get("reportTypes", reportTypeId);
  if (row === null || (row.ownerUserId !== null && row.ownerUserId !== userId)) {
    throw appError({ code: "REPORT_TYPE_NOT_FOUND" });
  }
  return row;
}

// Only the owner edits a personal type, administrators included.
export async function loadOwnedReportType(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  reportTypeId: Id<"reportTypes">
): Promise<ReportTypeDoc> {
  const row = await ctx.db.get("reportTypes", reportTypeId);
  if (row === null || row.ownerUserId !== userId) {
    throw appError({ code: "REPORT_TYPE_NOT_FOUND" });
  }
  return row;
}

// Built-in types belong to the deployment, not to a user, so only the
// administrator-guarded functions reach them.
export async function loadBuiltinReportType(
  ctx: QueryCtx | MutationCtx,
  reportTypeId: Id<"reportTypes">
): Promise<ReportTypeDoc> {
  const row = await ctx.db.get("reportTypes", reportTypeId);
  if (row === null || row.ownerUserId !== null) {
    throw appError({ code: "REPORT_TYPE_NOT_FOUND" });
  }
  return row;
}

// Names are unique for a scope: built-ins among themselves, a personal type
// among the types of its owner.
export async function assertTypeNameAvailable(
  ctx: QueryCtx | MutationCtx,
  ownerUserId: Id<"users"> | null,
  name: string,
  exceptId: Id<"reportTypes"> | null
): Promise<void> {
  const rows = await ctx.db
    .query("reportTypes")
    .withIndex("by_ownerUserId", (query) => query.eq("ownerUserId", ownerUserId))
    .collect();
  const taken = rows.some(
    (row) => row._id !== exceptId && row.name.toLowerCase() === name.toLowerCase()
  );
  if (taken) {
    throw appError({ code: "REPORT_TYPE_NAME_TAKEN", name });
  }
}
