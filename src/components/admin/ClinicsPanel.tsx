import type { FunctionReturnType } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { useState, type SyntheticEvent } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { AdminTabs } from "@/components/app/AdminTabs";
import { PageHeader } from "@/components/app/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
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
import {
  buildSheetColumnsInput,
  CLINIC_SHEET_COLUMN_DEFAULTS,
  EMPTY_SHEET_COLUMN_FORM,
  formatSheetColumnSummary,
  sheetColumnsToFormValues,
  type SheetColumnFormValues,
} from "@/lib/clinicSheetColumns";

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
  sheetColumns: SheetColumnFormValues;
};

const EMPTY_FORM: ClinicFormValues = {
  name: "",
  sheetInput: "",
  clientId: "",
  externalClinicId: "",
  isActive: true,
  sheetColumns: EMPTY_SHEET_COLUMN_FORM,
};

type ClientFormValues = {
  name: string;
  isActive: boolean;
};

const EMPTY_CLIENT_FORM: ClientFormValues = {
  name: "",
  isActive: true,
};

/**
 * Shared confirmation for irreversible actions. Stays open while the request
 * runs so a failure is readable, and closes only from the caller.
 */
function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pending,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Delete failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={pending} onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ClientForm({
  open,
  onOpenChange,
  isEditing,
  initialValues,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isEditing: boolean;
  initialValues: ClientFormValues;
  pending: boolean;
  error: string | null;
  onSubmit: (values: ClientFormValues) => Promise<void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState(initialValues);
  const [validationError, setValidationError] = useState<string | null>(null);

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError(null);

    const name = values.name.trim();
    if (name === "") {
      setValidationError("Client name is required.");
      return;
    }

    await onSubmit({ name, isActive: values.isActive });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit client" : "New client"}</DialogTitle>
            <DialogDescription>
              Clients are organizations that own one or more clinics, like a dental brand or support
              organization.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="client-name">Client name</FieldLabel>
            <Input
              id="client-name"
              value={values.name}
              onChange={(event) =>
                setValues((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="e.g. Smilist"
              disabled={pending}
            />
          </Field>
          <Field orientation="horizontal">
            <Switch
              id="client-active"
              checked={values.isActive}
              onCheckedChange={(checked) =>
                setValues((current) => ({ ...current, isActive: checked }))
              }
              disabled={pending}
            />
            <FieldLabel htmlFor="client-active">Active</FieldLabel>
          </Field>
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Could not save client</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <FieldError>{validationError}</FieldError>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {isEditing ? "Save changes" : "Create client"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SheetColumnFields({
  values,
  onChange,
  disabled,
}: {
  values: SheetColumnFormValues;
  onChange: (values: SheetColumnFormValues) => void;
  disabled: boolean;
}) {
  function update<K extends keyof SheetColumnFormValues>(key: K, value: SheetColumnFormValues[K]) {
    onChange({ ...values, [key]: value });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">Sheet columns</h3>
        <p className="text-xs text-muted-foreground">
          Leave a field empty to use the global default shown in the placeholder.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Field>
          <FieldLabel htmlFor="column-update-status">Update status</FieldLabel>
          <Input
            id="column-update-status"
            value={values.updateStatus}
            onChange={(event) => update("updateStatus", event.target.value.toUpperCase())}
            placeholder={CLINIC_SHEET_COLUMN_DEFAULTS.updateStatus}
            disabled={disabled}
            className="font-mono uppercase"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="column-upload-status">Upload status</FieldLabel>
          <Input
            id="column-upload-status"
            value={values.uploadStatus}
            onChange={(event) => update("uploadStatus", event.target.value.toUpperCase())}
            placeholder={CLINIC_SHEET_COLUMN_DEFAULTS.uploadStatus}
            disabled={disabled}
            className="font-mono uppercase"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="column-verification-type">Verification type</FieldLabel>
          <Input
            id="column-verification-type"
            value={values.verificationType}
            onChange={(event) => update("verificationType", event.target.value.toUpperCase())}
            placeholder={CLINIC_SHEET_COLUMN_DEFAULTS.verificationType}
            disabled={disabled}
            className="font-mono uppercase"
          />
        </Field>
      </div>
      <details className="rounded-md border px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium">Advanced columns</summary>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <Field>
            <FieldLabel htmlFor="column-file-url">File URL</FieldLabel>
            <Input
              id="column-file-url"
              value={values.fileUrl}
              onChange={(event) => update("fileUrl", event.target.value.toUpperCase())}
              placeholder={CLINIC_SHEET_COLUMN_DEFAULTS.fileUrl}
              disabled={disabled}
              className="font-mono uppercase"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="column-url">URL</FieldLabel>
            <Input
              id="column-url"
              value={values.url}
              onChange={(event) => update("url", event.target.value.toUpperCase())}
              placeholder={CLINIC_SHEET_COLUMN_DEFAULTS.url}
              disabled={disabled}
              className="font-mono uppercase"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="column-conditional-formatting">Conditional formatting</FieldLabel>
            <Input
              id="column-conditional-formatting"
              value={values.conditionalFormatting}
              onChange={(event) =>
                update("conditionalFormatting", event.target.value.toUpperCase())
              }
              placeholder={CLINIC_SHEET_COLUMN_DEFAULTS.conditionalFormatting}
              disabled={disabled}
              className="font-mono uppercase"
            />
          </Field>
        </div>
      </details>
    </div>
  );
}

function ClinicForm({
  open,
  onOpenChange,
  isEditing,
  clients,
  initialValues,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isEditing: boolean;
  clients: ClientView[];
  initialValues: ClinicFormValues;
  pending: boolean;
  error: string | null;
  onSubmit: (values: ClinicFormValues) => Promise<void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState(initialValues);
  const [validationError, setValidationError] = useState<string | null>(null);

  function update<K extends keyof ClinicFormValues>(key: K, value: ClinicFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit clinic" : "New clinic"}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? "Update clinic details and sheet column letters."
                : "Paste the Google Sheet URL or ID and set column letters if this clinic differs from the defaults."}
            </DialogDescription>
          </DialogHeader>
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
                items={clients.map((client) => ({
                  value: client.clientId,
                  label: client.isActive ? client.name : `${client.name} (inactive)`,
                }))}
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
          <SheetColumnFields
            values={values.sheetColumns}
            onChange={(sheetColumns) => update("sheetColumns", sheetColumns)}
            disabled={pending}
          />
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Could not save clinic</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <FieldError>{validationError}</FieldError>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {isEditing ? "Save changes" : "Create clinic"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AdminClinicsPanel() {
  const current = useQuery(api.staffAccounts.current, {});
  const canManage = current?.role === "admin" && current.status === "active";

  const clientsData = useQuery(api.clinics.listClients, canManage ? {} : "skip");
  const clinicsData = useQuery(api.clinics.list, canManage ? {} : "skip");
  const createClinic = useMutation(api.clinics.create);
  const updateClinic = useMutation(api.clinics.update);
  const removeClinic = useMutation(api.clinics.remove);
  const createClient = useMutation(api.clinics.createClient);
  const updateClient = useMutation(api.clinics.updateClient);
  const removeClient = useMutation(api.clinics.removeClient);

  const [clinicFormError, setClinicFormError] = useState<string | null>(null);
  const [clientFormError, setClientFormError] = useState<string | null>(null);
  const [clinicDeleteError, setClinicDeleteError] = useState<string | null>(null);
  const [clientDeleteError, setClientDeleteError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingClient, setIsSavingClient] = useState(false);
  const [pendingClinicId, setPendingClinicId] = useState<Id<"clinics"> | null>(null);
  const [pendingClientId, setPendingClientId] = useState<Id<"clients"> | null>(null);
  const [formMode, setFormMode] = useState<"closed" | "creating" | "editing">("closed");
  const [editingClinic, setEditingClinic] = useState<ClinicView | null>(null);
  const [clientFormMode, setClientFormMode] = useState<"closed" | "creating" | "editing">("closed");
  const [editingClient, setEditingClient] = useState<ClientView | null>(null);
  // Bumped on every open so the form remounts with fresh values. Cancelling a
  // draft must not leak into the next open.
  const [clinicFormSession, setClinicFormSession] = useState(0);
  const [clientFormSession, setClientFormSession] = useState(0);
  const [clinicToDelete, setClinicToDelete] = useState<ClinicView | null>(null);
  const [clientToDelete, setClientToDelete] = useState<ClientView | null>(null);

  function closeForm() {
    setFormMode("closed");
    setEditingClinic(null);
    setClinicFormError(null);
  }

  function openCreate() {
    setClinicFormError(null);
    setEditingClinic(null);
    setClinicFormSession((session) => session + 1);
    setFormMode("creating");
  }

  function openEdit(clinic: ClinicView) {
    setClinicFormError(null);
    setEditingClinic(clinic);
    setClinicFormSession((session) => session + 1);
    setFormMode("editing");
  }

  async function submitClinic(values: ClinicFormValues) {
    setIsSaving(true);
    setClinicFormError(null);
    try {
      const clientId = values.clientId as Id<"clients">;
      const sheetColumns = buildSheetColumnsInput(values.sheetColumns) ?? {};
      if (formMode === "editing" && editingClinic !== null) {
        await updateClinic({
          clinicId: editingClinic.clinicId,
          name: values.name,
          googleSheetId: values.sheetInput,
          clientId,
          externalClinicId: values.externalClinicId === "" ? null : values.externalClinicId,
          isActive: values.isActive,
          sheetColumns,
        });
      } else {
        await createClinic({
          name: values.name,
          googleSheetId: values.sheetInput,
          clientId,
          externalClinicId: values.externalClinicId === "" ? undefined : values.externalClinicId,
          isActive: values.isActive,
          sheetColumns,
        });
      }
      closeForm();
    } catch (cause) {
      setClinicFormError(cause instanceof Error ? cause.message : "Saving the clinic failed.");
    } finally {
      setIsSaving(false);
    }
  }

  function openCreateClient() {
    setClientFormError(null);
    setEditingClient(null);
    setClientFormSession((session) => session + 1);
    setClientFormMode("creating");
  }

  function openEditClient(client: ClientView) {
    setClientFormError(null);
    setEditingClient(client);
    setClientFormSession((session) => session + 1);
    setClientFormMode("editing");
  }

  function closeClientForm() {
    setClientFormMode("closed");
    setEditingClient(null);
    setClientFormError(null);
  }

  async function submitClient(values: ClientFormValues) {
    setIsSavingClient(true);
    setClientFormError(null);
    try {
      if (clientFormMode === "editing" && editingClient !== null) {
        await updateClient({
          clientId: editingClient.clientId,
          name: values.name,
          isActive: values.isActive,
        });
      } else {
        await createClient({ name: values.name });
      }
      closeClientForm();
    } catch (cause) {
      setClientFormError(cause instanceof Error ? cause.message : "Saving the client failed.");
    } finally {
      setIsSavingClient(false);
    }
  }

  async function confirmClinicDelete() {
    if (clinicToDelete === null) return;

    setPendingClinicId(clinicToDelete.clinicId);
    setClinicDeleteError(null);
    try {
      await removeClinic({ clinicId: clinicToDelete.clinicId });
      setClinicToDelete(null);
    } catch (cause) {
      setClinicDeleteError(cause instanceof Error ? cause.message : "Deleting the clinic failed.");
    } finally {
      setPendingClinicId(null);
    }
  }

  async function confirmClientDelete() {
    if (clientToDelete === null) return;

    setPendingClientId(clientToDelete.clientId);
    setClientDeleteError(null);
    try {
      await removeClient({ clientId: clientToDelete.clientId });
      setClientToDelete(null);
    } catch (cause) {
      setClientDeleteError(cause instanceof Error ? cause.message : "Deleting the client failed.");
    } finally {
      setPendingClientId(null);
    }
  }

  const header = (
    <PageHeader
      title="Clinics"
      description="Clients own clinics, and each clinic points to one Google Sheet the reporting backend reads."
      actions={
        <Button onClick={openCreate}>
          <Plus aria-hidden="true" />
          Add clinic
        </Button>
      }
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
          <AlertDescription>Your account cannot manage clinics.</AlertDescription>
        </Alert>
      </div>
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
          sheetColumns: sheetColumnsToFormValues(editingClinic.sheetColumns),
        }
      : EMPTY_FORM;

  return (
    <div className="flex flex-col gap-6">
      {header}
      <AdminTabs />

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="font-heading text-base font-medium">Clients</h2>
            <p className="text-sm text-muted-foreground">
              Organizations that own one or more clinics, like a dental brand or support
              organization.
            </p>
          </div>
          <Button variant="outline" onClick={openCreateClient}>
            <Plus data-icon="inline-start" />
            Add client
          </Button>
        </div>

        {clientsData === undefined ? (
          <Skeleton className="h-40 w-full" />
        ) : clients.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No clients yet. Create the first one before adding clinics.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.map((client) => {
                  const isPending = pendingClientId === client.clientId;
                  return (
                    <TableRow key={client.clientId}>
                      <TableCell>{client.name}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {client.key}
                      </TableCell>
                      <TableCell>
                        <Badge variant={client.isActive ? "secondary" : "outline"}>
                          {client.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isPending}
                            onClick={() => openEditClient(client)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            disabled={isPending}
                            onClick={() => {
                              setClientDeleteError(null);
                              setClientToDelete(client);
                            }}
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
          </div>
        )}

        {clientsData?.hasMore ? (
          <p className="text-xs text-muted-foreground">
            Showing the first {clientsData.limit} clients.
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-base font-medium">All clinics</h2>
          <p className="text-sm text-muted-foreground">
            Each clinic maps to one Google Sheet and the status columns inside it.
          </p>
        </div>

        {clinicsData === undefined ? (
          <Skeleton className="h-64 w-full" />
        ) : clinicsData.clinics.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No clinics yet. Create a client above, then add the first clinic.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead>Clinic</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Google Sheet</TableHead>
                  <TableHead>Columns</TableHead>
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
                      <TableCell className="font-mono text-xs">
                        {formatSheetColumnSummary(clinic.sheetColumns)}
                      </TableCell>
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
                            onClick={() => openEdit(clinic)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            disabled={isPending}
                            onClick={() => {
                              setClinicDeleteError(null);
                              setClinicToDelete(clinic);
                            }}
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
          </div>
        )}

        {clinicsData?.hasMore ? (
          <p className="text-xs text-muted-foreground">
            Showing the first {clinicsData.limit} clinics.
          </p>
        ) : null}
      </section>

      <ClinicForm
        key={`clinic-form-${clinicFormSession}`}
        open={formMode !== "closed"}
        onOpenChange={(open) => {
          if (!open) closeForm();
        }}
        isEditing={isEditing}
        clients={clients}
        initialValues={formInitialValues}
        pending={isSaving}
        error={clinicFormError}
        onSubmit={submitClinic}
        onCancel={closeForm}
      />

      <ClientForm
        key={`client-form-${clientFormSession}`}
        open={clientFormMode !== "closed"}
        onOpenChange={(open) => {
          if (!open) closeClientForm();
        }}
        isEditing={clientFormMode === "editing"}
        initialValues={
          clientFormMode === "editing" && editingClient !== null
            ? { name: editingClient.name, isActive: editingClient.isActive }
            : EMPTY_CLIENT_FORM
        }
        pending={isSavingClient}
        error={clientFormError}
        onSubmit={submitClient}
        onCancel={closeClientForm}
      />

      <ConfirmDeleteDialog
        open={clinicToDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setClinicToDelete(null);
            setClinicDeleteError(null);
          }
        }}
        title="Delete clinic"
        description={
          clinicToDelete
            ? `Delete "${clinicToDelete.name}"? Its sheet column mappings and any clinic assignments on staff accounts are removed too. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete clinic"
        pending={pendingClinicId !== null}
        error={clinicDeleteError}
        onConfirm={() => void confirmClinicDelete()}
      />

      <ConfirmDeleteDialog
        open={clientToDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setClientToDelete(null);
            setClientDeleteError(null);
          }
        }}
        title="Delete client"
        description={
          clientToDelete
            ? `Delete "${clientToDelete.name}"? This cannot be undone. A client can only be deleted once it owns no clinics.`
            : ""
        }
        confirmLabel="Delete client"
        pending={pendingClientId !== null}
        error={clientDeleteError}
        onConfirm={() => void confirmClientDelete()}
      />
    </div>
  );
}
