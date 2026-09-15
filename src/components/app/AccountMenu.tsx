import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation } from "convex/react";
import { ChevronDown, CircleUser, Languages, LogOut, Monitor, Moon, Sun } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import { LOCALES, LOCALE_NAMES, type Locale } from "@/lib/i18n/locales";
import { setTheme, THEMES, type Theme } from "@/lib/theme";
import { useI18n } from "@/lib/i18n/context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/components/theme/useTheme";

import type { CurrentAccount } from "./AppHeader";

const THEME_ICON: Record<Theme, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

const SIGN_IN_PATH = "/sign-in";

/**
 * The account controls: who is signed in, the language, the theme, and signing
 * out. The header shows a button with the username, the bottom bar of narrow
 * screens one more item beside the sections.
 */
export function AccountMenu({
  account,
  placement = "header",
}: {
  account: CurrentAccount;
  placement?: "header" | "bottomBar";
}) {
  const { signOut } = useAuthActions();
  const { locale, setLocale, t } = useI18n();
  const theme = useTheme();
  const setLanguage = useMutation(api.staffAccounts.setLanguage);
  const canAdmin = account.role === "admin" && account.status === "active";
  const ThemeIcon = THEME_ICON[theme];

  async function handleSignOut() {
    await signOut();
    window.location.replace(SIGN_IN_PATH);
  }

  function selectLocale(next: Locale) {
    setLocale(next);
    // The choice already applied on this device, so a failed save only means
    // the next device will not start in it.
    void setLanguage({ language: next }).catch(() => undefined);
  }

  return (
    <DropdownMenu>
      {placement === "bottomBar" ? (
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className="relative flex min-w-0 flex-1 cursor-pointer flex-col items-center gap-1 rounded-lg py-2 text-xs font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring aria-expanded:text-foreground"
            />
          }
          aria-label={t.app.account.menu}
        >
          <CircleUser className="size-5" aria-hidden="true" />
          <span className="max-w-full truncate px-1">{account.username}</span>
        </DropdownMenuTrigger>
      ) : (
        <DropdownMenuTrigger
          render={<Button variant="ghost" className="h-10 gap-1 px-2" />}
          aria-label={t.app.account.menu}
        >
          <span className="max-w-28 truncate text-sm font-medium">{account.username}</span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </DropdownMenuTrigger>
      )}
      <DropdownMenuContent align="end" sideOffset={6} className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-1 px-2 py-1.5">
            <span className="truncate text-sm font-medium text-foreground">
              {account.displayName}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="truncate text-xs font-normal">{account.username}</span>
              {canAdmin ? (
                <Badge variant="secondary" className="px-1.5">
                  {t.app.roles.admin}
                </Badge>
              ) : null}
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="py-1.5">
            <Languages />
            {t.app.account.language}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={locale}
              onValueChange={(value) => selectLocale(value as Locale)}
            >
              {LOCALES.map((value) => (
                <DropdownMenuRadioItem key={value} value={value} className="py-1.5">
                  {LOCALE_NAMES[value]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="py-1.5">
            <ThemeIcon />
            {t.app.account.theme}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={theme}
              onValueChange={(value) => setTheme(value as Theme)}
            >
              {THEMES.map((value) => {
                const Icon = THEME_ICON[value];
                return (
                  <DropdownMenuRadioItem key={value} value={value} className="py-1.5">
                    <Icon />
                    {t.app.account.themes[value]}
                  </DropdownMenuRadioItem>
                );
              })}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            variant="destructive"
            className="py-1.5"
            onClick={() => void handleSignOut()}
          >
            <LogOut />
            {t.app.signOut}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
