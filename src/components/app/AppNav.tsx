"use client";

import { Building2, FileText, ShieldCheck } from "lucide-react";
import { useEffect, useRef } from "react";

import { useI18n } from "@/lib/i18n/context";
import { isActivePath } from "@/lib/paths";
import { cn } from "@/lib/utils";

import type { CurrentAccount } from "./AppHeader";
import { AccountMenu } from "./AccountMenu";
import { AppLink, useNavigation } from "./navigation";

const REPORT_PATH = "/";
const CLINICS_PATH = "/clinics";
const ADMIN_PATH = "/admin";
const CONFIGURATION_PATH = "/configuration";

// A nav item can cover more than one route. The configuration screen is only
// reachable from the reports page, so its route keeps the Reports item current.
type NavItem = {
  href: string;
  labelKey: "reports" | "clinics" | "admin";
  Icon: typeof FileText;
  sectionPaths?: string[];
};

const NAV_ITEMS: NavItem[] = [
  { href: REPORT_PATH, labelKey: "reports", Icon: FileText, sectionPaths: [CONFIGURATION_PATH] },
  { href: CLINICS_PATH, labelKey: "clinics", Icon: Building2 },
  { href: ADMIN_PATH, labelKey: "admin", Icon: ShieldCheck },
];

// The sections this account may open.
function visibleNavItems(account: CurrentAccount): NavItem[] {
  const canConfigureClinics =
    account.status === "active" && (account.role === "admin" || account.role === "operator");
  const canAdmin = account.role === "admin" && account.status === "active";

  return NAV_ITEMS.filter((item) => {
    if (item.href === CLINICS_PATH) return canConfigureClinics;
    if (item.href === ADMIN_PATH) return canAdmin;
    return true;
  });
}

function isCurrentSection({ href, sectionPaths = [] }: NavItem, path: string): boolean {
  return [href, ...sectionPaths].some((candidate) => isActivePath(candidate, path));
}

/** The sections of the app, laid out across the header of wide screens. */
export function AppHeaderNav({ account }: { account: CurrentAccount }) {
  const { path } = useNavigation();
  const { t } = useI18n();
  const navRef = useRef<HTMLElement | null>(null);
  const items = visibleNavItems(account);

  // The nav scrolls sideways when the header runs out of room, so the current
  // section has to be brought back into view instead of staying off the edge.
  useEffect(() => {
    navRef.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [path]);

  return (
    <nav
      ref={navRef}
      aria-label={t.app.nav.primary}
      className="flex min-w-0 flex-1 items-stretch self-stretch overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {items.map((item) => {
        const active = isCurrentSection(item, path);
        return (
          <AppLink
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex items-center px-3 text-sm font-medium whitespace-nowrap transition-colors",
              active
                ? "text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-t-full after:bg-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.app.nav[item.labelKey]}
          </AppLink>
        );
      })}
    </nav>
  );
}

/**
 * The same sections, pinned to the bottom of the screen where a thumb reaches
 * them, with the account menu as one more item. Only a short label fits here,
 * so every item carries an icon and splits the width of the bar evenly.
 */
export function AppBottomNav({ account }: { account: CurrentAccount }) {
  const { path } = useNavigation();
  const { t } = useI18n();
  const items = visibleNavItems(account);

  return (
    <nav
      aria-label={t.app.nav.primary}
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
    >
      <div className="mx-auto flex w-full max-w-6xl items-stretch">
        {items.map((item) => {
          const active = isCurrentSection(item, path);
          const ItemIcon = item.Icon;
          return (
            <AppLink
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex flex-1 flex-col items-center gap-1 py-2 text-xs font-medium transition-colors",
                active
                  ? "text-primary after:absolute after:inset-x-4 after:top-0 after:h-0.5 after:rounded-b-full after:bg-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <ItemIcon className="size-5" aria-hidden="true" />
              {t.app.nav[item.labelKey]}
            </AppLink>
          );
        })}
        <AccountMenu account={account} placement="bottomBar" />
      </div>
    </nav>
  );
}
