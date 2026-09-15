import { Monitor, Moon, Sun } from "lucide-react";

import { NEXT_THEME, setTheme, type Theme } from "@/lib/theme";
import { useI18n } from "@/lib/i18n/context";
import type { Messages } from "@/lib/i18n/messages";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme/useTheme";

const THEME_ICON: Record<Theme, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

const THEME_NAME: Record<Theme, (t: Messages) => string> = {
  light: (t) => t.app.theme.light,
  dark: (t) => t.app.theme.dark,
  system: (t) => t.app.theme.system,
};

export function ThemeToggle() {
  const { t } = useI18n();
  const theme = useTheme();

  const Icon = THEME_ICON[theme];
  const nextThemeLabel = THEME_NAME[NEXT_THEME[theme]](t);

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(NEXT_THEME[theme])}
      aria-label={t.app.theme.switchTo(nextThemeLabel)}
      title={t.app.theme.switchTo(nextThemeLabel)}
    >
      <Icon />
    </Button>
  );
}
