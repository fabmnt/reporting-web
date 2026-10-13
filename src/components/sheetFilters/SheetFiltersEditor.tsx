"use client";

import { useMutation, useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { useId, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { ConditionExpression } from "../../../convex/model/reportConditions";
import {
  MAX_SHEET_FILTER_DESCRIPTION_LENGTH,
  MAX_SHEET_FILTER_NAME_LENGTH,
  type SheetFilterDraft,
} from "../../../convex/model/sheetFilters";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
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
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n/context";
import { localizedError, type LocalizedMessage } from "@/lib/i18n/errors";

import { FilterExpressionEditor } from "./FilterExpressionEditor";

const EMPTY_EXPRESSION: ConditionExpression = { filters: [], groups: [] };

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function NewSheetFilterDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (sheetFilterId: Id<"sheetFilters">) => void;
}) {
  const { t } = useI18n();
  const create = useMutation(api.sheetFilters.create);
  const nameInputId = useId();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<LocalizedMessage | null>(null);

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      const created = await create({
        name,
        description: "",
        expression: EMPTY_EXPRESSION,
      });
      setName("");
      onCreated(created.sheetFilterId);
      onOpenChange(false);
    } catch (cause) {
      setError(localizedError(cause, (messages) => messages.sheetFilters.admin.failures.create));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setName("");
          setError(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.sheetFilters.admin.createTitle}</DialogTitle>
          <DialogDescription>{t.sheetFilters.admin.createDescription}</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor={nameInputId}>{t.sheetFilters.admin.name}</FieldLabel>
          <Input
            id={nameInputId}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={MAX_SHEET_FILTER_NAME_LENGTH}
            disabled={saving}
          />
        </Field>
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>{t.sheetFilters.admin.failures.title}</AlertTitle>
            <AlertDescription>{error.resolve(t)}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button onClick={() => void handleCreate()} disabled={saving || name.trim() === ""}>
            {t.sheetFilters.admin.newFilter}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SheetFiltersEditor() {
  const { t } = useI18n();
  const data = useQuery(api.sheetFilters.list, {});
  const save = useMutation(api.sheetFilters.save);
  const remove = useMutation(api.sheetFilters.remove);
  const nameInputId = useId();
  const descriptionInputId = useId();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, SheetFilterDraft | undefined>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<LocalizedMessage | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const filters = data?.filters ?? [];
  const selected = filters.find((item) => item.sheetFilterId === selectedId) ?? filters[0];
  const selectedKey = selected?.sheetFilterId ?? null;
  const storedDraft: SheetFilterDraft | undefined =
    selected === undefined
      ? undefined
      : {
          name: selected.name,
          description: selected.description,
          expression: selected.expression,
        };

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
      const saved = await save({
        sheetFilterId: selected.sheetFilterId,
        name: draft.name,
        description: draft.description,
        expression: { filters: draft.expression.filters, groups: [] },
      });
      setDrafts((previous) => ({
        ...previous,
        [saved.sheetFilterId]: {
          name: saved.name,
          description: saved.description,
          expression: saved.expression,
        },
      }));
      setNotice(t.sheetFilters.admin.notices.saved);
    } catch (cause) {
      setError(localizedError(cause, (messages) => messages.sheetFilters.admin.failures.save));
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
      await remove({ sheetFilterId: selected.sheetFilterId });
      setDrafts((previous) => {
        if (selectedKey === null) return previous;
        const next = { ...previous };
        delete next[selectedKey];
        return next;
      });
      setConfirmingDelete(false);
      setSelectedId(null);
      setNotice(t.sheetFilters.admin.notices.deleted);
    } catch (cause) {
      setError(localizedError(cause, (messages) => messages.sheetFilters.admin.failures.delete));
    } finally {
      setSaving(false);
    }
  }

  if (data === undefined) return <Skeleton className="h-80 w-full" />;

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t.sheetFilters.admin.failures.title}</AlertTitle>
          <AlertDescription>{error.resolve(t)}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <NewSheetFilterDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(sheetFilterId) => {
          setSelectedId(sheetFilterId);
          setConfirmingDelete(false);
          setNotice(t.sheetFilters.admin.notices.created);
        }}
      />

      {filters.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-4 py-6">
            <p className="text-sm text-muted-foreground">{t.sheetFilters.admin.empty}</p>
            <Button onClick={() => setCreating(true)} disabled={saving}>
              <Plus data-icon="inline-start" aria-hidden="true" />
              {t.sheetFilters.admin.newFilter}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start">
          <Card className="lg:sticky lg:top-20">
            <CardHeader>
              <h2 className="font-heading text-base leading-snug font-medium">
                {t.sheetFilters.apply.filter}
              </h2>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <Field>
                <Select
                  items={filters.map((item) => ({ value: item.sheetFilterId, label: item.name }))}
                  value={selected?.sheetFilterId ?? ""}
                  onValueChange={(value) => {
                    setSelectedId((value as string) ?? null);
                    setConfirmingDelete(false);
                  }}
                  disabled={saving}
                >
                  <SelectTrigger aria-label={t.sheetFilters.apply.filter} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {filters.map((item) => (
                        <SelectItem key={item.sheetFilterId} value={item.sheetFilterId}>
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
                  {t.sheetFilters.admin.newFilter}
                </Button>
              </Field>
              <Separator />
              <p className="text-xs text-muted-foreground">{t.sheetFilters.admin.intro}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="font-heading text-base leading-snug font-medium">
                {draft?.name ?? ""}
              </h2>
              {draft?.description ? <CardDescription>{draft.description}</CardDescription> : null}
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              {draft === undefined || selected === undefined ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor={nameInputId}>{t.sheetFilters.admin.name}</FieldLabel>
                      <Input
                        id={nameInputId}
                        value={draft.name}
                        maxLength={MAX_SHEET_FILTER_NAME_LENGTH}
                        disabled={saving}
                        onChange={(event) =>
                          setDrafts((previous) => ({
                            ...previous,
                            [selected.sheetFilterId]: { ...draft, name: event.target.value },
                          }))
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={descriptionInputId}>
                        {t.sheetFilters.admin.description}
                      </FieldLabel>
                      <Input
                        id={descriptionInputId}
                        value={draft.description}
                        maxLength={MAX_SHEET_FILTER_DESCRIPTION_LENGTH}
                        disabled={saving}
                        onChange={(event) =>
                          setDrafts((previous) => ({
                            ...previous,
                            [selected.sheetFilterId]: {
                              ...draft,
                              description: event.target.value,
                            },
                          }))
                        }
                      />
                    </Field>
                  </div>
                  <FilterExpressionEditor
                    expression={draft.expression}
                    disabled={saving}
                    onChange={(expression) =>
                      setDrafts((previous) => ({
                        ...previous,
                        [selected.sheetFilterId]: { ...draft, expression },
                      }))
                    }
                  />
                </>
              )}

              <div className="flex flex-col gap-3">
                {confirmingDelete ? (
                  <p className="text-sm text-muted-foreground">{t.sheetFilters.admin.deleteNote}</p>
                ) : null}
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
                        {t.sheetFilters.admin.confirmDelete}
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => setConfirmingDelete(true)}
                      disabled={saving || selected === undefined}
                    >
                      {t.sheetFilters.admin.delete}
                    </Button>
                  )}
                  <Button
                    onClick={() => void handleSave()}
                    disabled={saving || draft === undefined || selected === undefined}
                  >
                    {t.sheetFilters.admin.save}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
