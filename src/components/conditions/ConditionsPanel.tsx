"use client";

import { useMutation, useQuery } from "convex/react";
import { useState, type ReactNode } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type {
  ImplementedOperationKey,
  PendingAuditConditions,
  ReadyToUploadConditions,
  ReportConditionSet,
} from "../../../convex/model/reportConditions";
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
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  hasEnabledCriterion,
  PENDING_AUDIT_CRITERIA,
  READY_TO_UPLOAD_CRITERIA,
} from "@/lib/reportConditions";
import { cn } from "@/lib/utils";

import { MarkerListField } from "./MarkerListField";

const DEFAULT_SCOPE = "default";

type ConditionCopy = { title: string; description: string };

function RuleCard({
  copy,
  enabled,
  onToggle,
  disabled,
  children,
}: {
  copy: ConditionCopy;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">{copy.title}</h3>
          <p className="text-xs text-muted-foreground">{copy.description}</p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          disabled={disabled}
          aria-label={`Enable ${copy.title}`}
        />
      </div>
      <div className={cn("flex flex-col gap-4", !enabled && "opacity-60")}>{children}</div>
    </div>
  );
}

const MATCH_ITEMS = [
  { value: "exact", label: "Exact value" },
  { value: "contains", label: "Contains value" },
];

function PendingAuditEditor({
  conditions,
  onChange,
  disabled,
}: {
  conditions: PendingAuditConditions;
  onChange: (conditions: ReportConditionSet) => void;
  disabled: boolean;
}) {
  const update = (patch: Partial<PendingAuditConditions>) => onChange({ ...conditions, ...patch });

  return (
    <div className="flex flex-col gap-4">
      <RuleCard
        copy={PENDING_AUDIT_CRITERIA.verificationType}
        enabled={conditions.verificationType.enabled}
        onToggle={(enabled) =>
          update({ verificationType: { ...conditions.verificationType, enabled } })
        }
        disabled={disabled}
      >
        <MarkerListField
          label="Verification values"
          values={conditions.verificationType.values}
          onChange={(values) =>
            update({ verificationType: { ...conditions.verificationType, values } })
          }
          disabled={disabled || !conditions.verificationType.enabled}
          emptyHint="An enabled rule with no values matches nothing."
        />
      </RuleCard>

      <RuleCard
        copy={PENDING_AUDIT_CRITERIA.executionHit}
        enabled={conditions.executionHit.enabled}
        onToggle={(enabled) => update({ executionHit: { ...conditions.executionHit, enabled } })}
        disabled={disabled}
      >
        <MarkerListField
          label="L done markers"
          values={conditions.executionHit.lDoneMarkers}
          onChange={(lDoneMarkers) =>
            update({ executionHit: { ...conditions.executionHit, lDoneMarkers } })
          }
          disabled={disabled || !conditions.executionHit.enabled}
          emptyHint="No done markers: this branch never matches."
        />
        <MarkerListField
          label="L check markers"
          values={conditions.executionHit.lCheckMarkers}
          onChange={(lCheckMarkers) =>
            update({ executionHit: { ...conditions.executionHit, lCheckMarkers } })
          }
          disabled={disabled || !conditions.executionHit.enabled}
          emptyHint="No check markers: this branch never matches."
        />
        <MarkerListField
          label="M not-found markers"
          values={conditions.executionHit.mNotFoundMarkers}
          onChange={(mNotFoundMarkers) =>
            update({ executionHit: { ...conditions.executionHit, mNotFoundMarkers } })
          }
          disabled={disabled || !conditions.executionHit.enabled}
          emptyHint="No not-found markers: the check branch never matches."
        />
      </RuleCard>

      <RuleCard
        copy={PENDING_AUDIT_CRITERIA.updateStatusExclude}
        enabled={conditions.updateStatusExclude.enabled}
        onToggle={(enabled) =>
          update({ updateStatusExclude: { ...conditions.updateStatusExclude, enabled } })
        }
        disabled={disabled}
      >
        <MarkerListField
          label="Excluded values"
          values={conditions.updateStatusExclude.markers}
          onChange={(markers) =>
            update({ updateStatusExclude: { ...conditions.updateStatusExclude, markers } })
          }
          disabled={disabled || !conditions.updateStatusExclude.enabled}
          emptyHint="Nothing is excluded."
        />
      </RuleCard>

      <RuleCard
        copy={PENDING_AUDIT_CRITERIA.uploadStatusAllowed}
        enabled={conditions.uploadStatusAllowed.enabled}
        onToggle={(enabled) =>
          update({ uploadStatusAllowed: { ...conditions.uploadStatusAllowed, enabled } })
        }
        disabled={disabled}
      >
        <Field>
          <FieldLabel>Match</FieldLabel>
          <Select
            items={MATCH_ITEMS}
            value={conditions.uploadStatusAllowed.match}
            onValueChange={(value) =>
              update({
                uploadStatusAllowed: {
                  ...conditions.uploadStatusAllowed,
                  match: (value as "exact" | "contains") ?? "exact",
                },
              })
            }
            disabled={disabled || !conditions.uploadStatusAllowed.enabled}
          >
            <SelectTrigger aria-label="Upload status match" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="exact">Exact value</SelectItem>
                <SelectItem value="contains">Contains value</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <MarkerListField
          label="Upload values"
          values={conditions.uploadStatusAllowed.values}
          onChange={(values) =>
            update({ uploadStatusAllowed: { ...conditions.uploadStatusAllowed, values } })
          }
          disabled={disabled || !conditions.uploadStatusAllowed.enabled}
          emptyHint="An enabled rule with no values matches nothing."
        />
      </RuleCard>
    </div>
  );
}

function ReadyToUploadEditor({
  conditions,
  onChange,
  disabled,
}: {
  conditions: ReadyToUploadConditions;
  onChange: (conditions: ReportConditionSet) => void;
  disabled: boolean;
}) {
  const update = (patch: Partial<ReadyToUploadConditions>) => onChange({ ...conditions, ...patch });

  const rules: Array<{
    copy: ConditionCopy;
    key:
      | "executionDone"
      | "updateStatusDone"
      | "uploadStatusTerminalExclude"
      | "uploadReady"
      | "uploadReview";
    label: string;
    emptyHint: string;
  }> = [
    {
      copy: READY_TO_UPLOAD_CRITERIA.executionDone,
      key: "executionDone",
      label: "Column L markers",
      emptyHint: "An enabled rule with no values matches nothing.",
    },
    {
      copy: READY_TO_UPLOAD_CRITERIA.updateStatusDone,
      key: "updateStatusDone",
      label: "Update status markers",
      emptyHint: "An enabled rule with no values matches nothing.",
    },
    {
      copy: READY_TO_UPLOAD_CRITERIA.uploadStatusTerminalExclude,
      key: "uploadStatusTerminalExclude",
      label: "Terminal values",
      emptyHint: "Nothing is dropped.",
    },
    {
      copy: READY_TO_UPLOAD_CRITERIA.uploadReady,
      key: "uploadReady",
      label: "Ready values",
      emptyHint: "No row goes to Ready to upload through this rule.",
    },
    {
      copy: READY_TO_UPLOAD_CRITERIA.uploadReview,
      key: "uploadReview",
      label: "Review values",
      emptyHint: "No row goes to Needs review through this rule.",
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {rules.map((rule) => {
        const current = conditions[rule.key];
        return (
          <RuleCard
            key={rule.key}
            copy={rule.copy}
            enabled={current.enabled}
            onToggle={(enabled) => update({ [rule.key]: { ...current, enabled } })}
            disabled={disabled}
          >
            <MarkerListField
              label={rule.label}
              values={current.markers}
              onChange={(markers) => update({ [rule.key]: { ...current, markers } })}
              disabled={disabled || !current.enabled}
              emptyHint={rule.emptyHint}
            />
          </RuleCard>
        );
      })}
    </div>
  );
}

function ConditionsEditor({
  initial,
  disabled,
  saving,
  canReset,
  onSave,
  onReset,
}: {
  initial: ReportConditionSet;
  disabled: boolean;
  saving: boolean;
  canReset: boolean;
  onSave: (conditions: ReportConditionSet) => void;
  onReset: () => void;
}) {
  const [conditions, setConditions] = useState<ReportConditionSet>(initial);
  const noCriteria = !hasEnabledCriterion(conditions);

  return (
    <div className="flex flex-col gap-6">
      {conditions.kind === "pending-audit" ? (
        <PendingAuditEditor conditions={conditions} onChange={setConditions} disabled={disabled} />
      ) : (
        <ReadyToUploadEditor conditions={conditions} onChange={setConditions} disabled={disabled} />
      )}

      {noCriteria ? (
        <Alert>
          <AlertTitle>No criteria enabled</AlertTitle>
          <AlertDescription>
            Every row in the date range will be returned. Enable at least one criterion to filter
            rows.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        {canReset ? (
          <Button variant="outline" onClick={onReset} disabled={disabled || saving}>
            Reset to default
          </Button>
        ) : null}
        <Button onClick={() => onSave(conditions)} disabled={disabled || saving}>
          Save conditions
        </Button>
      </div>
    </div>
  );
}

export function ConditionsPanel() {
  const current = useQuery(api.staffAccounts.current, {});
  const canConfigure =
    current?.status === "active" && (current.role === "admin" || current.role === "operator");
  const data = useQuery(api.reportConditions.listMine, canConfigure ? {} : "skip");
  const saveMine = useMutation(api.reportConditions.saveMine);
  const resetMine = useMutation(api.reportConditions.resetMine);

  const [operationKey, setOperationKey] = useState<ImplementedOperationKey>("pending-audit");
  const [scope, setScope] = useState<string>(DEFAULT_SCOPE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const header = (
    <PageHeader
      title="Configuration"
      description="Choose which sheet rows each report returns. These conditions apply to your account only."
    />
  );

  if (current === undefined) return <Skeleton className="h-80 w-full" />;

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

  if (data === undefined) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const operation =
    data.operations.find((item) => item.operationKey === operationKey) ?? data.operations[0];

  if (operation === undefined) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <p className="text-sm text-muted-foreground">No report conditions are available.</p>
      </div>
    );
  }

  const isDefaultScope = scope === DEFAULT_SCOPE;
  const override = isDefaultScope
    ? undefined
    : operation.overrides.find((item) => item.clinicId === scope);
  const canReset = isDefaultScope ? operation.default.isCustom : override !== undefined;
  const initial = override?.conditions ?? operation.default.conditions;
  const clinicId = isDefaultScope ? null : (scope as Id<"clinics">);

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

  async function handleSave(conditions: ReportConditionSet) {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await saveMine({ operationKey: operation.operationKey, clinicId, conditions });
      setNotice(isDefaultScope ? "Default conditions saved." : "Clinic conditions saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Saving the conditions failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await resetMine({ operationKey: operation.operationKey, clinicId });
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

  return (
    <div className="flex flex-col gap-6">
      {header}

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {notice ? (
        <Alert>
          <AlertTitle>Saved</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

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
                items={data.operations.map((item) => ({
                  value: item.operationKey,
                  label: item.label,
                }))}
                value={operation.operationKey}
                onValueChange={(value) =>
                  setOperationKey((value as ImplementedOperationKey) ?? "pending-audit")
                }
                disabled={saving}
              >
                <SelectTrigger aria-label="Report type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {data.operations.map((item) => (
                      <SelectItem key={item.operationKey} value={item.operationKey}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

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

            <Separator />

            <p className="text-xs text-muted-foreground">
              Changes only affect the reports you run.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-heading text-base leading-snug font-medium">{operation.label}</h2>
            <CardDescription>Row rules applied when you run this report.</CardDescription>
          </CardHeader>
          <CardContent>
            <ConditionsEditor
              key={`${operation.operationKey}-${String(scope)}-${JSON.stringify(initial)}`}
              initial={initial}
              disabled={saving}
              saving={saving}
              canReset={canReset}
              onSave={(conditions) => void handleSave(conditions)}
              onReset={() => void handleReset()}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
