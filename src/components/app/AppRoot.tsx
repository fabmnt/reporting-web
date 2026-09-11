import { AdminAccountsPanel } from "@/components/admin/AdminPanel";
import { AdminClinicsPanel } from "@/components/admin/ClinicsPanel";
import { ReportRunner } from "@/components/reports/ReportPanel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { normalizePath } from "@/lib/paths";

import { AppShell } from "./AppShell";

const ROUTES: Record<string, () => React.JSX.Element> = {
  "/": ReportRunner,
  "/admin": AdminAccountsPanel,
  "/admin/clinics": AdminClinicsPanel,
};

function renderContent(path: string) {
  const Route = ROUTES[path];
  if (Route === undefined) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Page not found</AlertTitle>
        <AlertDescription>That page does not exist.</AlertDescription>
      </Alert>
    );
  }
  return <Route />;
}

export function AppRoot({ convexUrl, initialPath }: { convexUrl?: string; initialPath: string }) {
  return (
    <AppShell
      convexUrl={convexUrl}
      initialPath={normalizePath(initialPath)}
      renderContent={renderContent}
    />
  );
}
