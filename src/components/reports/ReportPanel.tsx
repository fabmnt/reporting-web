"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { FileText } from "lucide-react";
import { useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { AppLink } from "@/components/app/navigation";
import { PageHeader } from "@/components/app/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { clinicsToRun } from "@/lib/reportGroups";
import {
  readReportFilters,
  replaceReportFilters,
  type ReportFilters,
  type VerificationFilter,
} from "@/lib/reportFilters";
import { cn } from "@/lib/utils";

import { IncludedClinicsSection } from "./IncludedClinicsSection";
import {
  InactiveCarriersCard,
  OverviewCard,
  ResultsCard,
  UnmatchedCarrierRowsCard,
  type ReportResult,
} from "./ReportResults";
import { ReportGroupsDialog } from "./ReportGroupsDialog";

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
  // Every role runs reports and configures its own report types.
  const canConfigure = current?.status === "active";

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
  const groupData = useQuery(api.reportGroups.list, {});
  const typeData = useQuery(api.reportTypes.listRunnable, {});
  const startRun = useMutation(api.reportRuns.startReportRun);
  const cancelRun = useMutation(api.reportRuns.cancelReportRun);
  const abandonRun = useMutation(api.reportRuns.abandonReportRun);
  const runReport = useAction(api.reports.runSheetReport);

  // The controls live in the address bar, so a reload, a bookmark, or a link
  // sent to a colleague comes back to the same report settings.
  const [filters, setFilters] = useState<ReportFilters>(() =>
    readReportFilters(window.location.search)
  );
  const [running, setRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // The record of the run in flight, which is what the cancel button names.
  const [runId, setRunId] = useState<Id<"reportRuns"> | null>(null);
  const [error, setError] = useState<LocalizedMessage | null>(null);
  const [result, setResult] = useState<ReportResult | null>(null);
  // The dialog that creates, edits and deletes the report groups, which the
  // section around the run form opens.
  const [groupManagerOpen, setGroupManagerOpen] = useState(false);

  useDocumentTitle(t.app.titles.report);

  const types = typeData?.types ?? [];
  const groups = groupData?.groups ?? [];
  const selectedType = types.find((item) => item.reportTypeId === filters.reportTypeId) ?? types[0];
  const builtinTypes = types.filter((item) => item.owner === "builtin");
  const ownTypes = types.filter((item) => item.owner === "mine");
  // The ticked groups the form holds. An id that names no group of the account
  // is left out, so the run always reads what the form shows.
  const selectedGroupIds = filters.groupIds.filter((groupId) =>
    groups.some((group) => group.groupId === groupId)
  );

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

  // A client stands for the clinics the form lists under it, so one tick is the
  // whole client instead of one per clinic. A client that is held only partly
  // becomes whole, the same as the group picker does.
  function toggleClientClinics(clinicIds: readonly Id<"clinics">[]) {
    const excluded = new Set(filters.excludedClinicIds);
    const includeAll = clinicIds.some((clinicId) => excluded.has(clinicId));
    for (const clinicId of clinicIds) {
      if (includeAll) {
        excluded.delete(clinicId);
      } else {
        excluded.add(clinicId);
      }
    }
    updateFilters({ ...filters, excludedClinicIds: [...excluded] });
  }

  // A ticked group holds the run to the clinics it covers, so the run form
  // reads no clinic but those while one is ticked. The ids are matched against
  // the groups that exist, so a group that was deleted while it was ticked
  // reads as no group at all instead of holding the run to nothing.
  function toggleGroup(groupId: Id<"reportGroups">) {
    const selected = new Set(selectedGroupIds);
    if (selected.has(groupId)) {
      selected.delete(groupId);
    } else {
      selected.add(groupId);
    }
    updateFilters({ ...filters, groupIds: [...selected] });
  }

  async function handleRun() {
    const assignedClinics = assignment?.clinics ?? [];
    if (assignedClinics.length === 0) {
      setError(localizedMessage((t) => t.reports.outcomes.noAssignedClinics));
      return;
    }
    const runClinics = clinicsToRun(
      assignedClinics,
      groups,
      selectedGroupIds,
      filters.excludedClinicIds
    );
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
    setCancelling(false);
    setError(null);
    setResult(null);
    let openedRunId: Id<"reportRuns"> | null = null;
    try {
      // The run is opened before it starts, so the cancel button has something
      // to name, and the action reads the settings back from that record.
      const { reportRunId } = await startRun({
        reportTypeId: selectedType.reportTypeId,
        startDate: filters.startDate,
        endDate: filters.endDate,
      });
      openedRunId = reportRunId;
      setRunId(reportRunId);
      const data = await runReport({
        runId: reportRunId,
        verificationFilter: filters.verification,
        clinicIds: runClinics.map((clinic) => clinic.clinicId),
      });
      setResult(data);
    } catch (cause) {
      // A call that never reached the server leaves the record waiting to
      // start, and this form is the only thing that could still close it. The
      // mutation leaves a run the action did claim alone.
      if (openedRunId !== null) {
        await abandonRun({ runId: openedRunId }).catch(() => undefined);
      }
      setError(localizedError(cause, (t) => t.reports.outcomes.failed));
    } finally {
      setRunning(false);
      setCancelling(false);
      setRunId(null);
    }
  }

  async function handleCancel() {
    if (runId === null) return;
    setCancelling(true);
    try {
      // The run answers once it reaches its next step, which is where the
      // action below stops and returns what it had read.
      await cancelRun({ runId });
    } catch (cause) {
      // Nothing was stopped, so the button goes back to being a cancel button
      // and the reason it failed is shown instead.
      setCancelling(false);
      setError(localizedError(cause, (t) => t.reports.outcomes.cancelFailed));
    }
  }

  if (assignment === undefined || groupData === undefined || typeData === undefined) {
    return <ReportRunnerSkeleton />;
  }

  // A run stopped before it read anything has nothing to show under the notice
  // that says it was stopped.
  const showsResults = result !== null && (!result.cancelled || result.sheets.length > 0);
  const runClinics = clinicsToRun(
    assignment.clinics,
    groups,
    selectedGroupIds,
    filters.excludedClinicIds
  );

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

            <IncludedClinicsSection
              clinics={assignment.clinics}
              groups={groups}
              selectedGroupIds={selectedGroupIds}
              excludedClinicIds={filters.excludedClinicIds}
              runClinicCount={runClinics.length}
              running={running}
              onToggleClinic={toggleClinic}
              onToggleClientClinics={toggleClientClinics}
              onToggleGroup={toggleGroup}
              onManageGroups={() => setGroupManagerOpen(true)}
            />
          </CardContent>
          <CardFooter className="flex flex-col gap-2">
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
            {running ? (
              <Button
                variant="outline"
                size="lg"
                className="w-full"
                onClick={() => void handleCancel()}
                disabled={cancelling || runId === null}
              >
                {cancelling ? (
                  <>
                    <Spinner data-icon="inline-start" />
                    {t.reports.cancelling}
                  </>
                ) : (
                  t.reports.cancel
                )}
              </Button>
            ) : null}
          </CardFooter>
        </Card>

        <div className="flex min-w-0 flex-col gap-6">
          {result === null ? (
            <ResultsPlaceholder running={running} clinicCount={runClinics.length} />
          ) : (
            <>
              {result.cancelled ? (
                <Alert>
                  <AlertTitle>{t.reports.cancelled.title}</AlertTitle>
                  <AlertDescription>
                    {result.sheets.length === 0
                      ? t.reports.cancelled.nothing
                      : t.reports.cancelled.body}
                  </AlertDescription>
                </Alert>
              ) : null}
              {showsResults ? (
                <>
                  <OverviewCard result={result} />
                  <ResultsCard result={result} />
                  <UnmatchedCarrierRowsCard rows={result.unmatchedCarrierRows ?? []} />
                  <InactiveCarriersCard carriers={result.inactiveCarriers ?? []} />
                </>
              ) : null}
            </>
          )}
        </div>
      </div>

      <ReportGroupsDialog
        open={groupManagerOpen}
        onOpenChange={setGroupManagerOpen}
        groups={groups}
        clinics={assignment.clinics}
      />
    </div>
  );
}
