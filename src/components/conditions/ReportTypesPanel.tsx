"use client";

import { useMutation, useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { ReportTypeDraft } from "../../../convex/model/reportTypes";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
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
import { useI18n } from "@/lib/i18n/context";
import { localizedError, type LocalizedMessage } from "@/lib/i18n/errors";

import { NewReportTypeDialog, type CreatedReportType } from "./NewReportTypeDialog";
import { ReportTypeEditor } from "./ReportTypeEditor";

// The two panels differ in which functions they may call: personal types
// belong to their owner, built-in types belong to the administrators.
export type ReportTypeScope = "mine" | "builtin";

// Both sides come from the same stored shape, so a small JSON comparison is
// enough to know when a query result has caught up with a saved draft.
function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function useScopeMutations(scope: ReportTypeScope) {
  const createMine = useMutation(api.reportTypes.createMine);
  const saveMine = useMutation(api.reportTypes.saveMine);
  const removeMine = useMutation(api.reportTypes.removeMine);
  const createBuiltin = useMutation(api.reportTypes.createBuiltin);
  const saveBuiltin = useMutation(api.reportTypes.saveBuiltin);
  const removeBuiltin = useMutation(api.reportTypes.removeBuiltin);

  if (scope === "mine") {
    return { create: createMine, save: saveMine, remove: removeMine };
  }
  return { create: createBuiltin, save: saveBuiltin, remove: removeBuiltin };
}

export function ReportTypesPanel({ scope }: { scope: ReportTypeScope }) {
  const { t } = useI18n();
  const mutations = useScopeMutations(scope);
  const data = useQuery(api.reportTypes.listRunnable, {});

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ReportTypeDraft | undefined>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<LocalizedMessage | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const types = (data?.types ?? []).filter((item) => item.owner === scope);
  const selected = types.find((item) => item.reportTypeId === selectedId) ?? types[0];
  const selectedKey = selected?.reportTypeId ?? null;

  const storedDraft: ReportTypeDraft | undefined =
    selected === undefined
      ? undefined
      : {
          name: selected.name,
          description: selected.description,
          buckets: selected.buckets,
          conditions: selected.conditions,
          usesVerificationFilter: selected.usesVerificationFilter,
        };

  // A draft only covers the gap between a save and the query catching up. Once
  // the stored value matches it, the draft is dropped so later server updates
  // stay visible and the next save cannot write stale data back.
  const draftEntry = selectedKey === null ? undefined : drafts[selectedKey];
  if (draftEntry !== undefined && storedDraft !== undefined && sameValue(draftEntry, storedDraft)) {
    const next = { ...drafts };
    if (selectedKey !== null) delete next[selectedKey];
    setDrafts(next);
  }
  const draft = draftEntry ?? storedDraft;

  async function handleSave() {
    if (selected === undefined || draft === undefined) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await mutations.save({
        reportTypeId: selected.reportTypeId,
        name: draft.name,
        description: draft.description,
        buckets: draft.buckets,
        conditions: draft.conditions,
        usesVerificationFilter: draft.usesVerificationFilter,
      });
      // Keep the cleaned value on screen until the query catches up, so the
      // form does not flash back to the previously stored value.
      setDrafts((previous) => ({
        ...previous,
        [saved.reportTypeId]: {
          name: saved.name,
          description: saved.description,
          buckets: saved.buckets,
          conditions: saved.conditions,
          usesVerificationFilter: saved.usesVerificationFilter,
        },
      }));
      setNotice(t.conditions.notices.saved);
    } catch (cause) {
      setError(localizedError(cause, (t) => t.conditions.failures.saveType));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (selected === undefined) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await mutations.remove({ reportTypeId: selected.reportTypeId });
      setDrafts((previous) => {
        if (selectedKey === null) return previous;
        const next = { ...previous };
        delete next[selectedKey];
        return next;
      });
      setConfirmingDelete(false);
      setSelectedId(null);
      setNotice(t.conditions.notices.deleted);
    } catch (cause) {
      setError(localizedError(cause, (t) => t.conditions.failures.deleteType));
    } finally {
      setSaving(false);
    }
  }

  function handleCreated(created: CreatedReportType) {
    setDrafts((previous) => ({
      ...previous,
      [created.reportTypeId]: {
        name: created.name,
        description: created.description,
        buckets: created.buckets,
        conditions: created.conditions,
        usesVerificationFilter: created.usesVerificationFilter,
      },
    }));
    setSelectedId(created.reportTypeId);
    setConfirmingDelete(false);
    setNotice(t.conditions.notices.created);
  }

  if (data === undefined) return <Skeleton className="h-80 w-full" />;

  const isEmpty = types.length === 0;

  return (
    <div className="flex flex-col gap-6">
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
        scope={scope}
        // Copying takes the stored rules and the engine of another type, so a
        // carrier report is a starting point like any other. Every runnable
        // name still counts for the duplicate check below.
        sources={data.types.map((item) => ({
          reportTypeId: item.reportTypeId,
          name: item.name,
        }))}
        existingNames={data.types.filter((item) => item.owner === scope).map((item) => item.name)}
        open={creating}
        onOpenChange={setCreating}
        onCreated={handleCreated}
        disabled={saving}
      />

      {isEmpty ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-4 py-6">
            <p className="text-sm text-muted-foreground">
              {scope === "mine" ? t.conditions.noneMine : t.conditions.noneBuiltin}
            </p>
            <Button onClick={() => setCreating(true)} disabled={saving}>
              <Plus data-icon="inline-start" aria-hidden="true" />
              {t.conditions.newReportType}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start">
          <Card className="lg:sticky lg:top-20">
            <CardHeader>
              <h2 className="font-heading text-base leading-snug font-medium">
                {t.conditions.reportType}
              </h2>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <Field>
                <Select
                  items={types.map((item) => ({
                    value: item.reportTypeId,
                    label: item.name,
                  }))}
                  value={selected?.reportTypeId ?? ""}
                  onValueChange={(value) => {
                    setSelectedId((value as string) ?? null);
                    setConfirmingDelete(false);
                  }}
                  disabled={saving}
                >
                  <SelectTrigger aria-label={t.conditions.reportType} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {types.map((item) => (
                        <SelectItem key={item.reportTypeId} value={item.reportTypeId}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
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

              <Separator />

              <p className="text-xs text-muted-foreground">
                {scope === "mine" ? t.conditions.appliesNote : t.conditions.sharedNote}
              </p>
              <p className="text-xs text-muted-foreground">{t.conditions.changesNote}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="font-heading text-base leading-snug font-medium">
                {draft?.name ?? ""}
              </h2>
              <CardDescription>
                {selected?.engine === "execute"
                  ? t.conditions.executeNote
                  : draft !== undefined && draft.buckets.length > 1
                    ? t.conditions.firstMatchDescription
                    : t.conditions.dropDescription}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              {draft === undefined ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <ReportTypeEditor
                  draft={draft}
                  engine={selected?.engine ?? "rows"}
                  onChange={(next) => {
                    if (selectedKey === null) return;
                    setDrafts((previous) => ({ ...previous, [selectedKey]: next }));
                  }}
                  disabled={saving}
                />
              )}

              <div className="flex flex-wrap justify-end gap-2">
                {confirmingDelete ? (
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
                      onClick={() => void handleDelete()}
                      disabled={saving}
                    >
                      {t.conditions.confirmDelete}
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => setConfirmingDelete(true)}
                    disabled={saving || selected === undefined}
                  >
                    {t.conditions.deleteType}
                  </Button>
                )}
                <Button
                  onClick={() => void handleSave()}
                  disabled={saving || draft === undefined || selected === undefined}
                >
                  {t.conditions.saveType}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
