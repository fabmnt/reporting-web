import { ChevronDown } from "lucide-react";

import type { Id } from "../../../convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useI18n } from "@/lib/i18n/context";
import {
  byClient,
  groupClinicCount,
  selectableClinics,
  type ReportClinic,
  type ReportGroup,
} from "@/lib/reportGroups";

/**
 * The clinics a run covers, as the run form shows them: the report groups of
 * the account, and beneath them the clinics the ticked groups cover (every
 * assigned clinic while none is ticked), listed under their client. A clinic
 * can be left out on its own, and the client it is listed under stands for all
 * of its own at once. The row of a client folds, which puts its clinics out of
 * the way while its tick and its count stay in place.
 */
export function IncludedClinicsSection({
  clinics,
  groups,
  selectedGroupIds,
  excludedClinicIds,
  runClinicCount,
  running,
  onToggleClinic,
  onToggleClientClinics,
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
  // The clinics the form lists under one client, which its own tick selects or
  // leaves out in one go.
  onToggleClientClinics: (clinicIds: readonly Id<"clinics">[]) => void;
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
                  <span className="min-w-0 flex-1 truncate" title={group.name}>
                    {group.name}
                  </span>
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
          <div className="flex max-h-56 flex-col gap-3 overflow-y-auto text-sm">
            {byClient(listed).map((entry) => {
              const clientClinicIds = entry.clinics.map((clinic) => clinic.clinicId);
              const includedCount = clientClinicIds.filter(
                (clinicId) => !excluded.has(clinicId)
              ).length;
              const whole = includedCount === entry.clinics.length;
              return (
                <Collapsible key={entry.clientId} defaultOpen className="flex flex-col gap-2">
                  <div className="flex items-center gap-3 font-medium has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
                    <input
                      type="checkbox"
                      aria-label={entry.clientName}
                      // A callback ref re-runs on every render, which is what
                      // keeps the half-ticked state in step with the list.
                      ref={(node) => {
                        if (node) node.indeterminate = includedCount > 0 && !whole;
                      }}
                      checked={whole}
                      onChange={() => onToggleClientClinics(clientClinicIds)}
                      disabled={running}
                      className="size-4 shrink-0 accent-primary"
                    />
                    <CollapsibleTrigger className="group/client flex min-w-0 flex-1 items-center gap-3">
                      <span className="min-w-0 flex-1 truncate" title={entry.clientName}>
                        {entry.clientName}
                      </span>
                      <Badge variant="secondary" className="tabular-nums">
                        {entry.clinics.length}
                      </Badge>
                      <ChevronDown
                        className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]/client:rotate-180"
                        aria-hidden="true"
                      />
                    </CollapsibleTrigger>
                  </div>
                  <CollapsiblePanel>
                    <ul className="flex flex-col gap-2 pl-7">
                      {entry.clinics.map((clinic) => (
                        <li key={clinic.clinicId}>
                          <label className="flex cursor-pointer items-center gap-3 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
                            <input
                              type="checkbox"
                              checked={!excluded.has(clinic.clinicId)}
                              onChange={() => onToggleClinic(clinic.clinicId)}
                              disabled={running}
                              className="size-4 shrink-0 accent-primary"
                            />
                            <span
                              className="min-w-0 flex-1 truncate text-muted-foreground"
                              title={clinic.name}
                            >
                              {clinic.name}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </CollapsiblePanel>
                </Collapsible>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
