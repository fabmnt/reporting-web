import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { useState } from "react";
import type { DateRange } from "react-day-picker";

import { parseIsoDate, toIsoDate } from "@/lib/dates";
import { useI18n } from "@/lib/i18n/context";
import { DATE_LOCALES } from "@/lib/i18n/dateLocales";
import type { Locale } from "@/lib/i18n/locales";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type DateRangeValue = {
  startDate: string;
  endDate: string;
};

function toDateRange(value: DateRangeValue): DateRange {
  return {
    from: value.startDate ? parseIsoDate(value.startDate) : undefined,
    to: value.endDate ? parseIsoDate(value.endDate) : undefined,
  };
}

// "PP" is the long localized date, so each locale keeps its own order and
// punctuation instead of the month-day order of a fixed pattern.
const DATE_FORMAT = "PP";

function formatRangeLabel(value: DateRangeValue, locale: Locale, emptyLabel: string): string {
  const dateLocale = DATE_LOCALES[locale];
  if (!value.startDate && !value.endDate) return emptyLabel;
  if (value.startDate && !value.endDate) {
    return format(parseIsoDate(value.startDate), DATE_FORMAT, { locale: dateLocale });
  }
  if (value.startDate && value.endDate) {
    const from = format(parseIsoDate(value.startDate), DATE_FORMAT, { locale: dateLocale });
    const to = format(parseIsoDate(value.endDate), DATE_FORMAT, { locale: dateLocale });
    return value.startDate === value.endDate ? from : `${from} - ${to}`;
  }
  return emptyLabel;
}

export function DateRangePicker({
  value,
  onChange,
  disabled = false,
  id,
  className,
}: {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const selectedRange = toDateRange(value);
  const hasRange = Boolean(value.startDate && value.endDate);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={id}
        disabled={disabled}
        render={
          <Button
            variant="outline"
            data-empty={!hasRange}
            className={cn(
              "w-full justify-start text-left font-normal data-[empty=true]:text-muted-foreground",
              className
            )}
          />
        }
      >
        <CalendarIcon data-icon="inline-start" />
        <span>{formatRangeLabel(value, locale, t.common.pickDateRange)}</span>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          locale={DATE_LOCALES[locale]}
          defaultMonth={selectedRange.from ?? selectedRange.to}
          selected={selectedRange}
          onSelect={(range) => {
            onChange({
              startDate: range?.from ? toIsoDate(range.from) : "",
              endDate: range?.to ? toIsoDate(range.to) : "",
            });
            if (range?.from && range?.to) {
              setOpen(false);
            }
          }}
          numberOfMonths={2}
        />
      </PopoverContent>
    </Popover>
  );
}
