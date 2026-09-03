import { useConvexAuth } from "@convex-dev/auth/react";
import type { FunctionReturnType } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { parseSpreadsheetId } from "@/lib/googleSheets";
import { ProtectedRoute } from "../auth/ProtectedRoute";

type ClinicList = FunctionReturnType<typeof api.clinics.list>;
type ClinicView = ClinicList["clinics"][number];
type ClientList = FunctionReturnType<typeof api.clinics.listClients>;
type ClientView = ClientList["clients"][number];

type ClinicFormValues = {
  name: string;
  sheetInput: string;
  clientId: string;
  externalClinicId: string;
  isActive: boolean;
};

const EMPTY_FORM: ClinicFormValues = {
  name: "",
  sheetInput: "",
  clientId: "",
  externalClinicId: "",
  isActive: true,
};

function ClinicForm({
  title,
  description,
  clients,
  initialValues,
  pending,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  title: string;
  description: string;
  clients: ClientView[];
  initialValues: ClinicFormValues;
  pending: boolean;
  submitLabel: string;
  onSubmit: (values: ClinicFormValues) => Promise<void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState(initialValues);
  const [validationError, setValidationError] = useState<string | null>(null);

  function update<K extends keyof ClinicFormValues>(key: K, value: ClinicFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError(null);

    const name = values.name.trim();
    const googleSheetId = parseSpreadsheetId(values.sheetInput);
    if (name === "") {
      setValidationError("Clinic name is required.");
      return;
    }
    if (googleSheetId === "") {
      setValidationError("Paste a Google Sheet URL or ID.");
      return;
    }
    if (values.clientId === "") {
      setValidationError("Choose a client.");
      return;
    }

    await onSubmit({ ...values, name, sheetInput: googleSheetId });
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-4 rounded-lg border bg-muted/30 p-4"
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="clinic-name">Clinic name</FieldLabel>
          <Input
            id="clinic-name"
            value={values.name}
            onChange={(event) => update("name", event.target.value)}
            disabled={pending}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="clinic-external-id">External clinic ID (optional)</FieldLabel>
          <Input
            id="clinic-external-id"
            value={values.externalClinicId}
            onChange={(event) => update("externalClinicId", event.target.value)}
            disabled={pending}
          />
        </Field>
        <Field className="md:col-span-2">
          <FieldLabel htmlFor="clinic-sheet">Google Sheet URL or ID</FieldLabel>
          <Input
            id="clinic-sheet"
            value={values.sheetInput}
            onChange={(event) => update("sheetInput", event.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/..."
            disabled={pending}
          />
        </Field>
        <Field>
          <FieldLabel>Client</FieldLabel>
          <Select
            value={values.clientId}
            onValueChange={(value) => update("clientId", value ?? "")}
            disabled={pending}
          >
            <SelectTrigger aria-label="Client" className="w-full">
              <SelectValue placeholder="Choose a client" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {clients.map((client) => (
                  <SelectItem key={client.clientId} value={client.clientId}>
                    {client.isActive ? client.name : `${client.name} (inactive)`}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field orientation="horizontal">
          <Switch
            id="clinic-active"
            checked={values.isActive}
            onCheckedChange={(checked) => update("isActive", checked)}
            disabled={pending}
          />
          <FieldLabel htmlFor="clinic-active">Active</FieldLabel>
        </Field>
      </div>
      {validationError ? <p className="text-sm text-destructive">{validationError}</p> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function PanelContent() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const ensureProfile = useMutation(api.staffAccounts.ensureCurrentProfile);
  const current = useQuery(api.staffAccounts.current, isAuthenticated ? {} : "skip");
  const canManage = current?.role === "admin" && current.status === "active";

  const clientsData = useQuery(api.clinics.listClients, canManage ? {} : "skip");
  const clinicsData = useQuery(api.clinics.list, canManage ? {} : "skip");
  const createClinic = useMutation(api.clinics.create);
  const updateClinic = useMutation(api.clinics.update);
  const removeClinic = useMutation(api.clinics.remove);
  const createClient = useMutation(api.clinics.createClient);

  const requestedProfile = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingClinicId, setPendingClinicId] = useState<Id<"clinics"> | null>(null);
  const [formMode, setFormMode] = useState<"closed" | "creating" | "editing">("closed");
  const [editingClinic, setEditingClinic] = useState<ClinicView | null>(null);
  const [newClientName, setNewClientName] = useState("");

  useEffect(() => {
    if (!isAuthenticated || current !== null || requestedProfile.current) return;

    requestedProfile.current = true;
    void ensureProfile({}).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Account setup failed.");
    });
  }, [current, ensureProfile, isAuthenticated]);

  function resetError() {
    setError(null);
  }

  function closeForm() {
    setFormMode("closed");
    setEditingClinic(null);
  }

  async function submitClinic(values: ClinicFormValues) {
    setIsSaving(true);
    resetError();
    try {
      const clientId = values.clientId as Id<"clients">;
      if (formMode === "editing" && editingClinic !== null) {
        await updateClinic({
          clinicId: editingClinic.clinicId,
          name: values.name,
          googleSheetId: values.sheetInput,
          clientId,
          externalClinicId: values.externalClinicId === "" ? null : values.externalClinicId,
          isActive: values.isActive,
        });
      } else {
        await createClinic({
          name: values.name,
          googleSheetId: values.sheetInput,
          clientId,
          externalClinicId: values.externalClinicId === "" ? undefined : values.externalClinicId,
          isActive: values.isActive,
        });
      }
      closeForm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Saving the clinic failed.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(clinic: ClinicView) {
    const confirmed = window.confirm(
      `Delete clinic "${clinic.name}"? Its column mappings and QA assignments are removed too.`
    );
    if (!confirmed) return;

    setPendingClinicId(clinic.clinicId);
    resetError();
    try {
      await removeClinic({ clinicId: clinic.clinicId });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Deleting the clinic failed.");
    } finally {
      setPendingClinicId(null);
    }
  }

  async function handleAddClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    resetError();
    try {
      await createClient({ name: newClientName });
      setNewClientName("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Creating the client failed.");
    } finally {
      setIsSaving(false);
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
        <AlertDescription>Your account cannot manage clinics.</AlertDescription>
      </Alert>
    );
  }

  const clients = clientsData?.clients ?? [];
  const isEditing = formMode === "editing";
  const formInitialValues: ClinicFormValues =
    isEditing && editingClinic !== null
      ? {
          name: editingClinic.name,
          sheetInput: editingClinic.googleSheetId,
          clientId: editingClinic.clientId,
          externalClinicId: editingClinic.externalClinicId ?? "",
          isActive: editingClinic.isActive,
        }
      : EMPTY_FORM;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Clients</CardTitle>
          <CardDescription>
            Clients are organizations that own one or more clinics, like a dental brand or support
            organization.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {clients.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No clients yet. Create the first one before adding clinics.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {clients.map((client) => (
                <Badge key={client.clientId} variant={client.isActive ? "secondary" : "outline"}>
                  {client.name}
                </Badge>
              ))}
            </div>
          )}
          <form onSubmit={(event) => void handleAddClient(event)} className="flex items-end gap-2">
            <Field className="w-56">
              <FieldLabel htmlFor="new-client-name">New client</FieldLabel>
              <Input
                id="new-client-name"
                value={newClientName}
                onChange={(event) => setNewClientName(event.target.value)}
                placeholder="e.g. Smilist"
                disabled={isSaving}
              />
            </Field>
            <Button type="submit" disabled={isSaving || newClientName.trim() === ""}>
              Add client
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Clinics</CardTitle>
          <CardDescription>
            Each clinic points to one Google Sheet that the reporting backend will read.
          </CardDescription>
          <CardAction>
            {formMode === "closed" ? (
              <Button
                onClick={() => {
                  resetError();
                  setEditingClinic(null);
                  setFormMode("creating");
                }}
              >
                Add clinic
              </Button>
            ) : null}
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Something went wrong</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {formMode !== "closed" ? (
            <ClinicForm
              key={isEditing && editingClinic ? editingClinic.clinicId : "creating"}
              title={isEditing ? "Edit clinic" : "New clinic"}
              description={
                isEditing ? "Update the clinic details." : "Paste the Google Sheet URL or ID."
              }
              clients={clients}
              initialValues={formInitialValues}
              pending={isSaving}
              submitLabel={isEditing ? "Save changes" : "Create clinic"}
              onSubmit={submitClinic}
              onCancel={closeForm}
            />
          ) : null}
          {clinicsData === undefined ? (
            <Skeleton className="h-64 w-full" />
          ) : clinicsData.clinics.length === 0 && formMode === "closed" ? (
            <p className="text-sm text-muted-foreground">
              No clinics yet. Create a client above, then add the first clinic.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Clinic</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Google Sheet</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clinicsData.clinics.map((clinic) => {
                  const isPending = pendingClinicId === clinic.clinicId;
                  return (
                    <TableRow key={clinic.clinicId}>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span>{clinic.name}</span>
                          {clinic.externalClinicId ? (
                            <span className="text-xs text-muted-foreground">
                              External ID {clinic.externalClinicId}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>{clinic.clientName}</TableCell>
                      <TableCell className="font-mono text-xs">{clinic.googleSheetId}</TableCell>
                      <TableCell>
                        <Badge variant={clinic.isActive ? "secondary" : "outline"}>
                          {clinic.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isPending}
                            onClick={() => {
                              resetError();
                              setEditingClinic(clinic);
                              setFormMode("editing");
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={isPending}
                            onClick={() => void handleDelete(clinic)}
                          >
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          {clinicsData?.hasMore ? (
            <p className="text-xs text-muted-foreground">
              Showing the first {clinicsData.limit} clinics.
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="flex justify-between gap-3">
          <Button variant="outline" render={<a href="/admin" />}>
            Manage accounts
          </Button>
          <Button variant="outline" render={<a href="/" />}>
            Back to app
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

export function ClinicsPanel({ convexUrl }: { convexUrl?: string }) {
  return (
    <ProtectedRoute convexUrl={convexUrl}>
      <PanelContent />
    </ProtectedRoute>
  );
}
