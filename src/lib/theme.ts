export type Theme = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "reporting-web-theme";

export const NEXT_THEME: Record<Theme, Theme> = {
  light: "dark",
  dark: "system",
  system: "light",
};

export function readStoredTheme(): Theme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

export function storeTheme(theme: Theme): void {
  localStorage.setItem(THEME_STORAGE_KEY, theme);
}

// "system" resolves to the device preference at call time, so it keeps
// following the OS when the user changes it mid-session.
export function isDarkTheme(theme: Theme): boolean {
  return (
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
  );
}

export function applyTheme(theme: Theme): void {
  const dark = isDarkTheme(theme);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}
