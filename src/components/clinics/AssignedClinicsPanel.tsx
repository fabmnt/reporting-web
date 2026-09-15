import type { FunctionReturnType } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { useState, type SyntheticEvent } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { DataCard, DataCardList, DataCardRow, DataTableFrame } from "@/components/app/DataCard";
import { TruncatedText } from "@/components/app/TruncatedText";
import { SheetColumnFields } from "@/components/clinics/SheetColumnFields";
import { PageHeader } from "@/components/app/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  buildSheetColumnsInput,
  formatSheetColumnSummary,
  sheetColumnsToFormValues,
  type SheetColumnFormValues,
} from "@/lib/clinicSheetColumns";
import { parseSpreadsheetId } from "@/lib/googleSheets";
import { useDocumentTitle, useI18n } from "@/lib/i18n/context";
import { localizedError, localizedMessage, type LocalizedMessage } from "@/lib/i18n/errors";

type AssignedClinicList = FunctionReturnType<typeof api.clinics.listAssigned>;
type AssignedClinicView = AssignedClinicList["clinics"][number];
type AvailableClinicList = FunctionReturnType<typeof api.clinics.listAvailable>;
type AvailableClinicView = AvailableClinicList["clinics"][number];

type ClinicConfigFormValues = {
  sheetInput: string;
  sheetColumns: SheetColumnFormValues;
};

function ClinicConfigForm({
  open,
  onOpenChange,
  clinic,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clinic: AssignedClinicView;
  pending: boolean;
  error: LocalizedMessage | null;
  onSubmit: (values: ClinicConfigFormValues) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [values, setValues] = useState<ClinicConfigFormValues>(() => ({
    sheetInput: clinic.googleSheetId,
    sheetColumns: sheetColumnsToFormValues(clinic.sheetColumns),
  }));
  const [validationError, setValidationError] = useState<LocalizedMessage | null>(null);

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError(null);

    const googleSheetId = parseSpreadsheetId(values.sheetInput);
    if (googleSheetId === "") {
      setValidationError(localizedMessage((t) => t.clinics.dialog.invalidSheet));
      return;
    }

    await onSubmit({ ...values, sheetInput: googleSheetId });
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
            <DialogTitle>{t.clinics.dialog.configureTitle(clinic.name)}</DialogTitle>
            <DialogDescription>{t.clinics.dialog.configureDescription}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="assigned-clinic-sheet">{t.clinics.dialog.sheetLabel}</FieldLabel>
            <Input
              id="assigned-clinic-sheet"
              value={values.sheetInput}
              onChange={(event) =>
                setValues((current) => ({ ...current, sheetInput: event.target.value }))
              }
              placeholder="https://docs.google.com/spreadsheets/d/..."
              disabled={pending}
            />
          </Field>
          <SheetColumnFields
            values={values.sheetColumns}
            onChange={(sheetColumns) => setValues((current) => ({ ...current, sheetColumns }))}
            disabled={pending}
          />
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>{t.clinics.dialog.saveFailedTitle}</AlertTitle>
              <AlertDescription>{error.resolve(t)}</AlertDescription>
            </Alert>
          ) : null}
          <FieldError>{validationError?.resolve(t)}</FieldError>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {t.common.saveChanges}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AvailableClinicRow({
  clinic,
  disabled,
  onAdd,
}: {
  clinic: AvailableClinicView;
  disabled: boolean;
  onAdd: (clinicId: Id<"clinics">) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col">
        <span className="text-sm">{clinic.name}</span>
        <span className="text-xs text-muted-foreground">
          {clinic.externalClinicId
            ? `${clinic.clientName} · ${t.clinics.externalId(clinic.externalClinicId)}`
            : clinic.clientName}
        </span>
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => onAdd(clinic.clinicId)}
      >
        {t.common.add}
      </Button>
    </div>
  );
}

/**
 * Picks clinics for the caller's own assignment. The list holds what is left to
 * add, so an added clinic leaves the dialog as soon as the assignment lands.
 */
function AddClinicDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const availableData = useQuery(api.clinics.listAvailable, {});
  const addAssigned = useMutation(api.clinics.addAssigned);
  const [search, setSearch] = useState("");
  const [pendingClinicId, setPendingClinicId] = useState<Id<"clinics"> | null>(null);
  const [error, setError] = useState<LocalizedMessage | null>(null);

  const available = availableData?.clinics ?? [];
  const needle = search.trim().toLowerCase();
  const matches =
    needle === ""
      ? available
      : available.filter((clinic) =>
          `${clinic.name} ${clinic.clientName}`.toLowerCase().includes(needle)
        );

  async function add(clinicId: Id<"clinics">) {
    setPendingClinicId(clinicId);
    setError(null);
    try {
      await addAssigned({ clinicId });
    } catch (cause) {
      setError(localizedError(cause, (t) => t.clinics.addFailed));
    } finally {
      setPendingClinicId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.clinics.addDialog.title}</DialogTitle>
          <DialogDescription>{t.clinics.addDialog.description}</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="available-clinic-search">{t.clinics.addDialog.search}</FieldLabel>
          <Input
            id="available-clinic-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Field>
        <div className="flex max-h-72 flex-col gap-3 overflow-y-auto">
          {availableData === undefined ? (
            <Skeleton className="h-40 w-full" />
          ) : available.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.clinics.addDialog.noneAvailable}</p>
          ) : matches.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.clinics.addDialog.noMatches}</p>
          ) : (
            matches.map((clinic) => (
              <AvailableClinicRow
                key={clinic.clinicId}
                clinic={clinic}
                disabled={pendingClinicId !== null}
                onAdd={(clinicId) => void add(clinicId)}
              />
            ))
          )}
        </div>
        {availableData?.hasMore ? (
          <p className="text-xs text-muted-foreground">
            {t.clinics.addDialog.limit(availableData.limit)}
          </p>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>{t.clinics.addFailedTitle}</AlertTitle>
            <AlertDescription>{error.resolve(t)}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.common.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AssignedClinicsPanel() {
  const { t } = useI18n();
  const current = useQuery(api.staffAccounts.current, {});
  const canConfigure =
    current?.status === "active" && (current.role === "admin" || current.role === "operator");
  const assignedData = useQuery(api.clinics.listAssigned, canConfigure ? {} : "skip");
  const updateAssigned = useMutation(api.clinics.updateAssigned);
  const removeAssigned = useMutation(api.clinics.removeAssigned);

  const [editingClinic, setEditingClinic] = useState<AssignedClinicView | null>(null);
  const [formSession, setFormSession] = useState(0);
  const [formError, setFormError] = useState<LocalizedMessage | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [pendingClinicId, setPendingClinicId] = useState<Id<"clinics"> | null>(null);
  const [removeError, setRemoveError] = useState<LocalizedMessage | null>(null);

  function closeForm() {
    setEditingClinic(null);
    setFormError(null);
  }

  function openEdit(clinic: AssignedClinicView) {
    setFormError(null);
    setEditingClinic(clinic);
    setFormSession((session) => session + 1);
  }

  async function submitClinic(values: ClinicConfigFormValues) {
    if (editingClinic === null) return;

    setIsSaving(true);
    setFormError(null);
    try {
      await updateAssigned({
        clinicId: editingClinic.clinicId,
        googleSheetId: values.sheetInput,
        sheetColumns: buildSheetColumnsInput(values.sheetColumns) ?? {},
      });
      closeForm();
    } catch (cause) {
      setFormError(localizedError(cause, (t) => t.clinics.dialog.saveFailed));
    } finally {
      setIsSaving(false);
    }
  }

  async function removeClinic(clinic: AssignedClinicView) {
    setPendingClinicId(clinic.clinicId);
    setRemoveError(null);
    try {
      await removeAssigned({ clinicId: clinic.clinicId });
    } catch (cause) {
      setRemoveError(localizedError(cause, (t) => t.clinics.removeFailed));
    } finally {
      setPendingClinicId(null);
    }
  }

  useDocumentTitle(t.app.titles.clinics);

  const header = (
    <PageHeader
      title={t.clinics.pageTitle}
      actions={
        canConfigure ? (
          <Button onClick={() => setIsAdding(true)}>
            <Plus aria-hidden="true" />
            {t.clinics.addClinic}
          </Button>
        ) : undefined
      }
    />
  );

  if (current === undefined) return <Skeleton className="h-80 w-full" />;

  if (!canConfigure) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <Alert variant="destructive">
          <AlertTitle>{t.clinics.accessDeniedTitle}</AlertTitle>
          <AlertDescription>{t.clinics.accessDeniedBody}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {header}

      {removeError ? (
        <Alert variant="destructive">
          <AlertTitle>{t.clinics.removeFailedTitle}</AlertTitle>
          <AlertDescription>{removeError.resolve(t)}</AlertDescription>
        </Alert>
      ) : null}

      {assignedData === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : assignedData.clinics.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.clinics.noneAssigned}</p>
      ) : (
        <>
          <DataTableFrame>
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead>{t.clinics.table.clinic}</TableHead>
                  <TableHead>{t.clinics.table.client}</TableHead>
                  <TableHead>{t.clinics.table.googleSheet}</TableHead>
                  <TableHead>{t.clinics.table.columns}</TableHead>
                  <TableHead>{t.clinics.table.actions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignedData.clinics.map((clinic) => {
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
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => openEdit(clinic)}>
                            {t.clinics.table.configure}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            disabled={isPending}
                            onClick={() => void removeClinic(clinic)}
                          >
                            {t.common.remove}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </DataTableFrame>

          <DataCardList>
            {assignedData.clinics.map((clinic) => (
              <DataCard
                key={clinic.clinicId}
                title={clinic.name}
                subtitle={
                  clinic.externalClinicId
                    ? t.clinics.externalId(clinic.externalClinicId)
                    : undefined
                }
              >
                <DataCardRow label={t.clinics.table.client}>
                  <TruncatedText>{clinic.clientName}</TruncatedText>
                </DataCardRow>
                <DataCardRow label={t.clinics.table.googleSheet}>
                  <TruncatedText className="font-mono text-xs">
                    {clinic.googleSheetId}
                  </TruncatedText>
                </DataCardRow>
                <DataCardRow label={t.clinics.table.columns}>
                  <TruncatedText className="font-mono text-xs">
                    {formatSheetColumnSummary(clinic.sheetColumns)}
                  </TruncatedText>
                </DataCardRow>
                <DataCardRow>
                  <Button variant="outline" size="sm" onClick={() => openEdit(clinic)}>
                    {t.clinics.table.configure}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={pendingClinicId === clinic.clinicId}
                    onClick={() => void removeClinic(clinic)}
                  >
                    {t.common.remove}
                  </Button>
                </DataCardRow>
              </DataCard>
            ))}
          </DataCardList>
        </>
      )}

      {isAdding ? (
        <AddClinicDialog
          open
          onOpenChange={(open) => {
            if (!open) setIsAdding(false);
          }}
        />
      ) : null}

      {editingClinic !== null ? (
        <ClinicConfigForm
          key={`assigned-clinic-form-${formSession}`}
          open
          onOpenChange={(open) => {
            if (!open) closeForm();
          }}
          clinic={editingClinic}
          pending={isSaving}
          error={formError}
          onSubmit={submitClinic}
          onCancel={closeForm}
        />
      ) : null}
    </div>
  );
}
