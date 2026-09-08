import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { useState } from "react";
import type { DateRange } from "react-day-picker";

import { parseIsoDate, toIsoDate } from "@/lib/dates";
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

function formatRangeLabel(value: DateRangeValue): string {
  if (!value.startDate && !value.endDate) return "Pick a date range";
  if (value.startDate && !value.endDate) {
    return format(parseIsoDate(value.startDate), "LLL dd, y");
  }
  if (value.startDate && value.endDate) {
    const from = format(parseIsoDate(value.startDate), "LLL dd, y");
    const to = format(parseIsoDate(value.endDate), "LLL dd, y");
    return value.startDate === value.endDate ? from : `${from} - ${to}`;
  }
  return "Pick a date range";
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
        <span>{formatRangeLabel(value)}</span>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
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
