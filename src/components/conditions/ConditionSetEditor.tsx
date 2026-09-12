"use client";

import { useState } from "react";

import {
  bucketCatalog,
  type ConditionBucket,
  type ReportConditionSet,
} from "../../../convex/model/reportConditions";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { BucketEditor } from "./BucketEditor";

/**
 * Row group picker plus the editor of the selected group. The parent remounts
 * it when the report type changes, so the selection resets with it.
 */
export function ConditionSetEditor({
  buckets,
  conditions,
  onChange,
  disabled,
}: {
  buckets: ReadonlyArray<{ key: string; label: string }>;
  conditions: ReportConditionSet;
  onChange: (conditions: ReportConditionSet) => void;
  disabled: boolean;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const catalog = bucketCatalog(buckets);
  const index = Math.max(
    0,
    catalog.findIndex((bucket) => bucket.key === selectedKey)
  );
  const active = conditions.buckets[index];

  const setBucket = (bucket: ConditionBucket) =>
    onChange({
      ...conditions,
      buckets: conditions.buckets.map((item, position) => (position === index ? bucket : item)),
    });

  return (
    <div className="flex flex-col gap-6">
      {catalog.length > 1 ? (
        <Field>
          <FieldLabel>Row group</FieldLabel>
          <Select
            items={catalog.map((bucket) => ({ value: bucket.key, label: bucket.label }))}
            value={catalog[index]?.key ?? ""}
            onValueChange={(value) => setSelectedKey((value as string) ?? null)}
            disabled={disabled}
          >
            <SelectTrigger aria-label="Row group" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {catalog.map((bucket) => (
                  <SelectItem key={bucket.key} value={bucket.key}>
                    {bucket.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      ) : null}

      {active ? (
        <BucketEditor
          key={active.bucketKey}
          bucket={active}
          canCatchAll={catalog[index]?.canCatchAll ?? false}
          onChange={setBucket}
          disabled={disabled}
        />
      ) : null}
    </div>
  );
}
