import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { type Infer, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { appError, type AppErrorPayload } from "./model/appErrors";
import { MAX_ASSIGNED_CLINICS, usableClinicIds } from "./model/assignments";
import { clientKeyFromName } from "./model/clientKey";
import { adjustClientClinicCount } from "./model/clients";
import { clinicSheetColumns } from "./model/clinicSheetColumns";
import { listProfileClinics } from "./model/reporting";
import { requireAdmin, requireOperator } from "./model/staff";

// The pickers still read one capped page, because a select cannot page: the
// caps sit above the Control Central directory, which is larger than the 500
// clinics and 200 clients they started with. The lists behind the admin tables
// take a cursor instead and never truncate.
const MAX_CLINICS = 2000;
const MAX_CLIENTS = 500;
// The clinic picker shows what is still available, so its scan reads past the
// first page of the table: filtering after a short cap would hide every clinic
// that sits behind the pages of clinics the caller already has.
const MAX_AVAILABLE_SCAN = 2000;

// What both lists filter by. A list that is not filtered sends nothing.
const activeFilter = v.optional(v.union(v.literal("active"), v.literal("inactive")));

// A search reads this much of a table before it answers. Both tables sit inside
// the caps the pickers use, so a search of the directory the app is built for
// reads all of it, and one of a table larger than that says its answer is
// partial instead of reading on.
const MAX_SEARCH_SCAN = 2000;
// How many matches a search returns. Past this the caller is told to narrow the
// search rather than being handed a list nobody reads to the end.
const MAX_SEARCH_RESULTS = 200;

const clientView = v.object({
  clientId: v.id("clients"),
  key: v.string(),
  name: v.string(),
  isActive: v.boolean(),
});

// The client list also reports how many clinics the client owns, because that
// is the list the assignments dialog opens onto.
const clientListView = clientView.extend({
  clinicCount: v.number(),
});

const clinicView = v.object({
  clinicId: v.id("clinics"),
  name: v.string(),
  googleSheetId: v.string(),
  externalClinicId: v.string(),
  isActive: v.boolean(),
  clientId: v.id("clients"),
  clientName: v.string(),
  sheetColumns: clinicSheetColumns,
  qaGroupKeys: v.array(v.string()),
  // The accounts that hold this clinic, so a clinic list can say who runs it.
  assignedTo: v.array(v.string()),
});

const assignedClinicView = v.object({
  clinicId: v.id("clinics"),
  name: v.string(),
  googleSheetId: v.string(),
  externalClinicId: v.string(),
  clientName: v.string(),
  sheetColumns: clinicSheetColumns,
});

// What the clinic pickers need: enough to tell two clinics of one client apart.
const clinicChoiceView = v.object({
  clinicId: v.id("clinics"),
  name: v.string(),
  externalClinicId: v.string(),
  clientName: v.string(),
});

// What the clinics of one client carry into the assignments dialog: the columns
// the clinics list shows, without the client every row already belongs to.
const clientClinicView = v.object({
  clinicId: v.id("clinics"),
  name: v.string(),
  googleSheetId: v.string(),
  externalClinicId: v.string(),
  isActive: v.boolean(),
  sheetColumns: clinicSheetColumns,
});

/**
 * The display name of every account that holds each clinic, so a clinic list
 * can say who runs it. Assignments are stored on the profiles and Convex has no
 * index over the clinics inside them, so a page costs one read per profile in
 * the deployment: the walk goes through all of them, because a clinic whose
 * only account sits past the first page would otherwise read as unassigned. An
 * account that holds no clinic costs its read and nothing else.
 *
 * The walk iterates rather than paginates: the clinic list it answers is itself
 * a paginated query, and a function may run only one of those.
 */
async function assigneeNamesByClinic(ctx: QueryCtx): Promise<Map<Id<"clinics">, string[]>> {
  const namesByClinic = new Map<Id<"clinics">, string[]>();

  for await (const profile of ctx.db.query("staffProfiles").withIndex("by_userId")) {
    for (const clinicId of profile.assignedClinicIds ?? []) {
      const names = namesByClinic.get(clinicId);
      if (names === undefined) {
        namesByClinic.set(clinicId, [profile.displayName]);
      } else {
        names.push(profile.displayName);
      }
    }
  }

  for (const names of namesByClinic.values()) {
    names.sort((first, second) => first.localeCompare(second));
  }

  return namesByClinic;
}

/**
 * Resolves the client of every clinic row once, so a list of clinics costs one
 * client read per client instead of one per clinic.
 */
async function withClientNames<T extends { clientId: Id<"clients"> }>(
  ctx: QueryCtx,
  rows: T[]
): Promise<Array<T & { clientName: string }>> {
  const clientNameById = new Map<Id<"clients">, string>();
  const named: Array<T & { clientName: string }> = [];

  for (const row of rows) {
    let clientName = clientNameById.get(row.clientId);
    if (clientName === undefined) {
      const client = await ctx.db.get("clients", row.clientId);
      clientName = client?.name ?? "Unknown client";
      clientNameById.set(row.clientId, clientName);
    }
    named.push({ ...row, clientName });
  }

  return named;
}

/**
 * A client as both lists of the clients table show it. The count comes from the
 * client row, so showing it costs no clinic reads.
 */
function toClientListView(client: Doc<"clients">): Infer<typeof clientListView> {
  return {
    clientId: client._id,
    key: client.key,
    name: client.name,
    isActive: client.isActive,
    clinicCount: client.clinicCount ?? 0,
  };
}

/**
 * The clinic rows a table shows, with the name of each client and the accounts
 * that hold it resolved. Both the paged list and the search go through here, so
 * a row looks the same whichever read it.
 */
async function toClinicViews(
  ctx: QueryCtx,
  rows: Doc<"clinics">[]
): Promise<Infer<typeof clinicView>[]> {
  const named = await withClientNames(ctx, rows);
  const assignees = await assigneeNamesByClinic(ctx);

  return named.map((row) => ({
    clinicId: row._id,
    name: row.name,
    googleSheetId: row.googleSheetId,
    externalClinicId: row.externalClinicId ?? "",
    isActive: row.isActive,
    clientId: row.clientId,
    clientName: row.clientName,
    sheetColumns: row.sheetColumns ?? {},
    qaGroupKeys: row.qaGroupKeys ?? [],
    assignedTo: assignees.get(row._id) ?? [],
  }));
}

/**
 * Whether a client matches what the search box holds. The key is searched too,
 * because it is the client name without its punctuation, and a person looking
 * for "old co" is looking for the same client as one typing "Old Co.".
 */
function clientMatchesSearch(client: Doc<"clients">, needle: string): boolean {
  if (needle === "") return true;
  return client.name.toLowerCase().includes(needle) || client.key.toLowerCase().includes(needle);
}

/**
 * Whether a clinic matches what the search box holds, over the same fields the
 * clinics table shows. The client name is not on the row, so it is resolved on
 * demand and remembered for the rest of the request: a search reads one client
 * per client it scans past, not one per clinic.
 */
function clinicSearchPredicate(
  ctx: QueryCtx,
  needle: string
): (clinic: Doc<"clinics">) => Promise<boolean> {
  const clientNames = new Map<Id<"clients">, string>();

  return async (clinic) => {
    if (needle === "") return true;
    if (clinic.name.toLowerCase().includes(needle)) return true;
    if ((clinic.externalClinicId ?? "").toLowerCase().includes(needle)) return true;
    if (clinic.googleSheetId.toLowerCase().includes(needle)) return true;

    let clientName = clientNames.get(clinic.clientId);
    if (clientName === undefined) {
      const client = await ctx.db.get("clients", clinic.clientId);
      clientName = client?.name ?? "";
      clientNames.set(clinic.clientId, clientName);
    }
    return clientName.toLowerCase().includes(needle);
  };
}

const clinicInputFields = {
  name: v.string(),
  googleSheetId: v.string(),
  clientId: v.id("clients"),
};

function cleanRequiredText(value: string, missingField: AppErrorPayload): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw appError(missingField);
  }
  return trimmed;
}

function cleanQaGroupKeys(keys: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const key of keys) {
    const trimmed = key.trim();
    if (trimmed === "" || seen.has(trimmed)) continue;
    seen.add(trimmed);
    cleaned.push(trimmed);
  }
  return cleaned;
}

async function requireClient(ctx: MutationCtx, clientId: Id<"clients">) {
  const client = await ctx.db.get("clients", clientId);
  if (client === null) {
    throw appError({ code: "CLIENT_NOT_FOUND" });
  }
  return client;
}

async function assertGoogleSheetIdAvailable(
  ctx: MutationCtx,
  googleSheetId: string,
  ignoreClinicId?: Id<"clinics">
) {
  const existing = await ctx.db
    .query("clinics")
    .withIndex("by_googleSheetId", (query) => query.eq("googleSheetId", googleSheetId))
    .first();

  if (existing !== null && existing._id !== ignoreClinicId) {
    throw appError({ code: "GOOGLE_SHEET_TAKEN" });
  }
}

async function assertClinicNameAvailable(
  ctx: MutationCtx,
  clientId: Id<"clients">,
  name: string,
  ignoreClinicId?: Id<"clinics">
) {
  const existing = await ctx.db
    .query("clinics")
    .withIndex("by_clientId_and_name", (query) => query.eq("clientId", clientId).eq("name", name))
    .first();

  if (existing !== null && existing._id !== ignoreClinicId) {
    throw appError({ code: "CLINIC_NAME_TAKEN" });
  }
}

/**
 * Validates a client name and derives its key. Returns the key.
 * Pass `ignoreClientId` when renaming so a client does not collide with itself.
 */
async function assertClientNameAvailable(
  ctx: MutationCtx,
  name: string,
  ignoreClientId?: Id<"clients">
): Promise<string> {
  const key = clientKeyFromName(name);
  if (key === "") {
    throw appError({ code: "CLIENT_NAME_INVALID" });
  }

  const existingByKey = await ctx.db
    .query("clients")
    .withIndex("by_key", (query) => query.eq("key", key))
    .first();
  if (existingByKey !== null && existingByKey._id !== ignoreClientId) {
    throw appError({ code: "CLIENT_NAME_TAKEN" });
  }

  const scannedClients = await ctx.db.query("clients").withIndex("by_key").take(MAX_CLIENTS);
  const existingByName = scannedClients.find(
    (client) => client.name.toLowerCase() === name.toLowerCase() && client._id !== ignoreClientId
  );
  if (existingByName !== undefined) {
    throw appError({ code: "CLIENT_NAME_TAKEN" });
  }

  return key;
}

/**
 * Clears a clinic from every account that holds it, so an account past the
 * first one does not keep an assignment to a clinic that is gone.
 */
async function removeClinicFromStaffProfiles(ctx: MutationCtx, clinicId: Id<"clinics">) {
  for await (const profile of ctx.db.query("staffProfiles").withIndex("by_userId")) {
    const assignedClinicIds = profile.assignedClinicIds ?? [];
    if (!assignedClinicIds.includes(clinicId)) continue;
    await ctx.db.patch(profile._id, {
      assignedClinicIds: assignedClinicIds.filter((id) => id !== clinicId),
    });
  }
}

async function requireAssignedClinic(
  ctx: MutationCtx,
  profile: { role: "admin" | "operator"; assignedClinicIds?: Id<"clinics">[] },
  clinicId: Id<"clinics">
) {
  const accessible = await listProfileClinics(ctx, profile);
  if (!accessible.some((clinic) => clinic._id === clinicId)) {
    throw appError({ code: "CLINIC_NOT_ASSIGNED" });
  }

  const clinic = await ctx.db.get("clinics", clinicId);
  if (clinic === null) {
    throw appError({ code: "CLINIC_NOT_FOUND" });
  }
  return clinic;
}

/**
 * One page of the clients table, in key order, with the clinics each client
 * owns. The count is stored on the client, so a page costs one read per client
 * and never reads the clinics table.
 *
 * Only what the index and a field comparison can answer is filtered here: a
 * function may run one paginated query, and a substring is not something either
 * of them can ask. Searching is `searchClients`, which reads one bounded scan.
 */
export const listClients = query({
  args: {
    paginationOpts: paginationOptsValidator,
    status: activeFilter,
  },
  returns: paginationResultValidator(clientListView),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const status = args.status;
    const page =
      status === undefined
        ? await ctx.db.query("clients").withIndex("by_key").paginate(args.paginationOpts)
        : await ctx.db
            .query("clients")
            .withIndex("by_key")
            .filter((builder) => builder.eq(builder.field("isActive"), status === "active"))
            .paginate(args.paginationOpts);

    return {
      page: page.page.map(toClientListView),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

/**
 * The clients a search box finds, in key order. A Convex filter compares fields
 * and cannot ask whether a name contains a substring, so this reads one bounded
 * scan of the table and matches the rows here. `hasMore` says the scan ran out
 * before the table did, or that more clients matched than the result holds.
 */
export const searchClients = query({
  args: { search: v.string(), status: activeFilter },
  returns: v.object({
    clients: v.array(clientListView),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const status = args.status;
    const scanned =
      status === undefined
        ? await ctx.db
            .query("clients")
            .withIndex("by_key")
            .take(MAX_SEARCH_SCAN + 1)
        : await ctx.db
            .query("clients")
            .withIndex("by_key")
            .filter((builder) => builder.eq(builder.field("isActive"), status === "active"))
            .take(MAX_SEARCH_SCAN + 1);

    const needle = args.search.trim().toLowerCase();
    const matches = scanned
      .slice(0, MAX_SEARCH_SCAN)
      .filter((client) => clientMatchesSearch(client, needle));

    return {
      clients: matches.slice(0, MAX_SEARCH_RESULTS).map(toClientListView),
      hasMore: scanned.length > MAX_SEARCH_SCAN || matches.length > MAX_SEARCH_RESULTS,
    };
  },
});

/**
 * The clients a form or a filter picks from, in key order. A select cannot
 * page, so this reads one capped page and says when the cap cut the list short.
 */
export const listClientChoices = query({
  args: {},
  returns: v.object({
    clients: v.array(clientView),
    limit: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const rows = await ctx.db
      .query("clients")
      .withIndex("by_key")
      .take(MAX_CLIENTS + 1);
    const clients = rows.slice(0, MAX_CLIENTS).map((client) => ({
      clientId: client._id,
      key: client.key,
      name: client.name,
      isActive: client.isActive,
    }));
    clients.sort((a, b) => a.name.localeCompare(b.name));

    return { clients, limit: MAX_CLIENTS, hasMore: rows.length > MAX_CLIENTS };
  },
});

export const createClient = mutation({
  args: { name: v.string() },
  returns: clientView,
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const name = cleanRequiredText(args.name, { code: "CLIENT_NAME_REQUIRED" });
    const key = await assertClientNameAvailable(ctx, name);

    const clientId = await ctx.db.insert("clients", { key, name, isActive: true });
    return { clientId, key, name, isActive: true };
  },
});

export const updateClient = mutation({
  args: {
    clientId: v.id("clients"),
    name: v.string(),
    isActive: v.boolean(),
  },
  returns: clientView,
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const client = await ctx.db.get("clients", args.clientId);
    if (client === null) {
      throw appError({ code: "CLIENT_NOT_FOUND" });
    }

    const name = cleanRequiredText(args.name, { code: "CLIENT_NAME_REQUIRED" });
    const key = await assertClientNameAvailable(ctx, name, args.clientId);

    await ctx.db.patch(args.clientId, { key, name, isActive: args.isActive });

    return { clientId: args.clientId, key, name, isActive: args.isActive };
  },
});

/**
 * Deletes a client only when it owns no clinics. Clinics require a client, so
 * deleting one that still has clinics would leave those rows pointing at a
 * missing client. Callers must move or delete the clinics first.
 */
export const removeClient = mutation({
  args: { clientId: v.id("clients") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const client = await ctx.db.get("clients", args.clientId);
    if (client === null) {
      throw appError({ code: "CLIENT_NOT_FOUND" });
    }

    const ownedClinics = await ctx.db
      .query("clinics")
      .withIndex("by_clientId_and_name", (query) => query.eq("clientId", args.clientId))
      .take(MAX_CLINICS);

    if (ownedClinics.length > 0) {
      throw appError({
        code: "CLIENT_HAS_CLINICS",
        clientName: client.name,
        clinicCount: ownedClinics.length,
      });
    }

    await ctx.db.delete("clients", args.clientId);
    return null;
  },
});

/**
 * One page of the clinics table, in name order: the whole directory, or the
 * clinics of one client when the list is narrowed to one.
 *
 * Only what the index and a field comparison can answer is filtered here: a
 * function may run one paginated query, and a substring is not something either
 * of them can ask. Searching is `search`, which reads one bounded scan.
 */
export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
    clientId: v.optional(v.id("clients")),
    status: activeFilter,
  },
  returns: paginationResultValidator(clinicView),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const { clientId, status } = args;

    if (clientId !== undefined) {
      const ofClient = ctx.db
        .query("clinics")
        .withIndex("by_clientId_and_name", (builder) => builder.eq("clientId", clientId));
      const page =
        status === undefined
          ? await ofClient.paginate(args.paginationOpts)
          : await ofClient
              .filter((builder) => builder.eq(builder.field("isActive"), status === "active"))
              .paginate(args.paginationOpts);

      return {
        page: await toClinicViews(ctx, page.page),
        isDone: page.isDone,
        continueCursor: page.continueCursor,
      };
    }

    const all = ctx.db.query("clinics").withIndex("by_name");
    const page =
      status === undefined
        ? await all.paginate(args.paginationOpts)
        : await all
            .filter((builder) => builder.eq(builder.field("isActive"), status === "active"))
            .paginate(args.paginationOpts);

    return {
      page: await toClinicViews(ctx, page.page),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

/**
 * The clinics a search box finds, in name order: the whole directory, or the
 * clinics of one client. A Convex filter compares fields and cannot ask whether
 * a name contains a substring, so this reads one bounded scan and matches the
 * rows here, over the same fields the clinics table shows. `hasMore` says the
 * scan ran out before the table did, or that more clinics matched than the
 * result holds.
 */
export const search = query({
  args: {
    search: v.string(),
    clientId: v.optional(v.id("clients")),
    status: activeFilter,
  },
  returns: v.object({
    clinics: v.array(clinicView),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const { clientId, status } = args;
    const scan = MAX_SEARCH_SCAN + 1;
    let scanned: Doc<"clinics">[];

    if (clientId !== undefined) {
      const ofClient = ctx.db
        .query("clinics")
        .withIndex("by_clientId_and_name", (builder) => builder.eq("clientId", clientId));
      scanned =
        status === undefined
          ? await ofClient.take(scan)
          : await ofClient
              .filter((builder) => builder.eq(builder.field("isActive"), status === "active"))
              .take(scan);
    } else {
      const all = ctx.db.query("clinics").withIndex("by_name");
      scanned =
        status === undefined
          ? await all.take(scan)
          : await all
              .filter((builder) => builder.eq(builder.field("isActive"), status === "active"))
              .take(scan);
    }

    const accepts = clinicSearchPredicate(ctx, args.search.trim().toLowerCase());
    const matched: Doc<"clinics">[] = [];
    for (const clinic of scanned.slice(0, MAX_SEARCH_SCAN)) {
      if (await accepts(clinic)) matched.push(clinic);
    }

    return {
      clinics: await toClinicViews(ctx, matched.slice(0, MAX_SEARCH_RESULTS)),
      hasMore: scanned.length > MAX_SEARCH_SCAN || matched.length > MAX_SEARCH_RESULTS,
    };
  },
});

/**
 * The clinics of one client, for the assignments dialog: it reads them when the
 * dialog opens, so an admin assigns from one client without the directory being
 * read whole.
 *
 * An inactive clinic stays in the list, with its flag, because the dialog has
 * to show that a clinic it lists cannot be assigned any more. A client that no
 * longer exists has no clinics to list.
 */
export const listByClient = query({
  args: { clientId: v.id("clients") },
  returns: v.object({
    clinics: v.array(clientClinicView),
    limit: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const client = await ctx.db.get("clients", args.clientId);
    if (client === null) {
      throw appError({ code: "CLIENT_NOT_FOUND" });
    }

    const rows = await ctx.db
      .query("clinics")
      .withIndex("by_clientId_and_name", (query) => query.eq("clientId", args.clientId))
      .take(MAX_CLINICS + 1);

    const clinics = rows.slice(0, MAX_CLINICS).map((row) => ({
      clinicId: row._id,
      name: row.name,
      googleSheetId: row.googleSheetId,
      externalClinicId: row.externalClinicId ?? "",
      isActive: row.isActive,
      sheetColumns: row.sheetColumns ?? {},
    }));
    clinics.sort((a, b) => a.name.localeCompare(b.name));

    return { clinics, limit: MAX_CLINICS, hasMore: rows.length > MAX_CLINICS };
  },
});

// What the accounts screen needs of a clinic: enough to tell it apart inside
// its client and to say whether it can still be assigned.
const directoryClinicView = v.object({
  clinicId: v.id("clinics"),
  name: v.string(),
  isActive: v.boolean(),
});

// The same, under the client that owns it, so a screen can group the
// directory by client.
const clientDirectoryView = v.object({
  clientId: v.id("clients"),
  name: v.string(),
  isActive: v.boolean(),
  clinics: v.array(directoryClinicView),
});

/**
 * The clinic directory grouped by client, in client name order and, inside a
 * client, in clinic name order. The accounts screen changes the assignment of
 * one account across every client at once, so it reads them together instead of
 * calling `listByClient` once per client.
 *
 * A client that owns no clinic is left out, because there is nothing to assign
 * from it. A client that no longer exists takes its clinics with it: an
 * assignment to them could not be shown anywhere.
 */
export const listDirectoryByClient = query({
  args: {},
  returns: v.object({
    clients: v.array(clientDirectoryView),
    limit: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const rows = await ctx.db
      .query("clinics")
      .withIndex("by_clientId_and_name")
      .take(MAX_CLINICS + 1);

    const clinicsByClient = new Map<Id<"clients">, Infer<typeof directoryClinicView>[]>();
    for (const clinic of rows.slice(0, MAX_CLINICS)) {
      const clinicView = {
        clinicId: clinic._id,
        name: clinic.name,
        isActive: clinic.isActive,
      };
      const clinics = clinicsByClient.get(clinic.clientId);
      if (clinics === undefined) {
        clinicsByClient.set(clinic.clientId, [clinicView]);
      } else {
        clinics.push(clinicView);
      }
    }

    const clients: Infer<typeof clientDirectoryView>[] = [];
    for (const [clientId, clinics] of clinicsByClient) {
      const client = await ctx.db.get("clients", clientId);
      if (client === null) continue;
      clients.push({ clientId, name: client.name, isActive: client.isActive, clinics });
    }
    clients.sort((a, b) => a.name.localeCompare(b.name));

    return { clients, limit: MAX_CLINICS, hasMore: rows.length > MAX_CLINICS };
  },
});
export const listAvailable = query({
  args: {},
  returns: v.object({
    clinics: v.array(clinicChoiceView),
    limit: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (ctx) => {
    const { profile } = await requireOperator(ctx);
    const assigned = new Set<string>(profile.assignedClinicIds ?? []);

    const rows = await ctx.db
      .query("clinics")
      .withIndex("by_clientId_and_name")
      .take(MAX_AVAILABLE_SCAN + 1);

    const available = rows.filter((row) => row.isActive && !assigned.has(row._id));
    const named = await withClientNames(ctx, available.slice(0, MAX_CLINICS));
    const clinics = named
      .map((row) => ({
        clinicId: row._id,
        name: row.name,
        externalClinicId: row.externalClinicId ?? "",
        clientName: row.clientName,
      }))
      .sort((a, b) => a.clientName.localeCompare(b.clientName) || a.name.localeCompare(b.name));

    return {
      clinics,
      limit: MAX_CLINICS,
      // Either the scan or the result cap left clinics out, so the picker says
      // the list is not the whole directory.
      hasMore: rows.length > MAX_AVAILABLE_SCAN || available.length > MAX_CLINICS,
    };
  },
});

export const listAssigned = query({
  args: {},
  returns: v.object({
    clinics: v.array(assignedClinicView),
  }),
  handler: async (ctx) => {
    const { profile } = await requireOperator(ctx);
    const named = await withClientNames(ctx, await listProfileClinics(ctx, profile));
    const clinics = [];

    for (const clinic of named) {
      const row = await ctx.db.get("clinics", clinic._id);
      clinics.push({
        clinicId: clinic._id,
        name: clinic.name,
        googleSheetId: clinic.googleSheetId,
        externalClinicId: clinic.externalClinicId ?? "",
        clientName: clinic.clientName,
        sheetColumns: row?.sheetColumns ?? {},
      });
    }

    return { clinics };
  },
});

/**
 * Adds one clinic to the caller's own assignment. Assignments are the only
 * source of the report scope, so an operator can widen their own scope without
 * an admin.
 */
export const addAssigned = mutation({
  args: { clinicId: v.id("clinics") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { profile } = await requireOperator(ctx);
    const assignedClinicIds = profile.assignedClinicIds ?? [];
    if (assignedClinicIds.includes(args.clinicId)) {
      return null;
    }

    const clinic = await ctx.db.get("clinics", args.clinicId);
    if (clinic === null || !clinic.isActive) {
      throw appError({ code: "CLINIC_NOT_FOUND" });
    }

    // A list that only looks full, because it holds clinics that were disabled
    // or deleted since they were assigned, still takes another clinic. The ids
    // that hold no room leave with the same write.
    const assigned =
      assignedClinicIds.length >= MAX_ASSIGNED_CLINICS
        ? await usableClinicIds(ctx, assignedClinicIds)
        : assignedClinicIds;
    if (assigned.length >= MAX_ASSIGNED_CLINICS) {
      throw appError({ code: "CLINIC_ASSIGNMENT_LIMIT", limit: MAX_ASSIGNED_CLINICS });
    }

    await ctx.db.patch("staffProfiles", profile._id, {
      assignedClinicIds: [...assigned, args.clinicId],
    });

    return null;
  },
});

/** Drops one clinic from the caller's own assignment. */
export const removeAssigned = mutation({
  args: { clinicId: v.id("clinics") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { profile } = await requireOperator(ctx);
    const assignedClinicIds = profile.assignedClinicIds ?? [];
    if (!assignedClinicIds.includes(args.clinicId)) {
      return null;
    }

    await ctx.db.patch("staffProfiles", profile._id, {
      assignedClinicIds: assignedClinicIds.filter((clinicId) => clinicId !== args.clinicId),
    });

    return null;
  },
});

export const updateAssigned = mutation({
  args: {
    clinicId: v.id("clinics"),
    googleSheetId: v.string(),
    sheetColumns: v.optional(clinicSheetColumns),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { profile } = await requireOperator(ctx);
    const clinic = await requireAssignedClinic(ctx, profile, args.clinicId);

    const googleSheetId = cleanRequiredText(args.googleSheetId, { code: "GOOGLE_SHEET_REQUIRED" });
    await assertGoogleSheetIdAvailable(ctx, googleSheetId, args.clinicId);

    await ctx.db.patch(args.clinicId, {
      googleSheetId,
      sheetColumns: args.sheetColumns ?? clinic.sheetColumns ?? {},
    });

    return null;
  },
});

export const create = mutation({
  args: {
    ...clinicInputFields,
    externalClinicId: v.string(),
    isActive: v.optional(v.boolean()),
    sheetColumns: v.optional(clinicSheetColumns),
    qaGroupKeys: v.optional(v.array(v.string())),
  },
  returns: v.object({ clinicId: v.id("clinics") }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const name = cleanRequiredText(args.name, { code: "CLINIC_NAME_REQUIRED" });
    const googleSheetId = cleanRequiredText(args.googleSheetId, { code: "GOOGLE_SHEET_REQUIRED" });
    const externalClinicId = cleanRequiredText(args.externalClinicId, {
      code: "CARRIER_ID_REQUIRED",
    });
    await requireClient(ctx, args.clientId);
    await assertGoogleSheetIdAvailable(ctx, googleSheetId);
    await assertClinicNameAvailable(ctx, args.clientId, name);

    const clinicId = await ctx.db.insert("clinics", {
      name,
      googleSheetId,
      clientId: args.clientId,
      externalClinicId,
      isActive: args.isActive ?? true,
      sheetColumns: args.sheetColumns ?? {},
      qaGroupKeys: cleanQaGroupKeys(args.qaGroupKeys ?? []),
    });
    await adjustClientClinicCount(ctx, args.clientId, 1);

    return { clinicId };
  },
});

export const update = mutation({
  args: {
    clinicId: v.id("clinics"),
    ...clinicInputFields,
    externalClinicId: v.string(),
    isActive: v.boolean(),
    sheetColumns: v.optional(clinicSheetColumns),
    qaGroupKeys: v.optional(v.array(v.string())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const clinic = await ctx.db.get("clinics", args.clinicId);
    if (clinic === null) {
      throw appError({ code: "CLINIC_NOT_FOUND" });
    }

    const name = cleanRequiredText(args.name, { code: "CLINIC_NAME_REQUIRED" });
    const googleSheetId = cleanRequiredText(args.googleSheetId, { code: "GOOGLE_SHEET_REQUIRED" });
    const externalClinicId = cleanRequiredText(args.externalClinicId, {
      code: "CARRIER_ID_REQUIRED",
    });
    await requireClient(ctx, args.clientId);
    await assertGoogleSheetIdAvailable(ctx, googleSheetId, args.clinicId);
    await assertClinicNameAvailable(ctx, args.clientId, name, args.clinicId);

    await ctx.db.patch(args.clinicId, {
      name,
      googleSheetId,
      clientId: args.clientId,
      isActive: args.isActive,
      externalClinicId,
      sheetColumns: args.sheetColumns ?? clinic.sheetColumns ?? {},
      qaGroupKeys:
        args.qaGroupKeys !== undefined
          ? cleanQaGroupKeys(args.qaGroupKeys)
          : (clinic.qaGroupKeys ?? []),
    });

    // A clinic that changes hands leaves one client's count and joins another's.
    if (clinic.clientId !== args.clientId) {
      await adjustClientClinicCount(ctx, clinic.clientId, -1);
      await adjustClientClinicCount(ctx, args.clientId, 1);
    }

    return null;
  },
});

export const remove = mutation({
  args: { clinicId: v.id("clinics") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const clinic = await ctx.db.get("clinics", args.clinicId);
    if (clinic === null) {
      throw appError({ code: "CLINIC_NOT_FOUND" });
    }

    await removeClinicFromStaffProfiles(ctx, args.clinicId);
    await ctx.db.delete("clinics", args.clinicId);
    await adjustClientClinicCount(ctx, clinic.clientId, -1);

    return null;
  },
});
