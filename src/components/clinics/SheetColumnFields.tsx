import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { CLINIC_SHEET_COLUMN_DEFAULTS, type SheetColumnFormValues } from "@/lib/clinicSheetColumns";
import { useI18n } from "@/lib/i18n/context";

export function SheetColumnFields({
  values,
  onChange,
  disabled,
}: {
  values: SheetColumnFormValues;
  onChange: (values: SheetColumnFormValues) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();

  function update<K extends keyof SheetColumnFormValues>(key: K, value: SheetColumnFormValues[K]) {
    onChange({ ...values, [key]: value });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">{t.clinics.sheetColumns.title}</h3>
        <p className="text-xs text-muted-foreground">{t.clinics.sheetColumns.note}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <Field>
          <FieldLabel htmlFor="column-update-status">
            {t.clinics.sheetColumns.updateStatus}
          </FieldLabel>
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
          <FieldLabel htmlFor="column-upload-status">
            {t.clinics.sheetColumns.uploadStatus}
          </FieldLabel>
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
          <FieldLabel htmlFor="column-verification-type">
            {t.clinics.sheetColumns.verificationType}
          </FieldLabel>
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
          <FieldLabel htmlFor="column-files-urls">{t.clinics.sheetColumns.fileUrl}</FieldLabel>
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
