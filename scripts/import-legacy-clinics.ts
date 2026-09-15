/**
 * Parse legacy Reporting-Tool configs and import clients and clinics into
 * Convex. Clients come from the practice groups in
 * components/configurations/configs.py; every practice alias points at a config
 * file whose rows become clinics. Clinics are matched by googleSheetId.
 * Missing clients and clinics are created; staff assignments are not touched.
 *
 * Step 1, export JSON from legacy configs (safe, no Convex writes):
 *   pnpm import:legacy-clinics
 *
 * Step 2, preview what would change in Convex:
 *   pnpm import:legacy-clinics --apply
 *
 * Step 3, write to Convex (admin deployment only, after reviewing step 2):
 *   pnpm import:legacy-clinics --apply --execute
 *
 * Convex calls target the dev deployment in .env.local. Add --prod to target
 * this project's default production deployment instead.
 *
 * Options:
 *   --configs <dir>   Legacy configs directory (default: ../Reporting-Tool/configs)
 *   --output <file>   JSON output path (default: scripts/output/legacy-clinics.json)
 *   --prod            Run Convex against the production deployment
 */
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

type LegacyClinicEntry = {
  sourceFile: string;
  practice: string;
  aliases: string[];
  name: string;
  googleSheetId: string;
  externalClinicId: string | null;
  isActive: boolean;
  sheetColumns: Record<string, string>;
  qaGroupKeys: string[];
};

type UnresolvedAlias = {
  practice: string;
  alias: string;
  reason: string;
};

type UnreachableClinic = {
  sourceFile: string;
  name: string;
  googleSheetId: string;
};

type CrossClientSheet = {
  googleSheetId: string;
  name: string;
  keptPractice: string;
  ignoredPractice: string;
};

type ParsedLegacyPayload = {
  practices: string[];
  clinics: LegacyClinicEntry[];
  unresolvedAliases: UnresolvedAlias[];
  unreachableClinics: UnreachableClinic[];
  crossClientSheets: CrossClientSheet[];
};

type LegacyImportClinic = LegacyClinicEntry & { clientName: string };

type LegacyClientSummary = {
  name: string;
  practice: string;
  clinicCount: number;
};

type LegacyImportFile = {
  generatedAt: string;
  configsDir: string;
  clientCount: number;
  clinicCount: number;
  clients: LegacyClientSummary[];
  practicesWithoutClinics: string[];
  unresolvedAliases: UnresolvedAlias[];
  unreachableClinics: UnreachableClinic[];
  crossClientSheets: CrossClientSheet[];
  clinics: LegacyImportClinic[];
};

type ApplyEntry = {
  clientName: string;
  googleSheetId: string;
  name: string;
  externalClinicId?: string;
  isActive: boolean;
  sheetColumns: Record<string, string>;
  qaGroupKeys: string[];
};

type ApplySummary = {
  clientsCreated: number;
  clientsReused: number;
  created: number;
  updated: number;
  skipped: number;
  moved: number;
  nameConflicts: string[];
};

const PREVIEW_LIMIT = 10;

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

// "OPEN DENTAL" becomes "Open Dental", matching the client names admins type
// by hand in the app.
function clientNameFromPractice(practice: string): string {
  return practice
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== "")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function parseLegacyConfigs(configsDir: string, configsModule: string): ParsedLegacyPayload {
  const pythonScript = `
import ast
import json
import sys
from pathlib import Path

configs_dir = Path(sys.argv[1])
configs_module = Path(sys.argv[2])


def pick(entry, *keys):
    for key in keys:
        if key in entry and entry[key] not in (None, ""):
            value = entry[key]
            if isinstance(value, str):
                return value.strip()
            return value
    return None


def map_sheet_columns(entry):
    columns = {}
    update_status = pick(entry, "UPDATE_STATUS_COLUMN", "UPDATE_STATUS")
    upload_status = pick(entry, "UPLOAD_STATUS_COLUMN")
    verification_type = pick(entry, "TYPE_VERIFICATION_COLUMN")
    file_url = pick(entry, "FILE_URL_COLUMN")

    if update_status:
        columns["updateStatus"] = update_status
    if upload_status:
        columns["uploadStatus"] = upload_status
    if verification_type:
        columns["verificationType"] = verification_type
    if file_url:
        columns["fileUrl"] = file_url
    return columns


def read_clinic_rows(path):
    try:
        data = ast.literal_eval(path.read_text(encoding="utf-8"))
    except (SyntaxError, ValueError):
        return []
    if not isinstance(data, list):
        return []

    rows = []
    for entry in data:
        if not isinstance(entry, dict):
            continue
        name = pick(entry, "CLINIC_NAME")
        google_sheet_id = pick(entry, "GSHEETS_ID")
        if not name or not google_sheet_id:
            continue

        qa_groups = entry.get("QA_GROUPS")
        qa_group_keys = []
        if isinstance(qa_groups, list):
            qa_group_keys = [str(item).strip() for item in qa_groups if str(item).strip()]

        rows.append({
            "sourceFile": path.name,
            "name": name,
            "googleSheetId": google_sheet_id,
            "externalClinicId": pick(entry, "CLINIC_ID"),
            "isActive": bool(entry.get("CLINIC_STATUS_ACTIVE", True)),
            "sheetColumns": map_sheet_columns(entry),
            "qaGroupKeys": qa_group_keys,
        })
    return rows


def read_literal_assignments(path):
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except SyntaxError:
        return {}

    values = {}
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        for target in node.targets:
            if not isinstance(target, ast.Name):
                continue
            try:
                values[target.id] = ast.literal_eval(node.value)
            except (SyntaxError, ValueError):
                continue
    return values


rows_by_file = {}
for path in sorted(configs_dir.glob("*.py")):
    rows = read_clinic_rows(path)
    if rows:
        rows_by_file[path.name] = rows

module = read_literal_assignments(configs_module)
users = module.get("USERS_DB") if isinstance(module.get("USERS_DB"), dict) else {}
alias_files = module.get("cl") if isinstance(module.get("cl"), dict) else {}

practices = {}
for user in users.values():
    if not isinstance(user, dict):
        continue
    group_map = user.get("practices")
    if not isinstance(group_map, dict):
        continue
    for practice, aliases in group_map.items():
        bucket = practices.setdefault(str(practice), [])
        if not isinstance(aliases, list):
            continue
        for alias in aliases:
            alias = str(alias).strip()
            if alias and alias not in bucket:
                bucket.append(alias)

if not practices:
    print("No practices found in USERS_DB.", file=sys.stderr)
    sys.exit(1)

clinics = []
by_sheet_id = {}
unresolved_aliases = []
cross_client_sheets = []

for practice in sorted(practices):
    for alias in practices[practice]:
        filename = alias_files.get(alias)
        if not filename:
            unresolved_aliases.append({
                "practice": practice,
                "alias": alias,
                "reason": "alias is not in the cl map",
            })
            continue

        rows = rows_by_file.get(filename + ".py")
        if not rows:
            unresolved_aliases.append({
                "practice": practice,
                "alias": alias,
                "reason": "config file is missing or has no clinics",
            })
            continue

        for row in rows:
            sheet_id = row["googleSheetId"]
            existing = by_sheet_id.get(sheet_id)
            if existing is None:
                entry = dict(row)
                entry["practice"] = practice
                entry["aliases"] = [alias]
                by_sheet_id[sheet_id] = entry
                clinics.append(entry)
                continue

            if alias not in existing["aliases"]:
                existing["aliases"].append(alias)
            if existing["practice"] != practice:
                cross_client_sheets.append({
                    "googleSheetId": sheet_id,
                    "name": row["name"],
                    "keptPractice": existing["practice"],
                    "ignoredPractice": practice,
                })

unreachable_clinics = []
seen_unreachable = set()
for filename in sorted(rows_by_file):
    for row in rows_by_file[filename]:
        sheet_id = row["googleSheetId"]
        if sheet_id in by_sheet_id or sheet_id in seen_unreachable:
            continue
        seen_unreachable.add(sheet_id)
        unreachable_clinics.append({
            "sourceFile": filename,
            "name": row["name"],
            "googleSheetId": sheet_id,
        })

print(json.dumps({
    "practices": sorted(practices),
    "clinics": clinics,
    "unresolvedAliases": unresolved_aliases,
    "unreachableClinics": unreachable_clinics,
    "crossClientSheets": cross_client_sheets,
}))
`;

  const result = spawnSync("python3", ["-c", pythonScript, configsDir, configsModule], {
    encoding: "utf-8",
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.error) {
    fail(`Failed to run python3: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(result.stderr || "Python parser failed.");
  }

  return JSON.parse(result.stdout) as ParsedLegacyPayload;
}

function buildImportClinics(parsed: ParsedLegacyPayload): LegacyImportClinic[] {
  return parsed.clinics.map((clinic) => ({
    ...clinic,
    clientName: clientNameFromPractice(clinic.practice),
  }));
}

function buildClientSummaries(clinics: LegacyImportClinic[]): LegacyClientSummary[] {
  const summaries = new Map<string, LegacyClientSummary>();
  for (const clinic of clinics) {
    const summary = summaries.get(clinic.clientName);
    if (summary === undefined) {
      summaries.set(clinic.clientName, {
        name: clinic.clientName,
        practice: clinic.practice,
        clinicCount: 1,
      });
      continue;
    }
    summary.clinicCount += 1;
  }
  return [...summaries.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function buildApplyPayload(clinics: LegacyImportClinic[]): ApplyEntry[] {
  return clinics.map((clinic) => ({
    clientName: clinic.clientName,
    googleSheetId: clinic.googleSheetId,
    name: clinic.name,
    externalClinicId: clinic.externalClinicId ?? undefined,
    isActive: clinic.isActive,
    sheetColumns: clinic.sheetColumns,
    qaGroupKeys: clinic.qaGroupKeys,
  }));
}

async function writeImportFile(outputPath: string, payload: LegacyImportFile) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
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

function printParseSummary(importFile: LegacyImportFile, outputPath: string) {
  console.log(
    `Wrote ${importFile.clinicCount} clinic(s) across ${importFile.clientCount} client(s) to ${outputPath}`
  );
  console.log(
    `Clients: ${importFile.clients
      .map((client) => `${client.name} (${client.clinicCount})`)
      .join(", ")}`
  );

  printList("Practices with no clinics (client not created)", importFile.practicesWithoutClinics);
  printList(
    "Practice aliases that map to no config file (skipped)",
    importFile.unresolvedAliases.map(
      (entry) => `${entry.alias} under ${entry.practice}: ${entry.reason}`
    )
  );
  printList(
    "Clinics no practice references (not imported)",
    importFile.unreachableClinics.map((entry) => `${entry.name} (${entry.sourceFile})`)
  );
  printList(
    "Clinics shared by two practices (kept the first)",
    importFile.crossClientSheets.map(
      (entry) =>
        `${entry.name}: kept ${clientNameFromPractice(entry.keptPractice)}, ignored ${clientNameFromPractice(entry.ignoredPractice)}`
    )
  );
}

function runConvexApply(dryRun: boolean, targetProd: boolean, entries: ApplyEntry[]) {
  const payload = { dryRun, entries };
  const args = [
    "convex",
    "run",
    "migrations/importLegacyClinics:applyLegacyClinics",
    JSON.stringify(payload),
  ];
  if (targetProd) {
    args.push("--prod");
  }
  const result = spawnSync("pnpm", args, {
    cwd: repoRoot,
    encoding: "utf-8",
    env: process.env,
  });

  if (result.status !== 0) {
    fail(result.stderr || result.stdout || "Convex apply failed.");
  }

  const output = result.stdout.trim();
  const jsonStart = output.indexOf("{");
  const jsonEnd = output.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
    console.log(result.stdout);
    return;
  }

  const summary = JSON.parse(output.slice(jsonStart, jsonEnd + 1)) as ApplySummary;
  const prefix = dryRun ? "Dry run" : "Applied";
  const target = targetProd ? " on production" : "";
  const clientVerb = dryRun ? "would create" : "created";
  const clinicVerb = dryRun ? "would create" : "created";
  const updateVerb = dryRun ? "would update" : "updated";
  const moveVerb = dryRun ? "would move" : "moved";

  console.log(
    `${prefix}${target}: ${summary.clientsCreated} client(s) ${clientVerb}, ${summary.clientsReused} client(s) reused, ${summary.created} clinic(s) ${clinicVerb}, ${summary.updated} ${updateVerb} (${summary.moved} ${moveVerb} to another client), ${summary.skipped} unchanged.`
  );

  printList("Name conflicts in the target client (skipped)", summary.nameConflicts);
}

async function main() {
  const configsDir = path.resolve(repoRoot, readArg("--configs") ?? "../Reporting-Tool/configs");
  const configsModule = path.resolve(
    configsDir,
    "..",
    "components",
    "configurations",
    "configs.py"
  );
  const outputPath = path.resolve(
    repoRoot,
    readArg("--output") ?? "scripts/output/legacy-clinics.json"
  );
  const shouldApply = hasFlag("--apply");
  const shouldExecute = hasFlag("--execute");
  const targetProd = hasFlag("--prod");

  const parsed = parseLegacyConfigs(configsDir, configsModule);
  const clinicEntries = buildImportClinics(parsed);
  const clients = buildClientSummaries(clinicEntries);
  const usedPractices = new Set(clinicEntries.map((clinic) => clinic.practice));
  const importFile: LegacyImportFile = {
    generatedAt: new Date().toISOString(),
    configsDir,
    clientCount: clients.length,
    clinicCount: clinicEntries.length,
    clients,
    practicesWithoutClinics: parsed.practices
      .filter((practice) => !usedPractices.has(practice))
      .map((practice) => clientNameFromPractice(practice)),
    unresolvedAliases: parsed.unresolvedAliases,
    unreachableClinics: parsed.unreachableClinics,
    crossClientSheets: parsed.crossClientSheets,
    clinics: clinicEntries,
  };

  await writeImportFile(outputPath, importFile);
  printParseSummary(importFile, outputPath);

  if (!shouldApply) {
    console.log("Review the JSON file, then run with --apply to preview Convex updates.");
    return;
  }

  runConvexApply(!shouldExecute, targetProd, buildApplyPayload(clinicEntries));
  if (!shouldExecute) {
    console.log(
      `No data was written. Re-run with --apply --execute${targetProd ? " --prod" : ""} to apply clients and clinics.`
    );
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : "Import failed.");
});
