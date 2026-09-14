import { enUS, es, type Locale as DateFnsLocale } from "date-fns/locale";

import type { Locale } from "./locales";

// date-fns and react-day-picker take their month and weekday names from here.
export const DATE_LOCALES: Record<Locale, DateFnsLocale> = {
  en: enUS,
  es,
};
