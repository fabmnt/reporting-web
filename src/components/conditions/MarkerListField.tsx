"use client";

import { X } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MAX_MARKER_LENGTH, MAX_MARKERS_PER_RULE } from "../../../convex/model/reportConditions";
import { useI18n } from "@/lib/i18n/context";
import { normalizeMarker } from "@/lib/reportConditions";

export function MarkerListField({
  label,
  values,
  onChange,
  disabled,
  emptyHint,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  disabled: boolean;
  emptyHint: string;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");
  const inputId = useId();
  const atLimit = values.length >= MAX_MARKERS_PER_RULE;

  function addMarker() {
    const marker = normalizeMarker(draft);
    setDraft("");
    if (marker === "" || atLimit || values.includes(marker)) return;
    onChange([...values, marker]);
  }

  return (
    <Field>
      <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
      {values.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyHint}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {values.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onChange(values.filter((item) => item !== value))}
              disabled={disabled}
              aria-label={t.conditions.markers.remove(value)}
              title={t.conditions.markers.remove(value)}
              className="group inline-flex max-w-full shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-secondary py-1 pr-1.5 pl-2.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="truncate">{value}</span>
              <X
                className="size-3 shrink-0 text-muted-foreground transition-colors group-hover:text-destructive"
                aria-hidden="true"
              />
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Input
          id={inputId}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            addMarker();
          }}
          maxLength={MAX_MARKER_LENGTH}
          placeholder={t.conditions.markers.placeholder}
          disabled={disabled || atLimit}
          className="uppercase"
        />
        <Button
          type="button"
          variant="outline"
          onClick={addMarker}
          disabled={disabled || atLimit || draft.trim() === ""}
        >
          {t.common.add}
        </Button>
      </div>
      {atLimit ? (
        <p className="text-xs text-muted-foreground">
          {t.conditions.markers.limit(MAX_MARKERS_PER_RULE)}
        </p>
      ) : null}
    </Field>
  );
}
