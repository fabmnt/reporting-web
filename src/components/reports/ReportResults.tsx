"use client";

import { ChevronDown, CircleCheck, ClipboardList, TriangleAlert } from "lucide-react";

import type { Id } from "../../../convex/_generated/dataModel";
import type { ReportSheetError } from "../../../convex/model/appErrors";
import { DataTableFrame } from "@/components/app/DataCard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useI18n } from "@/lib/i18n/context";
import { sheetErrorText } from "@/lib/i18n/errors";
import { cn } from "@/lib/utils";

export type ReportRow = { rowNumber: number; values: string[] };
export type BucketResult = {
  bucketKey: string;
  label: string;
  rows: ReportRow[];
  // 0-based sheet columns the conditions read to pick these rows.
  filterColumns: number[];
};
export type SheetResult = {
  clinicId: Id<"clinics">;
  clinicName: string;
  googleSheetId: string;
  tabTitle: string;
  headers: string[];
  bucketRows: BucketResult[];
  error: ReportSheetError | null;
};
export type ReportResult = {
  reportRunId: Id<"reportRuns"> | null;
  assignedClinicCount: number;
  sheets: SheetResult[];
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

type RowCell = { column: number; label: string; value: string };

function cellsOf(
  headers: string[],
  row: ReportRow,
  columns: number[],
  fallbackLabel: (index: number) => string
): RowCell[] {
  return columns.map((column) => ({
    column,
    label: headers[column] || fallbackLabel(column),
    value: row.values[column] ?? "",
  }));
}

// Cells with a value beyond the columns the phone card opens with: the empty
// columns most sheets carry would only add noise to the open row.
function filledColumnIndexes(row: ReportRow, shownColumns: number[]): number[] {
  const indexes: number[] = [];
  for (let index = 0; index < row.values.length; index += 1) {
    if (shownColumns.includes(index)) continue;
    if ((row.values[index] ?? "").trim() === "") continue;
    indexes.push(index);
  }
  return indexes;
}

/** A record of the phone layout: the cells that picked it are always in view. */
function ResultRowCard({
  headers,
  row,
  filterColumns,
}: {
  headers: string[];
  row: ReportRow;
  filterColumns: number[];
}) {
  const { t } = useI18n();
  const filterCells = cellsOf(headers, row, filterColumns, t.common.columnFallback);
  const restCells = cellsOf(
    headers,
    row,
    filledColumnIndexes(row, filterColumns),
    t.common.columnFallback
  );

  return (
    <li className="overflow-hidden rounded-lg border">
      <Collapsible>
        <CollapsibleTrigger className="group/row flex w-full flex-col gap-2 p-3">
          <span className="flex items-center justify-between gap-2">
            <span className="font-mono text-sm font-medium tabular-nums">
              {t.common.row} {row.rowNumber}
            </span>
            <ChevronDown
              className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]/row:rotate-180"
              aria-hidden="true"
            />
          </span>
          <ResultRowCells cells={filterCells} />
        </CollapsibleTrigger>
        {restCells.length === 0 ? null : (
          <CollapsiblePanel className="border-t p-3">
            <ResultRowCells cells={restCells} />
          </CollapsiblePanel>
        )}
      </Collapsible>
    </li>
  );
}

/**
 * Labelled cells of a row card. Spans keep the cells inside the trigger of the
 * collapsible, which only takes phrasing content.
 */
function ResultRowCells({ cells }: { cells: RowCell[] }) {
  return (
    <span className="grid gap-1.5">
      {cells.map((cell) => (
        // Grid columns that start at zero keep the row's own width at zero, so
        // a long value truncates inside its share instead of widening the card.
        <span
          key={cell.column}
          className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] items-center gap-3"
        >
          <span className="max-w-32 truncate text-xs text-muted-foreground">{cell.label}</span>
          <span className="min-w-0 truncate text-right text-sm">{cell.value}</span>
        </span>
      ))}
    </span>
  );
}

/** The result rows of narrow screens, one collapsible card per sheet row. */
function ResultRows({
  headers,
  rows,
  filterColumns,
}: {
  headers: string[];
  rows: ReportRow[];
  filterColumns: number[];
}) {
  return (
    <ul className="flex flex-col gap-2 lg:hidden">
      {rows.map((row) => (
        <ResultRowCard
          key={row.rowNumber}
          headers={headers}
          row={row}
          filterColumns={filterColumns}
        />
      ))}
    </ul>
  );
}

/** The result rows of wide screens, where the whole table fits. */
function ResultTable({
  headers,
  rows,
  filterColumns,
}: {
  headers: string[];
  rows: ReportRow[];
  filterColumns: number[];
}) {
  const { t } = useI18n();
  const columnIndexes = visibleColumnIndexes(headers.length, filterColumns);

  return (
    <DataTableFrame>
      <Table>
        <TableHeader className="bg-muted/40">
          <TableRow>
            <TableHead>{t.common.row}</TableHead>
            {columnIndexes.map((index) => (
              <TableHead key={index}>{headers[index] || t.common.columnFallback(index)}</TableHead>
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
    </DataTableFrame>
  );
}

function ResultBucket({
  bucket,
  tone,
  headers,
  showLabel,
}: {
  bucket: BucketResult;
  tone: RowTone;
  headers: string[];
  // A run with a single group is named after the report type the user just
  // picked, so only multi-group runs label their groups on narrow screens.
  showLabel: boolean;
}) {
  if (bucket.rows.length === 0) return null;
  const { Icon, iconClass, badgeClass } = TONES[tone];

  return (
    <section className="flex flex-col gap-2">
      {showLabel ? (
        <h4 className="text-xs font-medium text-muted-foreground lg:hidden">{bucket.label}</h4>
      ) : null}
      <div className="hidden items-center gap-2 lg:flex">
        <Icon className={cn("size-4", iconClass)} aria-hidden="true" />
        <h4 className="text-sm font-medium">{bucket.label}</h4>
        <Badge variant="outline" className={cn("tabular-nums", badgeClass)}>
          {bucket.rows.length}
        </Badge>
      </div>
      <ResultTable headers={headers} rows={bucket.rows} filterColumns={bucket.filterColumns} />
      <ResultRows headers={headers} rows={bucket.rows} filterColumns={bucket.filterColumns} />
    </section>
  );
}

function sheetRowCount(sheet: SheetResult): number {
  return sheet.bucketRows.reduce((sum, bucket) => sum + bucket.rows.length, 0);
}

function countRows(result: ReportResult): number {
  return result.sheets.reduce((sum, sheet) => sum + sheetRowCount(sheet), 0);
}

/**
 * Renders one finished run. Every value comes from the run itself, so editing
 * the report controls afterward never rewrites what the run returned.
 */
export function ResultsCard({ result }: { result: ReportResult }) {
  const { t } = useI18n();

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-heading text-base leading-snug font-medium">
            {t.reports.results.title}
          </h2>
          <Badge variant="secondary" className="tabular-nums">
            {t.reports.results.rows(countRows(result))}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {result.sheets.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.reports.results.noneProcessed}</p>
        ) : null}
        {result.sheets.map((sheet) => {
          const buckets = sheet.bucketRows.filter((bucket) => bucket.rows.length > 0);
          return (
            <div key={`${sheet.clinicId}-${sheet.tabTitle}`} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-medium">
                  {sheet.clinicName} {sheet.tabTitle ? `· ${sheet.tabTitle}` : ""}
                </h3>
                {sheet.error === null ? (
                  <Badge variant="secondary" className="tabular-nums">
                    {sheetRowCount(sheet)}
                  </Badge>
                ) : null}
              </div>
              {sheet.error ? (
                <Alert variant="destructive">
                  <AlertTitle>{t.reports.results.sheetError}</AlertTitle>
                  <AlertDescription>{sheetErrorText(sheet.error, t)}</AlertDescription>
                </Alert>
              ) : (
                <>
                  {buckets.map((bucket) => (
                    <ResultBucket
                      key={bucket.bucketKey}
                      bucket={bucket}
                      tone="neutral"
                      headers={sheet.headers}
                      showLabel={buckets.length > 1}
                    />
                  ))}
                  {buckets.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t.reports.results.noMatchingRows}
                    </p>
                  ) : null}
                </>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
