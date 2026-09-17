import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { appError } from "./appErrors";

// Client names are free text, so the stored key is the normalized name.
export function clientKeyFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Moves the stored clinic count of a client by `delta`. The client list shows
 * the count, so every mutation that adds, moves or deletes a clinic calls this
 * in the same transaction as the clinic write.
 *
 * A client whose count predates the backfill has none, and taking a clinic away
 * from it would leave a negative number, so both floor at zero.
 * migrations/backfillClientClinicCounts recounts the whole table from the
 * clinics themselves, and that is the value that counts.
 */
export async function adjustClientClinicCount(
  ctx: MutationCtx,
  clientId: Id<"clients">,
  delta: number
): Promise<void> {
  const client = await ctx.db.get("clients", clientId);
  if (client === null) {
    throw appError({ code: "CLIENT_NOT_FOUND" });
  }

  await ctx.db.patch(clientId, { clinicCount: Math.max(0, (client.clinicCount ?? 0) + delta) });
}
