import type { FunctionReturnType } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { useState, type SyntheticEvent } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { AdminTabs } from "@/components/app/AdminTabs";
import { DataCard, DataCardList, DataCardRow, DataTableFrame } from "@/components/app/DataCard";
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
  EMPTY_SHEET_COLUMN_FORM,
  formatSheetColumnSummary,
  sheetColumnsToFormValues,
  type SheetColumnFormValues,
} from "@/lib/clinicSheetColumns";
import { useDocumentTitle, useI18n } from "@/lib/i18n/context";
import { localizedError, localizedMessage, type LocalizedMessage } from "@/lib/i18n/errors";
import { SheetColumnFields } from "@/components/clinics/SheetColumnFields";

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

/** Shared by the client table and the narrow-screen cards. */
function ClientActions({
  client,
  disabled,
  onEdit,
  onDelete,
}: {
  client: ClientView;
  disabled: boolean;
  onEdit: (client: ClientView) => void;
  onDelete: (client: ClientView) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" disabled={disabled} onClick={() => onEdit(client)}>
        {t.common.edit}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        disabled={disabled}
        onClick={() => onDelete(client)}
      >
        {t.common.delete}
      </Button>
    </div>
  );
}

/** Shared by the clinic table and the narrow-screen cards. */
function ClinicActions({
  clinic,
  disabled,
  onEdit,
  onDelete,
}: {
  clinic: ClinicView;
  disabled: boolean;
  onEdit: (clinic: ClinicView) => void;
  onDelete: (clinic: ClinicView) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" disabled={disabled} onClick={() => onEdit(clinic)}>
        {t.common.edit}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        disabled={disabled}
        onClick={() => onDelete(clinic)}
      >
        {t.common.delete}
      </Button>
    </div>
  );
}

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
  error: LocalizedMessage | null;
  onConfirm: () => void;
}) {
  const { t } = useI18n();

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>{t.admin.clinics.delete.failedTitle}</AlertTitle>
            <AlertDescription>{error.resolve(t)}</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t.common.cancel}</AlertDialogCancel>
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
  error: LocalizedMessage | null;
  onSubmit: (values: ClientFormValues) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [values, setValues] = useState(initialValues);
  const [validationError, setValidationError] = useState<LocalizedMessage | null>(null);

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError(null);

    const name = values.name.trim();
    if (name === "") {
      setValidationError(localizedMessage((t) => t.admin.clinics.clientForm.nameRequired));
      return;
    }

    await onSubmit({ name, isActive: values.isActive });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>
              {isEditing
                ? t.admin.clinics.clientForm.editTitle
                : t.admin.clinics.clientForm.createTitle}
            </DialogTitle>
            <DialogDescription>{t.admin.clinics.clientForm.description}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="client-name">{t.admin.clinics.clientForm.name}</FieldLabel>
            <Input
              id="client-name"
              value={values.name}
              onChange={(event) =>
                setValues((current) => ({ ...current, name: event.target.value }))
              }
              placeholder={t.admin.clinics.clientForm.namePlaceholder}
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
            <FieldLabel htmlFor="client-active">{t.admin.clinics.clientForm.active}</FieldLabel>
          </Field>
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>{t.admin.clinics.clientForm.saveFailedTitle}</AlertTitle>
              <AlertDescription>{error.resolve(t)}</AlertDescription>
            </Alert>
          ) : null}
          <FieldError>{validationError?.resolve(t)}</FieldError>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {isEditing ? t.common.saveChanges : t.admin.clinics.clientForm.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
  error: LocalizedMessage | null;
  onSubmit: (values: ClinicFormValues) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [values, setValues] = useState(initialValues);
  const [validationError, setValidationError] = useState<LocalizedMessage | null>(null);

  function update<K extends keyof ClinicFormValues>(key: K, value: ClinicFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError(null);

    const name = values.name.trim();
    const googleSheetId = parseSpreadsheetId(values.sheetInput);
    if (name === "") {
      setValidationError(localizedMessage((t) => t.admin.clinics.clinicForm.nameRequired));
      return;
    }
    if (googleSheetId === "") {
      setValidationError(localizedMessage((t) => t.admin.clinics.clinicForm.invalidSheet));
      return;
    }
    if (values.clientId === "") {
      setValidationError(localizedMessage((t) => t.admin.clinics.clinicForm.clientRequired));
      return;
    }

    await onSubmit({ ...values, name, sheetInput: googleSheetId });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>
              {isEditing
                ? t.admin.clinics.clinicForm.editTitle
                : t.admin.clinics.clinicForm.createTitle}
            </DialogTitle>
            <DialogDescription>
              {isEditing
                ? t.admin.clinics.clinicForm.editDescription
                : t.admin.clinics.clinicForm.createDescription}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 md:gap-4">
            <Field>
              <FieldLabel htmlFor="clinic-name">{t.admin.clinics.clinicForm.name}</FieldLabel>
              <Input
                id="clinic-name"
                value={values.name}
                onChange={(event) => update("name", event.target.value)}
                disabled={pending}
              />
            </Field>
            <Field>
              <FieldLabel>{t.admin.clinics.clinicForm.client}</FieldLabel>
              <Select
                items={clients.map((client) => ({
                  value: client.clientId,
                  label: client.isActive
                    ? client.name
                    : `${client.name} ${t.admin.clinics.clinicForm.inactiveSuffix}`,
                }))}
                value={values.clientId}
                onValueChange={(value) => update("clientId", value ?? "")}
                disabled={pending}
              >
                <SelectTrigger aria-label={t.admin.clinics.clinicForm.client} className="w-full">
                  <SelectValue placeholder={t.admin.clinics.clinicForm.chooseClient} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {clients.map((client) => (
                      <SelectItem key={client.clientId} value={client.clientId}>
                        {client.isActive
                          ? client.name
                          : `${client.name} ${t.admin.clinics.clinicForm.inactiveSuffix}`}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field className="col-span-2">
              <FieldLabel htmlFor="clinic-sheet">
                {t.admin.clinics.clinicForm.sheetLabel}
              </FieldLabel>
              <Input
                id="clinic-sheet"
                value={values.sheetInput}
                onChange={(event) => update("sheetInput", event.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
                disabled={pending}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="clinic-external-id">
                {t.admin.clinics.clinicForm.externalId}
              </FieldLabel>
              <Input
                id="clinic-external-id"
                value={values.externalClinicId}
                onChange={(event) => update("externalClinicId", event.target.value)}
                disabled={pending}
              />
            </Field>
            <Field orientation="horizontal">
              <Switch
                id="clinic-active"
                checked={values.isActive}
                onCheckedChange={(checked) => update("isActive", checked)}
                disabled={pending}
              />
              <FieldLabel htmlFor="clinic-active">{t.admin.clinics.clinicForm.active}</FieldLabel>
            </Field>
          </div>
          <SheetColumnFields
            values={values.sheetColumns}
            onChange={(sheetColumns) => update("sheetColumns", sheetColumns)}
            disabled={pending}
          />
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>{t.admin.clinics.clinicForm.saveFailedTitle}</AlertTitle>
              <AlertDescription>{error.resolve(t)}</AlertDescription>
            </Alert>
          ) : null}
          <FieldError>{validationError?.resolve(t)}</FieldError>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {isEditing ? t.common.saveChanges : t.admin.clinics.clinicForm.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AdminClinicsPanel() {
  const { t } = useI18n();
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

  const [clinicFormError, setClinicFormError] = useState<LocalizedMessage | null>(null);
  const [clientFormError, setClientFormError] = useState<LocalizedMessage | null>(null);
  const [clinicDeleteError, setClinicDeleteError] = useState<LocalizedMessage | null>(null);
  const [clientDeleteError, setClientDeleteError] = useState<LocalizedMessage | null>(null);
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
      setClinicFormError(localizedError(cause, (t) => t.admin.clinics.clinicForm.saveFailed));
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
      setClientFormError(localizedError(cause, (t) => t.admin.clinics.clientForm.saveFailed));
    } finally {
      setIsSavingClient(false);
    }
  }

  function requestClinicDelete(clinic: ClinicView) {
    setClinicDeleteError(null);
    setClinicToDelete(clinic);
  }

  function requestClientDelete(client: ClientView) {
    setClientDeleteError(null);
    setClientToDelete(client);
  }

  async function confirmClinicDelete() {
    if (clinicToDelete === null) return;

    setPendingClinicId(clinicToDelete.clinicId);
    setClinicDeleteError(null);
    try {
      await removeClinic({ clinicId: clinicToDelete.clinicId });
      setClinicToDelete(null);
    } catch (cause) {
      setClinicDeleteError(localizedError(cause, (t) => t.admin.clinics.delete.clinicFailed));
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
      setClientDeleteError(localizedError(cause, (t) => t.admin.clinics.delete.clientFailed));
    } finally {
      setPendingClientId(null);
    }
  }

  useDocumentTitle(t.app.titles.clinics);

  const header = (
    <PageHeader
      title={t.admin.clinics.pageTitle}
      description={t.admin.clinics.pageDescription}
      actions={
        <Button onClick={openCreate}>
          <Plus aria-hidden="true" />
          {t.admin.clinics.addClinic}
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
          <AlertTitle>{t.admin.accessDeniedTitle}</AlertTitle>
          <AlertDescription>{t.admin.clinics.accessDeniedBody}</AlertDescription>
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
            <h2 className="font-heading text-base font-medium">{t.admin.clinics.clientsTitle}</h2>
            <p className="text-sm text-muted-foreground">{t.admin.clinics.clientsDescription}</p>
          </div>
          <Button variant="outline" onClick={openCreateClient}>
            <Plus data-icon="inline-start" />
            {t.admin.clinics.addClient}
          </Button>
        </div>

        {clientsData === undefined ? (
          <Skeleton className="h-40 w-full" />
        ) : clients.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.admin.clinics.noClients}</p>
        ) : (
          <>
            <DataTableFrame>
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead>{t.admin.clinics.clientTable.client}</TableHead>
                    <TableHead>{t.admin.clinics.clientTable.key}</TableHead>
                    <TableHead>{t.admin.clinics.clientTable.status}</TableHead>
                    <TableHead>{t.common.actions}</TableHead>
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
                            {client.isActive ? t.common.active : t.common.inactive}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <ClientActions
                            client={client}
                            disabled={isPending}
                            onEdit={openEditClient}
                            onDelete={requestClientDelete}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </DataTableFrame>

            <DataCardList>
              {clients.map((client) => (
                <DataCard
                  key={client.clientId}
                  title={client.name}
                  subtitle={client.key}
                  badge={
                    <Badge variant={client.isActive ? "secondary" : "outline"}>
                      {client.isActive ? t.common.active : t.common.inactive}
                    </Badge>
                  }
                >
                  <DataCardRow>
                    <ClientActions
                      client={client}
                      disabled={pendingClientId === client.clientId}
                      onEdit={openEditClient}
                      onDelete={requestClientDelete}
                    />
                  </DataCardRow>
                </DataCard>
              ))}
            </DataCardList>
          </>
        )}

        {clientsData?.hasMore ? (
          <p className="text-xs text-muted-foreground">
            {t.admin.clinics.clientsLimit(clientsData.limit)}
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-base font-medium">{t.admin.clinics.allClinicsTitle}</h2>
          <p className="text-sm text-muted-foreground">{t.admin.clinics.allClinicsDescription}</p>
        </div>

        {clinicsData === undefined ? (
          <Skeleton className="h-64 w-full" />
        ) : clinicsData.clinics.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.admin.clinics.noClinics}</p>
        ) : (
          <>
            <DataTableFrame>
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead>{t.admin.clinics.clinicTable.clinic}</TableHead>
                    <TableHead>{t.admin.clinics.clinicTable.client}</TableHead>
                    <TableHead>{t.admin.clinics.clinicTable.googleSheet}</TableHead>
                    <TableHead>{t.admin.clinics.clinicTable.columns}</TableHead>
                    <TableHead>{t.admin.clinics.clinicTable.status}</TableHead>
                    <TableHead>{t.common.actions}</TableHead>
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
                                {t.clinics.externalId(clinic.externalClinicId)}
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>{clinic.clientName}</TableCell>
                        <TableCell
                          className="max-w-48 truncate font-mono text-xs"
                          title={clinic.googleSheetId}
                        >
                          {clinic.googleSheetId}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {formatSheetColumnSummary(clinic.sheetColumns)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={clinic.isActive ? "secondary" : "outline"}>
                            {clinic.isActive ? t.common.active : t.common.inactive}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <ClinicActions
                            clinic={clinic}
                            disabled={isPending}
                            onEdit={openEdit}
                            onDelete={requestClinicDelete}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </DataTableFrame>

            <DataCardList>
              {clinicsData.clinics.map((clinic) => (
                <DataCard
                  key={clinic.clinicId}
                  title={clinic.name}
                  subtitle={
                    clinic.externalClinicId
                      ? t.clinics.externalId(clinic.externalClinicId)
                      : undefined
                  }
                  badge={
                    <Badge variant={clinic.isActive ? "secondary" : "outline"}>
                      {clinic.isActive ? t.common.active : t.common.inactive}
                    </Badge>
                  }
                >
                  <DataCardRow label={t.admin.clinics.clinicTable.client}>
                    <span className="truncate">{clinic.clientName}</span>
                  </DataCardRow>
                  <DataCardRow label={t.admin.clinics.clinicTable.googleSheet}>
                    <span className="truncate font-mono text-xs">{clinic.googleSheetId}</span>
                  </DataCardRow>
                  <DataCardRow label={t.admin.clinics.clinicTable.columns}>
                    <span className="truncate font-mono text-xs">
                      {formatSheetColumnSummary(clinic.sheetColumns)}
                    </span>
                  </DataCardRow>
                  <DataCardRow>
                    <ClinicActions
                      clinic={clinic}
                      disabled={pendingClinicId === clinic.clinicId}
                      onEdit={openEdit}
                      onDelete={requestClinicDelete}
                    />
                  </DataCardRow>
                </DataCard>
              ))}
            </DataCardList>
          </>
        )}

        {clinicsData?.hasMore ? (
          <p className="text-xs text-muted-foreground">
            {t.admin.clinics.clinicsLimit(clinicsData.limit)}
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
        title={t.admin.clinics.delete.clinicTitle}
        description={
          clinicToDelete ? t.admin.clinics.delete.clinicDescription(clinicToDelete.name) : ""
        }
        confirmLabel={t.admin.clinics.delete.deleteClinic}
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
        title={t.admin.clinics.delete.clientTitle}
        description={
          clientToDelete ? t.admin.clinics.delete.clientDescription(clientToDelete.name) : ""
        }
        confirmLabel={t.admin.clinics.delete.deleteClient}
        pending={pendingClientId !== null}
        error={clientDeleteError}
        onConfirm={() => void confirmClientDelete()}
      />
    </div>
  );
}
