"use client";

import { useMutation } from "convex/react";
import { useId, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { REPORT_BUCKETS, type ReportConditionSet } from "../../../convex/model/reportConditions";
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
import type { Messages } from "@/lib/i18n/messages";
import { bucketLabel } from "@/lib/i18n/reportLabels";

export type CreatedReportType = {
  reportTypeId: Id<"reportTypes">;
  name: string;
  description: string;
  buckets: ReportTypeBucket[];
  conditions: ReportConditionSet;
};

// The buckets of a template are stored with the new type, so they are created
// with the labels of the language the user is working in.
function templateBucketLabels(t: Messages, template: ReportTypeTemplate): string[] {
  if (template === "blank") return [t.conditions.editor.group(0)];
  return REPORT_BUCKETS[template].map((bucket) =>
    bucketLabel(t, template, bucket.key, bucket.label)
  );
}

export function NewReportTypeDialog({
  open,
  onOpenChange,
  onCreated,
  disabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (created: CreatedReportType) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const createMine = useMutation(api.reportTypes.createMine);
  const nameInputId = useId();
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<ReportTypeTemplate>("blank");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<LocalizedMessage | null>(null);

  const templateItems: ReadonlyArray<{ value: ReportTypeTemplate; label: string }> = [
    { value: "blank", label: t.conditions.newType.templateBlank },
    { value: "pending-audit", label: t.conditions.newType.templatePendingAudit },
    { value: "ready-to-upload", label: t.conditions.newType.templateReadyToUpload },
  ];

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      const created = await createMine({
        name,
        template,
        bucketLabels: templateBucketLabels(t, template),
      });
      setName("");
      setTemplate("blank");
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
        </Field>

        <Field>
          <FieldLabel>{t.conditions.newType.startingPoint}</FieldLabel>
          <Select
            items={templateItems}
            value={template}
            onValueChange={(value) => setTemplate((value as ReportTypeTemplate) ?? "blank")}
            disabled={saving}
          >
            <SelectTrigger aria-label={t.conditions.newType.startingPoint} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {templateItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t.conditions.newType.copyNote}</p>
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
