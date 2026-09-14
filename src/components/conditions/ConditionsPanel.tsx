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
import { useDocumentTitle, useI18n } from "@/lib/i18n/context";
import { localizedError, type LocalizedMessage } from "@/lib/i18n/errors";
import { bucketLabel, operationLabel } from "@/lib/i18n/reportLabels";

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
  const { t } = useI18n();
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
  const [error, setError] = useState<LocalizedMessage | null>(null);
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

  useDocumentTitle(t.app.titles.configuration);

  const header = (
    <PageHeader title={t.conditions.pageTitle} description={t.conditions.pageDescription} />
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
          <AlertTitle>{t.conditions.accessDeniedTitle}</AlertTitle>
          <AlertDescription>{t.conditions.accessDeniedBody}</AlertDescription>
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

  // Built-in labels travel from the backend in English, so they are translated
  // once here and everything below reads the translated list.
  const operations = data.operations.map((item) => ({
    ...item,
    label: operationLabel(t, item.operationKey, item.label),
    buckets: item.buckets.map((bucket) => ({
      ...bucket,
      label: bucketLabel(t, item.operationKey, bucket.key, bucket.label),
    })),
  }));
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
        <p className="text-sm text-muted-foreground">{t.conditions.noneAvailable}</p>
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
    { value: DEFAULT_SCOPE, label: t.conditions.myDefault },
    ...data.clinics.map((clinic) => ({
      value: clinic.clinicId,
      label: `${clinic.name} (${clinic.clientName})`,
    })),
  ];

  const inheritanceNote = isDefaultScope
    ? t.conditions.inheritanceDefault
    : hasOverride
      ? t.conditions.inheritanceClinicOwn
      : t.conditions.inheritanceClinicInherits;

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
      setNotice(
        isDefaultScope ? t.conditions.notices.defaultSaved : t.conditions.notices.clinicSaved
      );
    } catch (cause) {
      setError(localizedError(cause, (t) => t.conditions.failures.saveConditions));
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
      setNotice(t.conditions.notices.typeSaved);
    } catch (cause) {
      setError(localizedError(cause, (t) => t.conditions.failures.saveType));
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
        isDefaultScope ? t.conditions.notices.defaultReset : t.conditions.notices.clinicInherits
      );
    } catch (cause) {
      setError(localizedError(cause, (t) => t.conditions.failures.resetConditions));
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
      setNotice(t.conditions.notices.typeDeleted);
    } catch (cause) {
      setError(localizedError(cause, (t) => t.conditions.failures.deleteType));
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
    setNotice(t.conditions.notices.typeCreated);
  }

  return (
    <div className="flex flex-col gap-6">
      {header}

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t.conditions.updateFailedTitle}</AlertTitle>
          <AlertDescription>{error.resolve(t)}</AlertDescription>
        </Alert>
      ) : null}

      {notice ? (
        <Alert>
          <AlertTitle>{t.conditions.updatedTitle}</AlertTitle>
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
            <h2 className="font-heading text-base leading-snug font-medium">
              {t.conditions.scopeTitle}
            </h2>
            <CardDescription>{t.conditions.scopeDescription}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <Field>
              <FieldLabel>{t.conditions.reportType}</FieldLabel>
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
                <SelectTrigger aria-label={t.conditions.reportType} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>{t.conditions.builtIn}</SelectLabel>
                    {operations.map((item) => (
                      <SelectItem key={item.operationKey} value={item.operationKey}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  {customTypes.length > 0 ? (
                    <SelectGroup>
                      <SelectLabel>{t.conditions.myReportTypes}</SelectLabel>
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
                {t.conditions.newReportType}
              </Button>
            </Field>

            {isCustom ? (
              <p className="text-xs text-muted-foreground">{t.conditions.customAppliesNote}</p>
            ) : (
              <Field>
                <FieldLabel>{t.conditions.appliesTo}</FieldLabel>
                <Select
                  items={scopeItems}
                  value={scope}
                  onValueChange={(value) => setScope(value ?? DEFAULT_SCOPE)}
                  disabled={saving}
                >
                  <SelectTrigger aria-label={t.conditions.appliesTo} className="w-full">
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

            <p className="text-xs text-muted-foreground">{t.conditions.changesNote}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-heading text-base leading-snug font-medium">
              {isCustom ? (customDraft?.name ?? "") : operation?.label}
            </h2>
            <CardDescription>
              {isCustom || (operation !== undefined && operation.buckets.length > 1)
                ? t.conditions.firstMatchDescription
                : t.conditions.dropDescription}
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
                      {t.common.cancel}
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => void handleDeleteCustom()}
                      disabled={saving}
                    >
                      {t.conditions.confirmDelete}
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => setConfirmingDelete(true)}
                    disabled={saving}
                  >
                    {t.conditions.deleteType}
                  </Button>
                )
              ) : canReset ? (
                <Button variant="outline" onClick={() => void handleReset()} disabled={saving}>
                  {t.conditions.resetToDefault}
                </Button>
              ) : null}
              <Button
                onClick={() => void (isCustom ? handleSaveCustom() : handleSaveBuiltin())}
                disabled={saving || overrideLoading || (isCustom && customDraft === undefined)}
              >
                {t.conditions.saveConditions}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
