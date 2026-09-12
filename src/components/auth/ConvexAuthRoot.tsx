import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { useMemo, type ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useI18n } from "@/lib/i18n/context";

export function ConvexAuthRoot({
  convexUrl,
  children,
}: {
  convexUrl?: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
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
        <AlertTitle>{t.app.convex.notConnectedTitle}</AlertTitle>
        <AlertDescription>
          {t.app.convex.notConnectedBefore} <code>pnpm convex dev</code>{" "}
          {t.app.convex.notConnectedAfter}
        </AlertDescription>
      </Alert>
    );
  }

  return <ConvexAuthProvider client={convexClient}>{children}</ConvexAuthProvider>;
}
