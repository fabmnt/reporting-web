import { useAuthActions } from "@convex-dev/auth/react";
import { useAction } from "convex/react";
import { useEffect, useState, type SyntheticEvent } from "react";

import { api } from "../../../convex/_generated/api";
import { LanguageToggle } from "@/components/i18n/LanguageToggle";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { I18nProvider, useDocumentTitle, useI18n } from "@/lib/i18n/context";
import { localizedError, localizedMessage, type LocalizedMessage } from "@/lib/i18n/errors";

import { ConvexAuthRoot } from "./ConvexAuthRoot";

function BrandMark() {
  const { t } = useI18n();

  return (
    <div className="mb-2 flex items-center gap-2">
      <span
        aria-hidden="true"
        className="grid size-6 shrink-0 place-items-center rounded-md bg-primary text-xs font-semibold text-primary-foreground"
      >
        R
      </span>
      <span className="text-sm font-semibold tracking-tight">{t.app.brand}</span>
    </div>
  );
}

function SetPasswordForm() {
  const { signIn } = useAuthActions();
  const setPassword = useAction(api.passwordSetup.setPassword);
  const { t } = useI18n();
  // undefined while the address bar is being read, then the token or null.
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<LocalizedMessage | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useDocumentTitle(t.app.titles.setPassword);

  // The page is a static file, so the token only exists in the browser URL.
  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token"));
  }, []);

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (typeof token !== "string" || token === "") return;

    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") ?? "");
    const confirmation = String(formData.get("confirmation") ?? "");

    if (password !== confirmation) {
      setError(localizedMessage((messages) => messages.app.auth.passwordMismatch));
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      const { username } = await setPassword({ token, password });
      // The password is set, so the user lands signed in instead of being sent
      // back to the sign-in form. The backend ended any older session.
      await signIn("password", { username, password, flow: "signIn" });
      window.location.replace("/");
    } catch (cause) {
      setError(localizedError(cause, (messages) => messages.app.auth.setPasswordFailed));
      setIsSubmitting(false);
    }
  }

  if (token === undefined) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <BrandMark />
          <CardTitle className="text-lg">{t.app.auth.setPasswordTitle}</CardTitle>
          <CardDescription>{t.app.auth.checkingLink}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (token === null || token === "") {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <BrandMark />
          <CardTitle className="text-lg">{t.app.auth.setPasswordTitle}</CardTitle>
          <CardDescription>{t.app.auth.linkMissing}</CardDescription>
        </CardHeader>
        <CardFooter>
          <a
            className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
            href="/sign-in"
          >
            {t.app.auth.useExistingAccount}
          </a>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <BrandMark />
        <CardTitle className="text-lg">{t.app.auth.setPasswordTitle}</CardTitle>
        <CardDescription>{t.app.auth.setPasswordDescription}</CardDescription>
      </CardHeader>
      <CardContent>
        <form id="set-password-form" className="flex flex-col gap-5" onSubmit={handleSubmit}>
          <FieldGroup>
            <Field data-invalid={error !== null}>
              <FieldLabel htmlFor="password">{t.app.auth.newPassword}</FieldLabel>
              <Input
                id="password"
                name="password"
                type="password"
                placeholder="••••••••"
                autoComplete="new-password"
                aria-invalid={error !== null}
                minLength={8}
                required
              />
              <FieldError>{error?.resolve(t)}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="confirmation">{t.app.auth.confirmPassword}</FieldLabel>
              <Input
                id="confirmation"
                name="confirmation"
                type="password"
                placeholder="••••••••"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </Field>
          </FieldGroup>
          <p className="text-xs text-muted-foreground">{t.app.auth.passwordHint}</p>
        </form>
      </CardContent>
      <CardFooter>
        <Button form="set-password-form" type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
          {t.app.auth.setPassword}
        </Button>
      </CardFooter>
    </Card>
  );
}

export function SetPasswordPage({ convexUrl }: { convexUrl?: string }) {
  return (
    <I18nProvider>
      <ConvexAuthRoot convexUrl={convexUrl}>
        {/* The theme and language controls share the island so a change applies
            to the form without a page reload. */}
        <div className="fixed top-[max(1rem,env(safe-area-inset-top))] right-[max(1rem,env(safe-area-inset-right))] z-50 flex items-center gap-1">
          <LanguageToggle />
          <ThemeToggle />
        </div>
        <main className="flex min-h-dvh items-center justify-center p-6">
          <SetPasswordForm />
        </main>
      </ConvexAuthRoot>
    </I18nProvider>
  );
}
