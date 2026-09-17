import type { FunctionReturnType } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { useState, type SyntheticEvent } from "react";

import { api } from "../../../convex/_generated/api";
import { AssignClinicsDialog } from "@/components/admin/AssignClinicsDialog";
import { ConfirmDeleteDialog } from "@/components/admin/ConfirmDeleteDialog";
import { AdminTabs } from "@/components/app/AdminTabs";
import { DataCard, DataCardList, DataCardRow, DataTableFrame } from "@/components/app/DataCard";
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
import { localizedError, localizedMessage, type LocalizedMessage } from "@/lib/i18n/errors";
import { useCursorPages, useSearchText } from "@/lib/listControls";
import { statusFilterArg, TABLE_PAGE_SIZE, type StatusFilter } from "@/lib/tableList";

type ClientList = FunctionReturnType<typeof api.clinics.listClients>;
type ClientView = ClientList["page"][number];

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
  onAssign,
}: {
  client: ClientView;
  disabled: boolean;
  onEdit: (client: ClientView) => void;
  onDelete: (client: ClientView) => void;
  onAssign: (client: ClientView) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" disabled={disabled} onClick={() => onEdit(client)}>
        {t.common.edit}
      </Button>
      <Button variant="outline" size="sm" disabled={disabled} onClick={() => onAssign(client)}>
        {t.admin.clients.assign}
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
      setValidationError(localizedMessage((t) => t.admin.clients.form.nameRequired));
      return;
    }

    await onSubmit({ name, isActive: values.isActive });
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
      <DialogContent showCloseButton={!pending}>
        <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>
              {isEditing ? t.admin.clients.form.editTitle : t.admin.clients.form.createTitle}
            </DialogTitle>
            <DialogDescription>{t.admin.clients.form.description}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="client-name">{t.admin.clients.form.name}</FieldLabel>
            <Input
              id="client-name"
              value={values.name}
              onChange={(event) =>
                setValues((current) => ({ ...current, name: event.target.value }))
              }
              placeholder={t.admin.clients.form.namePlaceholder}
              disabled={pending}
            />
          </Field>
          {/* A new client is always created active, so only the edit form
              offers the switch. */}
          {isEditing ? (
            <Field orientation="horizontal">
              <Switch
                id="client-active"
                checked={values.isActive}
                onCheckedChange={(checked) =>
                  setValues((current) => ({ ...current, isActive: checked }))
                }
                disabled={pending}
              />
              <FieldLabel htmlFor="client-active">{t.admin.clients.form.active}</FieldLabel>
            </Field>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>{t.admin.clients.form.saveFailedTitle}</AlertTitle>
              <AlertDescription>{error.resolve(t)}</AlertDescription>
            </Alert>
          ) : null}
          <FieldError>{validationError?.resolve(t)}</FieldError>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {isEditing ? t.common.saveChanges : t.admin.clients.form.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AdminClientsPanel() {
  const { t } = useI18n();
  const search = useSearchText();
  const pages = useCursorPages<ClientView>();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const status = statusFilterArg(statusFilter);
  const isSearching = search.query !== "";

  const current = useQuery(api.staffAccounts.current, {});
  const canManage = current?.role === "admin" && current.status === "active";

  // A substring is not something an index can answer, so the list pages with
  // the cursor while the box is empty and asks the bounded search otherwise.
  const clientsData = useQuery(
    api.clinics.listClients,
    canManage && !isSearching
      ? {
          paginationOpts: { numItems: TABLE_PAGE_SIZE, cursor: pages.cursor },
          ...(status === undefined ? {} : { status }),
        }
      : "skip"
  );
  const searchData = useQuery(
    api.clinics.searchClients,
    canManage && isSearching
      ? { search: search.query, ...(status === undefined ? {} : { status }) }
      : "skip"
  );
  const createClient = useMutation(api.clinics.createClient);
  const updateClient = useMutation(api.clinics.updateClient);
  const removeClient = useMutation(api.clinics.removeClient);

  const [formError, setFormError] = useState<LocalizedMessage | null>(null);
  const [deleteError, setDeleteError] = useState<LocalizedMessage | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingClientId, setPendingClientId] = useState<ClientView["clientId"] | null>(null);
  const [formMode, setFormMode] = useState<"closed" | "creating" | "editing">("closed");
  const [editingClient, setEditingClient] = useState<ClientView | null>(null);
  // Bumped on every open so the form remounts with fresh values. Cancelling a
  // draft must not leak into the next open.
  const [formSession, setFormSession] = useState(0);
  const [clientToDelete, setClientToDelete] = useState<ClientView | null>(null);
  const [assigningClient, setAssigningClient] = useState<ClientView | null>(null);

  const isReady = isSearching ? searchData !== undefined : clientsData !== undefined;
  // While a change loads, the table keeps the rows it had: emptying it would
  // collapse the page and send the reader back to the top.
  const clients = isSearching ? (searchData?.clients ?? []) : (clientsData?.page ?? []);
  const shownRows = isReady ? clients : (pages.held?.rows ?? clients);
  const shownIndex = isReady ? pages.index : (pages.held?.index ?? pages.index);
  // The rows on screen, which is all a cursor can tell: the pages behind them
  // were read and the ones ahead are not known.
  const firstRow = shownIndex * TABLE_PAGE_SIZE + 1;
  const lastRow = firstRow + shownRows.length - 1;
  const hasFilters = isSearching || statusFilter !== "all";
  // A page ahead is one the server just read and said it has, with the cursor
  // that asks for it: a page held from before cannot stand in for that.
  const canGoNext = clientsData !== undefined && !clientsData.isDone;
  // Only a page the reader asked for shows a spinner on its own control; a
  // filter or a search leaves the table as it is until its rows arrive.
  const paging = !isSearching && clientsData === undefined ? pages.pending : null;

  function openCreate() {
    setFormError(null);
    setEditingClient(null);
    setFormSession((session) => session + 1);
    setFormMode("creating");
  }

  function openEdit(client: ClientView) {
    setFormError(null);
    setEditingClient(client);
    setFormSession((session) => session + 1);
    setFormMode("editing");
  }

  function closeForm() {
    setFormMode("closed");
    setEditingClient(null);
    setFormError(null);
  }

  async function submitClient(values: ClientFormValues) {
    setIsSaving(true);
    setFormError(null);
    try {
      if (formMode === "editing" && editingClient !== null) {
        await updateClient({
          clientId: editingClient.clientId,
          name: values.name,
          isActive: values.isActive,
        });
      } else {
        await createClient({ name: values.name });
      }
      closeForm();
    } catch (cause) {
      setFormError(localizedError(cause, (t) => t.admin.clients.form.saveFailed));
    } finally {
      setIsSaving(false);
    }
  }

  function requestDelete(client: ClientView) {
    setDeleteError(null);
    setClientToDelete(client);
  }

  async function confirmDelete() {
    if (clientToDelete === null) return;

    setPendingClientId(clientToDelete.clientId);
    setDeleteError(null);
    try {
      await removeClient({ clientId: clientToDelete.clientId });
      setClientToDelete(null);
    } catch (cause) {
      setDeleteError(localizedError(cause, (t) => t.admin.clients.delete.clientFailed));
    } finally {
      setPendingClientId(null);
    }
  }

  useDocumentTitle(t.app.titles.adminClients);

  const header = (
    <PageHeader
      title={t.admin.clients.pageTitle}
      actions={
        canManage ? (
          <Button onClick={openCreate}>
            <Plus aria-hidden="true" />
            {t.admin.clients.addClient}
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
          <AlertDescription>{t.admin.clients.accessDeniedBody}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {header}
      <AdminTabs />

      <section className="flex flex-col gap-4">
        {/* A search that found nothing still has to leave the box on screen,
            or there is no way to change it back. */}
        {clients.length > 0 || hasFilters ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={search.text}
              onChange={(event) => {
                search.change(event.target.value);
                pages.reset({ rows: shownRows, index: shownIndex });
              }}
              placeholder={t.admin.clients.filters.search}
              aria-label={t.admin.clients.filters.search}
              className="h-8 w-full max-w-64"
            />
            <StatusFilterSelect
              value={statusFilter}
              label={t.admin.clients.filters.status}
              onChange={(next) => {
                setStatusFilter(next);
                pages.reset({ rows: shownRows, index: shownIndex });
              }}
            />
          </div>
        ) : null}

        {!isReady && shownRows.length === 0 ? (
          <Skeleton className="h-40 w-full" />
        ) : shownRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {hasFilters ? t.admin.clients.noMatches : t.admin.clients.noClients}
          </p>
        ) : (
          <>
            <DataTableFrame>
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead>{t.admin.clients.table.client}</TableHead>
                    <TableHead>{t.admin.clients.table.clinics}</TableHead>
                    <TableHead>{t.admin.clients.table.key}</TableHead>
                    <TableHead>{t.admin.clients.table.status}</TableHead>
                    <TableHead>{t.common.actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shownRows.map((client) => {
                    const isPending = pendingClientId === client.clientId;
                    return (
                      <TableRow key={client.clientId}>
                        <TableCell>{client.name}</TableCell>
                        <TableCell className="tabular-nums">{client.clinicCount}</TableCell>
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
                            onEdit={openEdit}
                            onDelete={requestDelete}
                            onAssign={setAssigningClient}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </DataTableFrame>

            <DataCardList>
              {shownRows.map((client) => (
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
                  <DataCardRow label={t.admin.clients.table.clinics}>
                    <span className="tabular-nums">{client.clinicCount}</span>
                  </DataCardRow>
                  <DataCardRow>
                    <ClientActions
                      client={client}
                      disabled={pendingClientId === client.clientId}
                      onEdit={openEdit}
                      onDelete={requestDelete}
                      onAssign={setAssigningClient}
                    />
                  </DataCardRow>
                </DataCard>
              ))}
            </DataCardList>
          </>
        )}

        {isSearching ? (
          searchData?.hasMore ? (
            <p className="text-xs text-muted-foreground">{t.admin.clients.searchIncomplete}</p>
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
              pages.goNext(clientsData?.continueCursor ?? "", {
                rows: shownRows,
                index: shownIndex,
              })
            }
          />
        )}
      </section>

      <ClientForm
        key={`client-form-${formSession}`}
        open={formMode !== "closed"}
        onOpenChange={(open) => {
          if (!open) closeForm();
        }}
        isEditing={formMode === "editing"}
        initialValues={
          formMode === "editing" && editingClient !== null
            ? { name: editingClient.name, isActive: editingClient.isActive }
            : EMPTY_CLIENT_FORM
        }
        pending={isSaving}
        error={formError}
        onSubmit={submitClient}
        onCancel={closeForm}
      />

      <ConfirmDeleteDialog
        open={clientToDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setClientToDelete(null);
            setDeleteError(null);
          }
        }}
        title={t.admin.clients.delete.clientTitle}
        description={
          clientToDelete ? t.admin.clients.delete.clientDescription(clientToDelete.name) : ""
        }
        confirmLabel={t.admin.clients.delete.deleteClient}
        pending={pendingClientId !== null}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
      />

      {assigningClient === null ? null : (
        <AssignClinicsDialog client={assigningClient} onClose={() => setAssigningClient(null)} />
      )}
    </div>
  );
}
