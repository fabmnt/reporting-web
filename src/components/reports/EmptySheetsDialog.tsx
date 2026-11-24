import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/context";

export type EmptySheetsClinic = {
  clinicId: string;
  clinicName: string;
  // The sheet tabs of the clinic that read no rows. A sheet without a tab name
  // is listed as the clinic alone.
  tabTitles: string[];
  // Why the clinic was read with the app's own account, when it was. A link
  // Google turned down is what can sit behind an empty result.
  fallbackNote: string | null;
};

/**
 * The sheets a run read that held no rows, kept out of the results and behind
 * a button that says how many there are.
 */
export function EmptySheetsDialog({
  clinics,
  sheetCount,
}: {
  clinics: EmptySheetsClinic[];
  sheetCount: number;
}) {
  const { t } = useI18n();

  if (sheetCount === 0) return null;

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        {t.reports.results.emptySheets.trigger(sheetCount)}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.reports.results.emptySheets.title}</DialogTitle>
          <DialogDescription>{t.reports.results.emptySheets.description}</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-4">
          {clinics.map((clinic) => (
            <li key={clinic.clinicId} className="flex flex-col gap-1">
              <h3 className="text-sm font-medium">{clinic.clinicName}</h3>
              {clinic.tabTitles.some((title) => title !== "") ? (
                <ul className="flex flex-col gap-0.5 border-l pl-3 text-xs text-muted-foreground">
                  {clinic.tabTitles
                    .filter((title) => title !== "")
                    .map((title) => (
                      <li key={title}>{title}</li>
                    ))}
                </ul>
              ) : null}
              {clinic.fallbackNote === null ? null : (
                <p className="text-xs text-muted-foreground">{clinic.fallbackNote}</p>
              )}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
