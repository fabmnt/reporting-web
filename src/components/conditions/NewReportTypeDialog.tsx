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

const TEMPLATE_ITEMS: ReadonlyArray<{ value: ReportTypeTemplate; label: string }> = [
  { value: "blank", label: "Start empty" },
  { value: "pending-audit", label: "Copy pending audit rules" },
  { value: "ready-to-upload", label: "Copy ready to upload rules" },
];

export type CreatedReportType = {
  reportTypeId: Id<"reportTypes">;
  name: string;
  description: string;
  buckets: ReportTypeBucket[];
  conditions: ReportConditionSet;
};

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
  const createMine = useMutation(api.reportTypes.createMine);
  const nameInputId = useId();
  const [name, setName] = useState("");
  const [template, setTemplate] = useState<ReportTypeTemplate>("blank");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      const created = await createMine({ name, template });
      setName("");
      setTemplate("blank");
      onCreated(created);
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Creating the report type failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New report type</DialogTitle>
          <DialogDescription>
            Build your own row rules on top of the same clinic sheets. Only you can see and run it.
          </DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel htmlFor={nameInputId}>Name</FieldLabel>
          <Input
            id={nameInputId}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Late verifications"
            maxLength={MAX_TYPE_NAME_LENGTH}
            disabled={saving}
          />
        </Field>

        <Field>
          <FieldLabel>Starting point</FieldLabel>
          <Select
            items={TEMPLATE_ITEMS}
            value={template}
            onValueChange={(value) => setTemplate((value as ReportTypeTemplate) ?? "blank")}
            disabled={saving}
          >
            <SelectTrigger aria-label="Starting point" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {TEMPLATE_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Copying a built-in report starts you from its current rules.
          </p>
        </Field>

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Could not create the report type</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleCreate()}
            disabled={saving || disabled || name.trim() === ""}
          >
            {saving ? (
              <>
                <Spinner data-icon="inline-start" />
                Creating
              </>
            ) : (
              "Create report type"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
