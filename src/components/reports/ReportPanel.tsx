import { useAction, useQuery } from "convex/react";
import { CircleCheck, ClipboardList, FileText, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
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
import { cn } from "@/lib/utils";

type OperationKey = "pending-audit" | "ready-to-upload";

type ReportRow = { rowNumber: number; values: string[] };
// TEMPORARY while project is in development: mirrors the backend debug shape
// so testers can see why rows were filtered. Remove with the debug flag.
type SheetDebug = {
  totalRows: number;
  keptRows: number;
  operationKey: string;
  verificationFilter: string;
  updateStatusColumn: string;
  uploadStatusColumn: string;
  verificationTypeColumn: string;
  droppedByReason: Array<{ reason: string; count: number }>;
  samples: Array<{
    rowNumber: number;
    reason: string;
    l: string;
    m: string;
    verification: string;
    updateStatus: string;
    uploadStatus: string;
  }>;
};
type SheetResult = {
  clinicId: Id<"clinics">;
  clinicName: string;
  googleSheetId: string;
  tabTitle: string;
  headers: string[];
  readyRows: ReportRow[];
  reviewRows: ReportRow[];
  auditRows: ReportRow[];
  error: string | null;
  debug: SheetDebug | null;
};
type ReportResult = {
  reportRunId: Id<"reportRuns"> | null;
  assignedClinicCount: number;
  sheets: SheetResult[];
  runDebug: RunDebug | null;
};
type RunDebug = {
  clinicCount: number;
  startDate: string;
  endDate: string;
  operationKey: string;
  verificationFilter: string;
  summary: string;
  totalSheetRowsRead: number;
  totalRowsKept: number;
  clinics: Array<{
    clinicName: string;
    googleSheetId: string;
    tabsInRange: string[];
    dateTabsOutsideRange: string[];
    nonDateTabCount: number;
    nonDateTabSamples: string[];
    sheetError: string | null;
  }>;
  aggregateDropReasons: Array<{ reason: string; count: number }>;
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

const OPERATIONS: Array<{ key: OperationKey; label: string; description: string }> = [
  {
    key: "pending-audit",
    label: "Pending audit",
    description: "Rows waiting for QA review before upload.",
  },
  {
    key: "ready-to-upload",
    label: "Ready to upload (incl. review)",
    description:
      "Rows ready to upload and rows that need review. Both groups come from the same report.",
  },
];

function ResultTable({
  title,
  tone,
  count,
  headers,
  rows,
}: {
  title: string;
  tone: RowTone;
  count: number;
  headers: string[];
  rows: ReportRow[];
}) {
  if (rows.length === 0) return null;
  // Show first 8 data columns plus row number; full rows copy from the sheet.
  const visibleHeaders = headers.slice(0, 8);
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
              <TableHead>Row</TableHead>
              {visibleHeaders.map((header, index) => (
                <TableHead key={`${header}-${index}`}>{header || `Col ${index + 1}`}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.rowNumber}>
                <TableCell className="font-mono tabular-nums">{row.rowNumber}</TableCell>
                {visibleHeaders.map((_, index) => (
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

// TEMPORARY while project is in development: shows why rows were filtered so
// the report form can be tested without reading backend code. Delete this
// component and the debug flag once row rules are stable.
const DEBUG_REASON_LABELS: Record<string, string> = {
  too_short: "Row too short, missing columns",
  verification_mismatch: "Verification type did not match the filter",
  l_m_condition_failed: "Columns L/M failed, needs DONE or CHECK plus NOT FOUND",
  update_status_excluded: "Update status is in the exclude list",
  upload_status_not_empty_or_unchecked: "Upload status is not EMPTY or UNCHECKED",
  col_l_not_done: "Column L is not DONE",
  update_status_not_done: "Update status is not DONE",
  upload_terminal: "Upload already done, UPLOADED or DONE BY",
  upload_no_match: "Upload status matched neither ready nor review",
};

function formatTabList(tabs: string[], max = 6): string {
  if (tabs.length === 0) return "none";
  const shown = tabs.slice(0, max).join(", ");
  if (tabs.length <= max) return shown;
  return `${shown}, and ${tabs.length - max} more`;
}

function RunDebugPanel({ runDebug }: { runDebug: RunDebug }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-dashed p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-medium">Why this run returned {runDebug.totalRowsKept} rows</h4>
        <Badge variant="secondary">{runDebug.clinicCount} clinics</Badge>
      </div>
      <p className="text-sm">{runDebug.summary}</p>
      <p className="text-xs text-muted-foreground">
        Date range {runDebug.startDate} to {runDebug.endDate}. Operation {runDebug.operationKey},
        verification {runDebug.verificationFilter}. Read {runDebug.totalSheetRowsRead} sheet row(s)
        from tabs in range.
      </p>
      {runDebug.clinicCount === 0 ? (
        <p className="text-sm text-muted-foreground">
          Ask an admin to assign clinics to your account before running the report again.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {runDebug.clinics.map((clinic) => (
            <div key={clinic.googleSheetId} className="rounded-md border p-3 text-sm">
              <p className="font-medium">{clinic.clinicName}</p>
              {clinic.sheetError ? (
                <p className="mt-1 text-destructive">{clinic.sheetError}</p>
              ) : null}
              <ul className="mt-2 flex flex-col gap-1 text-muted-foreground">
                <li>Tabs in range: {formatTabList(clinic.tabsInRange)}</li>
                <li>Date tabs outside range: {formatTabList(clinic.dateTabsOutsideRange)}</li>
                {clinic.nonDateTabCount > 0 ? (
                  <li>
                    Other tab names ({clinic.nonDateTabCount}):{" "}
                    {formatTabList(clinic.nonDateTabSamples, 4)}
                  </li>
                ) : null}
              </ul>
            </div>
          ))}
        </div>
      )}
      {runDebug.aggregateDropReasons.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">Rows filtered out across all tabs</p>
          <ul className="flex flex-col gap-1 text-sm">
            {runDebug.aggregateDropReasons.map((item) => (
              <li key={item.reason} className="flex items-center gap-2">
                <Badge variant="outline" className="tabular-nums">
                  {item.count}
                </Badge>
                <span>{DEBUG_REASON_LABELS[item.reason] ?? item.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function DebugPanel({ debug }: { debug: SheetDebug }) {
  const sorted = [...debug.droppedByReason].sort((a, b) => b.count - a.count);
  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed p-3">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-medium">Why rows were filtered, temporary debug</h4>
        <Badge variant="secondary" className="tabular-nums">
          {debug.keptRows} of {debug.totalRows} kept
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Operation {debug.operationKey}, verification {debug.verificationFilter}. Columns: update{" "}
        {debug.updateStatusColumn}, upload {debug.uploadStatusColumn}, verification{" "}
        {debug.verificationTypeColumn}. Values below are uppercased, as the filter sees them.
      </p>
      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">No rows were dropped.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {sorted.map((item) => (
            <li key={item.reason} className="flex items-center gap-2">
              <Badge variant="outline" className="tabular-nums">
                {item.count}
              </Badge>
              <span>{DEBUG_REASON_LABELS[item.reason] ?? item.reason}</span>
            </li>
          ))}
        </ul>
      )}
      {debug.samples.length > 0 ? (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead>Row</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>L</TableHead>
                <TableHead>M</TableHead>
                <TableHead>{debug.verificationTypeColumn}</TableHead>
                <TableHead>{debug.updateStatusColumn}</TableHead>
                <TableHead>{debug.uploadStatusColumn}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {debug.samples.map((sample) => (
                <TableRow key={sample.rowNumber}>
                  <TableCell className="font-mono tabular-nums">{sample.rowNumber}</TableCell>
                  <TableCell className="max-w-48 truncate text-xs">
                    {DEBUG_REASON_LABELS[sample.reason] ?? sample.reason}
                  </TableCell>
                  <TableCell className="max-w-32 truncate text-xs">{sample.l}</TableCell>
                  <TableCell className="max-w-32 truncate text-xs">{sample.m}</TableCell>
                  <TableCell className="max-w-32 truncate text-xs">{sample.verification}</TableCell>
                  <TableCell className="max-w-32 truncate text-xs">{sample.updateStatus}</TableCell>
                  <TableCell className="max-w-32 truncate text-xs">{sample.uploadStatus}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}

function ResultsPlaceholder({ running, clinicCount }: { running: boolean; clinicCount: number }) {
  if (running) {
    return (
      <div className="flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <div className="flex items-center gap-2">
          <Spinner className="size-4 text-muted-foreground" />
          <h2 className="font-heading text-base font-medium leading-snug">Reading sheets</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Reading {clinicCount} clinic sheet{clinicCount === 1 ? "" : "s"}. This can take a moment.
        </p>
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-12 text-center">
      <FileText className="size-6 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-medium">No results yet</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Choose a date range and run a report. Rows appear here, grouped by clinic and sheet tab.
      </p>
    </div>
  );
}

export function ReportRunner() {
  const assignment = useQuery(api.googleSheets.listAssignedReportClinics, {});
  const runReport = useAction(api.reports.runSheetReport);

  const [operation, setOperation] = useState<OperationKey>("pending-audit");
  const [dateRange, setDateRange] = useState({ startDate: todayIso(), endDate: todayIso() });
  const [verification, setVerification] = useState<"all" | "fbd" | "elg">("all");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReportResult | null>(null);

  async function handleRun() {
    if ((assignment?.clinics.length ?? 0) === 0) {
      setError("No assigned clinics to run.");
      return;
    }
    if (!dateRange.startDate || !dateRange.endDate) {
      setError("Pick a start and end date.");
      return;
    }
    if (dateRange.startDate > dateRange.endDate) {
      setError("The start date must be on or before the end date.");
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const data = await runReport({
        operationKey: operation,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        verificationFilter: verification,
        // TEMPORARY while project is in development: always ask for filter
        // reasons so testers can see why rows were dropped.
        debug: true,
      });
      setResult(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The report failed.");
    } finally {
      setRunning(false);
    }
  }

  if (assignment === undefined) return <Skeleton className="h-80 w-full" />;

  const assignedClinicCount = assignment.clinics.length;

  const totalRows =
    result?.sheets.reduce((sum, sheet) => {
      if (operation === "pending-audit") return sum + sheet.auditRows.length;
      return sum + sheet.readyRows.length + sheet.reviewRows.length;
    }, 0) ?? 0;

  const selectedOperation = OPERATIONS.find((item) => item.key === operation);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Run report"
        description="Reads your assigned clinic sheets for the selected dates and applies the same row rules as the desktop tool."
      />

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Report failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start">
        <Card className="lg:sticky lg:top-20">
          <CardHeader>
            <h2 className="font-heading text-base leading-snug font-medium">Report settings</h2>
            <CardDescription>Choose what to read and which dates to cover.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <Field>
              <FieldLabel htmlFor="report-date-range">Date range</FieldLabel>
              <DateRangePicker
                id="report-date-range"
                value={dateRange}
                onChange={setDateRange}
                disabled={running}
              />
            </Field>

            <Field>
              <FieldLabel>Report type</FieldLabel>
              <Select
                items={OPERATIONS.map((item) => ({ value: item.key, label: item.label }))}
                value={operation}
                onValueChange={(value) => setOperation((value as OperationKey) ?? "pending-audit")}
                disabled={running}
              >
                <SelectTrigger aria-label="Report type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {OPERATIONS.map((item) => (
                      <SelectItem key={item.key} value={item.key}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {selectedOperation ? (
                <p className="text-xs text-muted-foreground">{selectedOperation.description}</p>
              ) : null}
            </Field>

            {operation === "pending-audit" ? (
              <Field>
                <FieldLabel>Verification type</FieldLabel>
                <Select
                  items={[
                    { value: "all", label: "All (FBD + ELG)" },
                    { value: "fbd", label: "FBD" },
                    { value: "elg", label: "ELG" },
                  ]}
                  value={verification}
                  onValueChange={(value) =>
                    setVerification((value as typeof verification) ?? "all")
                  }
                  disabled={running}
                >
                  <SelectTrigger aria-label="Verification type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="all">All (FBD + ELG)</SelectItem>
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
                <h3 className="text-sm font-medium">Included clinics</h3>
                <Badge variant="secondary" className="tabular-nums">
                  {assignedClinicCount}
                </Badge>
              </div>
              {assignment.usesAllClinics ? (
                <Badge variant="outline" className="w-fit">
                  All clinics (admin)
                </Badge>
              ) : null}
              {assignedClinicCount === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No clinics assigned yet. Ask an admin to assign clinics to your account.
                </p>
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
              disabled={running || assignedClinicCount === 0}
            >
              {running ? (
                <>
                  <Spinner data-icon="inline-start" />
                  Running report
                </>
              ) : (
                "Run report"
              )}
            </Button>
          </CardFooter>
        </Card>

        <div className="flex min-w-0 flex-col gap-6">
          {result === null ? (
            <ResultsPlaceholder running={running} clinicCount={assignedClinicCount} />
          ) : (
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-heading text-base leading-snug font-medium">Results</h2>
                  <Badge variant="secondary" className="tabular-nums">
                    {totalRows} rows
                  </Badge>
                </div>
                <CardDescription>
                  {result.assignedClinicCount} clinic(s), {dateRange.startDate} to{" "}
                  {dateRange.endDate}. Sheet row numbers match the Google Sheet.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-6">
                {result.runDebug ? <RunDebugPanel runDebug={result.runDebug} /> : null}
                {result.sheets.length === 0 && !result.runDebug ? (
                  <p className="text-sm text-muted-foreground">
                    No sheets were processed. Check your assigned clinics and the selected dates.
                  </p>
                ) : null}
                {result.sheets.map((sheet) => (
                  <div
                    key={`${sheet.clinicId}-${sheet.tabTitle}`}
                    className="flex flex-col gap-4 rounded-lg border p-4"
                  >
                    <h3 className="text-sm font-medium">
                      {sheet.clinicName} {sheet.tabTitle ? `· ${sheet.tabTitle}` : ""}
                    </h3>
                    {sheet.error ? (
                      <Alert variant="destructive">
                        <AlertTitle>Sheet error</AlertTitle>
                        <AlertDescription>{sheet.error}</AlertDescription>
                      </Alert>
                    ) : (
                      <>
                        {operation === "ready-to-upload" ? (
                          <>
                            <ResultTable
                              title="Ready to upload"
                              tone="success"
                              count={sheet.readyRows.length}
                              headers={sheet.headers}
                              rows={sheet.readyRows}
                            />
                            <ResultTable
                              title="Needs review"
                              tone="warning"
                              count={sheet.reviewRows.length}
                              headers={sheet.headers}
                              rows={sheet.reviewRows}
                            />
                          </>
                        ) : (
                          <ResultTable
                            title="Pending audit"
                            tone="neutral"
                            count={sheet.auditRows.length}
                            headers={sheet.headers}
                            rows={sheet.auditRows}
                          />
                        )}
                        {operation === "ready-to-upload" &&
                        sheet.readyRows.length === 0 &&
                        sheet.reviewRows.length === 0 ? (
                          <p className="text-sm text-muted-foreground">No matching rows.</p>
                        ) : null}
                        {operation === "pending-audit" && sheet.auditRows.length === 0 ? (
                          <p className="text-sm text-muted-foreground">No matching rows.</p>
                        ) : null}
                        {sheet.debug ? <DebugPanel debug={sheet.debug} /> : null}
                      </>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
