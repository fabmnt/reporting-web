import type { FunctionReturnType } from "convex/server";
import { useAction, useMutation, useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { useState, type SyntheticEvent } from "react";

import { api } from "../../../convex/_generated/api";
import { ConfirmDeleteDialog } from "@/components/admin/ConfirmDeleteDialog";
import { ServiceAccountClientsDialog } from "@/components/admin/ServiceAccountClientsDialog";
import { AdminTabs } from "@/components/app/AdminTabs";
import { DataCard, DataCardList, DataCardRow, DataTableFrame } from "@/components/app/DataCard";
import { PageHeader } from "@/components/app/PageHeader";
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
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useDocumentTitle, useI18n } from "@/lib/i18n/context";
import {
  errorText,
  localizedError,
  localizedMessage,
  type LocalizedMessage,
} from "@/lib/i18n/errors";

type ServiceAccountsData = FunctionReturnType<typeof api.googleAccounts.listServiceAccounts>;
type ServiceAccountView = ServiceAccountsData["serviceAccounts"][number];

// The answer of the last key test, kept until the next one so the administrator
// can see what Google said about the account they just checked.
type TestResult = {
  email: string;
  ok: boolean;
  message: string | null;
};

function ServiceAccountForm({
  open,
  onOpenChange,
  isReplacing,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isReplacing: boolean;
  pending: boolean;
  error: LocalizedMessage | null;
  onSubmit: (secretKey: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [secretKey, setSecretKey] = useState("");
  const [validationError, setValidationError] = useState<LocalizedMessage | null>(null);

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError(null);

    const key = secretKey.trim();
    if (key === "") {
      setValidationError(localizedMessage((t) => t.admin.serviceAccounts.form.keyRequired));
      return;
    }

    await onSubmit(key);
  }

  return (
    <Dialog
      open={open}
      // A save in flight lands on whatever form is open when it settles, so the
      // dialog only closes from the request it owns.
      onOpenChange={(next, eventDetails) => {
        if (!next && pending) {
          eventDetails.cancel();
          return;
        }
        onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={!pending}>
        <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>
              {isReplacing
                ? t.admin.serviceAccounts.form.replaceTitle
                : t.admin.serviceAccounts.form.createTitle}
            </DialogTitle>
            <DialogDescription>
              {isReplacing
                ? t.admin.serviceAccounts.form.replaceDescription
                : t.admin.serviceAccounts.form.description}
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="service-account-key">
              {t.admin.serviceAccounts.form.key}
            </FieldLabel>
            <Textarea
              id="service-account-key"
              value={secretKey}
              onChange={(event) => setSecretKey(event.target.value)}
              placeholder={t.admin.serviceAccounts.form.keyPlaceholder}
              rows={8}
              spellCheck={false}
              disabled={pending}
            />
            <FieldDescription>{t.admin.serviceAccounts.form.keyHint}</FieldDescription>
          </Field>
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>{t.admin.serviceAccounts.form.saveFailedTitle}</AlertTitle>
              <AlertDescription>{error.resolve(t)}</AlertDescription>
            </Alert>
          ) : null}
          <FieldError>{validationError?.resolve(t)}</FieldError>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {isReplacing ? t.common.saveChanges : t.admin.serviceAccounts.form.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Shared by the table and the narrow-screen cards. */
function ServiceAccountActions({
  account,
  disabled,
  onClients,
  onReplace,
  onTest,
  onDelete,
}: {
  account: ServiceAccountView;
  disabled: boolean;
  onClients: (account: ServiceAccountView) => void;
  onReplace: (account: ServiceAccountView) => void;
  onTest: (account: ServiceAccountView) => void;
  onDelete: (account: ServiceAccountView) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" disabled={disabled} onClick={() => onClients(account)}>
        {t.admin.serviceAccounts.clientsDialog.action}
      </Button>
      <Button variant="outline" size="sm" disabled={disabled} onClick={() => onReplace(account)}>
        {t.admin.serviceAccounts.replaceKey}
      </Button>
      <Button variant="outline" size="sm" disabled={disabled} onClick={() => onTest(account)}>
        {t.admin.serviceAccounts.test.action}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        disabled={disabled}
        onClick={() => onDelete(account)}
      >
        {t.common.delete}
      </Button>
    </div>
  );
}

export function AdminServiceAccountsPanel() {
  const { t } = useI18n();
  const current = useQuery(api.staffAccounts.current, {});
  const canManage = current?.role === "admin" && current.status === "active";

  const data = useQuery(api.googleAccounts.listServiceAccounts, canManage ? {} : "skip");
  const createServiceAccount = useMutation(api.googleAccounts.createServiceAccount);
  const updateServiceAccount = useMutation(api.googleAccounts.updateServiceAccount);
  const removeServiceAccount = useMutation(api.googleAccounts.removeServiceAccount);
  const testServiceAccount = useAction(api.googleAccounts.testServiceAccount);

  const [formError, setFormError] = useState<LocalizedMessage | null>(null);
  const [deleteError, setDeleteError] = useState<LocalizedMessage | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingAccountId, setPendingAccountId] = useState<
    ServiceAccountView["serviceAccountId"] | null
  >(null);
  // One operation at a time, so the answer of a test cannot land on the row of
  // another one that was started after it.
  const pending = pendingAccountId !== null;
  const [formMode, setFormMode] = useState<"closed" | "creating" | "replacing">("closed");
  const [replacingAccount, setReplacingAccount] = useState<ServiceAccountView | null>(null);
  // Bumped on every open so the form remounts with an empty paste. Cancelling a
  // draft must not leak into the next open.
  const [formSession, setFormSession] = useState(0);
  const [accountToDelete, setAccountToDelete] = useState<ServiceAccountView | null>(null);
  // The account whose clients are open, of which the dialog shows the linked
  // ones and offers the rest.
  const [clientsAccount, setClientsAccount] = useState<ServiceAccountView | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const accounts = data?.serviceAccounts ?? [];

  function openCreate() {
    setFormError(null);
    setReplacingAccount(null);
    setFormSession((session) => session + 1);
    setFormMode("creating");
  }

  function openReplace(account: ServiceAccountView) {
    setFormError(null);
    setReplacingAccount(account);
    setFormSession((session) => session + 1);
    setFormMode("replacing");
  }

  function closeForm() {
    setFormMode("closed");
    setReplacingAccount(null);
    setFormError(null);
  }

  async function submitAccount(secretKey: string) {
    setIsSaving(true);
    setFormError(null);
    try {
      if (formMode === "replacing" && replacingAccount !== null) {
        await updateServiceAccount({
          serviceAccountId: replacingAccount.serviceAccountId,
          secretKey,
        });
      } else {
        await createServiceAccount({ secretKey });
      }
      closeForm();
    } catch (cause) {
      setFormError(localizedError(cause, (t) => t.admin.serviceAccounts.form.saveFailed));
    } finally {
      setIsSaving(false);
    }
  }

  async function runTest(account: ServiceAccountView) {
    setPendingAccountId(account.serviceAccountId);
    setTestResult(null);
    try {
      const result = await testServiceAccount({ serviceAccountId: account.serviceAccountId });
      setTestResult({ email: account.email, ok: result.ok, message: result.error });
    } catch (cause) {
      setTestResult({ email: account.email, ok: false, message: errorText(cause, t) });
    } finally {
      setPendingAccountId(null);
    }
  }

  async function confirmDelete() {
    if (accountToDelete === null) return;

    setPendingAccountId(accountToDelete.serviceAccountId);
    setDeleteError(null);
    try {
      await removeServiceAccount({ serviceAccountId: accountToDelete.serviceAccountId });
      setAccountToDelete(null);
      setTestResult(null);
    } catch (cause) {
      setDeleteError(localizedError(cause, (t) => t.admin.serviceAccounts.delete.accountFailed));
    } finally {
      setPendingAccountId(null);
    }
  }

  useDocumentTitle(t.app.titles.adminServiceAccounts);

  const header = (
    <PageHeader
      title={t.admin.serviceAccounts.pageTitle}
      actions={
        canManage ? (
          <Button onClick={openCreate}>
            <Plus aria-hidden="true" />
            {t.admin.serviceAccounts.addAccount}
          </Button>
        ) : undefined
      }
    />
  );

  if (current === undefined) return <Skeleton className="h-80 w-full" />;

  if (!canManage) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <AdminTabs />
        <Alert variant="destructive">
          <AlertTitle>{t.admin.accessDeniedTitle}</AlertTitle>
          <AlertDescription>{t.admin.serviceAccounts.accessDeniedBody}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {header}
      <AdminTabs />

      {testResult === null ? null : (
        <Alert variant={testResult.ok ? "default" : "destructive"}>
          <AlertTitle>
            {testResult.ok
              ? t.admin.serviceAccounts.test.okTitle
              : t.admin.serviceAccounts.test.failedTitle}
          </AlertTitle>
          <AlertDescription>
            {`${testResult.email}: ${
              testResult.ok
                ? t.admin.serviceAccounts.test.okBody
                : (testResult.message ?? t.admin.serviceAccounts.test.requestFailed)
            }`}
          </AlertDescription>
        </Alert>
      )}

      <section className="flex flex-col gap-4">
        {data === undefined ? (
          <Skeleton className="h-40 w-full" />
        ) : accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.admin.serviceAccounts.noAccounts}</p>
        ) : (
          <>
            <DataTableFrame>
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead>{t.admin.serviceAccounts.table.account}</TableHead>
                    <TableHead>{t.admin.serviceAccounts.table.clients}</TableHead>
                    <TableHead>{t.common.actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts.map((account) => (
                    <TableRow key={account.serviceAccountId}>
                      <TableCell className="font-mono text-xs">{account.email}</TableCell>
                      <TableCell className="tabular-nums">{account.clientCount}</TableCell>
                      <TableCell>
                        <ServiceAccountActions
                          account={account}
                          disabled={pending}
                          onClients={setClientsAccount}
                          onReplace={openReplace}
                          onTest={runTest}
                          onDelete={setAccountToDelete}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </DataTableFrame>

            <DataCardList>
              {accounts.map((account) => (
                <DataCard
                  key={account.serviceAccountId}
                  title={account.email}
                  badge={
                    <Badge variant={account.clientCount === 0 ? "outline" : "secondary"}>
                      {account.clientCount}
                    </Badge>
                  }
                >
                  <DataCardRow label={t.admin.serviceAccounts.table.clients}>
                    <span className="tabular-nums">{account.clientCount}</span>
                  </DataCardRow>
                  <DataCardRow>
                    <ServiceAccountActions
                      account={account}
                      disabled={pending}
                      onClients={setClientsAccount}
                      onReplace={openReplace}
                      onTest={runTest}
                      onDelete={setAccountToDelete}
                    />
                  </DataCardRow>
                </DataCard>
              ))}
            </DataCardList>

            {data.hasMore ? (
              <p className="text-xs text-muted-foreground">
                {t.admin.serviceAccounts.listing(data.limit)}
              </p>
            ) : null}
          </>
        )}
      </section>

      <ServiceAccountForm
        key={`service-account-form-${formSession}`}
        open={formMode !== "closed"}
        onOpenChange={(open) => {
          if (!open) closeForm();
        }}
        isReplacing={formMode === "replacing"}
        pending={isSaving}
        error={formError}
        onSubmit={submitAccount}
        onCancel={closeForm}
      />

      {clientsAccount === null ? null : (
        <ServiceAccountClientsDialog
          account={clientsAccount}
          onClose={() => setClientsAccount(null)}
        />
      )}

      <ConfirmDeleteDialog
        open={accountToDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAccountToDelete(null);
            setDeleteError(null);
          }
        }}
        title={t.admin.serviceAccounts.delete.title}
        description={
          accountToDelete === null
            ? ""
            : t.admin.serviceAccounts.delete.description(
                accountToDelete.email,
                accountToDelete.clientCount
              )
        }
        confirmLabel={t.admin.serviceAccounts.delete.deleteAccount}
        pending={pendingAccountId !== null}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
