import { useConvexAuth } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

import { ProtectedRoute } from "../auth/ProtectedRoute";

type StaffRole = "admin" | "operator" | "viewer";

function PanelContent() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const ensureProfile = useMutation(api.staffAccounts.ensureCurrentProfile);
  const setRole = useMutation(api.staffAccounts.setRole);
  const setStatus = useMutation(api.staffAccounts.setStatus);
  const setAssignedClinics = useMutation(api.staffAccounts.setAssignedClinics);
  const current = useQuery(api.staffAccounts.current, isAuthenticated ? {} : "skip");
  const canManage = current?.role === "admin" && current.status === "active";
  const managed = useQuery(api.staffAccounts.listManaged, canManage ? {} : "skip");
  const clinicDirectory = useQuery(api.clinics.list, canManage ? {} : "skip");
  const requestedProfile = useRef(false);
  const [pendingProfileId, setPendingProfileId] = useState<Id<"staffProfiles"> | null>(null);
  const [editingProfileId, setEditingProfileId] = useState<Id<"staffProfiles"> | null>(null);
  const [draftClinicIds, setDraftClinicIds] = useState<Id<"clinics">[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || current !== null || requestedProfile.current) return;

    requestedProfile.current = true;
    void ensureProfile({}).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Account setup failed.");
    });
  }, [current, ensureProfile, isAuthenticated]);

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
      current.includes(clinicId)
        ? current.filter((id) => id !== clinicId)
        : [...current, clinicId]
    );
  }

  async function saveClinicAssignment() {
    if (!editingProfileId) return;
    setError(null);
    setPendingProfileId(editingProfileId);
    try {
      await setAssignedClinics({ profileId: editingProfileId, clinicIds: draftClinicIds });
      setEditingProfileId(null);
      setDraftClinicIds([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Clinic assignment failed.");
    } finally {
      setPendingProfileId(null);
    }
  }

  if (isLoading) {
    return <Skeleton className="h-80 w-full" />;
  }

  if (!isAuthenticated) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Sign-in required</AlertTitle>
        <AlertDescription>
          <a href="/sign-in">Sign in</a> with an administrator account.
        </AlertDescription>
      </Alert>
    );
  }

  if (current === undefined || current === null) {
    return <Skeleton className="h-80 w-full" />;
  }

  if (!canManage) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Administrator access required</AlertTitle>
        <AlertDescription>Your account cannot manage other users.</AlertDescription>
      </Alert>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account administration</CardTitle>
        <CardDescription>
          Enable new accounts and assign the minimum role each person needs.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Update failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {managed === undefined || clinicDirectory === undefined ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <>
            <Table>
              <TableHeader>
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
                          <Badge variant="secondary">{allClinicsAdmin}</Badge>
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
            {editingProfileId ? (
              <Card>
                <CardHeader>
                  <CardTitle>Assign clinics</CardTitle>
                  <CardDescription>
                    Operators run reports only on assigned clinics. Admins with no assignments can
                    run every active clinic.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex max-h-72 flex-col gap-2 overflow-y-auto">
                  {clinicDirectory.clinics.map((clinic) => {
                    const checked = draftClinicIds.includes(clinic.clinicId);
                    return (
                      <label
                        key={clinic.clinicId}
                        className="flex cursor-pointer items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleDraftClinic(clinic.clinicId)}
                        />
                        <span>
                          {clinic.name} · {clinic.clientName}
                        </span>
                      </label>
                    );
                  })}
                </CardContent>
                <CardFooter className="flex gap-2">
                  <Button
                    onClick={() => void saveClinicAssignment()}
                    disabled={pendingProfileId === editingProfileId}
                  >
                    Save clinics
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditingProfileId(null);
                      setDraftClinicIds([]);
                    }}
                  >
                    Cancel
                  </Button>
                </CardFooter>
              </Card>
            ) : null}
          </>
        )}
      </CardContent>
      <CardFooter className="flex justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Showing up to {managed?.limit ?? 100} accounts.
        </p>
        <div className="flex gap-3">
          <Button variant="outline" render={<a href="/admin/clinics" />}>
            Manage clinics
          </Button>
          <Button variant="outline" render={<a href="/" />}>
            Back to app
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

export function AdminPanel({ convexUrl }: { convexUrl?: string }) {
  return (
    <ProtectedRoute convexUrl={convexUrl}>
      <PanelContent />
    </ProtectedRoute>
  );
}
