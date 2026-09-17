"use client";

import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { FileText } from "lucide-react";
import { useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { AppLink } from "@/components/app/navigation";
import { PageHeader } from "@/components/app/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from "@/components/ui/card";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useDocumentTitle, useI18n } from "@/lib/i18n/context";
import { localizedError, localizedMessage, type LocalizedMessage } from "@/lib/i18n/errors";
import {
  readReportFilters,
  replaceReportFilters,
  type ReportFilters,
  type VerificationFilter,
} from "@/lib/reportFilters";
import { cn } from "@/lib/utils";

import {
  InactiveCarriersCard,
  OverviewCard,
  ResultsCard,
  type ReportResult,
} from "./ReportResults";

type AssignedClinic = FunctionReturnType<
  typeof api.googleSheets.listAssignedReportClinics
>["clinics"][number];

// The clinics a run reads: every assigned clinic the operator left enabled.
function clinicsToRun(assigned: AssignedClinic[], excludedClinicIds: string[]): AssignedClinic[] {
  if (excludedClinicIds.length === 0) return assigned;
  const excluded = new Set(excludedClinicIds);
  return assigned.filter((clinic) => !excluded.has(clinic.clinicId));
}

function ReportRunnerSkeleton() {
  const { t } = useI18n();

  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label={t.reports.loading.page}>
      <PageHeader title={t.reports.pageTitle} actions={<ConfigureLink />} />
      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start">
        <Card className="lg:sticky lg:top-20" aria-label={t.reports.loading.settings}>
          <CardHeader className="gap-3">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-4 w-full max-w-xs" />
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full" />
            </div>
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full" />
            </div>
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-10 w-full" />
            </div>
            <Separator />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-20 w-full" />
            </div>
          </CardContent>
          <CardFooter>
            <Skeleton className="h-10 w-full" />
          </CardFooter>
        </Card>

        <Card aria-label={t.reports.loading.results}>
          <CardHeader className="gap-3">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-full max-w-md" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-48 w-full rounded-lg" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ResultsPlaceholder({ running, clinicCount }: { running: boolean; clinicCount: number }) {
  const { t } = useI18n();

  if (running) {
    return (
      <div className="flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <div className="flex items-center gap-2">
          <Spinner className="size-4 text-muted-foreground" />
          <h2 className="font-heading text-base font-medium leading-snug">
            {t.reports.reading.title}
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">{t.reports.reading.body(clinicCount)}</p>
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-12 text-center">
      <FileText className="size-6 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-medium">{t.reports.empty.title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{t.reports.empty.body}</p>
    </div>
  );
}

// The configuration screen has no entry in the header of its own, so the
// reports page links to it and only shows the link to accounts that may open it.
const CONFIGURATION_PATH = "/configuration";

function ConfigureLink() {
  const { t } = useI18n();
  const current = useQuery(api.staffAccounts.current, {});
  const canConfigure =
    current?.status === "active" && (current.role === "admin" || current.role === "operator");

  if (!canConfigure) return null;

  return (
    <AppLink href={CONFIGURATION_PATH} className={cn(buttonVariants({ variant: "outline" }))}>
      {t.reports.configure}
    </AppLink>
  );
}

export function ReportRunner() {
  const { t } = useI18n();
  const assignment = useQuery(api.googleSheets.listAssignedReportClinics, {});
  const typeData = useQuery(api.reportTypes.listRunnable, {});
  const runReport = useAction(api.reports.runSheetReport);

  // The controls live in the address bar, so a reload, a bookmark, or a link
  // sent to a colleague comes back to the same report settings.
  const [filters, setFilters] = useState<ReportFilters>(() =>
    readReportFilters(window.location.search)
  );
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<LocalizedMessage | null>(null);
  const [result, setResult] = useState<ReportResult | null>(null);

  useDocumentTitle(t.app.titles.report);

  const types = typeData?.types ?? [];
  const selectedType = types.find((item) => item.reportTypeId === filters.reportTypeId) ?? types[0];
  const builtinTypes = types.filter((item) => item.owner === "builtin");
  const ownTypes = types.filter((item) => item.owner === "mine");

  function updateFilters(next: ReportFilters) {
    setFilters(next);
    replaceReportFilters(next);
  }

  // The filters keep the clinics left out instead of the ones kept in, so the
  // default state holds none of them and a clinic assigned later runs without
  // the operator ticking it again.
  function toggleClinic(clinicId: Id<"clinics">) {
    const excluded = new Set(filters.excludedClinicIds);
    if (excluded.has(clinicId)) {
      excluded.delete(clinicId);
    } else {
      excluded.add(clinicId);
    }
    updateFilters({ ...filters, excludedClinicIds: [...excluded] });
  }

  async function handleRun() {
    const assignedClinics = assignment?.clinics ?? [];
    if (assignedClinics.length === 0) {
      setError(localizedMessage((t) => t.reports.outcomes.noAssignedClinics));
      return;
    }
    const runClinics = clinicsToRun(assignedClinics, filters.excludedClinicIds);
    if (runClinics.length === 0) {
      setError(localizedMessage((t) => t.reports.outcomes.noSelectedClinics));
      return;
    }
    if (selectedType === undefined) {
      setError(localizedMessage((t) => t.reports.outcomes.noReportType));
      return;
    }
    if (!filters.startDate || !filters.endDate) {
      setError(localizedMessage((t) => t.reports.outcomes.pickDates));
      return;
    }
    if (filters.startDate > filters.endDate) {
      setError(localizedMessage((t) => t.reports.outcomes.invalidRange));
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const data = await runReport({
        reportTypeId: selectedType.reportTypeId,
        startDate: filters.startDate,
        endDate: filters.endDate,
        verificationFilter: filters.verification,
        clinicIds: runClinics.map((clinic) => clinic.clinicId),
      });
      setResult(data);
    } catch (cause) {
      setError(localizedError(cause, (t) => t.reports.outcomes.failed));
    } finally {
      setRunning(false);
    }
  }

  if (assignment === undefined || typeData === undefined) return <ReportRunnerSkeleton />;

  const excludedClinicIds = new Set(filters.excludedClinicIds);
  const runClinics = clinicsToRun(assignment.clinics, filters.excludedClinicIds);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.reports.pageTitle} actions={<ConfigureLink />} />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{t.reports.failedTitle}</AlertTitle>
          <AlertDescription>{error.resolve(t)}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start">
        <Card className="lg:sticky lg:top-20">
          <CardHeader>
            <h2 className="font-heading text-base leading-snug font-medium">
              {t.reports.settingsTitle}
            </h2>
            <CardDescription>{t.reports.settingsDescription}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <Field>
              <FieldLabel htmlFor="report-date-range">{t.reports.dateRange}</FieldLabel>
              <DateRangePicker
                id="report-date-range"
                value={filters}
                onChange={(value) => updateFilters({ ...filters, ...value })}
                disabled={running}
              />
            </Field>

            <Field>
              <FieldLabel>{t.reports.reportType}</FieldLabel>
              {types.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t.reports.noReportTypes}</p>
              ) : (
                <Select
                  items={types.map((item) => ({ value: item.reportTypeId, label: item.name }))}
                  value={selectedType?.reportTypeId ?? ""}
                  onValueChange={(value) =>
                    updateFilters({ ...filters, reportTypeId: (value as string) ?? null })
                  }
                  disabled={running}
                >
                  <SelectTrigger aria-label={t.reports.reportType} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>{t.reports.builtIn}</SelectLabel>
                      {builtinTypes.map((item) => (
                        <SelectItem key={item.reportTypeId} value={item.reportTypeId}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                    {ownTypes.length > 0 ? (
                      <SelectGroup>
                        <SelectLabel>{t.reports.myReportTypes}</SelectLabel>
                        {ownTypes.map((item) => (
                          <SelectItem key={item.reportTypeId} value={item.reportTypeId}>
                            {item.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ) : null}
                  </SelectContent>
                </Select>
              )}
              {selectedType ? (
                <p className="text-xs text-muted-foreground">{selectedType.description}</p>
              ) : null}
            </Field>

            {selectedType?.usesVerificationFilter ? (
              <Field>
                <FieldLabel>{t.reports.verificationType}</FieldLabel>
                <Select
                  items={[
                    { value: "all", label: t.reports.verificationAll },
                    { value: "fbd", label: "FBD" },
                    { value: "elg", label: "ELG" },
                  ]}
                  value={filters.verification}
                  onValueChange={(value) =>
                    updateFilters({
                      ...filters,
                      verification: (value as VerificationFilter) ?? "all",
                    })
                  }
                  disabled={running}
                >
                  <SelectTrigger aria-label={t.reports.verificationType} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="all">{t.reports.verificationAll}</SelectItem>
                      <SelectItem value="fbd">FBD</SelectItem>
                      <SelectItem value="elg">ELG</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            ) : null}

            <Separator />

            <section className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium">{t.reports.includedClinics}</h3>
                <Badge variant="secondary" className="tabular-nums">
                  {runClinics.length}
                </Badge>
              </div>
              {assignment.clinics.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t.reports.noAssignedClinics}</p>
              ) : (
                <ul className="flex max-h-56 flex-col gap-2 overflow-y-auto text-sm">
                  {assignment.clinics.map((clinic) => (
                    <li key={clinic.clinicId}>
                      <label className="flex cursor-pointer items-start gap-3 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
                        <input
                          type="checkbox"
                          checked={!excludedClinicIds.has(clinic.clinicId)}
                          onChange={() => toggleClinic(clinic.clinicId)}
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
            </section>
          </CardContent>
          <CardFooter>
            <Button
              size="lg"
              className="w-full"
              onClick={() => void handleRun()}
              disabled={running || runClinics.length === 0 || selectedType === undefined}
            >
              {running ? (
                <>
                  <Spinner data-icon="inline-start" />
                  {t.reports.running}
                </>
              ) : (
                t.reports.run
              )}
            </Button>
          </CardFooter>
        </Card>

        <div className="flex min-w-0 flex-col gap-6">
          {result === null ? (
            <ResultsPlaceholder running={running} clinicCount={runClinics.length} />
          ) : (
            <>
              <OverviewCard result={result} />
              <InactiveCarriersCard carriers={result.inactiveCarriers ?? []} />
              <ResultsCard result={result} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
