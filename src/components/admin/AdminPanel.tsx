import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { AdminTabs } from "@/components/app/AdminTabs";
import { PageHeader } from "@/components/app/PageHeader";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDocumentTitle, useI18n } from "@/lib/i18n/context";
import { localizedError, type LocalizedMessage } from "@/lib/i18n/errors";

type StaffRole = "admin" | "operator";

export function AdminAccountsPanel() {
  const { t } = useI18n();
  const setRole = useMutation(api.staffAccounts.setRole);
  const setStatus = useMutation(api.staffAccounts.setStatus);
  const setAssignedClinics = useMutation(api.staffAccounts.setAssignedClinics);
  const current = useQuery(api.staffAccounts.current, {});
  const canManage = current?.role === "admin" && current.status === "active";
  const managed = useQuery(api.staffAccounts.listManaged, canManage ? {} : "skip");
  const clinicDirectory = useQuery(api.clinics.list, canManage ? {} : "skip");
  const [pendingProfileId, setPendingProfileId] = useState<Id<"staffProfiles"> | null>(null);
  const [editingProfileId, setEditingProfileId] = useState<Id<"staffProfiles"> | null>(null);
  const [draftClinicIds, setDraftClinicIds] = useState<Id<"clinics">[]>([]);
  const [error, setError] = useState<LocalizedMessage | null>(null);
  const [assignmentError, setAssignmentError] = useState<LocalizedMessage | null>(null);
  const [isSavingAssignment, setIsSavingAssignment] = useState(false);

  async function updateRole(profileId: Id<"staffProfiles">, role: StaffRole) {
    setError(null);
    setPendingProfileId(profileId);
    try {
      await setRole({ profileId, role });
    } catch (cause) {
      setError(localizedError(cause, (t) => t.admin.accounts.failures.role));
    } finally {
      setPendingProfileId(null);
    }
  }

  async function updateStatus(profileId: Id<"staffProfiles">, isActive: boolean) {
    setError(null);
    setPendingProfileId(profileId);
    try {
      await setStatus({ profileId, status: isActive ? "active" : "disabled" });
    } catch (cause) {
      setError(localizedError(cause, (t) => t.admin.accounts.failures.status));
    } finally {
      setPendingProfileId(null);
    }
  }

  function startClinicAssignment(
    profileId: Id<"staffProfiles">,
    assignedClinicIds: Id<"clinics">[]
  ) {
    setError(null);
    setAssignmentError(null);
    setEditingProfileId(profileId);
    setDraftClinicIds(assignedClinicIds);
  }

  function toggleDraftClinic(clinicId: Id<"clinics">) {
    setDraftClinicIds((current) =>
      current.includes(clinicId) ? current.filter((id) => id !== clinicId) : [...current, clinicId]
    );
  }

  function resetClinicAssignment() {
    setEditingProfileId(null);
    setDraftClinicIds([]);
    setAssignmentError(null);
  }

  function cancelClinicAssignment() {
    if (isSavingAssignment) return;
    resetClinicAssignment();
  }

  async function saveClinicAssignment() {
    if (editingProfileId === null || isSavingAssignment) return;

    setError(null);
    setAssignmentError(null);
    setIsSavingAssignment(true);
    try {
      await setAssignedClinics({ profileId: editingProfileId, clinicIds: draftClinicIds });
      resetClinicAssignment();
    } catch (cause) {
      setAssignmentError(localizedError(cause, (t) => t.admin.accounts.failures.assignment));
    } finally {
      setIsSavingAssignment(false);
    }
  }

  useDocumentTitle(t.app.titles.accounts);

  const header = (
    <PageHeader title={t.admin.accounts.pageTitle} description={t.admin.accounts.pageDescription} />
  );

  if (current === undefined) return <Skeleton className="h-80 w-full" />;

  if (!canManage) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <AdminTabs />
        <Alert variant="destructive">
          <AlertTitle>{t.admin.accessDeniedTitle}</AlertTitle>
          <AlertDescription>{t.admin.accounts.accessDeniedBody}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const editingAccount =
    editingProfileId !== null
      ? (managed?.accounts.find((account) => account.profileId === editingProfileId) ?? null)
      : null;

  return (
    <div className="flex flex-col gap-6">
      {header}
      <AdminTabs />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t.admin.accounts.updateFailedTitle}</AlertTitle>
          <AlertDescription>{error.resolve(t)}</AlertDescription>
        </Alert>
      ) : null}

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-heading text-base font-medium">{t.admin.accounts.staffAccounts}</h2>
          <p className="text-xs text-muted-foreground">
            {t.admin.accounts.listing(managed?.limit ?? 100)}
          </p>
        </div>

        {managed === undefined || clinicDirectory === undefined ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <>
            <div className="overflow-hidden rounded-lg border">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead>{t.admin.accounts.table.account}</TableHead>
                    <TableHead>{t.admin.accounts.table.role}</TableHead>
                    <TableHead>{t.admin.accounts.table.clinics}</TableHead>
                    <TableHead>{t.admin.accounts.table.enabled}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {managed.accounts.map((account) => {
                    const isPending = pendingProfileId === account.profileId;
                    const assignedCount = account.assignedClinicIds.length;
                    const allClinicsAdmin =
                      account.role === "admin" && assignedCount === 0
                        ? t.admin.accounts.allClinics
                        : assignedCount;
                    return (
                      <TableRow key={account.profileId}>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <span>{account.displayName}</span>
                            <span className="text-xs text-muted-foreground">
                              {account.username}
                            </span>
                            {account.isCurrentUser ? (
                              <Badge variant="outline">{t.common.you}</Badge>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Select
                            items={[
                              { value: "admin", label: t.app.roles.admin },
                              { value: "operator", label: t.app.roles.operator },
                            ]}
                            value={account.role}
                            onValueChange={(role) => {
                              if (role) void updateRole(account.profileId, role as StaffRole);
                            }}
                            disabled={account.isCurrentUser || isPending}
                          >
                            <SelectTrigger
                              aria-label={t.admin.accounts.roleFor(account.displayName)}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                <SelectItem value="admin">{t.app.roles.admin}</SelectItem>
                                <SelectItem value="operator">{t.app.roles.operator}</SelectItem>
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="tabular-nums">
                              {allClinicsAdmin}
                            </Badge>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={isPending || isSavingAssignment}
                              onClick={() =>
                                startClinicAssignment(account.profileId, account.assignedClinicIds)
                              }
                            >
                              {t.admin.accounts.assign}
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Field
                            orientation="horizontal"
                            data-disabled={account.isCurrentUser || isPending}
                          >
                            <Switch
                              id={`status-${account.profileId}`}
                              checked={account.status === "active"}
                              onCheckedChange={(checked) =>
                                void updateStatus(account.profileId, checked)
                              }
                              disabled={account.isCurrentUser || isPending}
                            />
                            <FieldLabel htmlFor={`status-${account.profileId}`}>
                              {account.status === "active"
                                ? t.admin.accounts.enabled
                                : t.admin.accounts.disabled}
                            </FieldLabel>
                          </Field>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </section>

      <Dialog
        open={editingProfileId !== null}
        onOpenChange={(open, eventDetails) => {
          if (open) return;
          // The dialog owns an in-flight mutation. Dismissing it now would drop
          // the draft and could apply the result to a different profile's dialog.
          if (isSavingAssignment) {
            eventDetails.cancel();
            return;
          }
          cancelClinicAssignment();
        }}
      >
        <DialogContent className="sm:max-w-lg" showCloseButton={!isSavingAssignment}>
          <DialogHeader>
            <DialogTitle>{t.admin.accounts.assignment.title}</DialogTitle>
            <DialogDescription>
              {editingAccount
                ? t.admin.accounts.assignment.descriptionFor(editingAccount.displayName)
                : t.admin.accounts.assignment.descriptionGeneric}
            </DialogDescription>
          </DialogHeader>
          <div className="flex max-h-72 flex-col gap-3 overflow-y-auto">
            {clinicDirectory === undefined ? (
              <Skeleton className="h-40 w-full" />
            ) : clinicDirectory.clinics.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t.admin.accounts.assignment.noneAvailable}
              </p>
            ) : (
              clinicDirectory.clinics.map((clinic) => (
                <label
                  key={clinic.clinicId}
                  className="flex cursor-pointer items-center gap-2 text-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
                >
                  <input
                    type="checkbox"
                    checked={draftClinicIds.includes(clinic.clinicId)}
                    onChange={() => toggleDraftClinic(clinic.clinicId)}
                    disabled={isSavingAssignment}
                    className="size-4 accent-primary"
                  />
                  <span>
                    {clinic.name} <span aria-hidden="true">·</span> {clinic.clientName}
                  </span>
                </label>
              ))
            )}
          </div>
          {assignmentError ? (
            <Alert variant="destructive">
              <AlertTitle>{t.admin.accounts.assignment.failedTitle}</AlertTitle>
              <AlertDescription>{assignmentError.resolve(t)}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={cancelClinicAssignment}
              disabled={isSavingAssignment}
            >
              {t.common.cancel}
            </Button>
            <Button onClick={() => void saveClinicAssignment()} disabled={isSavingAssignment}>
              {t.admin.accounts.assignment.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
