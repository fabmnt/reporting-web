import type { FunctionReturnType } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import { ChevronRight } from "lucide-react";
import { useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n/context";
import { localizedError, type LocalizedMessage } from "@/lib/i18n/errors";
import { cn } from "@/lib/utils";

type ManagedAccountView = FunctionReturnType<
  typeof api.staffAccounts.listManaged
>["accounts"][number];
type ClientDirectoryView = FunctionReturnType<
  typeof api.clinics.listDirectoryByClient
>["clients"][number];
type DirectoryClinicView = ClientDirectoryView["clinics"][number];

/** One client of the directory with the clinics the dialog shows of it. */
type ListedClient = { client: ClientDirectoryView; clinics: DirectoryClinicView[] };

/**
 * The entries that are assigned first, keeping the order they came in. That
 * order is the name order the backend returned, so picking cannot re-sort it.
 */
function assignedFirst<T>(items: T[], isAssigned: (item: T) => boolean): T[] {
  return [...items.filter(isAssigned), ...items.filter((item) => !isAssigned(item))];
}

/** Whether the account holds any clinic of that client. */
function clientHasAssignment(client: ClientDirectoryView, assigned: Set<Id<"clinics">>): boolean {
  return client.clinics.some((clinic) => assigned.has(clinic.clinicId));
}

/**
 * The clients and clinics a search shows. A client whose own name matches keeps
 * all of its clinics, because the admin looking for a client is looking for
 * everything under it.
 */
function listFor(clients: ClientDirectoryView[], needle: string): ListedClient[] {
  if (needle === "") {
    return clients.map((client) => ({ client, clinics: client.clinics }));
  }

  const listed: ListedClient[] = [];
  for (const client of clients) {
    if (client.name.toLowerCase().includes(needle)) {
      listed.push({ client, clinics: client.clinics });
      continue;
    }
    const clinics = client.clinics.filter((clinic) => clinic.name.toLowerCase().includes(needle));
    if (clinics.length > 0) {
      listed.push({ client, clinics });
    }
  }
  return listed;
}

/** One clinic of the client, ticked when the account runs reports on it. */
function ClinicOption({
  clinic,
  checked,
  disabled,
  onToggle,
}: {
  clinic: DirectoryClinicView;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();

  return (
    <label className="flex cursor-pointer items-start gap-3 text-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        disabled={disabled}
        className="mt-0.5 size-4 shrink-0 accent-primary"
      />
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate" title={clinic.name}>
          {clinic.name}
        </span>
        {clinic.isActive ? null : <Badge variant="outline">{t.common.inactive}</Badge>}
      </span>
    </label>
  );
}

/**
 * One client of the directory with its clinics. The header box covers the
 * clinics this list shows and the account can hold, so a search never changes a
 * clinic that is out of sight.
 */
function ClientSection({
  client,
  clinics,
  selected,
  isOpen,
  disabled,
  onToggleOpen,
  onToggleClinics,
  onToggleClinic,
}: {
  client: ClientDirectoryView;
  clinics: DirectoryClinicView[];
  selected: Set<Id<"clinics">>;
  isOpen: boolean;
  disabled: boolean;
  onToggleOpen: () => void;
  onToggleClinics: (clinicIds: Id<"clinics">[]) => void;
  onToggleClinic: (clinicId: Id<"clinics">) => void;
}) {
  const { t } = useI18n();
  // An inactive clinic is not assignable, but a tick on one stays removable:
  // the account may hold it from before it was disabled, or the admin may have
  // ticked it just before it was. A report skips it either way, so the tick is
  // the only thing worth the control.
  const isTickable = (clinic: DirectoryClinicView) =>
    clinic.isActive || selected.has(clinic.clinicId);
  const tickable = clinics.filter(isTickable);
  const tickedHere = tickable.filter((clinic) => selected.has(clinic.clinicId));
  const allTicked = tickable.length > 0 && tickedHere.length === tickable.length;
  const assignedCount = clinics.filter((clinic) => selected.has(clinic.clinicId)).length;

  return (
    <section className="rounded-lg border">
      <div className="flex items-center gap-3 p-3">
        <input
          type="checkbox"
          // A callback ref re-runs on every render, which is what keeps the
          // half-ticked state in step with the list.
          ref={(node) => {
            if (node) {
              node.indeterminate = tickedHere.length > 0 && !allTicked;
            }
          }}
          checked={allTicked}
          onChange={() => onToggleClinics(tickable.map((clinic) => clinic.clinicId))}
          disabled={disabled || tickable.length === 0}
          aria-label={t.admin.accounts.assignments.selectAllFor(client.name)}
          className="size-4 shrink-0 accent-primary"
        />
        <button
          type="button"
          onClick={onToggleOpen}
          aria-expanded={isOpen}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronRight
            aria-hidden
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              isOpen && "rotate-90"
            )}
          />
          <span className="truncate text-sm font-medium" title={client.name}>
            {client.name}
          </span>
          {client.isActive ? null : <Badge variant="outline">{t.common.inactive}</Badge>}
          {assignedCount === 0 ? null : (
            <Badge variant="secondary">
              {t.admin.accounts.assignments.assignedCount(assignedCount)}
            </Badge>
          )}
          <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground tabular-nums">
            {t.admin.accounts.assignments.clinicsCount(clinics.length)}
          </span>
        </button>
      </div>
      {isOpen ? (
        <div className="flex flex-col gap-3 border-t p-3">
          {clinics.map((clinic) => (
            <ClinicOption
              key={clinic.clinicId}
              clinic={clinic}
              checked={selected.has(clinic.clinicId)}
              disabled={disabled || !isTickable(clinic)}
              onToggle={() => onToggleClinic(clinic.clinicId)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Changes which clinics one account runs reports on. The list holds the whole
 * directory, because the assignment spans clients: the clinics the account
 * already runs come first, grouped under their client, and the rest of the
 * directory follows under its own clients.
 *
 * Every client carries its whole set and every clinic its own tick, and a save
 * sends the difference against the assignment the dialog opened on. A clinic
 * the dialog cannot show or tick therefore keeps the assignment it had.
 */
export function AccountAssignmentsDialog({
  account,
  onClose,
}: {
  account: ManagedAccountView;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const directoryData = useQuery(api.clinics.listDirectoryByClient, {});
  const setAssignments = useMutation(api.staffAccounts.setAssignments);

  const [search, setSearch] = useState("");
  // The assignment the ticks start from, which is what a save diffs against: a
  // clinic another screen assigned while this dialog was open is not read as
  // one the admin unticked.
  const [initialAssigned] = useState<Set<Id<"clinics">>>(() => new Set(account.assignedClinicIds));
  const [selected, setSelected] = useState<Set<Id<"clinics">>>(
    () => new Set(account.assignedClinicIds)
  );
  // The clients the admin opened or closed. Unset follows the default: the
  // clients the account holds stay open, the rest stay closed.
  const [expandedOverride, setExpandedOverride] = useState<Set<Id<"clients">> | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<LocalizedMessage | null>(null);

  const clients = directoryData?.clients ?? [];
  const assignedClientIds = new Set(
    clients
      .filter((client) => clientHasAssignment(client, initialAssigned))
      .map((client) => client.clientId)
  );
  const expanded = expandedOverride ?? assignedClientIds;
  const needle = search.trim().toLowerCase();
  const sections = assignedFirst(listFor(clients, needle), ({ client }) =>
    clientHasAssignment(client, initialAssigned)
  ).map(({ client, clinics }) => ({
    client,
    clinics: assignedFirst(clinics, (clinic) => initialAssigned.has(clinic.clinicId)),
  }));
  const addClinicIds = [...selected].filter((clinicId) => !initialAssigned.has(clinicId));
  const removeClinicIds = [...initialAssigned].filter((clinicId) => !selected.has(clinicId));
  const hasChanges = addClinicIds.length > 0 || removeClinicIds.length > 0;

  function updateSearch(value: string) {
    setSearch(value);
    // A client the search finds opens itself, so its clinics can be ticked
    // without another click.
    const searchNeedle = value.trim().toLowerCase();
    if (searchNeedle === "") return;
    setExpandedOverride((current) => {
      const next = new Set(current ?? assignedClientIds);
      for (const { client } of listFor(clients, searchNeedle)) {
        next.add(client.clientId);
      }
      return next;
    });
  }

  function toggleExpanded(clientId: Id<"clients">) {
    setExpandedOverride((current) => {
      const next = new Set(current ?? assignedClientIds);
      if (next.has(clientId)) {
        next.delete(clientId);
      } else {
        next.add(clientId);
      }
      return next;
    });
  }

  function toggleClinics(clinicIds: Id<"clinics">[]) {
    // A failed save leaves its message on screen while the admin fixes the
    // ticks it complained about, so the next move clears it.
    setError(null);
    setSelected((current) => {
      const next = new Set(current);
      const everyTicked = clinicIds.every((clinicId) => next.has(clinicId));
      for (const clinicId of clinicIds) {
        if (everyTicked) {
          next.delete(clinicId);
        } else {
          next.add(clinicId);
        }
      }
      return next;
    });
  }

  async function save() {
    if (isSaving) return;

    setError(null);
    setIsSaving(true);
    try {
      await setAssignments({
        profileId: account.profileId,
        // Only what the dialog changes travels: a clinic it cannot show, one
        // that was disabled since it was listed, and one another screen
        // assigned while it was open all keep the assignment they had.
        addClinicIds,
        removeClinicIds,
      });
      onClose();
    } catch (cause) {
      setError(localizedError(cause, (t) => t.admin.accounts.assignments.saveFailed));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog
      open
      // A save in flight lands on whatever dialog is open when it settles, so
      // this one only closes from the request it owns.
      onOpenChange={(next, eventDetails) => {
        if (next) return;
        if (isSaving) {
          eventDetails.cancel();
          return;
        }
        onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl" showCloseButton={!isSaving}>
        <DialogHeader>
          <DialogTitle>{t.admin.accounts.assignments.title}</DialogTitle>
          <DialogDescription>
            {t.admin.accounts.assignments.descriptionFor(account.displayName)}
          </DialogDescription>
        </DialogHeader>

        {directoryData === undefined ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="account-assignments-search">
                {t.admin.accounts.assignments.search}
              </FieldLabel>
              <Input
                id="account-assignments-search"
                value={search}
                onChange={(event) => updateSearch(event.target.value)}
                disabled={isSaving}
              />
            </Field>

            <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
              {clients.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t.admin.accounts.assignments.noneAvailable}
                </p>
              ) : sections.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t.admin.accounts.assignments.noMatches}
                </p>
              ) : (
                sections.map(({ client, clinics }) => (
                  <ClientSection
                    key={client.clientId}
                    client={client}
                    clinics={clinics}
                    selected={selected}
                    isOpen={expanded.has(client.clientId)}
                    disabled={isSaving}
                    onToggleOpen={() => toggleExpanded(client.clientId)}
                    onToggleClinics={toggleClinics}
                    onToggleClinic={(clinicId) => toggleClinics([clinicId])}
                  />
                ))
              )}
            </div>

            <p className="text-xs text-muted-foreground tabular-nums">
              {t.admin.accounts.assignments.assignedCount(selected.size)}
            </p>
            {directoryData.hasMore ? (
              <p className="text-xs text-muted-foreground">
                {t.admin.accounts.assignments.incomplete(directoryData.limit)}
              </p>
            ) : null}
          </div>
        )}

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>{t.admin.accounts.assignments.failedTitle}</AlertTitle>
            <AlertDescription>{error.resolve(t)}</AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            {t.common.cancel}
          </Button>
          <Button onClick={() => void save()} disabled={isSaving || !hasChanges}>
            {t.admin.accounts.assignments.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
