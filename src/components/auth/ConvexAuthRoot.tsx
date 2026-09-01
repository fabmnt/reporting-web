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
    () => (convexUrl ? new ConvexReactClient(convexUrl) : null),
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
