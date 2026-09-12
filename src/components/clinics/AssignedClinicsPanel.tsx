import type { FunctionReturnType } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import { useState, type SyntheticEvent } from "react";

import { api } from "../../../convex/_generated/api";
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
  error: string | null;
  onSubmit: (values: ClinicConfigFormValues) => Promise<void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<ClinicConfigFormValues>(() => ({
    sheetInput: clinic.googleSheetId,
    sheetColumns: sheetColumnsToFormValues(clinic.sheetColumns),
  }));
  const [validationError, setValidationError] = useState<string | null>(null);

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError(null);

    const googleSheetId = parseSpreadsheetId(values.sheetInput);
    if (googleSheetId === "") {
      setValidationError("Paste a Google Sheet URL or ID.");
      return;
    }

    await onSubmit({ ...values, sheetInput: googleSheetId });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>Configure {clinic.name}</DialogTitle>
            <DialogDescription>
              Update the Google Sheet link and column letters for this clinic.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="assigned-clinic-sheet">Google Sheet URL or ID</FieldLabel>
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
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AssignedClinicsPanel() {
  const current = useQuery(api.staffAccounts.current, {});
  const canConfigure =
    current?.status === "active" && (current.role === "admin" || current.role === "operator");
  const assignedData = useQuery(api.clinics.listAssigned, canConfigure ? {} : "skip");
  const updateAssigned = useMutation(api.clinics.updateAssigned);

  const [editingClinic, setEditingClinic] = useState<AssignedClinicView | null>(null);
  const [formSession, setFormSession] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
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
      setFormError(cause instanceof Error ? cause.message : "Saving the clinic failed.");
    } finally {
      setIsSaving(false);
    }
  }

  const header = (
    <PageHeader
      title="Clinics"
      description="Configure the Google Sheet link and column letters for clinics assigned to you."
    />
  );

  if (current === undefined) return <Skeleton className="h-80 w-full" />;

  if (!canConfigure) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <Alert variant="destructive">
          <AlertTitle>Active staff access required</AlertTitle>
          <AlertDescription>Your account cannot configure clinics.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {header}

      {assignedData?.usesAllClinics ? (
        <Alert>
          <AlertTitle>All active clinics</AlertTitle>
          <AlertDescription>
            You are an admin with no clinic assignments, so every active clinic is listed here.
          </AlertDescription>
        </Alert>
      ) : null}

      {assignedData === undefined ? (
        <Skeleton className="h-64 w-full" />
      ) : assignedData.clinics.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No clinics are assigned to you yet. Ask an admin to assign clinics before you can
          configure them.
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
                <TableHead>Actions</TableHead>
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
                    <Button variant="outline" size="sm" onClick={() => openEdit(clinic)}>
                      Configure
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
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
