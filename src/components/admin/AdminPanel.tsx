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

type StaffRole = "admin" | "operator" | "viewer";

export function AdminAccountsPanel() {
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
  const [error, setError] = useState<string | null>(null);

  async function updateRole(profileId: Id<"staffProfiles">, role: StaffRole) {
    setError(null);
    setPendingProfileId(profileId);
    try {
      await setRole({ profileId, role });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Role update failed.");
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
      setError(cause instanceof Error ? cause.message : "Status update failed.");
    } finally {
      setPendingProfileId(null);
    }
  }

  function startClinicAssignment(
    profileId: Id<"staffProfiles">,
    assignedClinicIds: Id<"clinics">[]
  ) {
    setError(null);
    setEditingProfileId(profileId);
    setDraftClinicIds(assignedClinicIds);
  }

  function toggleDraftClinic(clinicId: Id<"clinics">) {
    setDraftClinicIds((current) =>
      current.includes(clinicId) ? current.filter((id) => id !== clinicId) : [...current, clinicId]
    );
  }

  function cancelClinicAssignment() {
    setEditingProfileId(null);
    setDraftClinicIds([]);
  }

  async function saveClinicAssignment() {
    if (!editingProfileId) return;
    setError(null);
    setPendingProfileId(editingProfileId);
    try {
      await setAssignedClinics({ profileId: editingProfileId, clinicIds: draftClinicIds });
      cancelClinicAssignment();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Clinic assignment failed.");
    } finally {
      setPendingProfileId(null);
    }
  }

  const header = (
    <PageHeader
      title="Accounts"
      description="Enable new accounts and assign the minimum role each person needs."
    />
  );

  if (current === undefined) return <Skeleton className="h-80 w-full" />;

  if (!canManage) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <AdminTabs />
        <Alert variant="destructive">
          <AlertTitle>Administrator access required</AlertTitle>
          <AlertDescription>Your account cannot manage other users.</AlertDescription>
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
          <AlertTitle>Update failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-heading text-base font-medium">Staff accounts</h2>
          <p className="text-xs text-muted-foreground">
            Showing up to {managed?.limit ?? 100} accounts.
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
                    <TableHead>Account</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Clinics</TableHead>
                    <TableHead>Enabled</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {managed.accounts.map((account) => {
                    const isPending = pendingProfileId === account.profileId;
                    const assignedCount = account.assignedClinicIds.length;
                    const allClinicsAdmin =
                      account.role === "admin" && assignedCount === 0 ? "All" : assignedCount;
                    return (
                      <TableRow key={account.profileId}>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <span>{account.displayName}</span>
                            <span className="text-xs text-muted-foreground">{account.email}</span>
                            {account.isCurrentUser ? <Badge variant="outline">You</Badge> : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Select
                            items={[
                              { value: "admin", label: "Admin" },
                              { value: "operator", label: "Operator" },
                              { value: "viewer", label: "Viewer" },
                            ]}
                            value={account.role}
                            onValueChange={(role) => {
                              if (role) void updateRole(account.profileId, role as StaffRole);
                            }}
                            disabled={account.isCurrentUser || isPending}
                          >
                            <SelectTrigger aria-label={`Role for ${account.displayName}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                <SelectItem value="admin">Admin</SelectItem>
                                <SelectItem value="operator">Operator</SelectItem>
                                <SelectItem value="viewer">Viewer</SelectItem>
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
                              disabled={isPending}
                              onClick={() =>
                                startClinicAssignment(account.profileId, account.assignedClinicIds)
                              }
                            >
                              Assign
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
                              {account.status === "active" ? "Enabled" : "Disabled"}
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
        onOpenChange={(open) => {
          if (!open) cancelClinicAssignment();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Assign clinics</DialogTitle>
            <DialogDescription>
              {editingAccount
                ? `${editingAccount.displayName} runs reports only on the clinics you select.`
                : "Choose which clinics this account can run reports on."}{" "}
              Admins with no assignments run every active clinic.
            </DialogDescription>
          </DialogHeader>
          <div className="flex max-h-72 flex-col gap-3 overflow-y-auto">
            {clinicDirectory === undefined ? (
              <Skeleton className="h-40 w-full" />
            ) : clinicDirectory.clinics.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No clinics yet. Add clinics before assigning them.
              </p>
            ) : (
              clinicDirectory.clinics.map((clinic) => (
                <label
                  key={clinic.clinicId}
                  className="flex cursor-pointer items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={draftClinicIds.includes(clinic.clinicId)}
                    onChange={() => toggleDraftClinic(clinic.clinicId)}
                    className="size-4 accent-primary"
                  />
                  <span>
                    {clinic.name} <span aria-hidden="true">·</span> {clinic.clientName}
                  </span>
                </label>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={cancelClinicAssignment}>
              Cancel
            </Button>
            <Button
              onClick={() => void saveClinicAssignment()}
              disabled={pendingProfileId === editingProfileId}
            >
              Save clinics
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
