import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import { applyTheme, NEXT_THEME, readStoredTheme, storeTheme, type Theme } from "@/lib/theme";
import { Button } from "@/components/ui/button";

const THEME_ICON: Record<Theme, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

const THEME_LABEL: Record<Theme, string> = {
  light: "light",
  dark: "dark",
  system: "system (device default)",
};

export function ThemeToggle() {
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
  const nextThemeLabel = THEME_LABEL[NEXT_THEME[theme]];

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={selectNextTheme}
      aria-label={`Switch to ${nextThemeLabel} theme`}
      title={`Switch to ${nextThemeLabel} theme`}
    >
      <Icon />
    </Button>
  );
}
