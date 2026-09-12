import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { CLINIC_SHEET_COLUMN_DEFAULTS, type SheetColumnFormValues } from "@/lib/clinicSheetColumns";

export function SheetColumnFields({
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
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
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
        <Field>
          <FieldLabel htmlFor="column-files-urls">Files URLs</FieldLabel>
          <Input
            id="column-files-urls"
            value={values.fileUrl}
            onChange={(event) => update("fileUrl", event.target.value.toUpperCase())}
            placeholder={CLINIC_SHEET_COLUMN_DEFAULTS.fileUrl}
            disabled={disabled}
            className="font-mono uppercase"
          />
        </Field>
      </div>
    </div>
  );
}
