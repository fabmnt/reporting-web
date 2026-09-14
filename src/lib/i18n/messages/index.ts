import type { Locale } from "../locales";
import { en, type Messages } from "./en";
import { es } from "./es";

export type { Messages };

export const MESSAGES: Record<Locale, Messages> = { en, es };
