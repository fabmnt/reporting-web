import { useAuthActions } from "@convex-dev/auth/react";
import type { FunctionReturnType } from "convex/server";
import { useMutation } from "convex/react";
import { LogOut } from "lucide-react";
import { useEffect, useRef } from "react";

import { api } from "../../../convex/_generated/api";
import { LanguageToggle } from "@/components/i18n/LanguageToggle";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/locales";
import { isActivePath } from "@/lib/paths";
import { cn } from "@/lib/utils";

import { AccountMenu } from "./AccountMenu";
import { AppLink, useNavigation } from "./navigation";

export type CurrentAccount = NonNullable<FunctionReturnType<typeof api.staffAccounts.current>>;

const REPORT_PATH = "/";
const CLINICS_PATH = "/clinics";
const CONFIGURATION_PATH = "/configuration";
const ADMIN_PATH = "/admin";

// A nav item can cover more than one route. The configuration screen is only
// reachable from the reports page, so its route keeps the Reports item current.
type NavItem = { href: string; label: string; sectionPaths?: string[] };

function isCurrentSection({ href, sectionPaths = [] }: NavItem, path: string): boolean {
  return [href, ...sectionPaths].some((candidate) => isActivePath(candidate, path));
}

function initialsFor(account: CurrentAccount): string {
  const source = account.displayName.trim() || account.username || "";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function AppHeader({ account }: { account: CurrentAccount }) {
  const { signOut } = useAuthActions();
  const { path } = useNavigation();
  const { t } = useI18n();
  const setLanguage = useMutation(api.staffAccounts.setLanguage);
  const navRef = useRef<HTMLElement | null>(null);
  const canAdmin = account.role === "admin" && account.status === "active";
  const canConfigureClinics =
    account.status === "active" && (account.role === "admin" || account.role === "operator");
  const navItems: NavItem[] = [
    { href: REPORT_PATH, label: t.app.nav.reports, sectionPaths: [CONFIGURATION_PATH] },
    ...(canConfigureClinics ? [{ href: CLINICS_PATH, label: t.app.nav.clinics }] : []),
    ...(canAdmin ? [{ href: ADMIN_PATH, label: t.app.nav.admin }] : []),
  ];

  // The nav scrolls sideways on narrow screens, so the current page has to be
  // brought back into view instead of staying off the edge.
  useEffect(() => {
    navRef.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [path]);

  async function handleSignOut() {
    await signOut();
    window.location.replace("/sign-in");
  }

  // The choice already applied on this device, so a failed save only means the
  // next device will not start in it.
  function rememberLanguage(locale: Locale) {
    void setLanguage({ language: locale }).catch(() => undefined);
  }

  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-1 px-3 sm:gap-4 sm:px-6">
        <AppLink
          href={REPORT_PATH}
          className="flex items-center gap-2 text-sm font-semibold tracking-tight"
        >
          <span
            aria-hidden="true"
            className="grid size-6 shrink-0 place-items-center rounded-md bg-primary text-xs font-semibold text-primary-foreground"
          >
            R
          </span>
          <span className="hidden sm:inline">{t.app.brand}</span>
          <span className="sr-only sm:hidden">{t.app.brand}</span>
        </AppLink>

        <nav
          ref={navRef}
          aria-label={t.app.nav.primary}
          className="flex min-w-0 flex-1 items-stretch self-stretch overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {navItems.map((item) => {
            const active = isCurrentSection(item, path);
            return (
              <AppLink
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex items-center px-2 text-sm font-medium whitespace-nowrap transition-colors sm:px-3",
                  active
                    ? "text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-t-full after:bg-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {item.label}
              </AppLink>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          <div className="hidden items-center gap-1 md:flex md:gap-2">
            <LanguageToggle onSelected={rememberLanguage} />
            <ThemeToggle />
            <span
              aria-hidden="true"
              className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
            >
              {initialsFor(account)}
            </span>
            <span className="hidden max-w-40 truncate text-sm text-muted-foreground lg:inline">
              {account.displayName}
            </span>
            <span className="sr-only lg:hidden">{t.app.signedInAs(account.displayName)}</span>
            {canAdmin ? (
              <Badge variant="secondary" className="hidden lg:inline-flex">
                {t.app.roles.admin}
              </Badge>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void handleSignOut()}
              aria-label={t.app.signOut}
              title={t.app.signOut}
            >
              <LogOut />
            </Button>
          </div>
          <AccountMenu
            account={account}
            onLanguageSelected={rememberLanguage}
            onSignOut={() => void handleSignOut()}
          />
        </div>
      </div>
    </header>
  );
}
