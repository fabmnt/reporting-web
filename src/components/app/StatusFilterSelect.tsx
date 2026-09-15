import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n/context";
import type { StatusFilter } from "@/lib/tableList";

/** The active/inactive filter shared by the clients and clinics lists. */
export function StatusFilterSelect({
  value,
  label,
  onChange,
}: {
  value: StatusFilter;
  label: string;
  onChange: (value: StatusFilter) => void;
}) {
  const { t } = useI18n();
  const items = [
    { value: "all", label: t.common.allStatuses },
    { value: "active", label: t.common.active },
    { value: "inactive", label: t.common.inactive },
  ];

  return (
    <Select
      items={items}
      value={value}
      onValueChange={(next) => onChange((next ?? "all") as StatusFilter)}
    >
      <SelectTrigger aria-label={label} className="w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
