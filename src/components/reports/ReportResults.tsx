"use client";

import { ChevronDown, Copy } from "lucide-react";
import { useState } from "react";

import type { Id } from "../../../convex/_generated/dataModel";
import type { ReportSheetError } from "../../../convex/model/appErrors";
import { DataTableFrame } from "@/components/app/DataCard";
import { TruncatedText } from "@/components/app/TruncatedText";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

export type ReportRow = { rowNumber: number; values: string[]; carriers?: string[] };
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
// Bots of one clinic that the carrier API reports as not active, or whose
// pattern this app will not run, so the operator can tell a short list from a
// complete one.
export type InactiveCarriersSection = {
  clinicId: Id<"clinics">;
  clinicName: string;
  bots: Array<{ name: string; status: string; unsupported?: boolean }>;
};
export type ReportResult = {
  reportRunId: Id<"reportRuns"> | null;
  assignedClinicCount: number;
  sheets: SheetResult[];
  inactiveCarriers?: InactiveCarriersSection[];
};

// Leading data columns shown beside the row number; the rest of the sheet is
// read from the sheet itself.
const LEADING_COLUMN_COUNT = 8;

// The carriers a row matched belong to no sheet column, so they travel under
// a column number of their own.
const CARRIER_CELL_COLUMN = -1;

// Sheet columns of a result table, in reading order: the columns the conditions
// read come first so every row shows the cells that put it in the bucket, then
// the leading columns give the row its context.
function tableColumnIndexes(headerCount: number, filterColumns: number[]): number[] {
  const filters = [...new Set(filterColumns)].sort((left, right) => left - right);
  const leading: number[] = [];
  for (let index = 0; index < Math.min(headerCount, LEADING_COLUMN_COUNT); index += 1) {
    if (!filters.includes(index)) leading.push(index);
  }
  return [...filters, ...leading];
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

function sheetRowCount(sheet: SheetResult): number {
  return sheet.bucketRows.reduce((sum, bucket) => sum + bucket.rows.length, 0);
}

function countRows(result: ReportResult): number {
  return result.sheets.reduce((sum, sheet) => sum + sheetRowCount(sheet), 0);
}

/** How a sheet is named on both cards: the clinic and the tab it was read from. */
function sheetLabel(sheet: SheetResult): string {
  return sheet.tabTitle ? `${sheet.clinicName} · ${sheet.tabTitle}` : sheet.clinicName;
}

// A sheet that holds rows is what the run was for, so it reads before the
// sheets that found nothing. The order the run returned is kept inside both.
function sheetsWithRowsFirst(sheets: SheetResult[]): SheetResult[] {
  return [
    ...sheets.filter((sheet) => sheetRowCount(sheet) > 0),
    ...sheets.filter((sheet) => sheetRowCount(sheet) === 0),
  ];
}

/** The row numbers of one sheet in the shape they are copied in: '2', '3', '33'. */
function rowNumberList(sheet: SheetResult): string {
  const rowNumbers = sheet.bucketRows
    .flatMap((bucket) => bucket.rows.map((row) => row.rowNumber))
    .sort((left, right) => left - right);
  return rowNumbers.map((rowNumber) => `'${rowNumber}'`).join(", ");
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
  // The carriers that matched the row explain it as much as the cells behind
  // the filter, so the open row lists them beside those cells.
  const carrierCells: RowCell[] = row.carriers?.length
    ? [
        {
          column: CARRIER_CELL_COLUMN,
          label: t.reports.results.carriers,
          value: row.carriers.join(", "),
        },
      ]
    : [];
  const filterCells = [
    ...cellsOf(headers, row, filterColumns, t.common.columnFallback),
    ...carrierCells,
  ];
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

// Opening the row shows its cells in full. The cells sit inside the button that
// opens the row, where a focusable control is not allowed, so the row itself is
// how a keyboard reads a clipped value.
const ROW_OPEN_REVEAL =
  "group-data-[panel-open]/row:whitespace-normal group-data-[panel-open]/row:wrap-anywhere";

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
          <TruncatedText
            isPressOnly
            className={cn("max-w-32 text-xs text-muted-foreground", ROW_OPEN_REVEAL)}
          >
            {cell.label}
          </TruncatedText>
          <TruncatedText isPressOnly className={cn("min-w-0 text-right text-sm", ROW_OPEN_REVEAL)}>
            {cell.value}
          </TruncatedText>
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

/**
 * One column title. The title of a column that holds values stays out of the
 * flow, so the widest cell sets the column width and the title truncates
 * instead. A column whose rows are all empty keeps its title in the flow, or
 * the column would collapse to nothing.
 */
function ColumnHead({ label, titleSetsWidth }: { label: string; titleSetsWidth: boolean }) {
  return (
    <TableHead className={titleSetsWidth ? "max-w-40" : "relative"}>
      <span
        className={
          titleSetsWidth
            ? "block max-w-40 truncate"
            : "absolute inset-x-2 top-1/2 -translate-y-1/2 truncate"
        }
        title={label}
      >
        {label}
      </span>
    </TableHead>
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
  const columnIndexes = tableColumnIndexes(headers.length, filterColumns);
  const emptyColumns = new Set(
    columnIndexes.filter((index) => rows.every((row) => (row.values[index] ?? "").trim() === ""))
  );
  const showsCarriers = rows.some((row) => (row.carriers?.length ?? 0) > 0);

  return (
    <DataTableFrame>
      <Table>
        <TableHeader className="bg-muted/40">
          <TableRow>
            <TableHead>{t.common.row}</TableHead>
            {showsCarriers ? <TableHead>{t.reports.results.carriers}</TableHead> : null}
            {columnIndexes.map((index) => (
              <ColumnHead
                key={index}
                label={headers[index] || t.common.columnFallback(index)}
                titleSetsWidth={emptyColumns.has(index)}
              />
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.rowNumber}>
              <TableCell className="font-mono tabular-nums">{row.rowNumber}</TableCell>
              {showsCarriers ? (
                <TableCell className="max-w-40">
                  <TruncatedText>{(row.carriers ?? []).join(", ")}</TruncatedText>
                </TableCell>
              ) : null}
              {columnIndexes.map((index) => (
                <TableCell key={index} className="max-w-40">
                  <TruncatedText>{row.values[index] ?? ""}</TruncatedText>
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
  headers,
  showLabel,
}: {
  bucket: BucketResult;
  headers: string[];
  // A run with a single group is named after the report type the user just
  // picked, so only multi-group runs label their groups.
  showLabel: boolean;
}) {
  if (bucket.rows.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      {showLabel ? (
        <h4 className="text-xs font-medium text-muted-foreground">{bucket.label}</h4>
      ) : null}
      <ResultTable headers={headers} rows={bucket.rows} filterColumns={bucket.filterColumns} />
      <ResultRows headers={headers} rows={bucket.rows} filterColumns={bucket.filterColumns} />
    </section>
  );
}

/** Copies one sheet's row number list. */
function CopyRowNumbers({ label, rowNumbers }: { label: string; rowNumbers: string }) {
  const { t } = useI18n();
  const [isCopied, setIsCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(rowNumbers);
      setIsCopied(true);
    } catch {
      // Browsers refuse clipboard access outside a secure context. The list
      // stays on screen, so it can still be copied by hand.
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      aria-label={t.reports.overview.copyFor(label)}
      onClick={() => void copy()}
    >
      <Copy data-icon="inline-start" aria-hidden="true" />
      {isCopied ? t.reports.overview.copied : t.reports.overview.copy}
    </Button>
  );
}

/**
 * The bots of each clinic that the carrier API reports as not active, or whose
 * pattern this app will not run, so a short list is not read as a complete one.
 * It opens closed: the card answers a question about the results, it is not the
 * results themselves.
 */
export function InactiveCarriersCard({ carriers }: { carriers: InactiveCarriersSection[] }) {
  const { t } = useI18n();

  if (carriers.length === 0) return null;

  return (
    <Card>
      <Collapsible>
        <CollapsibleTrigger className="group/carriers flex w-full flex-col gap-1 px-(--card-spacing)">
          <span className="flex items-center justify-between gap-2">
            <span className="font-heading text-base leading-snug font-medium">
              {t.reports.inactiveCarriers.title}
            </span>
            <ChevronDown
              className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]/carriers:rotate-180"
              aria-hidden="true"
            />
          </span>
          <span className="text-sm text-muted-foreground">{t.reports.inactiveCarriers.note}</span>
        </CollapsibleTrigger>
        <CollapsiblePanel className="mt-(--card-spacing) border-t px-(--card-spacing) pt-(--card-spacing)">
          <div className="flex flex-col gap-4">
            {carriers.map((clinic) => (
              <div key={clinic.clinicId} className="flex flex-col gap-1.5">
                <h3 className="text-sm font-medium">{clinic.clinicName}</h3>
                <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                  {clinic.bots.map((bot) => (
                    <li key={bot.name}>
                      {bot.name} <span aria-hidden="true">·</span>{" "}
                      {bot.unsupported === true
                        ? t.reports.inactiveCarriers.patternUnsupported
                        : bot.status}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </Card>
  );
}

/**
 * The summary of a finished run: how many rows it found and the numbers of
 * those rows per clinic and sheet tab, each with the button that copies them.
 * A run that found nothing has nothing to summarize, so the card stays out.
 */
export function OverviewCard({ result }: { result: ReportResult }) {
  const { t } = useI18n();
  const sheets = sheetsWithRowsFirst(result.sheets).filter((sheet) => sheetRowCount(sheet) > 0);

  if (sheets.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-heading text-base leading-snug font-medium">
            {t.reports.overview.title}
          </h2>
          <Badge variant="secondary" className="tabular-nums">
            {t.reports.results.rows(countRows(result))}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {sheets.map((sheet) => {
          const label = sheetLabel(sheet);
          const rowNumbers = rowNumberList(sheet);
          return (
            <div key={`${sheet.clinicId}-${sheet.tabTitle}`} className="flex flex-col gap-1.5">
              <h3 className="text-sm font-medium">{label}</h3>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-mono text-xs">{rowNumbers}</p>
                <CopyRowNumbers label={label} rowNumbers={rowNumbers} />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
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
        {sheetsWithRowsFirst(result.sheets).map((sheet) => {
          const buckets = sheet.bucketRows.filter((bucket) => bucket.rows.length > 0);
          return (
            <div key={`${sheet.clinicId}-${sheet.tabTitle}`} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-medium">{sheetLabel(sheet)}</h3>
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
