"use client";

import { useQuery } from "convex/react";

import { api } from "../../../convex/_generated/api";
import { AdminTabs } from "@/components/app/AdminTabs";
import { PageHeader } from "@/components/app/PageHeader";
import { SheetFiltersEditor } from "@/components/sheetFilters/SheetFiltersEditor";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocumentTitle, useI18n } from "@/lib/i18n/context";

export function AdminSheetFiltersPanel() {
  const { t } = useI18n();
  const current = useQuery(api.staffAccounts.current, {});
  const canManage = current?.role === "admin" && current.status === "active";

  useDocumentTitle(t.app.titles.adminSheetFilters);

  const header = <PageHeader title={t.sheetFilters.admin.pageTitle} />;

  if (current === undefined) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <AdminTabs />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <AdminTabs />
        <Alert variant="destructive">
          <AlertTitle>{t.admin.accessDeniedTitle}</AlertTitle>
          <AlertDescription>{t.sheetFilters.admin.accessDeniedBody}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {header}
      <AdminTabs />
      <SheetFiltersEditor />
    </div>
  );
}
