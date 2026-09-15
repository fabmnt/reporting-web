import { useEffect, useSyncExternalStore } from "react";

import { getTheme, refreshTheme, subscribeToTheme, type Theme } from "@/lib/theme";

// The server has no stored theme, so it renders the device default until the
// browser resolves the real one.
function serverTheme(): Theme {
  return "system";
}

/** The active theme, shared by every theme control on screen. */
export function useTheme(): Theme {
  const theme = useSyncExternalStore(subscribeToTheme, getTheme, serverTheme);

  useEffect(() => {
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => refreshTheme();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  return theme;
}
