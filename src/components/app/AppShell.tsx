import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { api } from "../../../convex/_generated/api";
import { ConvexAuthRoot } from "@/components/auth/ConvexAuthRoot";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { normalizePath } from "@/lib/paths";

import { AppHeader, type CurrentAccount } from "./AppHeader";
import { NavigationContext } from "./navigation";

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

    if (error === null) return this.props.children;
    if (isUnauthenticatedError(error)) return <LoadingScreen />;

    return (
      <Centered>
        <Alert variant="destructive" className="w-full max-w-md">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      </Centered>
    );
  }
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh items-center justify-center p-6">{children}</div>;
}

function LoadingScreen() {
  return (
    <Centered>
      <Spinner className="size-5 text-muted-foreground" />
    </Centered>
  );
}

function AwaitingApproval({ email, onSignOut }: { email: string | null; onSignOut: () => void }) {
  return (
    <Centered>
      <div className="w-full max-w-md rounded-xl bg-card p-6 ring-1 ring-foreground/10">
        <h1 className="font-heading text-lg font-medium">Account awaiting approval</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          An administrator must enable {email ?? "your account"} before you can use Reporting Web.
        </p>
        <div className="mt-4">
          <Button variant="outline" onClick={onSignOut}>
            Sign out
          </Button>
        </div>
      </div>
    </Centered>
  );
}

function AppFrame({
  account,
  path,
  navigation,
  children,
}: {
  account: CurrentAccount;
  path: string;
  navigation: { path: string; navigate: (path: string) => void };
  children: ReactNode;
}) {
  return (
    <NavigationContext.Provider value={navigation}>
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:border focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground"
      >
        Skip to content
      </a>
      <AppHeader account={account} />
      <main id="content" className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8" key={path}>
        {children}
      </main>
    </NavigationContext.Provider>
  );
}

function AuthGate({
  initialPath,
  renderContent,
}: {
  initialPath: string;
  renderContent: (path: string) => ReactNode;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signOut } = useAuthActions();
  const ensureProfile = useMutation(api.staffAccounts.ensureCurrentProfile);
  const account = useQuery(api.staffAccounts.current, isAuthenticated ? {} : "skip");
  const requestedProfile = useRef(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [path, setPath] = useState(() => normalizePath(initialPath));

  useEffect(() => {
    const onPopState = () => setPath(normalizePath(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((next: string) => {
    const target = normalizePath(next);
    if (target !== normalizePath(window.location.pathname)) {
      window.history.pushState({}, "", target);
    }
    setPath(target);
    window.scrollTo({ top: 0 });
  }, []);

  const navigation = useMemo(() => ({ path, navigate }), [path, navigate]);

  useEffect(() => {
    if (!isAuthenticated || account !== null || requestedProfile.current) return;

    requestedProfile.current = true;
    void ensureProfile({}).catch((cause: unknown) => {
      setSetupError(cause instanceof Error ? cause.message : "Account setup failed.");
    });
  }, [account, ensureProfile, isAuthenticated]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      window.location.replace(SIGN_IN_PATH);
    }
  }, [isAuthenticated, isLoading]);

  async function handleSignOut() {
    await signOut();
    window.location.replace(SIGN_IN_PATH);
  }

  if (isLoading || !isAuthenticated) return <LoadingScreen />;

  if (setupError) {
    return (
      <Centered>
        <Alert variant="destructive" className="w-full max-w-md">
          <AlertTitle>Account setup failed</AlertTitle>
          <AlertDescription>{setupError}</AlertDescription>
        </Alert>
      </Centered>
    );
  }

  if (account === undefined || account === null) return <LoadingScreen />;

  if (account.status === "disabled") {
    return <AwaitingApproval email={account.email} onSignOut={() => void handleSignOut()} />;
  }

  return (
    <AppFrame account={account} path={path} navigation={navigation}>
      {renderContent(path)}
    </AppFrame>
  );
}

/**
 * One island owns the Convex client, the auth gate, the header, and the route
 * switch. Navigating between in-app routes only swaps the rendered content, so
 * the websocket, the access token, and every subscribed query stay alive
 * instead of being rebuilt on a full page load.
 */
export function AppShell({
  convexUrl,
  initialPath,
  renderContent,
}: {
  convexUrl?: string;
  initialPath: string;
  renderContent: (path: string) => ReactNode;
}) {
  return (
    <ConvexAuthRoot convexUrl={convexUrl}>
      <AuthErrorBoundary>
        <AuthGate initialPath={initialPath} renderContent={renderContent} />
      </AuthErrorBoundary>
    </ConvexAuthRoot>
  );
}
