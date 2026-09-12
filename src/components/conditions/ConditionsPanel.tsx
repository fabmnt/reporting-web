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

// Both sides come from the same stored shape, so a small JSON comparison is
// enough to know when a query result has caught up with a saved draft.
function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

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
  const [drafts, setDrafts] = useState<Record<string, ReportConditionSet | undefined>>({});
  const [customDrafts, setCustomDrafts] = useState<
    Record<string, CustomReportTypeDraft | undefined>
  >({});
  const [creating, setCreating] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // The list queries only carry names, so the rules of the scope being edited
  // are read on demand. Each query runs with "skip" until its scope is known.
  const listedOperation = data?.operations.find((item) => item.operationKey === typeValue);
  const isCustomSelection =
    (customTypesData?.types ?? []).some((item) => item.reportTypeId === typeValue) ||
    customDrafts[typeValue] !== undefined;
  const overrideData = useQuery(
    api.reportConditions.getMine,
    canConfigure && !isCustomSelection && listedOperation !== undefined && scope !== DEFAULT_SCOPE
      ? { operationKey: listedOperation.operationKey, clinicId: scope as Id<"clinics"> }
      : "skip"
  );
  const customDefinition = useQuery(
    api.reportTypes.getMine,
    canConfigure && isCustomSelection ? { reportTypeId: typeValue as Id<"reportTypes"> } : "skip"
  );

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
  const storedCustomDraft: CustomReportTypeDraft | undefined =
    customDefinition === undefined || customDefinition === null
      ? undefined
      : {
          name: customDefinition.name,
          description: customDefinition.description,
          buckets: customDefinition.buckets,
          conditions: customDefinition.conditions,
        };
  // A draft only covers the gap between a save and the query catching up. Once
  // the stored value matches it, the draft is dropped so later server updates
  // stay visible and the next save cannot write stale data back.
  const storedCustomDraftEntry = customDrafts[typeValue];
  if (
    storedCustomDraftEntry !== undefined &&
    storedCustomDraft !== undefined &&
    sameValue(storedCustomDraftEntry, storedCustomDraft)
  ) {
    const next = { ...customDrafts };
    delete next[typeValue];
    setCustomDrafts(next);
  }
  // A record lookup is missing until the type is edited or its rules load.
  const customDraftEntry = customDrafts[typeValue];
  const customDraft = customDraftEntry ?? storedCustomDraft;
  const isCustom = isCustomSelection;

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
  const hasOverride =
    operation !== undefined && operation.overrides.some((item) => item.clinicId === scope);
  const overrideConditions = hasOverride ? (overrideData?.conditions ?? undefined) : undefined;
  const overrideLoading = hasOverride && overrideData === undefined;
  const canReset =
    operation !== undefined && (isDefaultScope ? operation.default.isCustom : hasOverride);
  const editorKey = operation === undefined ? "" : `${operation.operationKey}:${scope}`;
  const storedConditions = overrideConditions ?? operation?.default.conditions;
  const draftConditions = drafts[editorKey];
  if (
    draftConditions !== undefined &&
    storedConditions !== undefined &&
    sameValue(draftConditions, storedConditions)
  ) {
    const next = { ...drafts };
    delete next[editorKey];
    setDrafts(next);
  }
  const conditions = draftConditions ?? storedConditions;

  const scopeItems: Array<{ value: string; label: string }> = [
    { value: DEFAULT_SCOPE, label: "My default" },
    ...data.clinics.map((clinic) => ({
      value: clinic.clinicId,
      label: `${clinic.name} (${clinic.clientName})`,
    })),
  ];

  const inheritanceNote = isDefaultScope
    ? "Clinics use these values unless they have their own override."
    : hasOverride
      ? "This clinic uses its own conditions."
      : "This clinic inherits your default conditions.";

  async function handleSaveBuiltin() {
    if (operation === undefined || conditions === undefined || overrideLoading) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await saveMine({
        operationKey: operation.operationKey,
        clinicId: isDefaultScope ? null : (scope as Id<"clinics">),
        conditions,
      });
      // Keep the cleaned value on screen until the query catches up, so the
      // form does not flash back to the previously stored value.
      setDrafts((previous) => ({ ...previous, [editorKey]: saved }));
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
      const saved = await saveTypeMine({
        reportTypeId: typeValue as Id<"reportTypes">,
        name: customDraft.name,
        description: customDraft.description,
        buckets: customDraft.buckets,
        conditions: customDraft.conditions,
      });
      setCustomDrafts((previous) => ({
        ...previous,
        [typeValue]: {
          name: saved.name,
          description: saved.description,
          buckets: saved.buckets,
          conditions: saved.conditions,
        },
      }));
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
              {isCustom ? (customDraft?.name ?? "") : operation?.label}
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
              customDraft !== undefined ? (
                <CustomReportTypeEditor
                  draft={customDraft}
                  onChange={(next) =>
                    setCustomDrafts((previous) => ({ ...previous, [typeValue]: next }))
                  }
                  disabled={saving}
                />
              ) : (
                <Skeleton className="h-64 w-full" />
              )
            ) : operation !== undefined && conditions !== undefined && !overrideLoading ? (
              <ConditionSetEditor
                key={editorKey}
                buckets={operation.buckets}
                conditions={conditions}
                onChange={(next) => setDrafts((previous) => ({ ...previous, [editorKey]: next }))}
                disabled={saving}
              />
            ) : (
              <Skeleton className="h-64 w-full" />
            )}

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
                disabled={saving || overrideLoading || (isCustom && customDraft === undefined)}
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
