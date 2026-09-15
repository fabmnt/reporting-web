import { Languages, LogOut, Menu, Monitor, Moon, Sun } from "lucide-react";

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

/**
 * Holds everything that does not fit in the narrow header: the signed-in
 * account, the language, the theme, and signing out.
 */
export function AccountMenu({
  account,
  onLanguageSelected,
  onSignOut,
}: {
  account: CurrentAccount;
  onLanguageSelected: (locale: Locale) => void;
  onSignOut: () => void;
}) {
  const { locale, setLocale, t } = useI18n();
  const theme = useTheme();
  const canAdmin = account.role === "admin" && account.status === "active";
  const ThemeIcon = THEME_ICON[theme];

  function selectLocale(next: Locale) {
    setLocale(next);
    onLanguageSelected(next);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" className="size-10 md:hidden" />}
        aria-label={t.app.account.menu}
      >
        <Menu />
      </DropdownMenuTrigger>
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
          <DropdownMenuItem variant="destructive" className="py-1.5" onClick={onSignOut}>
            <LogOut />
            {t.app.signOut}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
