import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import { Loader2Icon } from "lucide-react";

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  const { t } = useI18n();

  return (
    <Loader2Icon
      data-slot="spinner"
      role="status"
      aria-label={t.common.loading}
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
