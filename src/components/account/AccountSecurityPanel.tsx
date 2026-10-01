import { useAction, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { QRCodeSVG } from "qrcode.react";
import { useState, type SyntheticEvent } from "react";

import { api } from "../../../convex/_generated/api";
import { PageHeader } from "@/components/app/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useDocumentTitle, useI18n } from "@/lib/i18n/context";
import { localizedError, localizedMessage, type LocalizedMessage } from "@/lib/i18n/errors";

type Setup = FunctionReturnType<typeof api.twoFactor.beginSetup> & { password: string };

/**
 * The account security screen: turning the authenticator-app second factor on
 * and off. A freshly enabled factor answers with its recovery codes, which are
 * shown here once and never again.
 */
export function AccountSecurityPanel() {
  const { t } = useI18n();
  const status = useQuery(api.twoFactor.status, {});
  const beginSetup = useAction(api.twoFactor.beginSetup);
  const confirmSetup = useAction(api.twoFactor.confirmSetup);
  const disable = useAction(api.twoFactor.disable);
  const regenerate = useAction(api.twoFactor.regenerateRecoveryCodes);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [setupError, setSetupError] = useState<LocalizedMessage | null>(null);
  const [confirmError, setConfirmError] = useState<LocalizedMessage | null>(null);
  const [copyError, setCopyError] = useState<LocalizedMessage | null>(null);
  const [disableError, setDisableError] = useState<LocalizedMessage | null>(null);
  const [isBeginning, setIsBeginning] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isDisabling, setIsDisabling] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [credentialAction, setCredentialAction] = useState<"disable" | "regenerate" | null>(null);
  const isRegenerating = credentialAction === "regenerate";

  useDocumentTitle(t.app.titles.security);

  async function startSetup(password: string) {
    setSetupError(null);
    setConfirmError(null);
    setIsBeginning(true);
    try {
      setSetup({ ...(await beginSetup({ password })), password });
    } catch (cause) {
      setSetupError(localizedError(cause, (messages) => messages.security.failures.setup));
    } finally {
      setIsBeginning(false);
    }
  }

  async function handleConfirm(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (setup === null) return;

    const formData = new FormData(event.currentTarget);
    setConfirmError(null);
    setIsConfirming(true);
    try {
      const { recoveryCodes: codes } = await confirmSetup({
        password: setup.password,
        code: String(formData.get("code") ?? ""),
      });
      setSetup(null);
      setRecoveryCodes(codes);
      setIsCopied(false);
      setCopyError(null);
    } catch (cause) {
      setConfirmError(localizedError(cause, (messages) => messages.security.failures.confirm));
    } finally {
      setIsConfirming(false);
    }
  }

  async function copyRecoveryCodes() {
    if (recoveryCodes === null) return;

    setCopyError(null);
    try {
      await navigator.clipboard.writeText(recoveryCodes.join("\n"));
      setIsCopied(true);
    } catch {
      setCopyError(localizedMessage((messages) => messages.security.failures.copy));
    }
  }

  async function handleDisable(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    setDisableError(null);
    setIsDisabling(true);
    try {
      const credentials = {
        password: String(formData.get("password") ?? ""),
        code: String(formData.get("code") ?? ""),
      };
      if (isRegenerating) {
        const { recoveryCodes: codes } = await regenerate(credentials);
        setRecoveryCodes(codes);
        setIsCopied(false);
        setCopyError(null);
        setSetup(null);
      } else {
        await disable(credentials);
      }
      setCredentialAction(null);
    } catch (cause) {
      setDisableError(
        localizedError(cause, (messages) =>
          isRegenerating
            ? messages.security.failures.regenerate
            : messages.security.failures.disable
        )
      );
    } finally {
      setIsDisabling(false);
    }
  }

  function renderSetup(setupForm: Setup) {
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-base font-medium">{t.security.setup.title}</h2>
          <p className="text-sm text-muted-foreground">{t.security.setup.description}</p>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          {/* The QR code keeps its light background in both themes: scanners
              need the contrast, and the theme toggle has no business changing
              what the camera sees. */}
          <QRCodeSVG
            value={setupForm.uri}
            size={168}
            level="M"
            marginSize={2}
            className="shrink-0 self-center rounded-lg bg-white sm:self-start"
          />
          <div className="flex w-full flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t.security.setup.keyLabel}
            </span>
            <code className="rounded-lg bg-muted px-3 py-2 font-mono text-sm break-all">
              {setupForm.secret}
            </code>
          </div>
        </div>
        <form className="flex flex-col gap-4" onSubmit={handleConfirm}>
          <Field data-invalid={confirmError !== null}>
            <FieldLabel htmlFor="totp-setup-code">{t.security.setup.codeLabel}</FieldLabel>
            <Input
              id="totp-setup-code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={confirmError !== null}
              autoFocus
              required
            />
            <FieldDescription>{t.security.setup.codeHint}</FieldDescription>
            <FieldError>{confirmError?.resolve(t)}</FieldError>
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={isConfirming || isBeginning}>
              {isConfirming ? <Spinner data-icon="inline-start" /> : null}
              {t.security.setup.confirm}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isConfirming || isBeginning}
              onClick={() => void startSetup(setupForm.password)}
            >
              {isBeginning ? <Spinner data-icon="inline-start" /> : null}
              {t.security.setup.restart}
            </Button>
          </div>
        </form>
      </div>
    );
  }

  function renderRecoveryCodes(codes: string[]) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-base font-medium">{t.security.recovery.title}</h2>
          <p className="text-sm text-muted-foreground">{t.security.recovery.description}</p>
        </div>
        <ul className="grid grid-cols-1 gap-1.5 font-mono text-sm sm:grid-cols-2">
          {codes.map((code) => (
            <li key={code} className="rounded-md bg-muted px-3 py-1.5">
              {code}
            </li>
          ))}
        </ul>
        {copyError ? (
          <Alert variant="destructive">
            <AlertTitle>{t.app.states.somethingWentWrong}</AlertTitle>
            <AlertDescription>{copyError.resolve(t)}</AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void copyRecoveryCodes()}>
            {isCopied ? t.security.recovery.copied : t.security.recovery.copy}
          </Button>
          <Button
            type="button"
            onClick={() => {
              setRecoveryCodes(null);
              setIsCopied(false);
            }}
          >
            {t.security.recovery.done}
          </Button>
        </div>
      </div>
    );
  }

  function renderStatus(enabled: boolean, recoveryCodesRemaining: number) {
    if (!enabled) {
      return (
        <div className="flex flex-col gap-4">
          {setupError ? (
            <Alert variant="destructive">
              <AlertTitle>{t.app.states.somethingWentWrong}</AlertTitle>
              <AlertDescription>{setupError.resolve(t)}</AlertDescription>
            </Alert>
          ) : null}
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void startSetup(String(new FormData(event.currentTarget).get("password") ?? ""));
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="setup-password">{t.security.disable.password}</FieldLabel>
                <Input
                  id="setup-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  disabled={isBeginning}
                />
                <FieldDescription>{t.security.setup.passwordHint}</FieldDescription>
              </Field>
            </FieldGroup>
            <div>
              <Button type="submit" disabled={isBeginning}>
                {isBeginning ? <Spinner data-icon="inline-start" /> : null}
                {t.security.enable}
              </Button>
            </div>
          </form>
        </div>
      );
    }

    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {t.security.enabled.remaining(recoveryCodesRemaining)}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setDisableError(null);
              setCredentialAction("regenerate");
            }}
          >
            {t.security.regenerate.title}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setDisableError(null);
              setCredentialAction("disable");
            }}
          >
            {t.security.enabled.disable}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.security.pageTitle} />

      {status === undefined ? (
        <Skeleton className="h-48 w-full max-w-2xl" />
      ) : (
        <Card className="max-w-2xl">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <CardTitle>{t.security.title}</CardTitle>
              <Badge variant={status.enabled ? "default" : "secondary"}>
                {status.enabled ? t.security.status.on : t.security.status.off}
              </Badge>
            </div>
            <CardDescription>{t.security.description}</CardDescription>
          </CardHeader>
          <CardContent>
            {recoveryCodes !== null
              ? renderRecoveryCodes(recoveryCodes)
              : setup !== null && !status.enabled
                ? renderSetup(setup)
                : renderStatus(status.enabled, status.recoveryCodesRemaining)}
          </CardContent>
        </Card>
      )}

      <Dialog
        open={credentialAction !== null}
        onOpenChange={(open) => {
          // The dialog owns an in-flight action, so dismissing it early would
          // hide the result of a request that still runs.
          if (!open && !isDisabling) setCredentialAction(null);
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={!isDisabling}>
          <DialogHeader>
            <DialogTitle>
              {isRegenerating ? t.security.regenerate.title : t.security.disable.title}
            </DialogTitle>
            <DialogDescription>
              {isRegenerating ? t.security.regenerate.description : t.security.disable.description}
            </DialogDescription>
          </DialogHeader>
          <form id="disable-two-factor" className="flex flex-col gap-4" onSubmit={handleDisable}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="disable-password">{t.security.disable.password}</FieldLabel>
                <Input
                  id="disable-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </Field>
              <Field data-invalid={disableError !== null}>
                <FieldLabel htmlFor="disable-code">{t.security.disable.code}</FieldLabel>
                <Input
                  id="disable-code"
                  name="code"
                  type="text"
                  autoComplete="one-time-code"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-invalid={disableError !== null}
                  required
                />
                <FieldError>{disableError?.resolve(t)}</FieldError>
              </Field>
            </FieldGroup>
          </form>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isDisabling}
              onClick={() => setCredentialAction(null)}
            >
              {t.common.cancel}
            </Button>
            <Button type="submit" form="disable-two-factor" disabled={isDisabling}>
              {isDisabling ? <Spinner data-icon="inline-start" /> : null}
              {isRegenerating ? t.security.regenerate.confirm : t.security.disable.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
