import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { useEffect, useState, type SyntheticEvent } from "react";

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
import { localizedError, type LocalizedMessage } from "@/lib/i18n/errors";

import { ConvexAuthRoot } from "./ConvexAuthRoot";

type AuthMode = "signIn" | "signUp";

function AuthForm({ mode }: { mode: AuthMode }) {
  const { signIn } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { t } = useI18n();
  const [error, setError] = useState<LocalizedMessage | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSignIn = mode === "signIn";

  useDocumentTitle(isSignIn ? t.app.titles.signIn : t.app.titles.signUp);

  useEffect(() => {
    if (isAuthenticated) window.location.replace("/");
  }, [isAuthenticated]);

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    formData.set("flow", mode);

    try {
      await signIn("password", formData);
    } catch (cause) {
      setError(localizedError(cause, (t) => t.app.auth.failed));
      setIsSubmitting(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <div className="mb-2 flex items-center gap-2">
          <span
            aria-hidden="true"
            className="grid size-6 shrink-0 place-items-center rounded-md bg-primary text-xs font-semibold text-primary-foreground"
          >
            R
          </span>
          <span className="text-sm font-semibold tracking-tight">{t.app.brand}</span>
        </div>
        <CardTitle className="text-lg">
          {isSignIn ? t.app.auth.signInTitle : t.app.auth.signUpTitle}
        </CardTitle>
        <CardDescription>
          {isSignIn ? t.app.auth.signInDescription : t.app.auth.signUpDescription}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form id="auth-form" className="flex flex-col gap-5" onSubmit={handleSubmit}>
          <FieldGroup>
            <Field data-invalid={error !== null}>
              <FieldLabel htmlFor="email">{t.app.auth.email}</FieldLabel>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                aria-invalid={error !== null}
                required
              />
            </Field>
            <Field data-invalid={error !== null}>
              <FieldLabel htmlFor="password">{t.app.auth.password}</FieldLabel>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete={isSignIn ? "current-password" : "new-password"}
                aria-invalid={error !== null}
                minLength={8}
                required
              />
              <FieldError>{error?.resolve(t)}</FieldError>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="flex flex-wrap justify-between gap-3">
        <Button form="auth-form" type="submit" size="lg" disabled={isSubmitting || isLoading}>
          {isSubmitting || isLoading ? <Spinner data-icon="inline-start" /> : null}
          {isSignIn ? t.app.auth.signIn : t.app.auth.createAccount}
        </Button>
        <a
          className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          href={isSignIn ? "/sign-up" : "/sign-in"}
        >
          {isSignIn ? t.app.auth.createAccount : t.app.auth.useExistingAccount}
        </a>
      </CardFooter>
    </Card>
  );
}

export function AuthPage({ convexUrl, mode }: { convexUrl?: string; mode: AuthMode }) {
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
          <AuthForm mode={mode} />
        </main>
      </ConvexAuthRoot>
    </I18nProvider>
  );
}
