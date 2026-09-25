import { AdminAccountsPanel } from "@/components/admin/AdminPanel";
import { AdminReportTypesPanel } from "@/components/admin/AdminReportTypesPanel";
import { AdminClientsPanel } from "@/components/admin/ClientsPanel";
import { AdminClinicsPanel } from "@/components/admin/ClinicsPanel";
import { AdminServiceAccountsPanel } from "@/components/admin/ServiceAccountsPanel";
import { AssignedClinicsPanel } from "@/components/clinics/AssignedClinicsPanel";
import { ConditionsPanel } from "@/components/conditions/ConditionsPanel";
import { ReportRunner } from "@/components/reports/ReportPanel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useI18n } from "@/lib/i18n/context";
import { normalizePath } from "@/lib/paths";

import { AppShell } from "./AppShell";

const ROUTES: Record<string, () => React.JSX.Element> = {
  "/": ReportRunner,
  "/clinics": AssignedClinicsPanel,
  "/configuration": ConditionsPanel,
  "/admin": AdminAccountsPanel,
  "/admin/clients": AdminClientsPanel,
  "/admin/clinics": AdminClinicsPanel,
  "/admin/service-accounts": AdminServiceAccountsPanel,
  "/admin/report-types": AdminReportTypesPanel,
};

function NotFound() {
  const { t } = useI18n();

  return (
    <Alert variant="destructive">
      <AlertTitle>{t.app.notFound.title}</AlertTitle>
      <AlertDescription>{t.app.notFound.description}</AlertDescription>
    </Alert>
  );
}

function renderContent(path: string) {
  const Route = ROUTES[path];
  return Route === undefined ? <NotFound /> : <Route />;
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
