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
        <span className="truncate text-sm">{client.name}</span>
        <span className="truncate font-mono text-xs text-muted-foreground">{client.key}</span>
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
 * take over. Linking writes the client's service account, which is the same
 * link the client form sets, so the counts of the accounts involved move with
 * it. A client already linked to another account is offered here too, because
 * moving it is what linking it to this one means.
 */
export function ServiceAccountClientsDialog({
  account,
  onClose,
}: {
  account: { serviceAccountId: Id<"googleServiceAccounts">; email: string };
  onClose: () => void;
}) {
  const { t } = useI18n();
  const data = useQuery(api.clinics.listClientChoices, {});
  const updateClient = useMutation(api.clinics.updateClient);

  const [search, setSearch] = useState("");
  const [pendingClientId, setPendingClientId] = useState<Id<"clients"> | null>(null);
  const [error, setError] = useState<LocalizedMessage | null>(null);

  const clients = data?.clients ?? [];
  const linked = clients.filter((client) => client.serviceAccountId === account.serviceAccountId);
  const others = clients.filter((client) => client.serviceAccountId !== account.serviceAccountId);
  const needle = search.trim().toLowerCase();
  const matches =
    needle === ""
      ? others
      : others.filter(
          (client) =>
            client.name.toLowerCase().includes(needle) || client.key.toLowerCase().includes(needle)
        );

  async function link(client: ClientChoice) {
    setPendingClientId(client.clientId);
    setError(null);
    try {
      // The name and the state travel back unchanged: this dialog only decides
      // which account reads the client's sheets.
      await updateClient({
        clientId: client.clientId,
        name: client.name,
        isActive: client.isActive,
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

        {data === undefined ? (
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
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  disabled={pendingClientId !== null}
                />
              </Field>
              <div className="flex max-h-64 flex-col gap-3 overflow-y-auto">
                {others.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t.admin.serviceAccounts.clientsDialog.allLinked}
                  </p>
                ) : matches.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t.admin.serviceAccounts.clientsDialog.noMatches}
                  </p>
                ) : (
                  matches.map((client) => (
                    <ClientRow
                      key={client.clientId}
                      client={client}
                      disabled={pendingClientId !== null}
                      onLink={(chosen) => void link(chosen)}
                    />
                  ))
                )}
              </div>
              {data.hasMore ? (
                <p className="text-xs text-muted-foreground">
                  {t.admin.serviceAccounts.clientsDialog.incomplete(data.limit)}
                </p>
              ) : null}
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
