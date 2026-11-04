import { useAction, useMutation, useQuery } from "convex/react";
import { ChevronRight, Plus, RefreshCw } from "lucide-react";
import { Suspense, use, useState, useTransition } from "react";

import { api } from "../../../convex/_generated/api";
import { AdminTabs } from "@/components/app/AdminTabs";
import { PageHeader } from "@/components/app/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  addInBatches,
  areAllSelected,
  filterGroups,
  isAddable,
  isClinicSelected,
  isGroupSelectable,
  isGroupSelected,
  NO_EXCLUSIONS,
  selectedGroups,
  setGroupsSelected,
  toggleClinic,
  toggleGroup,
  type AddResult,
  type Exclusions,
  type MissingClientGroup,
  type MissingClinic,
  type SelectedGroup,
} from "@/lib/directorySync";
import { useDocumentTitle, useI18n } from "@/lib/i18n/context";
import { localizedError, type LocalizedMessage } from "@/lib/i18n/errors";
import type { Messages } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";

// The check never throws into React: a failed read renders as an alert.
type LoadOutcome = { ok: true; groups: MissingClientGroup[] } | { ok: false; error: unknown };

// What the confirmation adds: one client, or every ticked client when null.
type ConfirmScope = { clientKey: string | null };

// Every load calls the Control Central API, so a load is a promise held in
// state and only replaced on purpose: on refresh and after an add.
type LoadRequest = { version: number; outcome: Promise<LoadOutcome> };

function summaryOf(selection: SelectedGroup[], t: Messages): string {
  const clients = selection.filter((entry) => entry.createsClient).length;
  const clinics = selection.reduce((total, entry) => total + entry.clinics.length, 0);
  return t.admin.directorySync.summary(clients, clinics);
}

function groupName(group: MissingClientGroup, t: Messages): string {
  return group.key === "" ? t.admin.directorySync.noClientGroup : group.name;
}

function ClinicOption({
  clinic,
  checked,
  disabled,
  onToggle,
}: {
  clinic: MissingClinic;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const labels = t.admin.directorySync;

  return (
    <label className="flex cursor-pointer items-start gap-3 text-sm has-[:disabled]:cursor-not-allowed">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        disabled={disabled || !isAddable(clinic)}
        className="mt-0.5 size-4 shrink-0 accent-primary"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className={cn("wrap-anywhere", !isAddable(clinic) && "text-muted-foreground")}>
            {clinic.name || t.common.none}
          </span>
          {clinic.problem === null ? null : (
            <Badge variant="outline">{labels.problems[clinic.problem]}</Badge>
          )}
        </span>
        <span className="font-mono text-xs wrap-anywhere text-muted-foreground">
          {labels.externalId}: {clinic.externalClinicId} · {labels.sheet}:{" "}
          {clinic.googleSheetId || t.common.none}
        </span>
      </span>
    </label>
  );
}

function ClientGroup({
  group,
  exclusions,
  isOpen,
  disabled,
  canAdd,
  onToggleOpen,
  onChange,
  onAdd,
}: {
  group: MissingClientGroup;
  exclusions: Exclusions;
  isOpen: boolean;
  disabled: boolean;
  // Whether this client or a clinic of it is ticked, hidden ones included.
  canAdd: boolean;
  onToggleOpen: () => void;
  onChange: (next: Exclusions) => void;
  onAdd: () => void;
}) {
  const { t } = useI18n();
  const labels = t.admin.directorySync;
  const name = groupName(group, t);
  const addable = group.clinics.filter(isAddable);
  const selectedCount = addable.filter((clinic) => isClinicSelected(clinic, exclusions)).length;
  const checked = isGroupSelected(group, exclusions);

  return (
    <li className="rounded-lg border">
      <div className="flex items-center gap-3 p-3">
        <input
          type="checkbox"
          // A callback ref re-runs on every render, which keeps the half-ticked
          // state in step with the clinics.
          ref={(node) => {
            if (node) node.indeterminate = !checked && selectedCount > 0;
          }}
          checked={checked}
          onChange={() => onChange(toggleGroup(group, exclusions))}
          disabled={disabled || !isGroupSelectable(group)}
          aria-label={labels.selectClient(name)}
          className="size-4 shrink-0 accent-primary"
        />
        <button
          type="button"
          onClick={onToggleOpen}
          aria-expanded={isOpen}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronRight
            aria-hidden
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              isOpen && "rotate-90"
            )}
          />
          <span className="truncate text-sm font-medium" title={name}>
            {name}
          </span>
          {group.isMissing ? <Badge variant="secondary">{labels.newClient}</Badge> : null}
          <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground tabular-nums">
            {labels.missingClinics(group.clinics.length)}
          </span>
        </button>
        <Button variant="outline" size="sm" disabled={disabled || !canAdd} onClick={onAdd}>
          <Plus aria-hidden="true" />
          {t.common.add}
        </Button>
      </div>
      {isOpen ? (
        <div className="flex flex-col gap-3 border-t p-3 pl-10">
          {group.clinics.length === 0 ? (
            <p className="text-sm text-muted-foreground">{labels.noMissingClinics}</p>
          ) : (
            group.clinics.map((clinic) => (
              <ClinicOption
                key={clinic.externalClinicId}
                clinic={clinic}
                checked={isClinicSelected(clinic, exclusions)}
                disabled={disabled}
                onToggle={() => onChange(toggleClinic(group, clinic, exclusions))}
              />
            ))
          )}
        </div>
      ) : null}
    </li>
  );
}

function ConfirmAddDialog({
  open,
  selection,
  pending,
  error,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  selection: SelectedGroup[];
  pending: boolean;
  error: LocalizedMessage | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const labels = t.admin.directorySync;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="data-[size=default]:sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>{labels.confirm.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {labels.confirm.description(summaryOf(selection, t))}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="flex max-h-80 flex-col gap-3 overflow-y-auto rounded-lg border p-3 text-sm">
          {selection.map((entry) => (
            <li key={entry.group.key} className="flex flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2 font-medium">
                {groupName(entry.group, t)}
                {entry.createsClient ? <Badge variant="secondary">{labels.newClient}</Badge> : null}
              </span>
              {entry.clinics.length === 0 ? (
                <span className="pl-4 text-muted-foreground">{labels.confirm.clientOnly}</span>
              ) : (
                <ul className="list-disc pl-8 text-muted-foreground">
                  {entry.clinics.map((clinic) => (
                    <li key={clinic.externalClinicId}>{clinic.name}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
        {error === null ? null : (
          <Alert variant="destructive">
            <AlertTitle>{labels.addFailedTitle}</AlertTitle>
            <AlertDescription>{error.resolve(t)}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t.common.cancel}</AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={onConfirm}>
            {pending ? <Spinner /> : null}
            {labels.confirm.add}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * The loaded list with its ticks. It suspends until the load settles, and a
 * new load mounts a fresh one, so the ticks start over with every list. The
 * search only narrows what is shown: ticked clinics hidden by it are still
 * added, and the confirmation lists them.
 */
function MissingDirectory({
  outcome,
  search,
  disabled,
  onSearchChange,
  onAdded,
}: {
  outcome: Promise<LoadOutcome>;
  search: string;
  disabled: boolean;
  onSearchChange: (search: string) => void;
  onAdded: (result: AddResult) => void;
}) {
  const { t } = useI18n();
  const labels = t.admin.directorySync;
  const loaded = use(outcome);
  const addMissing = useMutation(api.directorySync.addMissing);
  const [exclusions, setExclusions] = useState<Exclusions>(NO_EXCLUSIONS);
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(new Set());
  const [confirmScope, setConfirmScope] = useState<ConfirmScope | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<LocalizedMessage | null>(null);

  if (!loaded.ok) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{labels.loadFailedTitle}</AlertTitle>
        <AlertDescription>
          {localizedError(loaded.error, (t) => t.admin.directorySync.loadFailed).resolve(t)}
        </AlertDescription>
      </Alert>
    );
  }

  const groups = loaded.groups;
  if (groups.length === 0) {
    return <p className="text-sm text-muted-foreground">{labels.nothingMissing}</p>;
  }

  const selection = selectedGroups(groups, exclusions);
  const isSearching = search.trim() !== "";
  const shownGroups = filterGroups(groups, search);
  const allShownSelected = areAllSelected(shownGroups, exclusions);
  const confirmSelection =
    confirmScope?.clientKey == null
      ? selection
      : selection.filter((entry) => entry.group.key === confirmScope.clientKey);

  function openConfirm(clientKey: string | null) {
    setAddError(null);
    setConfirmScope({ clientKey });
  }

  function toggleOpen(key: string) {
    setOpenKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function confirmAdd() {
    setAdding(true);
    setAddError(null);
    try {
      const result = await addInBatches(addMissing, confirmSelection);
      setConfirmScope(null);
      onAdded(result);
    } catch (error) {
      setAddError(localizedError(error, (t) => t.admin.directorySync.addFailed));
    } finally {
      setAdding(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={labels.search}
          aria-label={labels.search}
          className="h-8 w-full max-w-64"
        />
        <span className="ml-auto text-sm text-muted-foreground">{summaryOf(selection, t)}</span>
        <Button disabled={disabled || selection.length === 0} onClick={() => openConfirm(null)}>
          <Plus aria-hidden="true" />
          {labels.addSelected}
        </Button>
      </div>

      {shownGroups.length === 0 ? (
        <p className="text-sm text-muted-foreground">{labels.noMatches}</p>
      ) : (
        // Covers the clients the list shows, so with a search it ticks or
        // unticks only the matches.
        <label className="flex cursor-pointer items-center gap-3 px-3 text-sm has-[:disabled]:cursor-not-allowed">
          <input
            type="checkbox"
            checked={allShownSelected}
            onChange={() =>
              setExclusions(setGroupsSelected(shownGroups, exclusions, !allShownSelected))
            }
            disabled={disabled || !shownGroups.some(isGroupSelectable)}
            className="size-4 shrink-0 accent-primary"
          />
          {labels.selectAll}
        </label>
      )}

      <ul className="flex flex-col gap-2">
        {shownGroups.map((group) => (
          <ClientGroup
            key={group.key}
            group={group}
            exclusions={exclusions}
            // A search opens every client it shows, so the matches are in sight.
            isOpen={isSearching || openKeys.has(group.key)}
            disabled={disabled}
            canAdd={selection.some((entry) => entry.group.key === group.key)}
            onToggleOpen={() => toggleOpen(group.key)}
            onChange={setExclusions}
            onAdd={() => openConfirm(group.key)}
          />
        ))}
      </ul>

      <ConfirmAddDialog
        open={confirmScope !== null}
        selection={confirmSelection}
        pending={adding}
        error={addError}
        onOpenChange={(open) => {
          if (!adding && !open) setConfirmScope(null);
        }}
        onConfirm={() => void confirmAdd()}
      />
    </section>
  );
}

async function loadMissing(findMissing: () => Promise<MissingClientGroup[]>): Promise<LoadOutcome> {
  try {
    return { ok: true, groups: await findMissing() };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Loads the missing directory as soon as it mounts and again on refresh or
 * after an add. A reload runs as a transition, so the current list stays on
 * screen until the new one is ready.
 */
function DirectorySync() {
  const { t } = useI18n();
  const labels = t.admin.directorySync;
  const findMissing = useAction(api.directorySync.findMissingDirectory);
  const [request, setRequest] = useState<LoadRequest>(() => ({
    version: 0,
    outcome: loadMissing(() => findMissing({})),
  }));
  const [notice, setNotice] = useState<LocalizedMessage | null>(null);
  // Kept here so a reload keeps what the admin searched for.
  const [search, setSearch] = useState("");
  const [reloading, startReload] = useTransition();

  function reload() {
    // The request starts here, once. React runs a state updater again every
    // time it retries the suspended render, so a request started inside the
    // updater would start a new one on every retry and never settle.
    const outcome = loadMissing(() => findMissing({}));
    startReload(() => setRequest((current) => ({ version: current.version + 1, outcome })));
  }

  function handleAdded(result: AddResult) {
    const skipped = result.skippedClinicIds.length;
    setNotice({
      resolve: (t) => {
        const summary = t.admin.directorySync.summary(
          result.addedClientKeys.length,
          result.addedClinicIds.length
        );
        const added = t.admin.directorySync.added(summary);
        return skipped === 0 ? added : `${added} ${t.admin.directorySync.skipped(skipped)}`;
      },
    });
    reload();
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={labels.pageTitle}
        actions={
          <Button
            variant="outline"
            disabled={reloading}
            onClick={() => {
              setNotice(null);
              reload();
            }}
          >
            {reloading ? <Spinner /> : <RefreshCw aria-hidden="true" />}
            {labels.refresh}
          </Button>
        }
      />
      <AdminTabs />
      <p className="text-sm text-muted-foreground">{labels.intro}</p>
      {notice === null ? null : (
        <Alert>
          <AlertDescription>{notice.resolve(t)}</AlertDescription>
        </Alert>
      )}
      <Suspense fallback={<Skeleton className="h-80 w-full" />}>
        <MissingDirectory
          key={request.version}
          outcome={request.outcome}
          search={search}
          disabled={reloading}
          onSearchChange={setSearch}
          onAdded={handleAdded}
        />
      </Suspense>
    </div>
  );
}

/**
 * Admin screen that lists the clients and clinics Control Central has and the
 * app does not, grouped by client, and adds the ticked ones after a
 * confirmation.
 */
export function AdminDirectorySyncPanel() {
  const { t } = useI18n();
  const current = useQuery(api.staffAccounts.current, {});
  const canManage = current?.role === "admin" && current.status === "active";

  useDocumentTitle(t.app.titles.adminDirectorySync);

  if (current === undefined) return <Skeleton className="h-80 w-full" />;

  if (canManage) return <DirectorySync />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.admin.directorySync.pageTitle} />
      <AdminTabs />
      <Alert variant="destructive">
        <AlertTitle>{t.admin.accessDeniedTitle}</AlertTitle>
        <AlertDescription>{t.admin.directorySync.accessDeniedBody}</AlertDescription>
      </Alert>
    </div>
  );
}
