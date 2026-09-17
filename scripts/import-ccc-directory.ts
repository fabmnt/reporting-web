/**
 * Rebuild the client and clinic directory in Convex from Control Central,
 * which is the source of truth for which client owns which clinic. The data in
 * the app came from the legacy Reporting-Tool configs and puts most clinics
 * under the wrong client.
 *
 * Every Control Central clinic that has a spreadsheet and a client becomes a
 * clinic row; a spreadsheet shared by several clinics keeps one row and the
 * rest are reported. Clinics already in Convex keep their sheet column mapping,
 * because Control Central stores nothing equivalent.
 *
 * Step 1, build the plan and read it (no Convex writes):
 *   pnpm import:ccc-directory
 *
 * Step 2, write it to Convex (replaces the current clients and clinics):
 *   pnpm import:ccc-directory --execute
 *
 * Convex calls target the dev deployment in .env.local. Add --prod to target
 * this project's default production deployment instead.
 *
 * Options:
 *   --execute             Write to Convex. Without it nothing is written.
 *   --prod                Run Convex against the production deployment.
 *   --ccc-env <file>      Control Central credentials file
 *                         (default: ~/dev/dr/CCCdashboard/.env.local).
 *   --output <file>       JSON output path
 *                         (default: scripts/output/ccc-directory.json).
 *
 * Credentials come from CCC_USERNAME and CCC_PASSWORD when both are set, and
 * from the credentials file otherwise.
 */
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

const CCC_BASE_URL = "https://carriers.dentalautomation.ai";
const SIGN_IN_PATH = "/api/signin";
const CLIENTS_PATH = "/api/clients/";
const CLINICS_PATH = "/api/clinics/";
const DRIVE_PATH = "/api/drive/";

const DEFAULT_CCC_ENV = path.join(homedir(), "dev", "dr", "CCCdashboard", ".env.local");
const DEFAULT_OUTPUT = "scripts/output/ccc-directory.json";

const PREVIEW_LIMIT = 10;
// Small enough that one batch stays well inside a single transaction and
// inside one command line argument.
const INSERT_BATCH = 100;
const MAX_WIPE_CALLS = 50;

// What the import needs out of Control Central, after the API shapes are
// narrowed at the fetch boundary.
type Directory = {
  counts: { clients: number; clinics: number; drive: number };
  clientNameByClinicId: Map<string, string>;
  clinics: Array<{ externalClinicId: string; name: string; googleSheetId: string }>;
};

type SheetConfig = {
  googleSheetId: string;
  externalClinicId: string | null;
  sheetColumns: Record<string, string>;
  qaGroupKeys: string[];
};

type DirectoryClinic = {
  clientName: string;
  name: string;
  externalClinicId: string;
  googleSheetId: string;
  sheetColumns: Record<string, string>;
  qaGroupKeys: string[];
};

type SkippedClinic = {
  name: string;
  externalClinicId: string;
  reason: string;
};

type SharedSheet = {
  googleSheetId: string;
  kept: string;
  dropped: string[];
};

type DirectoryPlan = {
  generatedAt: string;
  source: string;
  clients: string[];
  clinics: DirectoryClinic[];
  skipped: SkippedClinic[];
  sharedSheets: SharedSheet[];
  carriedOverConfig: number;
};

type WipeResult = {
  deletedClinics: number;
  deletedClients: number;
  clearedProfiles: number;
  done: boolean;
};

type InsertResult = {
  inserted: number;
  clientsCreated: number;
  skipped: number;
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function readArg(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    fail(`Missing value for ${flag}`);
  }
  return value;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function pickString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseEnvFile(contents: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of contents.split("\n")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match === null) continue;
    values[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return values;
}

async function loadCredentials(): Promise<{ username: string; password: string }> {
  const username = process.env.CCC_USERNAME ?? "";
  const password = process.env.CCC_PASSWORD ?? "";
  if (username !== "" && password !== "") {
    return { username, password };
  }

  const envPath = path.resolve(readArg("--ccc-env") ?? DEFAULT_CCC_ENV);
  const contents = await readFile(envPath, "utf-8").catch(() => {
    fail(
      `Cannot read Control Central credentials at ${envPath}. ` +
        "Set CCC_USERNAME and CCC_PASSWORD, or point --ccc-env at the file that holds them."
    );
  });
  const values = parseEnvFile(contents);
  const fileUsername = values.TEST_USERNAME ?? values.CCC_USERNAME ?? "";
  const filePassword = values.TEST_PASSWORD ?? values.CCC_PASSWORD ?? "";
  if (fileUsername === "" || filePassword === "") {
    fail(`${envPath} holds no TEST_USERNAME/TEST_PASSWORD pair.`);
  }

  return { username: fileUsername, password: filePassword };
}

async function signIn(credentials: { username: string; password: string }): Promise<string> {
  const response = await fetch(`${CCC_BASE_URL}${SIGN_IN_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(credentials).toString(),
  });
  if (!response.ok) {
    fail(`Control Central rejected the credentials (HTTP ${response.status}).`);
  }

  const body: unknown = await response.json();
  const token = isRecord(body) ? body.token : undefined;
  if (typeof token !== "string" || token === "") {
    fail("The sign-in response did not include a token.");
  }
  return token;
}

async function fetchList(endpoint: string, token: string): Promise<unknown[]> {
  const response = await fetch(`${CCC_BASE_URL}${endpoint}`, {
    headers: { "x-access-token": token },
  });
  if (!response.ok) {
    fail(`GET ${endpoint} answered HTTP ${response.status}.`);
  }

  const body: unknown = await response.json();
  if (!Array.isArray(body)) {
    fail(`GET ${endpoint} did not answer with a list.`);
  }
  return body;
}

/**
 * Narrows the three Control Central answers the directory needs: every client
 * with the clinics it owns, and the spreadsheet each clinic writes to. Rows
 * that do not carry the fields the import reads are dropped here, so the rest
 * of the script never works with an unchecked API shape.
 */
async function fetchDirectory(token: string): Promise<Directory> {
  const [clientRows, clinicRows, driveRows] = await Promise.all([
    fetchList(CLIENTS_PATH, token),
    fetchList(CLINICS_PATH, token),
    fetchList(DRIVE_PATH, token),
  ]);

  const spreadsheetByDriveId = new Map<string, string>();
  for (const row of driveRows) {
    if (!isRecord(row)) continue;
    const driveId = pickString(row._id);
    const spreadsheet = pickString(row.spreadsheet).trim();
    if (driveId !== "" && spreadsheet !== "") {
      spreadsheetByDriveId.set(driveId, spreadsheet);
    }
  }

  const clientNameByClinicId = new Map<string, string>();
  for (const row of clientRows) {
    if (!isRecord(row)) continue;
    const clientName = pickString(row.clientName).trim();
    for (const entry of Array.isArray(row.clinic) ? row.clinic : []) {
      if (!isRecord(entry)) continue;
      const clinicId = pickString(entry._id);
      if (clinicId !== "") {
        clientNameByClinicId.set(clinicId, clientName);
      }
    }
  }

  const clinics: Directory["clinics"] = [];
  for (const row of clinicRows) {
    if (!isRecord(row)) continue;
    const externalClinicId = pickString(row._id);
    if (externalClinicId === "") continue;
    clinics.push({
      externalClinicId,
      name: pickString(row.clinicName).trim(),
      googleSheetId: spreadsheetByDriveId.get(pickString(row.drive)) ?? "",
    });
  }

  return {
    counts: {
      clients: clientRows.length,
      clinics: clinicRows.length,
      drive: driveRows.length,
    },
    clientNameByClinicId,
    clinics,
  };
}

/**
 * One row per clinic Control Central can place: it needs a spreadsheet, because
 * a clinic without one has nothing for a report to write to, and a client,
 * because a clinic row cannot exist without one.
 *
 * A spreadsheet several clinics share keeps a single row. The one already
 * stored in Convex wins, so a clinic the app tracks does not move to another
 * client on the way in; ties and the rest fall back to client and clinic name,
 * which keeps the result independent of the order the API answered with.
 */
function buildPlan(directory: Directory, configBySheet: Map<string, SheetConfig>): DirectoryPlan {
  const knownExternalIds = new Set(
    [...configBySheet.values()]
      .map((config) => config.externalClinicId)
      .filter((id): id is string => id !== null && id !== "")
  );

  const skipped: SkippedClinic[] = [];
  const candidates: DirectoryClinic[] = [];

  for (const clinic of directory.clinics) {
    const clientName = directory.clientNameByClinicId.get(clinic.externalClinicId) ?? "";
    if (clinic.googleSheetId === "") {
      skipped.push({
        name: clinic.name,
        externalClinicId: clinic.externalClinicId,
        reason: "no spreadsheet",
      });
      continue;
    }
    if (clientName === "") {
      skipped.push({
        name: clinic.name,
        externalClinicId: clinic.externalClinicId,
        reason: "no client",
      });
      continue;
    }

    candidates.push({
      clientName,
      name: clinic.name,
      externalClinicId: clinic.externalClinicId,
      googleSheetId: clinic.googleSheetId,
      sheetColumns: {},
      qaGroupKeys: [],
    });
  }

  candidates.sort((first, second) => {
    const firstKnown = knownExternalIds.has(first.externalClinicId) ? 0 : 1;
    const secondKnown = knownExternalIds.has(second.externalClinicId) ? 0 : 1;
    return (
      firstKnown - secondKnown ||
      first.clientName.localeCompare(second.clientName) ||
      first.name.localeCompare(second.name)
    );
  });

  const sharedSheets: SharedSheet[] = [];
  const bySheet = new Map<string, DirectoryClinic>();
  for (const clinic of candidates) {
    const kept = bySheet.get(clinic.googleSheetId);
    if (kept === undefined) {
      bySheet.set(clinic.googleSheetId, clinic);
      continue;
    }
    const label = `${clinic.clientName} / ${clinic.name}`;
    const group = sharedSheets.find((entry) => entry.googleSheetId === clinic.googleSheetId);
    if (group === undefined) {
      sharedSheets.push({
        googleSheetId: clinic.googleSheetId,
        kept: `${kept.clientName} / ${kept.name}`,
        dropped: [label],
      });
      continue;
    }
    group.dropped.push(label);
  }

  let carriedOverConfig = 0;
  const clinics = [...bySheet.values()].map((clinic) => {
    const config = configBySheet.get(clinic.googleSheetId);
    if (config === undefined) return clinic;
    carriedOverConfig += 1;
    return { ...clinic, sheetColumns: config.sheetColumns, qaGroupKeys: config.qaGroupKeys };
  });

  const clients = [...new Set(clinics.map((clinic) => clinic.clientName))].sort((first, second) =>
    first.localeCompare(second)
  );

  return {
    generatedAt: new Date().toISOString(),
    source: CCC_BASE_URL,
    clients,
    clinics,
    skipped,
    sharedSheets,
    carriedOverConfig,
  };
}

// The CLI prints the answer after the deployment banner, so the JSON is the
// span between the first bracket and the last one. It answers with an object
// or an array depending on the function.
function parseConvexOutput(output: string, functionName: string): unknown {
  const starts = [output.indexOf("{"), output.indexOf("[")].filter((index) => index !== -1);
  const ends = [output.lastIndexOf("}"), output.lastIndexOf("]")].filter((index) => index !== -1);
  const start = starts.length === 0 ? -1 : Math.min(...starts);
  const end = ends.length === 0 ? -1 : Math.max(...ends);
  if (start === -1 || end < start) {
    fail(`${functionName} answered without JSON: ${output.slice(0, 200)}`);
  }

  try {
    return JSON.parse(output.slice(start, end + 1));
  } catch {
    fail(`${functionName} answered with something that is not JSON: ${output.slice(0, 200)}`);
  }
}

function runConvex(functionName: string, payload: unknown, targetProd: boolean): unknown {
  const args = ["convex", "run", functionName, JSON.stringify(payload)];
  if (targetProd) {
    args.push("--prod");
  }
  const result = spawnSync("pnpm", args, {
    cwd: repoRoot,
    encoding: "utf-8",
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
  });

  if (result.status !== 0) {
    fail(result.stderr || result.stdout || `${functionName} failed.`);
  }

  return parseConvexOutput(result.stdout.trim(), functionName);
}

function readSheetConfig(targetProd: boolean): Map<string, SheetConfig> {
  const rows = runConvex(
    "migrations/importCccDirectory:readSheetConfig",
    {},
    targetProd
  ) as SheetConfig[];
  return new Map(rows.map((row) => [row.googleSheetId, row]));
}

function wipeDirectory(targetProd: boolean): WipeResult {
  const totals: WipeResult = {
    deletedClinics: 0,
    deletedClients: 0,
    clearedProfiles: 0,
    done: false,
  };

  for (let call = 0; call < MAX_WIPE_CALLS; call += 1) {
    const result = runConvex(
      "migrations/importCccDirectory:wipeDirectory",
      {},
      targetProd
    ) as WipeResult;
    totals.deletedClinics += result.deletedClinics;
    totals.deletedClients += result.deletedClients;
    totals.clearedProfiles += result.clearedProfiles;
    if (result.done) {
      totals.done = true;
      return totals;
    }
  }

  return fail(`The wipe did not finish after ${MAX_WIPE_CALLS} calls.`);
}

function insertClinics(plan: DirectoryPlan, targetProd: boolean): InsertResult {
  const totals: InsertResult = { inserted: 0, clientsCreated: 0, skipped: 0 };

  for (let start = 0; start < plan.clinics.length; start += INSERT_BATCH) {
    const batch = plan.clinics.slice(start, start + INSERT_BATCH);
    const result = runConvex(
      "migrations/importCccDirectory:insertClinics",
      { clinics: batch },
      targetProd
    ) as InsertResult;
    totals.inserted += result.inserted;
    totals.clientsCreated += result.clientsCreated;
    totals.skipped += result.skipped;
    console.log(
      `  ${Math.min(start + batch.length, plan.clinics.length)}/${plan.clinics.length} clinic(s) written`
    );
  }

  return totals;
}

function printList(label: string, values: string[]) {
  if (values.length === 0) return;
  console.log(`${label} (${values.length}):`);
  for (const value of values.slice(0, PREVIEW_LIMIT)) {
    console.log(`  - ${value}`);
  }
  if (values.length > PREVIEW_LIMIT) {
    console.log(`  ... and ${values.length - PREVIEW_LIMIT} more`);
  }
}

function printPlan(plan: DirectoryPlan, outputPath: string) {
  console.log(
    `Planned ${plan.clinics.length} clinic(s) across ${plan.clients.length} client(s); wrote ${outputPath}`
  );
  console.log(`Clinics that keep the column mapping they already had: ${plan.carriedOverConfig}`);

  printList(
    "Clinics with a spreadsheet that Control Central places under no client (not imported)",
    plan.skipped
      .filter((entry) => entry.reason === "no client")
      .map((entry) => `${entry.name} (${entry.externalClinicId})`)
  );
  printList(
    "Clinics with no spreadsheet (not imported)",
    plan.skipped
      .filter((entry) => entry.reason === "no spreadsheet")
      .map((entry) => `${entry.name} (${entry.externalClinicId})`)
  );
  printList(
    "Clinics sharing another clinic's spreadsheet (not imported)",
    plan.sharedSheets.map((group) => `${group.kept} keeps it; dropped ${group.dropped.join(", ")}`)
  );
}

async function main() {
  const targetProd = hasFlag("--prod");
  const shouldExecute = hasFlag("--execute");
  const outputPath = path.resolve(repoRoot, readArg("--output") ?? DEFAULT_OUTPUT);

  const credentials = await loadCredentials();
  console.log(`Reading the directory from ${CCC_BASE_URL} as ${credentials.username}.`);

  const token = await signIn(credentials);
  const directory = await fetchDirectory(token);
  console.log(
    `Control Central answered ${directory.counts.clients} client(s), ${directory.counts.clinics} clinic(s) and ${directory.counts.drive} drive row(s).`
  );

  const plan = buildPlan(directory, readSheetConfig(targetProd));
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`, "utf-8");
  printPlan(plan, outputPath);

  if (!shouldExecute) {
    console.log("Nothing was written. Re-run with --execute to replace the directory in Convex.");
    return;
  }

  const target = targetProd ? "production" : "dev";
  console.log(`Replacing the directory on ${target}.`);
  const wiped = wipeDirectory(targetProd);
  console.log(
    `  removed ${wiped.deletedClinics} clinic(s) and ${wiped.deletedClients} client(s), cleared ${wiped.clearedProfiles} assignment(s).`
  );

  const written = insertClinics(plan, targetProd);
  console.log(
    `Wrote ${written.inserted} clinic(s) and created ${written.clientsCreated} client(s).`
  );
  if (written.skipped > 0) {
    console.log(`  ${written.skipped} incomplete entr(ies) were skipped.`);
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : "Import failed.");
});
