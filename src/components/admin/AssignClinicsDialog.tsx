import type { FunctionReturnType } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import { useRef, useState } from "react";

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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatSheetColumnSummary } from "@/lib/clinicSheetColumns";
import { useI18n } from "@/lib/i18n/context";
import { localizedError, type LocalizedMessage } from "@/lib/i18n/errors";

type ClientClinicList = FunctionReturnType<typeof api.clinics.listByClient>;
type ClientClinicView = ClientClinicList["clinics"][number];

// The same fields the clinics tab searches on. The client is left out because
// every clinic here belongs to the one client the dialog was opened for.
function matchesSearch(clinic: ClientClinicView, needle: string): boolean {
  return [clinic.name, clinic.externalClinicId, clinic.googleSheetId].some((value) =>
    value.toLowerCase().includes(needle)
  );
}

/** One clinic of the dialog's client, as the clinics tab lists it. */
function ClinicOption({
  clinic,
  checked,
  disabled,
  onToggle,
}: {
  clinic: ClientClinicView;
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
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{clinic.name}</span>
          <Badge variant={clinic.isActive ? "secondary" : "outline"}>
            {clinic.isActive ? t.common.active : t.common.inactive}
          </Badge>
        </span>
        <span className="truncate font-mono text-xs text-muted-foreground">
          {t.clinics.externalId(clinic.externalClinicId)} · {clinic.googleSheetId} ·{" "}
          {formatSheetColumnSummary(clinic.sheetColumns)}
        </span>
      </span>
    </label>
  );
}

/**
 * Changes which of one client's clinics an account runs reports on. Only the
 * ticks the admin moved are sent: the account keeps every other client, and the
 * clinics this dialog cannot show or tick keep the assignment they had. The
 * ticks start as what the account holds of this client.
 */
export function AssignClinicsDialog({
  client,
  onClose,
}: {
  client: { clientId: Id<"clients">; name: string };
  onClose: () => void;
}) {
  const { t } = useI18n();
  const clinicsData = useQuery(api.clinics.listByClient, { clientId: client.clientId });
  const accountsData = useQuery(api.staffAccounts.listManaged, {});
  const setClientAssignment = useMutation(api.staffAccounts.setClientAssignment);

  const [profileId, setProfileId] = useState("");
  const [selected, setSelected] = useState<Set<Id<"clinics">>>(new Set());
  const [search, setSearch] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<LocalizedMessage | null>(null);
  // The select-all box also reports that only some of the listed clinics are ticked.
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  const accounts = accountsData?.accounts ?? [];
  const clinics = clinicsData?.clinics ?? [];
  // A report reads active clinics only, so an inactive one is listed but never
  // assignable, and the backend refuses it if it is sent anyway.
  const assignable = clinics.filter((clinic) => clinic.isActive);
  const needle = search.trim().toLowerCase();
  const listed =
    needle === "" ? clinics : clinics.filter((clinic) => matchesSearch(clinic, needle));
  const listedAssignable = listed.filter((clinic) => clinic.isActive);
  const allListedSelected =
    listedAssignable.length > 0 &&
    listedAssignable.every((clinic) => selected.has(clinic.clinicId));
  const isLocked = isSaving || profileId === "";

  function chooseAccount(nextProfileId: string) {
    const account = accounts.find((entry) => entry.profileId === nextProfileId);
    const assigned = new Set<Id<"clinics">>(account?.assignedClinicIds ?? []);
    setProfileId(nextProfileId);
    setSelected(
      new Set(
        assignable
          .filter((clinic) => assigned.has(clinic.clinicId))
          .map((clinic) => clinic.clinicId)
      )
    );
  }

  function toggleClinic(clinicId: Id<"clinics">) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(clinicId)) {
        next.delete(clinicId);
      } else {
        next.add(clinicId);
      }
      return next;
    });
  }

  // A search leaves clinics out of sight, so the box only covers the ones on
  // screen and never changes a clinic the admin cannot see.
  function toggleListed() {
    setSelected((current) => {
      const next = new Set(current);
      for (const clinic of listedAssignable) {
        if (allListedSelected) {
          next.delete(clinic.clinicId);
        } else {
          next.add(clinic.clinicId);
        }
      }
      return next;
    });
  }

  async function save() {
    if (profileId === "" || isSaving) return;

    const account = accounts.find((entry) => entry.profileId === profileId);
    const assigned = new Set<Id<"clinics">>(account?.assignedClinicIds ?? []);

    setError(null);
    setIsSaving(true);
    try {
      await setClientAssignment({
        profileId: profileId as Id<"staffProfiles">,
        clientId: client.clientId,
        // Only what the dialog changes travels: a clinic it cannot show, or an
        // inactive one it cannot tick, keeps the assignment it had.
        addClinicIds: [...selected].filter((clinicId) => !assigned.has(clinicId)),
        removeClinicIds: assignable
          .filter((clinic) => assigned.has(clinic.clinicId) && !selected.has(clinic.clinicId))
          .map((clinic) => clinic.clinicId),
      });
      onClose();
    } catch (cause) {
      setError(localizedError(cause, (t) => t.admin.clients.assignDialog.saveFailed));
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
          <DialogTitle>{t.admin.clients.assignDialog.title}</DialogTitle>
          <DialogDescription>
            {t.admin.clients.assignDialog.descriptionFor(client.name)}
          </DialogDescription>
        </DialogHeader>

        {clinicsData === undefined || accountsData === undefined ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel>{t.admin.clients.assignDialog.user}</FieldLabel>
              <Select
                items={accounts.map((account) => ({
                  value: account.profileId,
                  label: account.displayName,
                }))}
                value={profileId}
                onValueChange={(value) => chooseAccount(value ?? "")}
                disabled={isSaving}
              >
                <SelectTrigger aria-label={t.admin.clients.assignDialog.user} className="w-full">
                  <SelectValue placeholder={t.admin.clients.assignDialog.chooseUser} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {accounts.map((account) => (
                      <SelectItem key={account.profileId} value={account.profileId}>
                        {account.displayName}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {accountsData.hasMore ? (
                <p className="text-xs text-muted-foreground">
                  {t.admin.clients.assignDialog.accountLimit(accountsData.limit)}
                </p>
              ) : null}
            </Field>

            <Field>
              <FieldLabel htmlFor="assign-clinic-search">
                {t.admin.clients.assignDialog.search}
              </FieldLabel>
              <Input
                id="assign-clinic-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                disabled={isSaving}
              />
            </Field>

            <div className="flex max-h-80 flex-col gap-3 overflow-y-auto">
              {clinics.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t.admin.clients.assignDialog.noneAvailable}
                </p>
              ) : listed.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t.admin.clients.assignDialog.noMatches}
                </p>
              ) : (
                <>
                  <label className="flex cursor-pointer items-center gap-3 text-sm font-medium has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
                    <input
                      type="checkbox"
                      // A callback ref re-runs on every render, which is what
                      // keeps the half-ticked state in step with the list.
                      ref={(node) => {
                        selectAllRef.current = node;
                        if (node) {
                          node.indeterminate =
                            listedAssignable.some((clinic) => selected.has(clinic.clinicId)) &&
                            !allListedSelected;
                        }
                      }}
                      checked={allListedSelected}
                      onChange={toggleListed}
                      disabled={isLocked || listedAssignable.length === 0}
                      className="size-4 shrink-0 accent-primary"
                    />
                    <span>{t.admin.clients.assignDialog.selectAll}</span>
                  </label>
                  {listed.map((clinic) => (
                    <ClinicOption
                      key={clinic.clinicId}
                      clinic={clinic}
                      checked={selected.has(clinic.clinicId)}
                      disabled={isLocked || !clinic.isActive}
                      onToggle={() => toggleClinic(clinic.clinicId)}
                    />
                  ))}
                </>
              )}
            </div>

            {clinics.length === 0 ? null : (
              <p className="text-xs text-muted-foreground tabular-nums">
                {t.admin.clients.assignDialog.selected(selected.size, assignable.length)}
              </p>
            )}
          </div>
        )}

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>{t.admin.clients.assignDialog.failedTitle}</AlertTitle>
            <AlertDescription>{error.resolve(t)}</AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            {t.common.cancel}
          </Button>
          <Button onClick={() => void save()} disabled={isLocked}>
            {t.admin.clients.assignDialog.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
