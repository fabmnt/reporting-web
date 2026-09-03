import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { ProtectedRoute } from "./ProtectedRoute";

function HomeContent() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signOut } = useAuthActions();
  const ensureProfile = useMutation(api.staffAccounts.ensureCurrentProfile);
  const account = useQuery(api.staffAccounts.current, isAuthenticated ? {} : "skip");
  const requestedProfile = useRef(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || account !== null || requestedProfile.current) return;

    requestedProfile.current = true;
    void ensureProfile({}).catch((cause: unknown) => {
      setSetupError(cause instanceof Error ? cause.message : "Account setup failed.");
    });
  }, [account, ensureProfile, isAuthenticated]);

  async function handleSignOut() {
    await signOut();
    window.location.replace("/sign-in");
  }

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  if (!isAuthenticated) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Reporting Web</CardTitle>
          <CardDescription>Sign in to access reporting tools.</CardDescription>
        </CardHeader>
        <CardFooter className="flex gap-3">
          <Button render={<a href="/sign-in" />}>Sign in</Button>
          <Button variant="outline" render={<a href="/sign-up" />}>
            Create account
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (setupError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Account setup failed</AlertTitle>
        <AlertDescription>{setupError}</AlertDescription>
      </Alert>
    );
  }

  if (account === undefined || account === null) return <Skeleton className="h-48 w-full" />;

  if (account.status === "disabled") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Account awaiting approval</CardTitle>
          <CardDescription>
            An administrator must enable {account.email ?? account.displayName} before you can use
            Reporting Web.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button variant="outline" onClick={() => void handleSignOut()}>
            Sign out
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reporting Web</CardTitle>
        <CardDescription>Signed in as {account.email ?? account.displayName}.</CardDescription>
        <CardAction>
          <Badge variant="secondary">{account.role}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Run audit and upload reports against live Google Sheets.
        </p>
      </CardContent>
      <CardFooter className="flex justify-between gap-3">
        <div className="flex gap-3">
          <Button render={<a href="/reports" />}>Run report</Button>
          {account.role === "admin" ? (
            <>
              <Button variant="outline" render={<a href="/admin" />}>
                Manage accounts
              </Button>
              <Button variant="outline" render={<a href="/admin/clinics" />}>
                Manage clinics
              </Button>
            </>
          ) : null}
        </div>
        <Button variant="outline" onClick={() => void handleSignOut()}>
          Sign out
        </Button>
      </CardFooter>
    </Card>
  );
}

export function AccountHome({ convexUrl }: { convexUrl?: string }) {
  return (
    <ProtectedRoute convexUrl={convexUrl}>
      <HomeContent />
    </ProtectedRoute>
  );
}
