"use client";

import { Check, ChevronDown, Copy } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
// One row no carrier bot could take, with the carrier cell it was read from:
// that cell is the name the bots did not match.
export type UnmatchedCarrierRow = {
  rowNumber: number;
  carrier: string;
};
// Rows of one clinic tab that no carrier bot could take. They stay out of the
// results, so the operator works them by hand from this list.
export type UnmatchedCarrierRowsSection = {
  clinicId: Id<"clinics">;
  clinicName: string;
  tabTitle: string;
  rows: UnmatchedCarrierRow[];
};
export type ReportResult = {
  reportRunId: Id<"reportRuns"> | null;
  assignedClinicCount: number;
  // A run the operator stopped answers with the sheets it read before the
  // request landed, which is a short list and not a failed one.
  cancelled: boolean;
  sheets: SheetResult[];
  inactiveCarriers?: InactiveCarriersSection[];
  unmatchedCarrierRows?: UnmatchedCarrierRowsSection[];
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

type ClinicGroup = {
  clinicId: Id<"clinics">;
  clinicName: string;
  sheets: SheetResult[];
};

// The run comes back as one entry per clinic tab. Both cards read it grouped by
// clinic first and then by tab, so the tabs of a clinic stay together and the
// clinic is named once instead of on every tab.
function groupByClinic(sheets: SheetResult[]): ClinicGroup[] {
  const groups: ClinicGroup[] = [];
  const groupByClinicId = new Map<string, ClinicGroup>();

  for (const sheet of sheetsWithRowsFirst(sheets)) {
    let group = groupByClinicId.get(sheet.clinicId);
    if (group === undefined) {
      group = { clinicId: sheet.clinicId, clinicName: sheet.clinicName, sheets: [] };
      groupByClinicId.set(sheet.clinicId, group);
      groups.push(group);
    }
    group.sheets.push(sheet);
  }

  return groups;
}

function clinicRowCount(group: ClinicGroup): number {
  return group.sheets.reduce((total, sheet) => total + sheetRowCount(sheet), 0);
}

// A sheet that read no rows has nothing to show, so its section is left out of
// the results. A sheet that failed keeps its section, because the error is what
// the operator has to read.
function sheetHasContent(sheet: SheetResult): boolean {
  return sheetRowCount(sheet) > 0 || sheet.error !== null;
}

// A clinic none of whose sheet tabs has anything to show is left out of the
// results whole.
function clinicHasContent(group: ClinicGroup): boolean {
  return group.sheets.some(sheetHasContent);
}

/** Row numbers in the shape they are copied in: '2', '3', '33'. */
function formatRowNumbers(rowNumbers: number[]): string {
  return rowNumbers.map((rowNumber) => `'${rowNumber}'`).join(", ");
}

/** The row numbers of one sheet in the shape they are copied in. */
function rowNumberList(sheet: SheetResult): string {
  const rowNumbers = sheet.bucketRows
    .flatMap((bucket) => bucket.rows.map((row) => row.rowNumber))
    .sort((left, right) => left - right);
  return formatRowNumbers(rowNumbers);
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

/**
 * Copies one sheet's row number list. The button shows the icon alone, so its
 * name is what tells a screen reader which sheet it copies.
 */
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
      aria-label={
        isCopied ? t.reports.overview.copiedFor(label) : t.reports.overview.copyFor(label)
      }
      onClick={() => void copy()}
    >
      {isCopied ? (
        <Check data-icon="inline-start" aria-hidden="true" />
      ) : (
        <Copy data-icon="inline-start" aria-hidden="true" />
      )}
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
 * The rows of a clinic that no carrier bot could take, listed per clinic tab so
 * an operator can work them by hand. They stay out of the results, so this card
 * is the only place they appear, and it opens so the work is not hidden.
 */
export function UnmatchedCarrierRowsCard({ rows }: { rows: UnmatchedCarrierRowsSection[] }) {
  const { t } = useI18n();

  if (rows.length === 0) return null;

  return (
    <Card>
      <Collapsible defaultOpen>
        <CollapsibleTrigger className="group/unmatched flex w-full flex-col gap-1 px-(--card-spacing)">
          <span className="flex items-center justify-between gap-2">
            <span className="font-heading text-base leading-snug font-medium">
              {t.reports.unmatchedCarrierRows.title}
            </span>
            <ChevronDown
              className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]/unmatched:rotate-180"
              aria-hidden="true"
            />
          </span>
          <span className="text-sm text-muted-foreground">
            {t.reports.unmatchedCarrierRows.note}
          </span>
        </CollapsibleTrigger>
        <CollapsiblePanel className="mt-(--card-spacing) border-t px-(--card-spacing) pt-(--card-spacing)">
          <div className="flex flex-col gap-4">
            {rows.map((entry) => {
              const label = entry.tabTitle
                ? `${entry.clinicName} · ${entry.tabTitle}`
                : entry.clinicName;
              const rowNumbers = formatRowNumbers(entry.rows.map((row) => row.rowNumber));
              return (
                <div key={`${entry.clinicId}-${entry.tabTitle}`} className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-medium">{entry.clinicName}</h3>
                    {entry.tabTitle === "" ? null : (
                      <h4 className="text-xs text-muted-foreground">{entry.tabTitle}</h4>
                    )}
                    <CopyRowNumbers label={label} rowNumbers={rowNumbers} />
                  </div>
                  <div className="overflow-hidden rounded-lg border">
                    <Table>
                      <TableHeader className="bg-muted/40">
                        <TableRow>
                          <TableHead>{t.common.row}</TableHead>
                          <TableHead>{t.reports.unmatchedCarrierRows.carrier}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {entry.rows.map((row) => (
                          <TableRow key={row.rowNumber}>
                            <TableCell className="font-mono tabular-nums">
                              {row.rowNumber}
                            </TableCell>
                            <TableCell className="max-w-40">
                              <TruncatedText>{row.carrier || t.common.none}</TruncatedText>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              );
            })}
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
  // Only the sheets that found rows belong in the summary, so a clinic whose
  // tabs all came back empty is left out whole.
  const groups = groupByClinic(result.sheets)
    .map((group) => ({
      ...group,
      sheets: group.sheets.filter((sheet) => sheetRowCount(sheet) > 0),
    }))
    .filter((group) => group.sheets.length > 0);

  if (groups.length === 0) return null;

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
        {groups.map((group) => (
          <div key={group.clinicId} className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">{group.clinicName}</h3>
            <div className="flex flex-col gap-3 border-l pl-3">
              {group.sheets.map((sheet) => {
                const label = sheetLabel(sheet);
                const rowNumbers = rowNumberList(sheet);
                return (
                  <div
                    key={`${sheet.clinicId}-${sheet.tabTitle}`}
                    className="flex flex-col gap-1.5"
                  >
                    {sheet.tabTitle === "" ? null : (
                      <h4 className="text-xs text-muted-foreground">{sheet.tabTitle}</h4>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-mono text-xs">{rowNumbers}</p>
                      <CopyRowNumbers label={label} rowNumbers={rowNumbers} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/**
 * Renders one finished run. Each clinic the run found rows for is a tab named
 * after the clinic and its row count, and inside it the sheet tabs of that
 * clinic carry the rows they found. A clinic or a sheet tab with nothing to
 * show is left out, unless it failed, in which case its error stays in view.
 * Every value comes from the run itself, so editing the report controls
 * afterward never rewrites what the run returned.
 */
export function ResultsCard({ result }: { result: ReportResult }) {
  const { t } = useI18n();
  // The clinic the reader is looking at. A new run may not hold the clinic the
  // last one was on, and then the first tab of the new run is what shows.
  const [selectedClinicId, setSelectedClinicId] = useState<string | null>(null);
  const groups = groupByClinic(result.sheets).filter(clinicHasContent);
  const selectedGroup = groups.find((group) => group.clinicId === selectedClinicId) ?? groups[0];

  // A run that read no sheet and a run that found no row both answer with a
  // sentence instead of tabs.
  let emptyMessage: string | null = null;
  if (result.sheets.length === 0) {
    emptyMessage = t.reports.results.noneProcessed;
  } else if (groups.length === 0) {
    emptyMessage = t.reports.results.noMatchingRows;
  }

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
        {emptyMessage === null ? null : (
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        )}
        {selectedGroup === undefined ? null : (
          <Tabs
            value={selectedGroup.clinicId}
            onValueChange={(value) => setSelectedClinicId(value as string)}
            className="gap-4"
          >
            {/* A run can read many clinics, so the tabs wrap instead of running
                off the card. The height override carries the same variant as
                the fixed height the list sets by default, which is what makes
                one replace the other. */}
            <TabsList className="group-data-horizontal/tabs:h-auto w-full flex-wrap justify-start">
              {groups.map((group) => (
                <TabsTrigger
                  key={group.clinicId}
                  value={group.clinicId}
                  className="flex-initial max-w-full"
                >
                  <span className="min-w-0 truncate">{group.clinicName}</span>{" "}
                  <Badge variant="secondary" className="tabular-nums">
                    {clinicRowCount(group)}
                  </Badge>
                </TabsTrigger>
              ))}
            </TabsList>
            {groups.map((group) => (
              <TabsContent
                key={group.clinicId}
                value={group.clinicId}
                className="flex flex-col gap-4"
              >
                {group.sheets.filter(sheetHasContent).map((sheet) => {
                  const buckets = sheet.bucketRows.filter((bucket) => bucket.rows.length > 0);
                  // A sheet with neither a tab name nor a row count is a failed
                  // read of a whole sheet: only its error says anything.
                  const hasTabHeading = sheet.tabTitle !== "" || sheet.error === null;
                  return (
                    <div
                      key={`${sheet.clinicId}-${sheet.tabTitle}`}
                      className="flex flex-col gap-3"
                    >
                      {hasTabHeading ? (
                        <div className="flex flex-wrap items-center gap-2">
                          {sheet.tabTitle === "" ? null : (
                            <h4 className="text-xs font-medium">{sheet.tabTitle}</h4>
                          )}
                          {sheet.error === null ? (
                            <Badge variant="secondary" className="tabular-nums">
                              {sheetRowCount(sheet)}
                            </Badge>
                          ) : null}
                        </div>
                      ) : null}
                      {sheet.error ? (
                        <Alert variant="destructive">
                          <AlertTitle>{t.reports.results.sheetError}</AlertTitle>
                          <AlertDescription>{sheetErrorText(sheet.error, t)}</AlertDescription>
                        </Alert>
                      ) : (
                        buckets.map((bucket) => (
                          <ResultBucket
                            key={bucket.bucketKey}
                            bucket={bucket}
                            headers={sheet.headers}
                            showLabel={buckets.length > 1}
                          />
                        ))
                      )}
                    </div>
                  );
                })}
              </TabsContent>
            ))}
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
