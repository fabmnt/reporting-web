"use client";

import { useMutation } from "convex/react";
import { useId, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { ReportConditionSet } from "../../../convex/model/reportConditions";
import {
  MAX_TYPE_NAME_LENGTH,
  type ReportTypeBucket,
  type ReportTypeTemplate,
} from "../../../convex/model/reportTypes";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";
import { localizedError, type LocalizedMessage } from "@/lib/i18n/errors";

import type { ReportTypeScope } from "./ReportTypesPanel";

export type CreatedReportType = {
  reportTypeId: Id<"reportTypes">;
  owner: ReportTypeScope;
  name: string;
  description: string;
  buckets: ReportTypeBucket[];
  conditions: ReportConditionSet;
  usesVerificationFilter: boolean;
};

const BLANK = "blank";

export function NewReportTypeDialog({
  scope,
  sources,
  existingNames,
  open,
  onOpenChange,
  onCreated,
  disabled,
}: {
  scope: ReportTypeScope;
  // Report types the caller can run, offered as a starting point.
  sources: ReadonlyArray<{ reportTypeId: Id<"reportTypes">; name: string }>;
  // Every name the caller can already run, whether or not it is a starting
  // point, because the backend refuses a duplicate among them.
  existingNames: ReadonlyArray<string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (created: CreatedReportType) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const createMine = useMutation(api.reportTypes.createMine);
  const createBuiltin = useMutation(api.reportTypes.createBuiltin);
  const nameInputId = useId();
  const [name, setName] = useState("");
  const [source, setSource] = useState<string>(BLANK);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<LocalizedMessage | null>(null);

  const template: ReportTypeTemplate =
    source === BLANK ? BLANK : { fromReportTypeId: source as Id<"reportTypes"> };

  // Names are unique per scope, so a personal type can share one with a
  // built-in. The two then sit next to each other in the run form, which the
  // note makes visible before the type exists.
  const trimmedName = name.trim();
  const nameTaken =
    trimmedName !== "" &&
    existingNames.some((existing) => existing.toLowerCase() === trimmedName.toLowerCase());

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      const create = scope === "builtin" ? createBuiltin : createMine;
      const created = await create({
        name,
        template,
        // An empty type starts from a group label in the working language. A
        // copy keeps the labels of the type it copies.
        bucketLabels: source === BLANK ? [t.conditions.editor.group(0)] : undefined,
      });
      setName("");
      setSource(BLANK);
      onCreated(created);
      onOpenChange(false);
    } catch (cause) {
      setError(localizedError(cause, (t) => t.conditions.failures.createType));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.conditions.newType.title}</DialogTitle>
          <DialogDescription>{t.conditions.newType.description}</DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel htmlFor={nameInputId}>{t.conditions.newType.name}</FieldLabel>
          <Input
            id={nameInputId}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t.conditions.newType.namePlaceholder}
            maxLength={MAX_TYPE_NAME_LENGTH}
            disabled={saving}
          />
          {nameTaken ? (
            <p className="text-xs text-muted-foreground">{t.conditions.newType.nameTakenNote}</p>
          ) : null}
        </Field>

        <Field>
          <FieldLabel>{t.conditions.newType.startingPoint}</FieldLabel>
          <Select
            items={[
              { value: BLANK, label: t.conditions.newType.templateBlank },
              ...sources.map((item) => ({ value: item.reportTypeId, label: item.name })),
            ]}
            value={source}
            onValueChange={(value) => setSource((value as string) ?? BLANK)}
            disabled={saving}
          >
            <SelectTrigger aria-label={t.conditions.newType.startingPoint} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={BLANK}>{t.conditions.newType.templateBlank}</SelectItem>
                {sources.map((item) => (
                  <SelectItem key={item.reportTypeId} value={item.reportTypeId}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t.conditions.newType.templateCopyNote}</p>
        </Field>

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>{t.conditions.newType.createFailedTitle}</AlertTitle>
            <AlertDescription>{error.resolve(t)}</AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {t.common.cancel}
          </Button>
          <Button
            type="button"
            onClick={() => void handleCreate()}
            disabled={saving || disabled || name.trim() === ""}
          >
            {saving ? (
              <>
                <Spinner data-icon="inline-start" />
                {t.conditions.newType.creating}
              </>
            ) : (
              t.conditions.newType.create
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
