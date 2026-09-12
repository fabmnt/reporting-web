export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];

export const LANGUAGE_STORAGE_KEY = "reporting-web-language";

// What the server-rendered HTML uses until the browser resolves the visitor's
// own language.
export const DEFAULT_LOCALE: Locale = "en";

// Every language names itself, so the switcher stays readable whichever
// language is active.
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  es: "Español",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

// Storage can be blocked or missing (private browsing, embedded webviews), so a
// failed read or write only means the language is not remembered on this
// device. The session keeps using whatever was resolved.
export function readStoredLanguage(): Locale | null {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLocale(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function storeLanguage(locale: Locale): void {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
  } catch {
    // Nothing to do: the language still applies to the current session.
  }
}

// The device preference decides the language of a visitor with no stored
// choice. Matching on the primary subtag makes "es-MX" and "es-419" resolve to
// Spanish, and anything unsupported falls back to English.
export function detectBrowserLanguage(): Locale {
  const candidates = [...(navigator.languages ?? []), navigator.language];
  for (const candidate of candidates) {
    const primary = candidate?.toLowerCase().split("-")[0];
    if (isLocale(primary)) return primary;
  }
  return "en";
}

export function resolveInitialLanguage(): Locale {
  return readStoredLanguage() ?? detectBrowserLanguage();
}

export function applyDocumentLanguage(locale: Locale): void {
  document.documentElement.lang = locale;
}
