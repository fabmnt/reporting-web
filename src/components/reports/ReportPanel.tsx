"use client";

import { useAction, useQuery } from "convex/react";
import { CircleCheck, ClipboardList, FileText, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { ReportSheetError } from "../../../convex/model/appErrors";
import { PageHeader } from "@/components/app/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { todayIso } from "@/lib/dates";
import { useDocumentTitle, useI18n } from "@/lib/i18n/context";
import {
  localizedError,
  localizedMessage,
  sheetErrorText,
  type LocalizedMessage,
} from "@/lib/i18n/errors";
import type { Messages } from "@/lib/i18n/messages";
import { bucketLabel, operationDescription, operationLabel } from "@/lib/i18n/reportLabels";
import { cn } from "@/lib/utils";

type BuiltinOperationKey = "pending-audit";
type ReportTypeSource = "builtin" | "custom";

type RunnableType = {
  source: ReportTypeSource;
  key: string;
  label: string;
  description: string;
  buckets: Array<{ key: string; label: string }>;
};

type ReportRow = { rowNumber: number; values: string[] };
type SheetResult = {
  clinicId: Id<"clinics">;
  clinicName: string;
  googleSheetId: string;
  tabTitle: string;
  headers: string[];
  bucketRows: Array<{
    bucketKey: string;
    label: string;
    rows: ReportRow[];
    // 0-based sheet columns the conditions read to pick these rows.
    filterColumns: number[];
  }>;
  error: ReportSheetError | null;
};
type ReportResult = {
  reportRunId: Id<"reportRuns"> | null;
  assignedClinicCount: number;
  sheets: SheetResult[];
};
// A finished run plus the parameters it actually used. The results view reads
// only from here, so editing the controls never rewrites what a run returned.
type CompletedRun = {
  data: ReportResult;
  source: ReportTypeSource;
  // Built-in runs carry the operation key, which is what the translated bucket
  // labels are looked up by.
  operationKey: string | null;
  startDate: string;
  endDate: string;
};
type RowTone = "neutral" | "success" | "warning";

const TONES: Record<
  RowTone,
  { Icon: typeof ClipboardList; iconClass: string; badgeClass: string }
> = {
  neutral: {
    Icon: ClipboardList,
    iconClass: "text-muted-foreground",
    badgeClass: "border-transparent bg-muted text-foreground",
  },
  success: {
    Icon: CircleCheck,
    iconClass: "text-success",
    badgeClass: "border-transparent bg-success/10 text-success",
  },
  warning: {
    Icon: TriangleAlert,
    iconClass: "text-warning",
    badgeClass: "border-transparent bg-warning/10 text-warning",
  },
};

// Row tone per built-in bucket key. Custom report types name their own groups,
// so they stay neutral instead of guessing what a name means.
const BUCKET_TONES: Record<string, RowTone> = {
  audit: "neutral",
};

function bucketTone(source: ReportTypeSource, bucketKey: string): RowTone {
  if (source !== "builtin") return "neutral";
  return BUCKET_TONES[bucketKey] ?? "neutral";
}

// Built-in report types travel from the backend with their English labels, so
// the list is translated once here and everything downstream reads it.
function translatedTypes(types: RunnableType[], t: Messages): RunnableType[] {
  return types.map((item) => {
    if (item.source !== "builtin") return item;
    return {
      ...item,
      label: operationLabel(t, item.key, item.label),
      description: operationDescription(t, item.key, item.description),
      buckets: item.buckets.map((bucket) => ({
        ...bucket,
        label: bucketLabel(t, item.key, bucket.key, bucket.label),
      })),
    };
  });
}

// Leading data columns shown beside the row number; the rest of the sheet is
// read from the sheet itself.
const LEADING_COLUMN_COUNT = 8;

// Sheet columns of a result table: the leading ones for context plus the ones
// the conditions read, so every row shows the cells that put it in the bucket.
function visibleColumnIndexes(headerCount: number, filterColumns: number[]): number[] {
  const indexes = new Set<number>();
  for (let index = 0; index < Math.min(headerCount, LEADING_COLUMN_COUNT); index += 1) {
    indexes.add(index);
  }
  for (const index of filterColumns) indexes.add(index);
  return [...indexes].sort((left, right) => left - right);
}

function ResultTable({
  title,
  tone,
  count,
  headers,
  rows,
  filterColumns,
}: {
  title: string;
  tone: RowTone;
  count: number;
  headers: string[];
  rows: ReportRow[];
  filterColumns: number[];
}) {
  const { t } = useI18n();

  if (rows.length === 0) return null;
  const columnIndexes = visibleColumnIndexes(headers.length, filterColumns);
  const { Icon, iconClass, badgeClass } = TONES[tone];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Icon className={cn("size-4", iconClass)} aria-hidden="true" />
        <h4 className="text-sm font-medium">{title}</h4>
        <Badge variant="outline" className={cn("tabular-nums", badgeClass)}>
          {count}
        </Badge>
      </div>
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead>{t.common.row}</TableHead>
              {columnIndexes.map((index) => (
                <TableHead key={index}>
                  {headers[index] || t.common.columnFallback(index)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.rowNumber}>
                <TableCell className="font-mono tabular-nums">{row.rowNumber}</TableCell>
                {columnIndexes.map((index) => (
                  <TableCell key={index} className="max-w-40 truncate">
                    {row.values[index] ?? ""}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function ReportRunnerSkeleton() {
  const { t } = useI18n();

  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label={t.reports.loading.page}>
      <PageHeader title={t.reports.pageTitle} description={t.reports.pageDescription} />
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

function countRows(run: CompletedRun): number {
  return run.data.sheets.reduce(
    (sum, sheet) =>
      sum + sheet.bucketRows.reduce((sheetSum, bucket) => sheetSum + bucket.rows.length, 0),
    0
  );
}

/**
 * Renders one finished run. Every value comes from the run itself, so editing
 * the report controls afterward never rewrites what the run returned.
 */
function ResultsCard({ run }: { run: CompletedRun }) {
  const { t } = useI18n();
  const { data } = run;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-heading text-base leading-snug font-medium">
            {t.reports.results.title}
          </h2>
          <Badge variant="secondary" className="tabular-nums">
            {t.reports.results.rows(countRows(run))}
          </Badge>
        </div>
        <CardDescription>
          {t.reports.results.summary(
            t.reports.results.clinics(data.assignedClinicCount),
            run.startDate,
            run.endDate
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {data.sheets.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.reports.results.noneProcessed}</p>
        ) : null}
        {data.sheets.map((sheet) => (
          <div
            key={`${sheet.clinicId}-${sheet.tabTitle}`}
            className="flex flex-col gap-4 rounded-lg border p-4"
          >
            <h3 className="text-sm font-medium">
              {sheet.clinicName} {sheet.tabTitle ? `· ${sheet.tabTitle}` : ""}
            </h3>
            {sheet.error ? (
              <Alert variant="destructive">
                <AlertTitle>{t.reports.results.sheetError}</AlertTitle>
                <AlertDescription>{sheetErrorText(sheet.error, t)}</AlertDescription>
              </Alert>
            ) : (
              <>
                {sheet.bucketRows.map((bucket) => (
                  <ResultTable
                    key={bucket.bucketKey}
                    title={
                      run.operationKey === null
                        ? bucket.label
                        : bucketLabel(t, run.operationKey, bucket.bucketKey, bucket.label)
                    }
                    tone={bucketTone(run.source, bucket.bucketKey)}
                    count={bucket.rows.length}
                    headers={sheet.headers}
                    rows={bucket.rows}
                    filterColumns={bucket.filterColumns}
                  />
                ))}
                {sheet.bucketRows.every((bucket) => bucket.rows.length === 0) ? (
                  <p className="text-sm text-muted-foreground">
                    {t.reports.results.noMatchingRows}
                  </p>
                ) : null}
              </>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function ReportRunner() {
  const { t } = useI18n();
  const assignment = useQuery(api.googleSheets.listAssignedReportClinics, {});
  const typeData = useQuery(api.reportTypes.listRunnable, {});
  const runReport = useAction(api.reports.runSheetReport);

  const [typeKey, setTypeKey] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState({ startDate: todayIso(), endDate: todayIso() });
  const [verification, setVerification] = useState<"all" | "fbd" | "elg">("all");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<LocalizedMessage | null>(null);
  const [result, setResult] = useState<CompletedRun | null>(null);

  useDocumentTitle(t.app.titles.report);

  const types: RunnableType[] = translatedTypes(typeData?.types ?? [], t);
  const selectedType = types.find((item) => item.key === typeKey) ?? types[0];
  const builtinTypes = types.filter((item) => item.source === "builtin");
  const customTypes = types.filter((item) => item.source === "custom");

  async function handleRun() {
    if ((assignment?.clinics.length ?? 0) === 0) {
      setError(localizedMessage((t) => t.reports.outcomes.noAssignedClinics));
      return;
    }
    if (selectedType === undefined) {
      setError(localizedMessage((t) => t.reports.outcomes.noReportType));
      return;
    }
    if (!dateRange.startDate || !dateRange.endDate) {
      setError(localizedMessage((t) => t.reports.outcomes.pickDates));
      return;
    }
    if (dateRange.startDate > dateRange.endDate) {
      setError(localizedMessage((t) => t.reports.outcomes.invalidRange));
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const data = await runReport({
        target:
          selectedType.source === "builtin"
            ? { source: "builtin", operationKey: selectedType.key as BuiltinOperationKey }
            : { source: "custom", reportTypeId: selectedType.key as Id<"reportTypes"> },
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        verificationFilter: verification,
      });
      setResult({
        data,
        source: selectedType.source,
        operationKey: selectedType.source === "builtin" ? selectedType.key : null,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
      });
    } catch (cause) {
      setError(localizedError(cause, (t) => t.reports.outcomes.failed));
    } finally {
      setRunning(false);
    }
  }

  if (assignment === undefined || typeData === undefined) return <ReportRunnerSkeleton />;

  const assignedClinicCount = assignment.clinics.length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.reports.pageTitle} description={t.reports.pageDescription} />

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
                value={dateRange}
                onChange={setDateRange}
                disabled={running}
              />
            </Field>

            <Field>
              <FieldLabel>{t.reports.reportType}</FieldLabel>
              <Select
                items={types.map((item) => ({ value: item.key, label: item.label }))}
                value={selectedType?.key ?? ""}
                onValueChange={(value) => setTypeKey((value as string) ?? null)}
                disabled={running}
              >
                <SelectTrigger aria-label={t.reports.reportType} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>{t.reports.builtIn}</SelectLabel>
                    {builtinTypes.map((item) => (
                      <SelectItem key={item.key} value={item.key}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  {customTypes.length > 0 ? (
                    <SelectGroup>
                      <SelectLabel>{t.reports.myReportTypes}</SelectLabel>
                      {customTypes.map((item) => (
                        <SelectItem key={item.key} value={item.key}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ) : null}
                </SelectContent>
              </Select>
              {selectedType ? (
                <p className="text-xs text-muted-foreground">{selectedType.description}</p>
              ) : null}
            </Field>

            {selectedType?.source === "builtin" && selectedType.key === "pending-audit" ? (
              <Field>
                <FieldLabel>{t.reports.verificationType}</FieldLabel>
                <Select
                  items={[
                    { value: "all", label: t.reports.verificationAll },
                    { value: "fbd", label: "FBD" },
                    { value: "elg", label: "ELG" },
                  ]}
                  value={verification}
                  onValueChange={(value) =>
                    setVerification((value as typeof verification) ?? "all")
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
                  {assignedClinicCount}
                </Badge>
              </div>
              {assignedClinicCount === 0 ? (
                <p className="text-sm text-muted-foreground">{t.reports.noAssignedClinics}</p>
              ) : (
                <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto text-sm text-muted-foreground">
                  {assignment.clinics.map((clinic) => (
                    <li key={clinic.clinicId}>
                      {clinic.name} <span aria-hidden="true">·</span> {clinic.clientName}
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
              disabled={running || assignedClinicCount === 0 || selectedType === undefined}
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
            <ResultsPlaceholder running={running} clinicCount={assignedClinicCount} />
          ) : (
            <ResultsCard run={result} />
          )}
        </div>
      </div>
    </div>
  );
}
