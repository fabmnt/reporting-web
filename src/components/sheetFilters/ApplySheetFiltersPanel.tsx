"use client";

import { useAction, useQuery } from "convex/react";
import { useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { ReportSheetError } from "../../../convex/model/appErrors";
import { PageHeader } from "@/components/app/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from "@/components/ui/card";
import { DateRangePicker, type DateRangeValue } from "@/components/ui/date-range-picker";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { todayIso } from "@/lib/dates";
import { useDocumentTitle, useI18n } from "@/lib/i18n/context";
import { localizedError, sheetErrorText, type LocalizedMessage } from "@/lib/i18n/errors";
import type { Messages } from "@/lib/i18n/messages";
import { byClient } from "@/lib/reportGroups";

type TabError = ReportSheetError | { code: "SHEET_FILTER_TOO_LONG"; rowCount: number };

type ApplyResult = {
  clinics: Array<{
    clinicId: Id<"clinics">;
    clinicName: string;
    error: ReportSheetError | null;
    tabs: Array<{
      tabTitle: string;
      matchedRowCount: number;
      error: TabError | null;
    }>;
  }>;
};

function tabErrorText(error: TabError, t: Messages): string {
  if (error.code === "SHEET_FILTER_TOO_LONG") return t.sheetFilters.formulaTooLong(error.rowCount);
  return sheetErrorText(error, t);
}

function ApplyResults({ result }: { result: ApplyResult }) {
  const { t } = useI18n();

  return (
    <div className="flex flex-col gap-4">
      {result.clinics.map((clinic) => (
        <section key={clinic.clinicId} className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{clinic.clinicName}</h3>
          {clinic.error ? (
            <p className="text-sm text-destructive">{sheetErrorText(clinic.error, t)}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {clinic.tabs.map((tab) => (
                <li key={tab.tabTitle} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium tabular-nums">{tab.tabTitle}</span>
                  {tab.error ? (
                    <span className="text-destructive">{tabErrorText(tab.error, t)}</span>
                  ) : (
                    <span className="text-muted-foreground">
                      {t.sheetFilters.apply.matched(tab.matchedRowCount)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

export function ApplySheetFiltersPanel() {
  const { t } = useI18n();
  const filters = useQuery(api.sheetFilters.list, {});
  const assignment = useQuery(api.googleSheets.listAssignedReportClinics, {});
  const applyFilter = useAction(api.sheetFilters.apply);

  const today = todayIso();
  const [filterId, setFilterId] = useState<string | null>(null);
  const [dates, setDates] = useState<DateRangeValue>({ startDate: today, endDate: today });
  const [selectedClinicIds, setSelectedClinicIds] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<LocalizedMessage | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);

  useDocumentTitle(t.app.titles.sheetFilters);

  const filterList = filters?.filters ?? [];
  const selected = filterList.find((item) => item.sheetFilterId === filterId) ?? filterList[0];
  const clinics = assignment?.clinics ?? [];
  const selectedSet = new Set(selectedClinicIds);
  const canApply =
    selected !== undefined &&
    selectedClinicIds.length > 0 &&
    dates.startDate !== "" &&
    dates.endDate !== "" &&
    !applying;

  function toggleClinic(clinicId: Id<"clinics">) {
    setSelectedClinicIds((current) =>
      current.includes(clinicId) ? current.filter((id) => id !== clinicId) : [...current, clinicId]
    );
  }

  async function handleApply() {
    if (selected === undefined || selectedClinicIds.length === 0) return;
    setApplying(true);
    setError(null);
    try {
      const applied = await applyFilter({
        sheetFilterId: selected.sheetFilterId,
        clinicIds: selectedClinicIds as Id<"clinics">[],
        startDate: dates.startDate,
        endDate: dates.endDate,
      });
      setResult(applied);
    } catch (cause) {
      setError(localizedError(cause, (messages) => messages.sheetFilters.apply.failed));
    } finally {
      setApplying(false);
    }
  }

  if (filters === undefined || assignment === undefined) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t.sheetFilters.pageTitle} />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.sheetFilters.pageTitle} />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t.sheetFilters.apply.failedTitle}</AlertTitle>
          <AlertDescription>{error.resolve(t)}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start">
        <Card className="lg:sticky lg:top-20">
          <CardHeader>
            <h2 className="font-heading text-base leading-snug font-medium">
              {t.sheetFilters.apply.settingsTitle}
            </h2>
            <CardDescription>{t.sheetFilters.apply.settingsDescription}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <Field>
              <FieldLabel>{t.sheetFilters.apply.filter}</FieldLabel>
              {filterList.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t.sheetFilters.apply.noFilters}</p>
              ) : (
                <Select
                  items={filterList.map((item) => ({
                    value: item.sheetFilterId,
                    label: item.name,
                  }))}
                  value={selected?.sheetFilterId ?? ""}
                  onValueChange={(value) => setFilterId((value as string) ?? null)}
                  disabled={applying}
                >
                  <SelectTrigger aria-label={t.sheetFilters.apply.filter} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {filterList.map((item) => (
                        <SelectItem key={item.sheetFilterId} value={item.sheetFilterId}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              )}
              {selected?.description ? (
                <p className="text-xs text-muted-foreground">{selected.description}</p>
              ) : null}
            </Field>

            <Field>
              <FieldLabel>{t.sheetFilters.apply.dateRange}</FieldLabel>
              <DateRangePicker
                id="sheet-filter-dates"
                value={dates}
                onChange={setDates}
                disabled={applying}
              />
            </Field>

            <Separator />

            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium">{t.sheetFilters.apply.clinics}</h3>
                <Badge variant="secondary" className="tabular-nums">
                  {t.sheetFilters.apply.selected(selectedClinicIds.length)}
                </Badge>
              </div>
              {clinics.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t.sheetFilters.apply.noAssignedClinics}
                </p>
              ) : (
                <>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={applying}
                      onClick={() => setSelectedClinicIds(clinics.map((clinic) => clinic.clinicId))}
                    >
                      {t.sheetFilters.apply.selectAll}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={applying || selectedClinicIds.length === 0}
                      onClick={() => setSelectedClinicIds([])}
                    >
                      {t.sheetFilters.apply.clear}
                    </Button>
                  </div>
                  <div className="flex max-h-72 flex-col gap-3 overflow-y-auto text-sm">
                    {byClient(clinics).map((entry) => (
                      <div key={entry.clientId} className="flex flex-col gap-2">
                        <p className="font-medium">{entry.clientName}</p>
                        <ul className="flex flex-col gap-2 pl-1">
                          {entry.clinics.map((clinic) => (
                            <li key={clinic.clinicId}>
                              <label className="flex cursor-pointer items-center gap-3 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
                                <input
                                  type="checkbox"
                                  checked={selectedSet.has(clinic.clinicId)}
                                  onChange={() => toggleClinic(clinic.clinicId)}
                                  disabled={applying}
                                  className="size-4 shrink-0 accent-primary"
                                />
                                <span className="min-w-0 flex-1 truncate" title={clinic.name}>
                                  {clinic.name}
                                </span>
                              </label>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>

            <p className="text-xs text-muted-foreground">{t.sheetFilters.apply.snapshotNote}</p>
          </CardContent>
          <CardFooter>
            <Button className="w-full" onClick={() => void handleApply()} disabled={!canApply}>
              {applying ? <Spinner data-icon="inline-start" /> : null}
              {t.sheetFilters.apply.apply}
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-heading text-base leading-snug font-medium">
              {t.sheetFilters.apply.resultsTitle}
            </h2>
            <CardDescription>{t.sheetFilters.apply.resultsDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            {applying ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <Spinner className="size-4 text-muted-foreground" />
                  <p className="text-sm font-medium">{t.sheetFilters.apply.applyingTitle}</p>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t.sheetFilters.apply.applyingBody(selectedClinicIds.length)}
                </p>
              </div>
            ) : result === null ? (
              <p className="text-sm text-muted-foreground">{t.sheetFilters.apply.emptyResults}</p>
            ) : (
              <ApplyResults result={result} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
