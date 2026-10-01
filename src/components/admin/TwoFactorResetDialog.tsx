import { useAction, useQuery } from "convex/react";
import { useId, useState, type SyntheticEvent } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";
import { localizedError, type LocalizedMessage } from "@/lib/i18n/errors";

export function TwoFactorResetDialog({
  account,
  onClose,
}: {
  account: { profileId: Id<"staffProfiles">; displayName: string };
  onClose: () => void;
}) {
  const { t } = useI18n();
  const reset = useAction(api.twoFactor.adminReset);
  const ownFactor = useQuery(api.twoFactor.status, {});
  const formId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<LocalizedMessage | null>(null);
  // A password alone must not undo another account's factor, so the reset stays
  // closed until the administrator has a factor of their own to confirm.
  const canReset = ownFactor?.enabled === true;

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !canReset) return;
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      await reset({
        profileId: account.profileId,
        password: String(data.get("password") ?? ""),
        code: String(data.get("code") ?? ""),
      });
      onClose();
    } catch (cause) {
      setError(localizedError(cause, (messages) => messages.admin.accounts.twoFactor.resetFailed));
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.admin.accounts.twoFactor.resetTitle}</AlertDialogTitle>
          <AlertDialogDescription>
            {t.admin.accounts.twoFactor.resetDescriptionFor(account.displayName)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form id={formId} onSubmit={submit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${formId}-password`}>{t.app.auth.password}</FieldLabel>
              <Input
                id={`${formId}-password`}
                name="password"
                type="password"
                autoComplete="current-password"
                required
                disabled={pending || !canReset}
              />
              <FieldDescription>{t.admin.accounts.twoFactor.passwordHint}</FieldDescription>
            </Field>
            {canReset ? (
              <Field>
                <FieldLabel htmlFor={`${formId}-code`}>{t.app.auth.verificationCode}</FieldLabel>
                <Input
                  id={`${formId}-code`}
                  name="code"
                  autoComplete="one-time-code"
                  required
                  disabled={pending}
                />
                <FieldDescription>{t.admin.accounts.twoFactor.codeHint}</FieldDescription>
              </Field>
            ) : null}
          </FieldGroup>
        </form>
        {ownFactor !== undefined && !ownFactor.enabled ? (
          <Alert>
            <AlertTitle>{t.admin.accounts.twoFactor.ownFactorTitle}</AlertTitle>
            <AlertDescription>{t.admin.accounts.twoFactor.ownFactorRequired}</AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>{t.admin.accounts.twoFactor.resetTitle}</AlertTitle>
            <AlertDescription>{error.resolve(t)}</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t.common.cancel}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            type="submit"
            form={formId}
            disabled={pending || !canReset}
          >
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {t.admin.accounts.twoFactor.resetConfirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
