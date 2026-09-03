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
};
type ReportResult = {
  reportRunId: Id<"reportRuns"> | null;
  scopeName: string;
  sheets: SheetResult[];
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

function PanelContent() {
  const scopes = useQuery(api.googleSheets.listRunnableScopes, {});
  const runReport = useAction(api.reports.runSheetReport);

  const [scopeId, setScopeId] = useState("");
  const [operation, setOperation] = useState<OperationKey>("pending-audit");
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(todayIso());
  const [verification, setVerification] = useState<"all" | "fbd" | "elg">("all");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReportResult | null>(null);

  async function handleRun() {
    if (!scopeId) {
      setError("Choose a reporting scope first.");
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
        reportingScopeId: scopeId as Id<"reportingScopes">,
        operationKey: operation,
        startDate,
        endDate,
        verificationFilter: verification,
      });
      setResult(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The report failed.");
    } finally {
      setRunning(false);
    }
  }

  if (scopes === undefined) return <Skeleton className="h-80 w-full" />;

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
            Pick dates and a scope. The backend reads each clinic sheet tab in that range and
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
              <FieldLabel>Reporting scope</FieldLabel>
              <Select
                items={scopes.map((scope) => ({
                  value: scope.reportingScopeId,
                  label: `${scope.name} (${scope.clinicCount})`,
                }))}
                value={scopeId}
                onValueChange={(value) => setScopeId(value ?? "")}
                disabled={running}
              >
                <SelectTrigger aria-label="Reporting scope" className="w-full">
                  <SelectValue placeholder="Choose a scope" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {scopes.map((scope) => (
                      <SelectItem key={scope.reportingScopeId} value={scope.reportingScopeId}>
                        {scope.name} ({scope.clinicCount})
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
          <div>
            <Button onClick={() => void handleRun()} disabled={running || scopes.length === 0}>
              {running ? "Running..." : "Run report"}
            </Button>
          </div>
          {scopes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No active scopes yet. Ask an admin to create a scope and link clinics first.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {result ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {result.scopeName} <Badge variant="secondary">{totalRows} rows</Badge>
            </CardTitle>
            <CardDescription>
              {startDate} to {endDate}. Sheet row numbers match the Google Sheet.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
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
