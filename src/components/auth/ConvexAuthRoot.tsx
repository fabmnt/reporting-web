import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { useMemo, type ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function ConvexAuthRoot({
  convexUrl,
  children,
}: {
  convexUrl?: string;
  children: ReactNode;
}) {
  const convexClient = useMemo(
    () =>
      convexUrl
        ? new ConvexReactClient(convexUrl, {
            // Without this the client throws away the valid cached JWT on every
            // page load and immediately calls `auth:signIn` with the refresh
            // token. That second Authenticate makes the server re-run every
            // authenticated query before anything renders. With it, the cached
            // token is reused and a refresh is scheduled before it expires.
            initialAuthTokenReuse: true,
          })
        : null,
    [convexUrl]
  );

  if (!convexClient) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Convex is not connected</AlertTitle>
        <AlertDescription>
          Run <code>pnpm convex dev</code> before using authentication.
        </AlertDescription>
      </Alert>
    );
  }

  return <ConvexAuthProvider client={convexClient}>{children}</ConvexAuthProvider>;
}
