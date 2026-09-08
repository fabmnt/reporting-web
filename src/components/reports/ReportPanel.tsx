import { useAction, useQuery } from "convex/react";
import { useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { ProtectedRoute } from "../auth/ProtectedRoute";

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
  clientName: string;
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

const OPERATIONS: Array<{ key: OperationKey; label: string }> = [
  { key: "pending-audit", label: "Pending audit" },
  { key: "ready-to-upload", label: "Ready to upload" },
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function ResultTable({
  title,
  count,
  headers,
  rows,
}: {
  title: string;
  count: number;
  headers: string[];
  rows: ReportRow[];
}) {
  if (rows.length === 0) return null;
  // Show first 8 data columns plus row number; full rows copy from the sheet.
  const visibleHeaders = headers.slice(0, 8);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-medium">{title}</h4>
        <Badge variant="secondary">{count}</Badge>
      </div>
      <Table>
        <TableHeader>
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
              <TableCell className="font-mono">{row.rowNumber}</TableCell>
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
  );
}

// TEMPORARY while project is in development: shows why rows were filtered so
// the /reports form can be tested without reading backend code. Delete this
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
          Add an active clinic for this client in admin before running the report again.
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
                <Badge variant="outline">{item.count}</Badge>
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
        <Badge variant="secondary">
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
              <Badge variant="outline">{item.count}</Badge>
              <span>{DEBUG_REASON_LABELS[item.reason] ?? item.reason}</span>
            </li>
          ))}
        </ul>
      )}
      {debug.samples.length > 0 ? (
        <Table>
          <TableHeader>
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
                <TableCell className="font-mono">{sample.rowNumber}</TableCell>
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
      ) : null}
    </div>
  );
}

function PanelContent() {
  const clients = useQuery(api.googleSheets.listRunnableClients, {});
  const runReport = useAction(api.reports.runSheetReport);

  const [clientId, setClientId] = useState("");
  const [operation, setOperation] = useState<OperationKey>("pending-audit");
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(todayIso());
  const [verification, setVerification] = useState<"all" | "fbd" | "elg">("all");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReportResult | null>(null);

  async function handleRun() {
    if (!clientId) {
      setError("Choose a client first.");
      return;
    }
    if (startDate > endDate) {
      setError("The start date must be on or before the end date.");
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const data = await runReport({
        clientId: clientId as Id<"clients">,
        operationKey: operation,
        startDate,
        endDate,
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

  if (clients === undefined) return <Skeleton className="h-80 w-full" />;

  const selectedClient = clients.find((client) => client.clientId === clientId);
  const selectedClientClinicCount = selectedClient?.clinicCount ?? 0;

  const totalRows =
    result?.sheets.reduce(
      (sum, sheet) =>
        sum + sheet.readyRows.length + sheet.reviewRows.length + sheet.auditRows.length,
      0
    ) ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Run report</CardTitle>
          <CardDescription>
            Pick a client and date range. The backend reads each clinic sheet tab in that range and
            applies the same row rules as the desktop tool.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Report failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="report-start">Start date</FieldLabel>
              <Input
                id="report-start"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                disabled={running}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="report-end">End date</FieldLabel>
              <Input
                id="report-end"
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                disabled={running}
              />
            </Field>
            <Field>
              <FieldLabel>Client</FieldLabel>
              <Select
                items={clients.map((client) => ({
                  value: client.clientId,
                  label: `${client.name} (${client.clinicCount})`,
                }))}
                value={clientId}
                onValueChange={(value) => setClientId(value ?? "")}
                disabled={running}
              >
                <SelectTrigger aria-label="Client" className="w-full">
                  <SelectValue placeholder="Choose a client" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {clients.map((client) => (
                      <SelectItem key={client.clientId} value={client.clientId}>
                        {client.name} ({client.clinicCount})
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
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
          </div>
          {selectedClient && selectedClientClinicCount === 0 ? (
            <Alert>
              <AlertTitle>No clinics for this client</AlertTitle>
              <AlertDescription>
                &quot;{selectedClient.name}&quot; has no active clinics. Add a clinic for this client
                in admin first.
              </AlertDescription>
            </Alert>
          ) : null}
          <div>
            <Button onClick={() => void handleRun()} disabled={running || clients.length === 0}>
              {running ? "Running..." : "Run report"}
            </Button>
          </div>
          {clients.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No active clients yet. Ask an admin to create a client and add clinics first.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {result ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {result.clientName} <Badge variant="secondary">{totalRows} rows</Badge>
            </CardTitle>
            <CardDescription>
              {startDate} to {endDate}. Sheet row numbers match the Google Sheet.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {result.runDebug ? <RunDebugPanel runDebug={result.runDebug} /> : null}
            {result.sheets.length === 0 && !result.runDebug ? (
              <p className="text-sm text-muted-foreground">
                No sheets were processed. Enable debug or check the client and clinic configuration.
              </p>
            ) : null}
            {result.sheets.map((sheet) => (
              <div
                key={`${sheet.clinicId}-${sheet.tabTitle}`}
                className="flex flex-col gap-4 rounded-lg border p-4"
              >
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium">
                    {sheet.clinicName} {sheet.tabTitle ? `· ${sheet.tabTitle}` : ""}
                  </h3>
                </div>
                {sheet.error ? (
                  <Alert variant="destructive">
                    <AlertTitle>Sheet error</AlertTitle>
                    <AlertDescription>{sheet.error}</AlertDescription>
                  </Alert>
                ) : (
                  <>
                    <ResultTable
                      title="Ready to upload"
                      count={sheet.readyRows.length}
                      headers={sheet.headers}
                      rows={sheet.readyRows}
                    />
                    <ResultTable
                      title="Needs review"
                      count={sheet.reviewRows.length}
                      headers={sheet.headers}
                      rows={sheet.reviewRows}
                    />
                    <ResultTable
                      title="Pending audit"
                      count={sheet.auditRows.length}
                      headers={sheet.headers}
                      rows={sheet.auditRows}
                    />
                    {sheet.readyRows.length === 0 &&
                    sheet.reviewRows.length === 0 &&
                    sheet.auditRows.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No matching rows.</p>
                    ) : null}
                    {sheet.debug ? <DebugPanel debug={sheet.debug} /> : null}
                  </>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export function ReportPanel({ convexUrl }: { convexUrl?: string }) {
  return (
    <ProtectedRoute convexUrl={convexUrl}>
      <PanelContent />
    </ProtectedRoute>
  );
}
