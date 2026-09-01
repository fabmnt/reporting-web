import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { useEffect, useState, type SyntheticEvent } from "react";

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

import { ConvexAuthRoot } from "./ConvexAuthRoot";

type AuthMode = "signIn" | "signUp";

function AuthForm({ mode }: { mode: AuthMode }) {
  const { signIn } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSignIn = mode === "signIn";

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
      setError(cause instanceof Error ? cause.message : "Authentication failed.");
      setIsSubmitting(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{isSignIn ? "Sign in" : "Create your account"}</CardTitle>
        <CardDescription>
          {isSignIn
            ? "Use your Reporting Web account."
            : "An administrator must enable your account before you can use the app."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form id="auth-form" className="flex flex-col gap-5" onSubmit={handleSubmit}>
          <FieldGroup>
            <Field data-invalid={error !== null}>
              <FieldLabel htmlFor="email">Email</FieldLabel>
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
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete={isSignIn ? "current-password" : "new-password"}
                aria-invalid={error !== null}
                minLength={8}
                required
              />
              <FieldError>{error}</FieldError>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="flex justify-between gap-3">
        <Button form="auth-form" type="submit" disabled={isSubmitting || isLoading}>
          {isSubmitting || isLoading ? <Spinner data-icon="inline-start" /> : null}
          {isSignIn ? "Sign in" : "Create account"}
        </Button>
        <a
          className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          href={isSignIn ? "/sign-up" : "/sign-in"}
        >
          {isSignIn ? "Create account" : "Use existing account"}
        </a>
      </CardFooter>
    </Card>
  );
}

export function AuthPage({ convexUrl, mode }: { convexUrl?: string; mode: AuthMode }) {
  return (
    <ConvexAuthRoot convexUrl={convexUrl}>
      <AuthForm mode={mode} />
    </ConvexAuthRoot>
  );
}
