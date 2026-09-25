import { v } from "convex/values";

import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { action, internalQuery, mutation, query } from "./_generated/server";
import { appError } from "./model/appErrors";
import {
  OAUTH_CREDENTIAL,
  googleCredential,
  parseServiceAccountKey,
  type GoogleCredential,
} from "./model/googleCredentials";
import { requireAdmin } from "./model/staff";

// The pickers behind the client form read one capped page, like the client
// pickers do. An installation holds one account per external organization, so
// the cap sits far above what anybody stores.
export const MAX_SERVICE_ACCOUNTS = 200;
// How many clients the usage count reads. The count is what the list shows and
// what the delete confirmation says, so it is one capped page like the counts
// the other lists report.
const MAX_LINKED_CLIENTS = 1000;

const serviceAccountView = v.object({
  serviceAccountId: v.id("googleServiceAccounts"),
  email: v.string(),
  // How many clients read their sheets with this account, so an administrator
  // can see what deleting it would change.
  clientCount: v.number(),
});

const serviceAccountKeyView = v.object({
  serviceAccountId: v.id("googleServiceAccounts"),
  email: v.string(),
});

async function linkedClientCount(
  ctx: QueryCtx | MutationCtx,
  serviceAccountId: Id<"googleServiceAccounts">
): Promise<number> {
  const linked = await ctx.db
    .query("clients")
    .withIndex("by_serviceAccountId", (query) => query.eq("serviceAccountId", serviceAccountId))
    .take(MAX_LINKED_CLIENTS + 1);
  return linked.length;
}

// One address, one account: the email is how a sheet is shared, so two rows with
// the same address would be two rows nobody can tell apart.
async function assertEmailAvailable(
  ctx: MutationCtx,
  email: string,
  except?: Id<"googleServiceAccounts">
): Promise<void> {
  const existing = await ctx.db
    .query("googleServiceAccounts")
    .withIndex("by_email", (query) => query.eq("email", email))
    .take(2);
  if (existing.some((account) => account._id !== except)) {
    throw appError({ code: "SERVICE_ACCOUNT_EMAIL_TAKEN" });
  }
}

// The accounts an administrator manages and a client form picks from.
export const listServiceAccounts = query({
  args: {},
  returns: v.object({
    serviceAccounts: v.array(serviceAccountView),
    limit: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const rows = await ctx.db.query("googleServiceAccounts").take(MAX_SERVICE_ACCOUNTS + 1);
    const accounts = rows.slice(0, MAX_SERVICE_ACCOUNTS);
    const serviceAccounts = [];
    for (const account of accounts) {
      serviceAccounts.push({
        serviceAccountId: account._id,
        email: account.email,
        clientCount: await linkedClientCount(ctx, account._id),
      });
    }
    serviceAccounts.sort((first, second) => first.email.localeCompare(second.email));

    return {
      serviceAccounts,
      limit: MAX_SERVICE_ACCOUNTS,
      hasMore: rows.length > MAX_SERVICE_ACCOUNTS,
    };
  },
});

/**
 * Adds a service account from the JSON key file Google hands out. The file
 * names the account it belongs to, so the address and the key both come from
 * it. The key is checked here, without asking Google, so a key that was cut
 * short or pasted with its newlines escaped is refused before it is stored.
 */
export const createServiceAccount = mutation({
  args: { secretKey: v.string() },
  returns: serviceAccountKeyView,
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const key = await parseServiceAccountKey(args.secretKey);
    await assertEmailAvailable(ctx, key.email);

    const serviceAccountId = await ctx.db.insert("googleServiceAccounts", key);
    return { serviceAccountId, email: key.email };
  },
});

/**
 * Stores another key file for an account. The address belongs to the key, so a
 * new file replaces both: the clients that point at this account keep pointing
 * at it, and their sheets have to be shared with the new address.
 */
export const updateServiceAccount = mutation({
  args: {
    serviceAccountId: v.id("googleServiceAccounts"),
    secretKey: v.string(),
  },
  returns: serviceAccountKeyView,
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const account = await ctx.db.get("googleServiceAccounts", args.serviceAccountId);
    if (account === null) throw appError({ code: "SERVICE_ACCOUNT_NOT_FOUND" });

    const key = await parseServiceAccountKey(args.secretKey);
    await assertEmailAvailable(ctx, key.email, args.serviceAccountId);
    await ctx.db.patch(args.serviceAccountId, key);

    return { serviceAccountId: args.serviceAccountId, email: key.email };
  },
});

/**
 * Deletes a service account and clears the link of every client that used it.
 * Those clients go back to being read with the app's own account rather than
 * pointing at a row that is gone, which is the state their runs fail on.
 *
 * The walk iterates the index instead of reading one capped page, because a
 * link left behind is a client whose runs fail until somebody notices. An
 * account is one per external organization, so the clients pointing at one are
 * well inside what a single transaction writes.
 */
export const removeServiceAccount = mutation({
  args: { serviceAccountId: v.id("googleServiceAccounts") },
  returns: v.object({ unlinkedClientCount: v.number() }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const account = await ctx.db.get("googleServiceAccounts", args.serviceAccountId);
    if (account === null) throw appError({ code: "SERVICE_ACCOUNT_NOT_FOUND" });

    let unlinkedClientCount = 0;
    for await (const client of ctx.db
      .query("clients")
      .withIndex("by_serviceAccountId", (query) =>
        query.eq("serviceAccountId", args.serviceAccountId)
      )) {
      await ctx.db.patch(client._id, { serviceAccountId: undefined });
      unlinkedClientCount += 1;
    }

    await ctx.db.delete(args.serviceAccountId);
    return { unlinkedClientCount };
  },
});

/**
 * The administrator's test button: it asks Google to sign a token with the
 * stored key, which fails on a key that was pasted wrong. It costs one token
 * request and says nothing about the sheets the account can read, which the
 * first run reports per sheet.
 *
 * The action cannot read staffProfiles itself, so it verifies through the
 * currentAdmin query with the caller's auth.
 */
export const testServiceAccount = action({
  args: { serviceAccountId: v.id("googleServiceAccounts") },
  returns: v.object({ ok: v.boolean(), error: v.union(v.string(), v.null()) }),
  handler: async (ctx, args): Promise<{ ok: boolean; error: string | null }> => {
    await ctx.runQuery(internal.staffAuth.currentAdmin, {});
    return await ctx.runAction(internal.googleServiceAccount.checkCredential, {
      serviceAccountId: args.serviceAccountId,
    });
  },
});

/**
 * Which account reads a client's sheets. This is the query every sheet read goes
 * through, and the private key is not part of its answer.
 */
export const credentialForClient = internalQuery({
  args: { clientId: v.id("clients") },
  returns: googleCredential,
  handler: async (ctx, args): Promise<GoogleCredential> => {
    const client = await ctx.db.get("clients", args.clientId);
    const serviceAccountId = client?.serviceAccountId;
    if (serviceAccountId === undefined) return OAUTH_CREDENTIAL;

    const account = await ctx.db.get("googleServiceAccounts", serviceAccountId);
    // A client whose account is gone fails instead of quietly reading with the
    // app's own account: a run that reports rows nobody expected is worse than
    // one that says what is missing.
    if (account === null) throw appError({ code: "SERVICE_ACCOUNT_NOT_FOUND" });

    return { kind: "serviceAccount", serviceAccountId, email: account.email };
  },
});

// The key a service account is signed with. Internal, and read only by the Node
// action that builds the Google client, so the private key never reaches a
// client and never travels in the arguments of a function a browser can call.
export const serviceAccountKey = internalQuery({
  args: { serviceAccountId: v.id("googleServiceAccounts") },
  returns: v.object({ email: v.string(), privateKey: v.string() }),
  handler: async (ctx, args) => {
    const account = await ctx.db.get("googleServiceAccounts", args.serviceAccountId);
    if (account === null) throw appError({ code: "SERVICE_ACCOUNT_NOT_FOUND" });
    return { email: account.email, privateKey: account.privateKey };
  },
});
