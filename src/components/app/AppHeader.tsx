import { useAuthActions } from "@convex-dev/auth/react";
import type { FunctionReturnType } from "convex/server";
import { LogOut } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isActivePath } from "@/lib/paths";
import { cn } from "@/lib/utils";

import { AppLink, useNavigation } from "./navigation";

export type CurrentAccount = NonNullable<FunctionReturnType<typeof api.staffAccounts.current>>;

const REPORT_PATH = "/";
const CLINICS_PATH = "/clinics";
const ADMIN_PATH = "/admin";

function initialsFor(account: CurrentAccount): string {
  const source = account.displayName.trim() || account.email || "";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function AppHeader({ account }: { account: CurrentAccount }) {
  const { signOut } = useAuthActions();
  const { path } = useNavigation();
  const canAdmin = account.role === "admin" && account.status === "active";
  const canConfigureClinics =
    account.status === "active" && (account.role === "admin" || account.role === "operator");
  const navItems = [
    { href: REPORT_PATH, label: "Reports" },
    ...(canConfigureClinics ? [{ href: CLINICS_PATH, label: "Clinics" }] : []),
    ...(canAdmin ? [{ href: ADMIN_PATH, label: "Admin" }] : []),
  ];

  async function handleSignOut() {
    await signOut();
    window.location.replace("/sign-in");
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
          <span className="hidden sm:inline">Reporting Web</span>
          <span className="sr-only sm:hidden">Reporting Web</span>
        </AppLink>

        <nav aria-label="Primary" className="flex items-stretch self-stretch">
          {navItems.map((item) => {
            const active = isActivePath(item.href, path);
            return (
              <AppLink
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex items-center px-2 text-sm font-medium transition-colors sm:px-3",
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

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <ThemeToggle />
          <span
            aria-hidden="true"
            className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
          >
            {initialsFor(account)}
          </span>
          <span className="hidden max-w-40 truncate text-sm text-muted-foreground sm:inline">
            {account.displayName}
          </span>
          <span className="sr-only sm:hidden">Signed in as {account.displayName}</span>
          {canAdmin ? (
            <Badge variant="secondary" className="hidden sm:inline-flex">
              {account.role}
            </Badge>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void handleSignOut()}
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut />
          </Button>
        </div>
      </div>
    </header>
  );
}
