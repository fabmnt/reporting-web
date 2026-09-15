import type { FunctionReturnType } from "convex/server";

import { api } from "../../../convex/_generated/api";
import { useI18n } from "@/lib/i18n/context";

import { AccountMenu } from "./AccountMenu";
import { AppHeaderNav } from "./AppNav";
import { AppLink } from "./navigation";

export type CurrentAccount = NonNullable<FunctionReturnType<typeof api.staffAccounts.current>>;

const REPORT_PATH = "/";

/** The app bar of wide screens. Narrow screens keep the bottom bar instead. */
export function AppHeader({ account }: { account: CurrentAccount }) {
  const { t } = useI18n();

  return (
    <header className="sticky top-0 z-40 hidden border-b bg-background/85 backdrop-blur-md md:block">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-6">
        <AppLink
          href={REPORT_PATH}
          className="flex shrink-0 items-center text-sm font-semibold tracking-tight"
        >
          {t.app.brand}
        </AppLink>

        <AppHeaderNav account={account} />

        <AccountMenu account={account} />
      </div>
    </header>
  );
}
