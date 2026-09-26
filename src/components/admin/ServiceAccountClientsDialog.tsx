import type { FunctionReturnType } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n/context";
import { localizedError, type LocalizedMessage } from "@/lib/i18n/errors";
import { useSearchText } from "@/lib/listControls";

type ClientChoice = FunctionReturnType<typeof api.clinics.listClientChoices>["clients"][number];

/** One client of the list, with the action that belongs to the side it is on. */
function ClientRow({
  client,
  disabled,
  onLink,
}: {
  client: ClientChoice;
  disabled?: boolean;
  onLink?: (client: ClientChoice) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm" title={client.name}>
          {client.name}
        </span>
        <span className="truncate font-mono text-xs text-muted-foreground" title={client.key}>
          {client.key}
        </span>
      </div>
      {client.isActive ? null : <Badge variant="outline">{t.common.inactive}</Badge>}
      {onLink === undefined ? null : (
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => onLink(client)}>
          {t.admin.serviceAccounts.clientsDialog.link}
        </Button>
      )}
    </div>
  );
}

/**
 * The clients one service account reads the sheets of, and the clients it could
 * take over. Linking writes the client's service account alone, through the
 * mutation that keeps it and the counts of both accounts in step, so a client
 * renamed or disabled while this was open keeps what it was given. A client
 * already linked to another account is offered here too, because moving it is
 * what linking it to this one means.
 */
export function ServiceAccountClientsDialog({
  account,
  onClose,
}: {
  account: { serviceAccountId: Id<"googleServiceAccounts">; email: string };
  onClose: () => void;
}) {
  const { t } = useI18n();
  // The clients of this account, read through the account's own index: the
  // picker below holds one page of the table, and a linked client past that page
  // would be missing from the account that reads its sheets.
  const accountClients = useQuery(api.clinics.listServiceAccountClients, {
    serviceAccountId: account.serviceAccountId,
  });
  // A substring is not something an index can answer, so the directory is the
  // picker's page of the table while the box is empty and the bounded server
  // search once it holds something, the same as the clients screen.
  const search = useSearchText();
  const isSearching = search.query !== "";
  const choiceData = useQuery(api.clinics.listClientChoices, isSearching ? "skip" : {});
  const searchData = useQuery(
    api.clinics.searchClients,
    isSearching ? { search: search.query } : "skip"
  );
  const linkClient = useMutation(api.clinics.linkClientServiceAccount);

  const [pendingClientId, setPendingClientId] = useState<Id<"clients"> | null>(null);
  const [error, setError] = useState<LocalizedMessage | null>(null);

  const linked = accountClients?.clients ?? [];
  const directory: ClientChoice[] = isSearching
    ? (searchData?.clients ?? [])
    : (choiceData?.clients ?? []);
  const others = directory.filter((client) => client.serviceAccountId !== account.serviceAccountId);
  const isReady =
    accountClients !== undefined &&
    (isSearching ? searchData !== undefined : choiceData !== undefined);

  // What a list says when it is not the whole directory: a search that read only
  // part of the table, or a page of the picker that stopped before its end.
  let directoryNote: string | null = null;
  if (isSearching) {
    if (searchData?.hasMore === true) {
      directoryNote = t.admin.serviceAccounts.clientsDialog.searchIncomplete;
    }
  } else if (choiceData?.hasMore === true) {
    directoryNote = t.admin.serviceAccounts.clientsDialog.incomplete(choiceData.limit);
  }

  async function link(client: ClientChoice) {
    setPendingClientId(client.clientId);
    setError(null);
    try {
      await linkClient({
        clientId: client.clientId,
        serviceAccountId: account.serviceAccountId,
      });
    } catch (cause) {
      setError(localizedError(cause, (t) => t.admin.serviceAccounts.clientsDialog.linkFailed));
    } finally {
      setPendingClientId(null);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next, eventDetails) => {
        if (next) return;
        if (pendingClientId !== null) {
          eventDetails.cancel();
          return;
        }
        onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl" showCloseButton={pendingClientId === null}>
        <DialogHeader>
          <DialogTitle>{t.admin.serviceAccounts.clientsDialog.title}</DialogTitle>
          <DialogDescription>
            {t.admin.serviceAccounts.clientsDialog.descriptionFor(account.email)}
          </DialogDescription>
        </DialogHeader>

        {!isReady ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium">
                  {t.admin.serviceAccounts.clientsDialog.linkedTitle}
                </h3>
                <Badge variant="secondary" className="tabular-nums">
                  {linked.length}
                </Badge>
              </div>
              {linked.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t.admin.serviceAccounts.clientsDialog.linkedNone}
                </p>
              ) : (
                <div className="flex max-h-48 flex-col gap-3 overflow-y-auto">
                  {linked.map((client) => (
                    <ClientRow key={client.clientId} client={client} />
                  ))}
                </div>
              )}
              {accountClients?.hasMore === true ? (
                <p className="text-xs text-muted-foreground">
                  {t.admin.serviceAccounts.clientsDialog.incomplete(accountClients.limit)}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-medium">
                {t.admin.serviceAccounts.clientsDialog.addTitle}
              </h3>
              <Field>
                <FieldLabel htmlFor="service-account-client-search">
                  {t.admin.serviceAccounts.clientsDialog.search}
                </FieldLabel>
                <Input
                  id="service-account-client-search"
                  value={search.text}
                  onChange={(event) => search.change(event.target.value)}
                  disabled={pendingClientId !== null}
                />
              </Field>
              <div className="flex max-h-64 flex-col gap-3 overflow-y-auto">
                {others.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {isSearching
                      ? t.admin.serviceAccounts.clientsDialog.noMatches
                      : t.admin.serviceAccounts.clientsDialog.allLinked}
                  </p>
                ) : (
                  others.map((client) => (
                    <ClientRow
                      key={client.clientId}
                      client={client}
                      disabled={pendingClientId !== null}
                      onLink={(chosen) => void link(chosen)}
                    />
                  ))
                )}
              </div>
              {directoryNote === null ? null : (
                <p className="text-xs text-muted-foreground">{directoryNote}</p>
              )}
            </div>
          </div>
        )}

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>{t.admin.serviceAccounts.clientsDialog.linkFailedTitle}</AlertTitle>
            <AlertDescription>{error.resolve(t)}</AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pendingClientId !== null}>
            {t.common.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
