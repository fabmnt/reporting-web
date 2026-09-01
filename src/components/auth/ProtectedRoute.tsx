import { useConvexAuth } from "@convex-dev/auth/react";
import { useEffect, type ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";

import { ConvexAuthRoot } from "./ConvexAuthRoot";

const SIGN_IN_PATH = "/sign-in";

function AuthenticatedContent({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      window.location.replace(SIGN_IN_PATH);
    }
  }, [isAuthenticated, isLoading]);

  if (isLoading || !isAuthenticated) {
    return <Skeleton className="h-48 w-full" />;
  }

  return children;
}

export function ProtectedRoute({
  convexUrl,
  children,
}: {
  convexUrl?: string;
  children: ReactNode;
}) {
  return (
    <ConvexAuthRoot convexUrl={convexUrl}>
      <AuthenticatedContent>{children}</AuthenticatedContent>
    </ConvexAuthRoot>
  );
}
