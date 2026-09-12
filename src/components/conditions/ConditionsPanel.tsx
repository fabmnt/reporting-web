"use client";

import { useMutation, useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { ReportConditionSet } from "../../../convex/model/reportConditions";
import { PageHeader } from "@/components/app/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

import { ConditionSetEditor } from "./ConditionSetEditor";
import { CustomReportTypeEditor, type CustomReportTypeDraft } from "./CustomReportTypeEditor";
import { NewReportTypeDialog, type CreatedReportType } from "./NewReportTypeDialog";

const DEFAULT_SCOPE = "default";

export function ConditionsPanel() {
  const current = useQuery(api.staffAccounts.current, {});
  const canConfigure =
    current?.status === "active" && (current.role === "admin" || current.role === "operator");
  const data = useQuery(api.reportConditions.listMine, canConfigure ? {} : "skip");
  const customTypesData = useQuery(api.reportTypes.listMine, canConfigure ? {} : "skip");
  const saveMine = useMutation(api.reportConditions.saveMine);
  const resetMine = useMutation(api.reportConditions.resetMine);
  const saveTypeMine = useMutation(api.reportTypes.saveMine);
  const removeTypeMine = useMutation(api.reportTypes.removeMine);

  const [typeValue, setTypeValue] = useState<string>("pending-audit");
  const [scope, setScope] = useState<string>(DEFAULT_SCOPE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Unsaved edits, keyed by report type and scope, so switching between them
  // does not throw the draft away.
  const [drafts, setDrafts] = useState<Record<string, ReportConditionSet>>({});
  const [customDrafts, setCustomDrafts] = useState<Record<string, CustomReportTypeDraft>>({});
  const [creating, setCreating] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const header = (
    <PageHeader
      title="Configuration"
      description="Choose which sheet rows each report returns. Report types and conditions apply to your account only."
    />
  );

  if (current === undefined) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (!canConfigure) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <Alert variant="destructive">
          <AlertTitle>Active staff access required</AlertTitle>
          <AlertDescription>Your account cannot edit report conditions.</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (data === undefined || customTypesData === undefined) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const operations = data.operations;
  const customTypes = customTypesData.types;
  const storedCustom = customTypes.find((item) => item.reportTypeId === typeValue);
  const customDraft: CustomReportTypeDraft | undefined =
    customDrafts[typeValue] ??
    (storedCustom === undefined
      ? undefined
      : {
          name: storedCustom.name,
          description: storedCustom.description,
          buckets: storedCustom.buckets,
          conditions: storedCustom.conditions,
        });
  const isCustom = customDraft !== undefined;

  const operation = isCustom
    ? undefined
    : (operations.find((item) => item.operationKey === typeValue) ?? operations[0]);

  if (!isCustom && operation === undefined) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <p className="text-sm text-muted-foreground">No report conditions are available.</p>
      </div>
    );
  }

  const isDefaultScope = scope === DEFAULT_SCOPE;
  const override =
    operation !== undefined && !isDefaultScope
      ? operation.overrides.find((item) => item.clinicId === scope)
      : undefined;
  const canReset =
    operation !== undefined &&
    (isDefaultScope ? operation.default.isCustom : override !== undefined);
  const editorKey = operation === undefined ? "" : `${operation.operationKey}:${scope}`;
  const conditions = drafts[editorKey] ?? override?.conditions ?? operation?.default.conditions;

  const scopeItems: Array<{ value: string; label: string }> = [
    { value: DEFAULT_SCOPE, label: "My default" },
    ...data.clinics.map((clinic) => ({
      value: clinic.clinicId,
      label: `${clinic.name} (${clinic.clientName})`,
    })),
  ];

  const inheritanceNote = isDefaultScope
    ? "Clinics use these values unless they have their own override."
    : override === undefined
      ? "This clinic inherits your default conditions."
      : "This clinic uses its own conditions.";

  async function handleSaveBuiltin() {
    if (operation === undefined || conditions === undefined) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await saveMine({
        operationKey: operation.operationKey,
        clinicId: isDefaultScope ? null : (scope as Id<"clinics">),
        conditions,
      });
      // Keep the draft on screen until the query catches up, so the form does
      // not flash back to the previously stored value.
      setDrafts((previous) => ({ ...previous, [editorKey]: conditions }));
      setNotice(isDefaultScope ? "Default conditions saved." : "Clinic conditions saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Saving the conditions failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveCustom() {
    if (customDraft === undefined) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await saveTypeMine({
        reportTypeId: typeValue as Id<"reportTypes">,
        name: customDraft.name,
        description: customDraft.description,
        buckets: customDraft.buckets,
        conditions: customDraft.conditions,
      });
      setCustomDrafts((previous) => ({ ...previous, [typeValue]: customDraft }));
      setNotice("Report type saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Saving the report type failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (operation === undefined) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await resetMine({
        operationKey: operation.operationKey,
        clinicId: isDefaultScope ? null : (scope as Id<"clinics">),
      });
      // Drop the draft so the row falls back to the stored value once the
      // query refetches.
      setDrafts((previous) => {
        if (!(editorKey in previous)) return previous;
        const next = { ...previous };
        delete next[editorKey];
        return next;
      });
      setNotice(
        isDefaultScope
          ? "Default conditions reset."
          : "This clinic now inherits your default conditions."
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Resetting the conditions failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteCustom() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await removeTypeMine({ reportTypeId: typeValue as Id<"reportTypes"> });
      setCustomDrafts((previous) => {
        const next = { ...previous };
        delete next[typeValue];
        return next;
      });
      setConfirmingDelete(false);
      setTypeValue(operations[0]?.operationKey ?? "pending-audit");
      setNotice("Report type deleted.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Deleting the report type failed.");
    } finally {
      setSaving(false);
    }
  }

  function handleCreated(created: CreatedReportType) {
    setCustomDrafts((previous) => ({
      ...previous,
      [created.reportTypeId]: {
        name: created.name,
        description: created.description,
        buckets: created.buckets,
        conditions: created.conditions,
      },
    }));
    setTypeValue(created.reportTypeId);
    setConfirmingDelete(false);
    setNotice("Report type created.");
  }

  return (
    <div className="flex flex-col gap-6">
      {header}

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not update the report type</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {notice ? (
        <Alert>
          <AlertTitle>Updated</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <NewReportTypeDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={handleCreated}
        disabled={saving}
      />

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start">
        <Card className="lg:sticky lg:top-20">
          <CardHeader>
            <h2 className="font-heading text-base leading-snug font-medium">Scope</h2>
            <CardDescription>Pick the report type and who the conditions apply to.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <Field>
              <FieldLabel>Report type</FieldLabel>
              <Select
                items={[
                  ...operations.map((item) => ({
                    value: item.operationKey,
                    label: item.label,
                  })),
                  ...customTypes.map((item) => ({
                    value: item.reportTypeId,
                    label: item.name,
                  })),
                ]}
                value={isCustom ? typeValue : (operation?.operationKey ?? "")}
                onValueChange={(value) => {
                  setTypeValue((value as string) ?? "pending-audit");
                  setConfirmingDelete(false);
                }}
                disabled={saving}
              >
                <SelectTrigger aria-label="Report type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Built-in</SelectLabel>
                    {operations.map((item) => (
                      <SelectItem key={item.operationKey} value={item.operationKey}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  {customTypes.length > 0 ? (
                    <SelectGroup>
                      <SelectLabel>My report types</SelectLabel>
                      {customTypes.map((item) => (
                        <SelectItem key={item.reportTypeId} value={item.reportTypeId}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ) : null}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => setCreating(true)}
                disabled={saving}
              >
                <Plus data-icon="inline-start" aria-hidden="true" />
                New report type
              </Button>
            </Field>

            {isCustom ? (
              <p className="text-xs text-muted-foreground">
                This type applies to all your assigned clinics.
              </p>
            ) : (
              <Field>
                <FieldLabel>Applies to</FieldLabel>
                <Select
                  items={scopeItems}
                  value={scope}
                  onValueChange={(value) => setScope(value ?? DEFAULT_SCOPE)}
                  disabled={saving}
                >
                  <SelectTrigger aria-label="Applies to" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {scopeItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{inheritanceNote}</p>
              </Field>
            )}

            <Separator />

            <p className="text-xs text-muted-foreground">
              Changes only affect the reports you run.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-heading text-base leading-snug font-medium">
              {isCustom ? customDraft.name : operation?.label}
            </h2>
            <CardDescription>
              {isCustom
                ? "A row lands in the first group that matches it."
                : operation !== undefined && operation.buckets.length > 1
                  ? "A row lands in the first group that matches it."
                  : "Rows that do not match are left out of the report."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {isCustom ? (
              <CustomReportTypeEditor
                draft={customDraft}
                onChange={(next) =>
                  setCustomDrafts((previous) => ({ ...previous, [typeValue]: next }))
                }
                disabled={saving}
              />
            ) : operation !== undefined && conditions !== undefined ? (
              <ConditionSetEditor
                key={editorKey}
                buckets={operation.buckets}
                conditions={conditions}
                onChange={(next) => setDrafts((previous) => ({ ...previous, [editorKey]: next }))}
                disabled={saving}
              />
            ) : null}

            <div className="flex flex-wrap justify-end gap-2">
              {isCustom ? (
                confirmingDelete ? (
                  <>
                    <Button
                      variant="ghost"
                      onClick={() => setConfirmingDelete(false)}
                      disabled={saving}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => void handleDeleteCustom()}
                      disabled={saving}
                    >
                      Confirm delete
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => setConfirmingDelete(true)}
                    disabled={saving}
                  >
                    Delete report type
                  </Button>
                )
              ) : canReset ? (
                <Button variant="outline" onClick={() => void handleReset()} disabled={saving}>
                  Reset to default
                </Button>
              ) : null}
              <Button
                onClick={() => void (isCustom ? handleSaveCustom() : handleSaveBuiltin())}
                disabled={saving}
              >
                Save conditions
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
