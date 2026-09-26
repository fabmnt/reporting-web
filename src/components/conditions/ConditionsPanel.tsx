"use client";

import { useQuery } from "convex/react";

import { api } from "../../../convex/_generated/api";
import { AppLink } from "@/components/app/navigation";
import { PageHeader } from "@/components/app/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocumentTitle, useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

import { ReportTypesPanel } from "./ReportTypesPanel";

const REPORT_PATH = "/";

export function ConditionsPanel() {
  const { t } = useI18n();
  const current = useQuery(api.staffAccounts.current, {});
  // Every role runs reports and configures its own report types.
  const canConfigure = current?.status === "active";

  useDocumentTitle(t.app.titles.configuration);

  const header = (
    <PageHeader
      title={t.conditions.pageTitle}
      actions={
        <AppLink href={REPORT_PATH} className={cn(buttonVariants({ variant: "outline" }))}>
          {t.conditions.backToReports}
        </AppLink>
      }
    />
  );

  if (current === undefined) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (!canConfigure) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <Alert variant="destructive">
          <AlertTitle>{t.conditions.accessDeniedTitle}</AlertTitle>
          <AlertDescription>{t.conditions.accessDeniedBody}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {header}
      <ReportTypesPanel scope="mine" />
    </div>
  );
}
