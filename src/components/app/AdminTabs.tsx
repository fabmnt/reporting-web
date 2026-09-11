import { isSamePath } from "@/lib/paths";
import { cn } from "@/lib/utils";

import { AppLink, useNavigation } from "./navigation";

const ADMIN_TABS = [
  { href: "/admin", label: "Accounts" },
  { href: "/admin/clinics", label: "Clinics" },
] as const;

export function AdminTabs() {
  const { path } = useNavigation();

  return (
    <nav aria-label="Admin sections" className="flex items-center gap-1 border-b">
      {ADMIN_TABS.map((tab) => {
        const active = isSamePath(tab.href, path);
        return (
          <AppLink
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </AppLink>
        );
      })}
    </nav>
  );
}
