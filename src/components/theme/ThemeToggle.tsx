import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import { applyTheme, NEXT_THEME, readStoredTheme, storeTheme, type Theme } from "@/lib/theme";
import { useI18n } from "@/lib/i18n/context";
import type { Messages } from "@/lib/i18n/messages";
import { Button } from "@/components/ui/button";

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
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const stored = readStoredTheme();
    setTheme(stored);
    applyTheme(stored);
  }, []);

  useEffect(() => {
    if (theme !== "system") {
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  const selectNextTheme = () => {
    const next = NEXT_THEME[theme];
    storeTheme(next);
    applyTheme(next);
    setTheme(next);
  };

  const Icon = THEME_ICON[theme];
  const nextThemeLabel = THEME_NAME[NEXT_THEME[theme]](t);

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={selectNextTheme}
      aria-label={t.app.theme.switchTo(nextThemeLabel)}
      title={t.app.theme.switchTo(nextThemeLabel)}
    >
      <Icon />
    </Button>
  );
}
