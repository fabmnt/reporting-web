import { useMutation } from "convex/react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type SyntheticEvent } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { ConfirmDeleteDialog } from "@/components/admin/ConfirmDeleteDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { useI18n } from "@/lib/i18n/context";
import { localizedError, type LocalizedMessage } from "@/lib/i18n/errors";
import {
  byClient,
  groupClinicCount,
  type ClientEntry,
  type ReportClinic,
  type ReportGroup,
} from "@/lib/reportGroups";

// Creating, editing and deleting the report groups of the account, from the
// run form the groups are picked on.

/** One client and its clinics, with the client standing for all of them. */
function ClientPicker({
  entry,
  clientIds,
  clinicIds,
  disabled,
  onToggleClient,
  onToggleClinic,
}: {
  entry: ClientEntry;
  clientIds: ReadonlySet<Id<"clients">>;
  clinicIds: ReadonlySet<Id<"clinics">>;
  disabled: boolean;
  onToggleClient: (entry: ClientEntry) => void;
  onToggleClinic: (entry: ClientEntry, clinic: ReportClinic) => void;
}) {
  const whole = clientIds.has(entry.clientId);
  const partly = !whole && entry.clinics.some((clinic) => clinicIds.has(clinic.clinicId));

  return (
    <div className="flex flex-col gap-2">
      <label className="flex cursor-pointer items-center gap-3 text-sm font-medium has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
        <input
          type="checkbox"
          // A callback ref re-runs on every render, which is what keeps the
          // half-ticked state in step with the list.
          ref={(node) => {
            if (node) node.indeterminate = partly;
          }}
          checked={whole}
          onChange={() => onToggleClient(entry)}
          disabled={disabled}
          className="size-4 shrink-0 accent-primary"
        />
        <span className="min-w-0 flex-1 truncate" title={entry.clientName}>
          {entry.clientName}
        </span>
        <Badge variant="secondary" className="tabular-nums">
          {entry.clinics.length}
        </Badge>
      </label>
      <ul className="flex flex-col gap-2 pl-7">
        {entry.clinics.map((clinic) => (
          <li key={clinic.clinicId}>
            <label className="flex cursor-pointer items-center gap-3 text-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
              <input
                type="checkbox"
                checked={whole || clinicIds.has(clinic.clinicId)}
                onChange={() => onToggleClinic(entry, clinic)}
                disabled={disabled}
                className="size-4 shrink-0 accent-primary"
              />
              <span className="min-w-0 flex-1 truncate text-muted-foreground" title={clinic.name}>
                {clinic.name}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The name and members of one group. A member is a whole client or a single
 * clinic, and unticking one clinic of a whole client leaves the client out and
 * keeps the clinics that stay ticked.
 */
function GroupForm({
  group,
  entries,
  clinics,
  isSaving,
  onSavingChange,
  onSaved,
  onCancel,
}: {
  group: ReportGroup | null;
  entries: ClientEntry[];
  clinics: ReportClinic[];
  // The save in flight belongs to the dialog, not to the form: a request that
  // outlives the draft it was sent from would land on the next one.
  isSaving: boolean;
  onSavingChange: (saving: boolean) => void;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const createGroup = useMutation(api.reportGroups.create);
  const saveGroup = useMutation(api.reportGroups.save);

  const [name, setName] = useState(group?.name ?? "");
  const [clientIds, setClientIds] = useState(() => new Set(group?.clientIds ?? []));
  const [clinicIds, setClinicIds] = useState(() => new Set(group?.clinicIds ?? []));
  const [error, setError] = useState<LocalizedMessage | null>(null);

  const covered = clinics.filter(
    (clinic) => clientIds.has(clinic.clientId) || clinicIds.has(clinic.clinicId)
  ).length;

  function toggleClient(entry: ClientEntry) {
    const whole = clientIds.has(entry.clientId);
    setClientIds((current) => {
      const next = new Set(current);
      if (whole) {
        next.delete(entry.clientId);
      } else {
        next.add(entry.clientId);
      }
      return next;
    });
    // The clinics of a client that is held whole are covered by it, and the
    // ticks of a client that is dropped go with it.
    setClinicIds((current) => {
      const next = new Set(current);
      for (const clinic of entry.clinics) next.delete(clinic.clinicId);
      return next;
    });
  }

  function toggleClinic(entry: ClientEntry, clinic: ReportClinic) {
    if (clientIds.has(entry.clientId)) {
      setClientIds((current) => {
        const next = new Set(current);
        next.delete(entry.clientId);
        return next;
      });
      setClinicIds((current) => {
        const next = new Set(current);
        for (const other of entry.clinics) {
          if (other.clinicId !== clinic.clinicId) next.add(other.clinicId);
        }
        return next;
      });
      return;
    }

    setClinicIds((current) => {
      const next = new Set(current);
      if (next.has(clinic.clinicId)) {
        next.delete(clinic.clinicId);
      } else {
        next.add(clinic.clinicId);
      }
      return next;
    });
  }

  async function handleSubmit(event: SyntheticEvent) {
    event.preventDefault();
    if (isSaving) return;

    setError(null);
    onSavingChange(true);
    try {
      const members = { name, clientIds: [...clientIds], clinicIds: [...clinicIds] };
      if (group === null) {
        await createGroup(members);
      } else {
        await saveGroup({ groupId: group.groupId, ...members });
      }
      onSaved();
    } catch (cause) {
      setError(localizedError(cause, (t) => t.reports.groups.manager.saveFailed));
    } finally {
      onSavingChange(false);
    }
  }

  const canSave = name.trim() !== "" && covered > 0;

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>
          {group === null
            ? t.reports.groups.manager.formCreateTitle
            : t.reports.groups.manager.formEditTitle}
        </DialogTitle>
        <DialogDescription>{t.reports.groups.manager.formDescription}</DialogDescription>
      </DialogHeader>

      <Field>
        <FieldLabel htmlFor="report-group-name">{t.reports.groups.manager.name}</FieldLabel>
        <Input
          id="report-group-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t.reports.groups.manager.namePlaceholder}
          disabled={isSaving}
        />
      </Field>

      <Field>
        <FieldLabel>{t.reports.groups.manager.members}</FieldLabel>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.reports.groups.manager.noClinics}</p>
        ) : (
          <>
            <div className="flex max-h-72 flex-col gap-4 overflow-y-auto pr-1">
              {entries.map((entry) => (
                <ClientPicker
                  key={entry.clientId}
                  entry={entry}
                  clientIds={clientIds}
                  clinicIds={clinicIds}
                  disabled={isSaving}
                  onToggleClient={toggleClient}
                  onToggleClinic={toggleClinic}
                />
              ))}
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">
              {t.reports.groups.manager.covered(covered, clinics.length)}
            </p>
          </>
        )}
        <p className="text-xs text-muted-foreground">{t.reports.groups.manager.membersHint}</p>
      </Field>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t.reports.groups.manager.saveFailedTitle}</AlertTitle>
          <AlertDescription>{error.resolve(t)}</AlertDescription>
        </Alert>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSaving}>
          {t.common.cancel}
        </Button>
        <Button type="submit" disabled={isSaving || !canSave}>
          {group === null ? t.reports.groups.manager.create : t.common.saveChanges}
        </Button>
      </DialogFooter>
    </form>
  );
}

type DialogMode = { kind: "list" } | { kind: "create" } | { kind: "edit"; group: ReportGroup };

/**
 * The groups of the account: the list the run form picks from, and the form
 * that creates, edits and deletes them. It reads the same groups the run form
 * holds, so a change lands on both at once.
 */
export function ReportGroupsDialog({
  open,
  onOpenChange,
  groups,
  clinics,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: ReportGroup[];
  clinics: ReportClinic[];
}) {
  const { t } = useI18n();
  const removeGroup = useMutation(api.reportGroups.remove);

  const [mode, setMode] = useState<DialogMode>({ kind: "list" });
  const [groupToDelete, setGroupToDelete] = useState<ReportGroup | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<LocalizedMessage | null>(null);
  // A save in flight is the dialog's to wait for: it closes when the request
  // answers, so the answer cannot land on the draft of the next visit.
  const [isSaving, setIsSaving] = useState(false);

  const entries = byClient(clinics);

  function close() {
    setMode({ kind: "list" });
    onOpenChange(false);
  }

  async function handleDelete() {
    if (groupToDelete === null || isDeleting) return;

    setDeleteError(null);
    setIsDeleting(true);
    try {
      await removeGroup({ groupId: groupToDelete.groupId });
      setGroupToDelete(null);
    } catch (cause) {
      setDeleteError(localizedError(cause, (t) => t.reports.groups.manager.saveFailed));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next, eventDetails) => {
          if (next) return;
          // The close button, the overlay and the escape key all land here. A
          // dialog closed over a save it started would answer into the next
          // draft, so the save is waited out instead.
          if (isSaving) {
            eventDetails.cancel();
            return;
          }
          close();
        }}
      >
        <DialogContent className="sm:max-w-2xl" showCloseButton={!isSaving}>
          {mode.kind === "list" ? (
            <>
              <DialogHeader>
                <DialogTitle>{t.reports.groups.manager.title}</DialogTitle>
                <DialogDescription>{t.reports.groups.manager.description}</DialogDescription>
              </DialogHeader>

              <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
                {groups.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t.reports.groups.manager.empty}</p>
                ) : (
                  groups.map((group) => (
                    <div
                      key={group.groupId}
                      className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                    >
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium" title={group.name}>
                          {group.name}
                        </span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {t.reports.groups.count(groupClinicCount(clinics, group))}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${t.common.edit}: ${group.name}`}
                          onClick={() => setMode({ kind: "edit", group })}
                        >
                          <Pencil aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${t.common.delete}: ${group.name}`}
                          onClick={() => {
                            setDeleteError(null);
                            setGroupToDelete(group);
                          }}
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={close}>
                  {t.common.done}
                </Button>
                <Button type="button" onClick={() => setMode({ kind: "create" })}>
                  <Plus data-icon="inline-start" aria-hidden="true" />
                  {t.reports.groups.manager.newGroup}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <GroupForm
              // A new open starts from the group it edits, never from the draft
              // that was left behind.
              key={mode.kind === "edit" ? mode.group.groupId : "create"}
              group={mode.kind === "edit" ? mode.group : null}
              entries={entries}
              clinics={clinics}
              isSaving={isSaving}
              onSavingChange={setIsSaving}
              onSaved={() => setMode({ kind: "list" })}
              onCancel={() => setMode({ kind: "list" })}
            />
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={groupToDelete !== null}
        onOpenChange={(next) => {
          if (!next) {
            setGroupToDelete(null);
            setDeleteError(null);
          }
        }}
        title={t.reports.groups.manager.deleteTitle(groupToDelete?.name ?? "")}
        description={t.reports.groups.manager.deleteDescription}
        confirmLabel={t.common.delete}
        pending={isDeleting}
        error={deleteError}
        onConfirm={() => void handleDelete()}
      />
    </>
  );
}
