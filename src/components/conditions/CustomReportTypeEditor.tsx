"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useId } from "react";

import type { ReportConditionSet } from "../../../convex/model/reportConditions";
import {
  conditionsForBuckets,
  defaultBucketLabel,
  MAX_BUCKETS_PER_TYPE,
  MAX_TYPE_DESCRIPTION_LENGTH,
  MAX_TYPE_NAME_LENGTH,
  nextBucketKey,
  type ReportTypeBucket,
} from "../../../convex/model/reportTypes";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

import { ConditionSetEditor } from "./ConditionSetEditor";

export type CustomReportTypeDraft = {
  name: string;
  description: string;
  buckets: ReportTypeBucket[];
  conditions: ReportConditionSet;
};

/**
 * Name, row groups, and rules of one custom report type. Bucket keys stay
 * stable while labels, order, and rules change, so saved conditions keep
 * pointing at the right group.
 */
export function CustomReportTypeEditor({
  draft,
  onChange,
  disabled,
}: {
  draft: CustomReportTypeDraft;
  onChange: (draft: CustomReportTypeDraft) => void;
  disabled: boolean;
}) {
  const nameInputId = useId();
  const descriptionInputId = useId();
  const groupInputIdBase = useId();

  const updateBuckets = (buckets: ReportTypeBucket[]) =>
    onChange({ ...draft, buckets, conditions: conditionsForBuckets(buckets, draft.conditions) });

  const renameBucket = (index: number, label: string) =>
    onChange({
      ...draft,
      buckets: draft.buckets.map((bucket, position) =>
        position === index ? { ...bucket, label } : bucket
      ),
    });

  const moveBucket = (index: number, delta: number) => {
    const target = index + delta;
    const current = draft.buckets[index];
    const other = draft.buckets[target];
    if (current === undefined || other === undefined) return;
    const buckets = [...draft.buckets];
    buckets[index] = other;
    buckets[target] = current;
    updateBuckets(buckets);
  };

  const removeBucket = (index: number) =>
    updateBuckets(draft.buckets.filter((_, position) => position !== index));

  const addBucket = () =>
    updateBuckets([
      ...draft.buckets,
      { key: nextBucketKey(draft.buckets), label: defaultBucketLabel(draft.buckets.length) },
    ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={nameInputId}>Name</FieldLabel>
          <Input
            id={nameInputId}
            value={draft.name}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
            maxLength={MAX_TYPE_NAME_LENGTH}
            disabled={disabled}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={descriptionInputId}>Description</FieldLabel>
          <Input
            id={descriptionInputId}
            value={draft.description}
            onChange={(event) => onChange({ ...draft, description: event.target.value })}
            maxLength={MAX_TYPE_DESCRIPTION_LENGTH}
            disabled={disabled}
          />
        </Field>
      </div>

      <Separator />

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">Row groups</h3>
          <p className="text-xs text-muted-foreground">
            A row lands in the first group that matches it. Only the last group of a multi-group
            type can catch all.
          </p>
        </div>
        {draft.buckets.map((bucket, index) => {
          const groupInputId = `${groupInputIdBase}-${bucket.key}`;
          return (
            <div key={bucket.key} className="flex items-end gap-2">
              <Field className="flex-1">
                <FieldLabel htmlFor={groupInputId}>Group {index + 1}</FieldLabel>
                <Input
                  id={groupInputId}
                  value={bucket.label}
                  onChange={(event) => renameBucket(index, event.target.value)}
                  maxLength={MAX_TYPE_NAME_LENGTH}
                  disabled={disabled}
                />
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground"
                onClick={() => moveBucket(index, -1)}
                disabled={disabled || index === 0}
                aria-label={`Move group ${index + 1} up`}
                title={`Move group ${index + 1} up`}
              >
                <ArrowUp aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground"
                onClick={() => moveBucket(index, 1)}
                disabled={disabled || index === draft.buckets.length - 1}
                aria-label={`Move group ${index + 1} down`}
                title={`Move group ${index + 1} down`}
              >
                <ArrowDown aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground"
                onClick={() => removeBucket(index)}
                disabled={disabled || draft.buckets.length === 1}
                aria-label={`Remove group ${index + 1}`}
                title={`Remove group ${index + 1}`}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          );
        })}
        <Button
          type="button"
          variant="outline"
          className="w-fit"
          onClick={addBucket}
          disabled={disabled || draft.buckets.length >= MAX_BUCKETS_PER_TYPE}
        >
          <Plus data-icon="inline-start" aria-hidden="true" />
          Add row group
        </Button>
      </section>

      <Separator />

      <ConditionSetEditor
        buckets={draft.buckets}
        conditions={draft.conditions}
        onChange={(conditions) => onChange({ ...draft, conditions })}
        disabled={disabled}
      />
    </div>
  );
}
