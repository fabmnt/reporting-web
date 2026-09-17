import type { FunctionReturnType } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { useState, type SyntheticEvent } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { ConfirmDeleteDialog } from "@/components/admin/ConfirmDeleteDialog";
import { AdminTabs } from "@/components/app/AdminTabs";
import { DataCard, DataCardList, DataCardRow, DataTableFrame } from "@/components/app/DataCard";
import { TruncatedText } from "@/components/app/TruncatedText";
import { PageHeader } from "@/components/app/PageHeader";
import { StatusFilterSelect } from "@/components/app/StatusFilterSelect";
import { TablePagination } from "@/components/app/TablePagination";
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
import { useCursorPages, useSearchText } from "@/lib/listControls";
import { statusFilterArg, TABLE_PAGE_SIZE, type StatusFilter } from "@/lib/tableList";
import { SheetColumnFields } from "@/components/clinics/SheetColumnFields";

type ClinicList = FunctionReturnType<typeof api.clinics.list>;
type ClinicView = ClinicList["page"][number];
type ClientList = FunctionReturnType<typeof api.clinics.listClientChoices>;
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

// The clinic list is read for every client at once, so the client filter starts
// with the whole directory.
const ALL_CLIENTS = "all";

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
      setValidationError(localizedMessage((t) => t.admin.clinics.form.nameRequired));
      return;
    }
    if (googleSheetId === "") {
      setValidationError(localizedMessage((t) => t.admin.clinics.form.invalidSheet));
      return;
    }
    if (values.clientId === "") {
      setValidationError(localizedMessage((t) => t.admin.clinics.form.clientRequired));
      return;
    }
    if (values.externalClinicId.trim() === "") {
      setValidationError(localizedMessage((t) => t.admin.clinics.form.externalIdRequired));
      return;
    }

    await onSubmit({ ...values, name, sheetInput: googleSheetId });
  }

  return (
    <Dialog
      open={open}
      // A save in flight lands on whatever form is open when it settles, so the
      // dialog only closes from the request it owns.
      onOpenChange={(next, eventDetails) => {
        if (!next && pending) {
          eventDetails.cancel();
          return;
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-2xl" showCloseButton={!pending}>
        <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>
              {isEditing ? t.admin.clinics.form.editTitle : t.admin.clinics.form.createTitle}
            </DialogTitle>
            <DialogDescription>
              {isEditing
                ? t.admin.clinics.form.editDescription
                : t.admin.clinics.form.createDescription}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 md:gap-4">
            <Field>
              <FieldLabel htmlFor="clinic-name">{t.admin.clinics.form.name}</FieldLabel>
              <Input
                id="clinic-name"
                value={values.name}
                onChange={(event) => update("name", event.target.value)}
                disabled={pending}
              />
            </Field>
            <Field>
              <FieldLabel>{t.admin.clinics.form.client}</FieldLabel>
              <Select
                items={clients.map((client) => ({
                  value: client.clientId,
                  label: client.isActive
                    ? client.name
                    : `${client.name} ${t.admin.clinics.form.inactiveSuffix}`,
                }))}
                value={values.clientId}
                onValueChange={(value) => update("clientId", value ?? "")}
                disabled={pending}
              >
                <SelectTrigger aria-label={t.admin.clinics.form.client} className="w-full">
                  <SelectValue placeholder={t.admin.clinics.form.chooseClient} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {clients.map((client) => (
                      <SelectItem key={client.clientId} value={client.clientId}>
                        {client.isActive
                          ? client.name
                          : `${client.name} ${t.admin.clinics.form.inactiveSuffix}`}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field className="col-span-2">
              <FieldLabel htmlFor="clinic-sheet">{t.admin.clinics.form.sheetLabel}</FieldLabel>
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
                {t.admin.clinics.form.externalId}
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
              <FieldLabel htmlFor="clinic-active">{t.admin.clinics.form.active}</FieldLabel>
            </Field>
          </div>
          <SheetColumnFields
            values={values.sheetColumns}
            onChange={(sheetColumns) => update("sheetColumns", sheetColumns)}
            disabled={pending}
          />
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>{t.admin.clinics.form.saveFailedTitle}</AlertTitle>
              <AlertDescription>{error.resolve(t)}</AlertDescription>
            </Alert>
          ) : null}
          <FieldError>{validationError?.resolve(t)}</FieldError>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {isEditing ? t.common.saveChanges : t.admin.clinics.form.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AdminClinicsPanel() {
  const { t } = useI18n();
  const search = useSearchText();
  const pages = useCursorPages<ClinicView>();
  const [clientFilter, setClientFilter] = useState(ALL_CLIENTS);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const status = statusFilterArg(statusFilter);
  const isSearching = search.query !== "";

  const current = useQuery(api.staffAccounts.current, {});
  const canManage = current?.role === "admin" && current.status === "active";

  const clientsData = useQuery(api.clinics.listClientChoices, canManage ? {} : "skip");
  // A substring is not something an index can answer, so the list pages with
  // the cursor while the box is empty and asks the bounded search otherwise.
  const clinicsData = useQuery(
    api.clinics.list,
    canManage && !isSearching
      ? {
          paginationOpts: { numItems: TABLE_PAGE_SIZE, cursor: pages.cursor },
          ...(status === undefined ? {} : { status }),
          ...(clientFilter === ALL_CLIENTS ? {} : { clientId: clientFilter as Id<"clients"> }),
        }
      : "skip"
  );
  const searchData = useQuery(
    api.clinics.search,
    canManage && isSearching
      ? {
          search: search.query,
          ...(status === undefined ? {} : { status }),
          ...(clientFilter === ALL_CLIENTS ? {} : { clientId: clientFilter as Id<"clients"> }),
        }
      : "skip"
  );
  const createClinic = useMutation(api.clinics.create);
  const updateClinic = useMutation(api.clinics.update);
  const removeClinic = useMutation(api.clinics.remove);

  const [formError, setFormError] = useState<LocalizedMessage | null>(null);
  const [deleteError, setDeleteError] = useState<LocalizedMessage | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingClinicId, setPendingClinicId] = useState<Id<"clinics"> | null>(null);
  const [formMode, setFormMode] = useState<"closed" | "creating" | "editing">("closed");
  const [editingClinic, setEditingClinic] = useState<ClinicView | null>(null);
  // Bumped on every open so the form remounts with fresh values. Cancelling a
  // draft must not leak into the next open.
  const [formSession, setFormSession] = useState(0);
  const [clinicToDelete, setClinicToDelete] = useState<ClinicView | null>(null);

  const clients = clientsData?.clients ?? [];
  const isReady = isSearching ? searchData !== undefined : clinicsData !== undefined;
  // While a change loads, the table keeps the rows it had: emptying it would
  // collapse the page and send the reader back to the top.
  const clinics = isSearching ? (searchData?.clinics ?? []) : (clinicsData?.page ?? []);
  const shownRows = isReady ? clinics : (pages.held?.rows ?? clinics);
  const shownIndex = isReady ? pages.index : (pages.held?.index ?? pages.index);
  // The rows on screen, which is all a cursor can tell: the pages behind them
  // were read and the ones ahead are not known.
  const firstRow = shownIndex * TABLE_PAGE_SIZE + 1;
  const lastRow = firstRow + shownRows.length - 1;
  const hasFilters = isSearching || clientFilter !== ALL_CLIENTS || statusFilter !== "all";
  // A page ahead is one the server just read and said it has, with the cursor
  // that asks for it: a page held from before cannot stand in for that.
  const canGoNext = clinicsData !== undefined && !clinicsData.isDone;
  // Only a page the reader asked for shows a spinner on its own control; a
  // filter or a search leaves the table as it is until its rows arrive.
  const paging = !isSearching && clinicsData === undefined ? pages.pending : null;

  // Both the client filter and the clinic form pick from the capped client
  // list, which is every client the directory holds at the size the cap allows.
  const clientOptions = clients
    .map((client) => ({ value: client.clientId, label: client.name }))
    .sort((left, right) => left.label.localeCompare(right.label));

  function closeForm() {
    setFormMode("closed");
    setEditingClinic(null);
    setFormError(null);
  }

  function openCreate() {
    setFormError(null);
    setEditingClinic(null);
    setFormSession((session) => session + 1);
    setFormMode("creating");
  }

  function openEdit(clinic: ClinicView) {
    setFormError(null);
    setEditingClinic(clinic);
    setFormSession((session) => session + 1);
    setFormMode("editing");
  }

  async function submitClinic(values: ClinicFormValues) {
    setIsSaving(true);
    setFormError(null);
    try {
      const clientId = values.clientId as Id<"clients">;
      const sheetColumns = buildSheetColumnsInput(values.sheetColumns) ?? {};
      if (formMode === "editing" && editingClinic !== null) {
        await updateClinic({
          clinicId: editingClinic.clinicId,
          name: values.name,
          googleSheetId: values.sheetInput,
          clientId,
          externalClinicId: values.externalClinicId.trim(),
          isActive: values.isActive,
          sheetColumns,
        });
      } else {
        await createClinic({
          name: values.name,
          googleSheetId: values.sheetInput,
          clientId,
          externalClinicId: values.externalClinicId.trim(),
          isActive: values.isActive,
          sheetColumns,
        });
      }
      closeForm();
    } catch (cause) {
      setFormError(localizedError(cause, (t) => t.admin.clinics.form.saveFailed));
    } finally {
      setIsSaving(false);
    }
  }

  function requestClinicDelete(clinic: ClinicView) {
    setDeleteError(null);
    setClinicToDelete(clinic);
  }

  async function confirmClinicDelete() {
    if (clinicToDelete === null) return;

    setPendingClinicId(clinicToDelete.clinicId);
    setDeleteError(null);
    try {
      await removeClinic({ clinicId: clinicToDelete.clinicId });
      setClinicToDelete(null);
    } catch (cause) {
      setDeleteError(localizedError(cause, (t) => t.admin.clinics.delete.clinicFailed));
    } finally {
      setPendingClinicId(null);
    }
  }

  useDocumentTitle(t.app.titles.clinics);

  const header = (
    <PageHeader
      title={t.admin.clinics.pageTitle}
      actions={
        canManage ? (
          <Button onClick={openCreate}>
            <Plus aria-hidden="true" />
            {t.admin.clinics.addClinic}
          </Button>
        ) : undefined
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

  const isEditing = formMode === "editing";
  const formInitialValues: ClinicFormValues =
    isEditing && editingClinic !== null
      ? {
          name: editingClinic.name,
          sheetInput: editingClinic.googleSheetId,
          clientId: editingClinic.clientId,
          externalClinicId: editingClinic.externalClinicId,
          isActive: editingClinic.isActive,
          sheetColumns: sheetColumnsToFormValues(editingClinic.sheetColumns),
        }
      : EMPTY_FORM;

  return (
    <div className="flex flex-col gap-6">
      {header}
      <AdminTabs />

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-base font-medium">{t.admin.clinics.allClinicsTitle}</h2>
          <p className="text-sm text-muted-foreground">{t.admin.clinics.allClinicsDescription}</p>
        </div>

        {/* A search that found nothing still has to leave the controls on
            screen, or there is no way to change them back. */}
        {clinics.length > 0 || hasFilters ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={search.text}
                onChange={(event) => {
                  search.change(event.target.value);
                  pages.reset();
                }}
                placeholder={t.admin.clinics.filters.search}
                aria-label={t.admin.clinics.filters.search}
                className="h-8 w-full max-w-64"
              />
              <Select
                items={[
                  { value: ALL_CLIENTS, label: t.admin.clinics.filters.allClients },
                  ...clientOptions,
                ]}
                value={clientFilter}
                onValueChange={(value) => {
                  setClientFilter(value ?? ALL_CLIENTS);
                  pages.reset();
                }}
              >
                <SelectTrigger aria-label={t.admin.clinics.filters.client} className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={ALL_CLIENTS}>
                      {t.admin.clinics.filters.allClients}
                    </SelectItem>
                    {clientOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <StatusFilterSelect
                value={statusFilter}
                label={t.admin.clinics.filters.status}
                onChange={(next) => {
                  setStatusFilter(next);
                  pages.reset();
                }}
              />
            </div>
            {clientsData?.hasMore ? (
              <p className="text-xs text-muted-foreground">
                {t.admin.clinics.clientLimit(clientsData.limit)}
              </p>
            ) : null}
          </div>
        ) : null}

        {!isReady && shownRows.length === 0 ? (
          <Skeleton className="h-64 w-full" />
        ) : shownRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {hasFilters ? t.admin.clinics.noMatches : t.admin.clinics.noClinics}
          </p>
        ) : (
          <>
            <DataTableFrame>
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead>{t.admin.clinics.table.clinic}</TableHead>
                    <TableHead>{t.admin.clinics.table.client}</TableHead>
                    <TableHead>{t.admin.clinics.table.googleSheet}</TableHead>
                    <TableHead>{t.admin.clinics.table.columns}</TableHead>
                    <TableHead>{t.admin.clinics.table.status}</TableHead>
                    <TableHead>{t.admin.clinics.table.assignedTo}</TableHead>
                    <TableHead>{t.common.actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shownRows.map((clinic) => {
                    const isPending = pendingClinicId === clinic.clinicId;
                    return (
                      <TableRow key={clinic.clinicId}>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <span>{clinic.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {t.clinics.externalId(clinic.externalClinicId)}
                            </span>
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
                        <TableCell className="max-w-48">
                          {clinic.assignedTo.length === 0 ? (
                            <span className="text-muted-foreground">{t.common.none}</span>
                          ) : (
                            <span className="block truncate" title={clinic.assignedTo.join(", ")}>
                              {clinic.assignedTo.join(", ")}
                            </span>
                          )}
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
              {shownRows.map((clinic) => (
                <DataCard
                  key={clinic.clinicId}
                  title={clinic.name}
                  subtitle={t.clinics.externalId(clinic.externalClinicId)}
                  badge={
                    <Badge variant={clinic.isActive ? "secondary" : "outline"}>
                      {clinic.isActive ? t.common.active : t.common.inactive}
                    </Badge>
                  }
                >
                  <DataCardRow label={t.admin.clinics.table.client}>
                    <TruncatedText>{clinic.clientName}</TruncatedText>
                  </DataCardRow>
                  <DataCardRow label={t.admin.clinics.table.googleSheet}>
                    <TruncatedText className="font-mono text-xs">
                      {clinic.googleSheetId}
                    </TruncatedText>
                  </DataCardRow>
                  <DataCardRow label={t.admin.clinics.table.columns}>
                    <TruncatedText className="font-mono text-xs">
                      {formatSheetColumnSummary(clinic.sheetColumns)}
                    </TruncatedText>
                  </DataCardRow>
                  <DataCardRow label={t.admin.clinics.table.assignedTo}>
                    <TruncatedText
                      className={
                        clinic.assignedTo.length === 0 ? "text-muted-foreground" : undefined
                      }
                    >
                      {clinic.assignedTo.length === 0
                        ? t.common.none
                        : clinic.assignedTo.join(", ")}
                    </TruncatedText>
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

        {isSearching ? (
          searchData?.hasMore ? (
            <p className="text-xs text-muted-foreground">{t.admin.clinics.searchIncomplete}</p>
          ) : null
        ) : (
          <TablePagination
            first={firstRow}
            last={lastRow}
            canPrevious={pages.canGoPrevious}
            canNext={canGoNext}
            pending={paging}
            onPrevious={() => pages.goPrevious({ rows: shownRows, index: shownIndex })}
            onNext={() =>
              pages.goNext(clinicsData?.continueCursor ?? "", {
                rows: shownRows,
                index: shownIndex,
              })
            }
          />
        )}
      </section>

      <ClinicForm
        key={`clinic-form-${formSession}`}
        open={formMode !== "closed"}
        onOpenChange={(open) => {
          if (!open) closeForm();
        }}
        isEditing={isEditing}
        clients={clients}
        initialValues={formInitialValues}
        pending={isSaving}
        error={formError}
        onSubmit={submitClinic}
        onCancel={closeForm}
      />

      <ConfirmDeleteDialog
        open={clinicToDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setClinicToDelete(null);
            setDeleteError(null);
          }
        }}
        title={t.admin.clinics.delete.clinicTitle}
        description={
          clinicToDelete ? t.admin.clinics.delete.clinicDescription(clinicToDelete.name) : ""
        }
        confirmLabel={t.admin.clinics.delete.deleteClinic}
        pending={pendingClinicId !== null}
        error={deleteError}
        onConfirm={() => void confirmClinicDelete()}
      />
    </div>
  );
}
