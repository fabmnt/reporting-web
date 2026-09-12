import { Languages } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/context";
import { LOCALE_NAMES, LOCALES, type Locale } from "@/lib/i18n/locales";

function nextLocale(locale: Locale): Locale {
  const index = LOCALES.indexOf(locale);
  return LOCALES[(index + 1) % LOCALES.length] ?? LOCALES[0];
}

/**
 * Cycles through the available languages. `onSelected` lets a signed-in screen
 * store the choice on the user's account; the device keeps it either way.
 */
export function LanguageToggle({ onSelected }: { onSelected?: (locale: Locale) => void }) {
  const { locale, setLocale, t } = useI18n();
  const next = nextLocale(locale);
  const nextName = LOCALE_NAMES[next];

  function selectNextLocale() {
    setLocale(next);
    onSelected?.(next);
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={selectNextLocale}
      aria-label={t.app.language.switchTo(nextName)}
      title={t.app.language.switchTo(nextName)}
    >
      <Languages />
    </Button>
  );
}
