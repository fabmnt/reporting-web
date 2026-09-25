import type { Id } from "../../../convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/context";
import {
  groupClinicCount,
  selectableClinics,
  type ReportClinic,
  type ReportGroup,
} from "@/lib/reportGroups";

/**
 * The clinics a run covers, as the run form shows them: the report groups of
 * the account, and beneath them the clinics the ticked groups cover (every
 * assigned clinic while none is ticked), each of which can be left out on its
 * own.
 */
export function IncludedClinicsSection({
  clinics,
  groups,
  selectedGroupIds,
  excludedClinicIds,
  runClinicCount,
  running,
  onToggleClinic,
  onToggleGroup,
  onManageGroups,
}: {
  clinics: ReportClinic[];
  groups: ReportGroup[];
  selectedGroupIds: string[];
  excludedClinicIds: string[];
  runClinicCount: number;
  running: boolean;
  onToggleClinic: (clinicId: Id<"clinics">) => void;
  onToggleGroup: (groupId: Id<"reportGroups">) => void;
  onManageGroups: () => void;
}) {
  const { t } = useI18n();

  const listed = selectableClinics(clinics, groups, selectedGroupIds);
  const excluded = new Set<string>(excludedClinicIds);
  const narrowed = selectedGroupIds.length > 0;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{t.reports.includedClinics}</h3>
        <Badge variant="secondary" className="tabular-nums">
          {runClinicCount}
        </Badge>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-xs font-medium text-muted-foreground">{t.reports.groups.title}</h4>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={onManageGroups}
            disabled={running}
          >
            {t.reports.groups.manage}
          </Button>
        </div>
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.reports.groups.none}</p>
        ) : (
          <ul className="flex max-h-40 flex-col gap-2 overflow-y-auto text-sm">
            {groups.map((group) => (
              <li key={group.groupId}>
                <label className="flex cursor-pointer items-center gap-3 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
                  <input
                    type="checkbox"
                    checked={selectedGroupIds.includes(group.groupId)}
                    onChange={() => onToggleGroup(group.groupId)}
                    disabled={running}
                    className="size-4 shrink-0 accent-primary"
                  />
                  <span className="min-w-0 flex-1 truncate">{group.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {t.reports.groups.count(groupClinicCount(clinics, group))}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h4 className="text-xs font-medium text-muted-foreground">
          {narrowed ? t.reports.groups.clinicsInGroups : t.reports.groups.clinicsTitle}
        </h4>
        {clinics.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.reports.noAssignedClinics}</p>
        ) : listed.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.reports.outcomes.noSelectedClinics}</p>
        ) : (
          <ul className="flex max-h-56 flex-col gap-2 overflow-y-auto text-sm">
            {listed.map((clinic) => (
              <li key={clinic.clinicId}>
                <label className="flex cursor-pointer items-start gap-3 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
                  <input
                    type="checkbox"
                    checked={!excluded.has(clinic.clinicId)}
                    onChange={() => onToggleClinic(clinic.clinicId)}
                    disabled={running}
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                  />
                  <span className="min-w-0 flex-1">
                    {clinic.name} <span aria-hidden="true">·</span> {clinic.clientName}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
