import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  applyDocumentLanguage,
  detectBrowserLanguage,
  DEFAULT_LOCALE,
  readStoredLanguage,
  storeLanguage,
  type Locale,
} from "./locales";
import { MESSAGES, type Messages } from "./messages";

type I18nValue = {
  locale: Locale;
  t: Messages;
  // Applies the language the user picked and remembers it on this device.
  setLocale: (locale: Locale) => void;
  // Applies the language stored on the user's profile. A language picked in
  // this session wins, so a slow profile read cannot revert the choice.
  syncProfileLanguage: (locale: Locale | null | undefined) => void;
};

const I18nContext = createContext<I18nValue | null>(null);

// Astro renders the islands on the server, where there is no window and no
// stored language. The browser build applies the stored language before the
// first paint instead.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const chosenInSession = useRef(false);

  const applyLocale = useCallback((next: Locale, remember: boolean) => {
    if (remember) storeLanguage(next);
    setLocaleState(next);
  }, []);

  useIsomorphicLayoutEffect(() => {
    if (chosenInSession.current) return;
    // Stored choice first, then the device preference, so the server-rendered
    // English is replaced before the browser paints.
    setLocaleState(readStoredLanguage() ?? detectBrowserLanguage());
  }, []);

  useEffect(() => {
    applyDocumentLanguage(locale);
  }, [locale]);

  const setLocale = useCallback(
    (next: Locale) => {
      chosenInSession.current = true;
      applyLocale(next, true);
    },
    [applyLocale]
  );

  const syncProfileLanguage = useCallback(
    (next: Locale | null | undefined) => {
      if (next === null || next === undefined || chosenInSession.current) return;
      applyLocale(next, true);
    },
    [applyLocale]
  );

  const value = useMemo<I18nValue>(
    () => ({ locale, t: MESSAGES[locale], setLocale, syncProfileLanguage }),
    [locale, setLocale, syncProfileLanguage]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (value === null) {
    throw new Error("useI18n must be used inside I18nProvider.");
  }
  return value;
}

// Keeps the browser tab in step with the language, without a full reload.
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
