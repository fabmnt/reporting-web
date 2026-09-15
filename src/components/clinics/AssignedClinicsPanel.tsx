import type { FunctionReturnType } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import { useState, type SyntheticEvent } from "react";

import { api } from "../../../convex/_generated/api";
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
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

export function AssignedClinicsPanel() {
  const { t } = useI18n();
  const current = useQuery(api.staffAccounts.current, {});
  const canConfigure =
    current?.status === "active" && (current.role === "admin" || current.role === "operator");
  const assignedData = useQuery(api.clinics.listAssigned, canConfigure ? {} : "skip");
  const updateAssigned = useMutation(api.clinics.updateAssigned);

  const [editingClinic, setEditingClinic] = useState<AssignedClinicView | null>(null);
  const [formSession, setFormSession] = useState(0);
  const [formError, setFormError] = useState<LocalizedMessage | null>(null);
  const [isSaving, setIsSaving] = useState(false);

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

  useDocumentTitle(t.app.titles.clinics);

  const header = <PageHeader title={t.clinics.pageTitle} />;

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
                {assignedData.clinics.map((clinic) => (
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
                      <Button variant="outline" size="sm" onClick={() => openEdit(clinic)}>
                        {t.clinics.table.configure}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
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
                </DataCardRow>
              </DataCard>
            ))}
          </DataCardList>
        </>
      )}

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
