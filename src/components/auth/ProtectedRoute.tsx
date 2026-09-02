import { useConvexAuth } from "@convex-dev/auth/react";
import { ConvexError } from "convex/values";
import { Component, useEffect, type ReactNode } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

import { ConvexAuthRoot } from "./ConvexAuthRoot";

const SIGN_IN_PATH = "/sign-in";

function isUnauthenticatedError(error: unknown): boolean {
  if (!(error instanceof ConvexError)) return false;
  const data = error.data;
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { code?: unknown }).code === "UNAUTHENTICATED"
  );
}

type AuthErrorBoundaryState = { error: Error | null };

class AuthErrorBoundary extends Component<{ children: ReactNode }, AuthErrorBoundaryState> {
  state: AuthErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): AuthErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidUpdate(_prevProps: { children: ReactNode }, prevState: AuthErrorBoundaryState) {
    if (
      this.state.error !== null &&
      prevState.error === null &&
      isUnauthenticatedError(this.state.error)
    ) {
      window.location.replace(SIGN_IN_PATH);
    }
  }

  render() {
    const { error } = this.state;

    if (error === null) {
      return this.props.children;
    }
    if (isUnauthenticatedError(error)) {
      return <Skeleton className="h-48 w-full" />;
    }

    return (
      <Alert variant="destructive">
        <AlertTitle>Something went wrong</AlertTitle>
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
    );
  }
}

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
      <AuthErrorBoundary>
        <AuthenticatedContent>{children}</AuthenticatedContent>
      </AuthErrorBoundary>
    </ConvexAuthRoot>
  );
}
