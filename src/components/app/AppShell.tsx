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
import { I18nProvider, useI18n } from "@/lib/i18n/context";
import { errorText, localizedError, type LocalizedMessage } from "@/lib/i18n/errors";
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

    return <ErrorScreen error={error} />;
  }
}

// Inside the provider, so a backend error still reads in the user's language.
function ErrorScreen({ error }: { error: Error }) {
  const { t } = useI18n();

  return (
    <Centered>
      <Alert variant="destructive" className="w-full max-w-md">
        <AlertTitle>{t.app.states.somethingWentWrong}</AlertTitle>
        <AlertDescription>{errorText(error, t)}</AlertDescription>
      </Alert>
    </Centered>
  );
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

function AwaitingApproval({
  username,
  onSignOut,
}: {
  username: string | null;
  onSignOut: () => void;
}) {
  const { t } = useI18n();

  return (
    <Centered>
      <div className="w-full max-w-md rounded-xl bg-card p-6 ring-1 ring-foreground/10">
        <h1 className="font-heading text-lg font-medium">{t.app.states.awaitingApprovalTitle}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t.app.states.awaitingApprovalBody(username ?? t.app.states.yourAccount)}
        </p>
        <div className="mt-4">
          <Button variant="outline" onClick={onSignOut}>
            {t.app.signOut}
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
  const { t } = useI18n();

  return (
    <NavigationContext.Provider value={navigation}>
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:border focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground"
      >
        {t.app.skipToContent}
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
  const { t, syncProfileLanguage } = useI18n();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signOut } = useAuthActions();
  const ensureProfile = useMutation(api.staffAccounts.ensureCurrentProfile);
  const account = useQuery(api.staffAccounts.current, isAuthenticated ? {} : "skip");
  const requestedProfile = useRef(false);
  const [setupError, setSetupError] = useState<LocalizedMessage | null>(null);
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
      setSetupError(localizedError(cause, (t) => t.app.states.accountSetupFailedFallback));
    });
  }, [account, ensureProfile, isAuthenticated]);

  // The language stored on the profile wins over the device preference, unless
  // the user already picked one in this session.
  useEffect(() => {
    syncProfileLanguage(account?.language);
  }, [account?.language, syncProfileLanguage]);

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
          <AlertTitle>{t.app.states.accountSetupFailed}</AlertTitle>
          <AlertDescription>{setupError.resolve(t)}</AlertDescription>
        </Alert>
      </Centered>
    );
  }

  if (account === undefined || account === null) return <LoadingScreen />;

  if (account.status === "disabled") {
    return <AwaitingApproval username={account.username} onSignOut={() => void handleSignOut()} />;
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
    <I18nProvider>
      <ConvexAuthRoot convexUrl={convexUrl}>
        <AuthErrorBoundary>
          <AuthGate initialPath={initialPath} renderContent={renderContent} />
        </AuthErrorBoundary>
      </ConvexAuthRoot>
    </I18nProvider>
  );
}
