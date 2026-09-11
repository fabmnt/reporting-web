/**
 * Parse legacy Reporting-Tool Python clinic configs and import clinics
 * into Convex. Updates existing clinics by googleSheetId and creates
 * missing ones under the given client.
 *
 * Step 1, export JSON from legacy configs (safe, no Convex writes):
 *   pnpm import:legacy-columns
 *
 * Step 2, preview what would change in Convex:
 *   pnpm import:legacy-columns --apply --clientId <convexClientId>
 *
 * Step 3, write to Convex (admin deployment only, after reviewing step 2):
 *   pnpm import:legacy-columns --apply --execute --clientId <convexClientId>
 *
 * Options:
 *   --configs <dir>   Legacy configs directory (default: ../Reporting-Tool/configs)
 *   --output <file>   JSON output path (default: scripts/output/legacy-clinic-columns.json)
 *   --clientId <id>   Convex client ID for created clinics. Without it,
 *                     missing clinics are only reported, not created.
 */
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

type LegacyClinicEntry = {
  sourceFile: string;
  name: string;
  googleSheetId: string;
  externalClinicId: string | null;
  isActive: boolean;
  sheetColumns: Record<string, string>;
  qaGroupKeys: string[];
};

type LegacyImportFile = {
  generatedAt: string;
  configsDir: string;
  clinicCount: number;
  duplicateSheetIds: string[];
  clinics: LegacyClinicEntry[];
};

type ParsedLegacyPayload = {
  clinics: LegacyClinicEntry[];
  duplicateSheetIds: string[];
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

function parseLegacyConfigs(configsDir: string): ParsedLegacyPayload {
  const pythonScript = `
import ast
import json
import sys
from pathlib import Path

configs_dir = Path(sys.argv[1])
clinics = []
duplicate_sheet_ids = []

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

for file_path in sorted(configs_dir.glob("*.py")):
    text = file_path.read_text(encoding="utf-8")
    try:
        data = ast.literal_eval(text)
    except (SyntaxError, ValueError):
        continue
    if not isinstance(data, list):
        continue

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

        clinics.append({
            "sourceFile": file_path.name,
            "name": name,
            "googleSheetId": google_sheet_id,
            "externalClinicId": pick(entry, "CLINIC_ID"),
            "isActive": bool(entry.get("CLINIC_STATUS_ACTIVE", True)),
            "sheetColumns": map_sheet_columns(entry),
            "qaGroupKeys": qa_group_keys,
        })

seen = {}
duplicates = []
for clinic in clinics:
    sheet_id = clinic["googleSheetId"]
    if sheet_id in seen:
        duplicates.append(sheet_id)
        continue
    seen[sheet_id] = clinic

print(json.dumps({
    "clinics": list(seen.values()),
    "duplicateSheetIds": sorted(set(duplicates)),
}))
`;

  const result = spawnSync("python3", ["-c", pythonScript, configsDir], {
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

async function writeImportFile(outputPath: string, payload: LegacyImportFile) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
}

function buildApplyPayload(clinics: LegacyClinicEntry[]) {
  return clinics.map((clinic) => ({
    googleSheetId: clinic.googleSheetId,
    name: clinic.name,
    externalClinicId: clinic.externalClinicId ?? undefined,
    isActive: clinic.isActive,
    sheetColumns: clinic.sheetColumns,
    qaGroupKeys: clinic.qaGroupKeys,
  }));
}

function runConvexApply(
  dryRun: boolean,
  entries: ReturnType<typeof buildApplyPayload>,
  clientId: string | null
) {
  const payload: Record<string, unknown> = { dryRun, entries };
  if (clientId) {
    payload.clientId = clientId;
  }
  const args = [
    "convex",
    "run",
    "migrations/importLegacySheetColumns:applyLegacySheetColumns",
    JSON.stringify(payload),
  ];
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

  const summary = JSON.parse(output.slice(jsonStart, jsonEnd + 1)) as {
    matched: number;
    updated: number;
    created: number;
    skipped: number;
    missing: string[];
    nameConflicts: string[];
  };

  console.log(
    dryRun
      ? `Dry run: ${summary.updated} clinic(s) would update, ${summary.created} would create, ${summary.skipped} unchanged, ${summary.matched} matched.`
      : `Applied: ${summary.updated} clinic(s) updated, ${summary.created} created, ${summary.skipped} unchanged, ${summary.matched} matched.`
  );
  if (summary.missing.length > 0) {
    console.log(`Missing in Convex (${summary.missing.length}):`);
    for (const sheetId of summary.missing.slice(0, 20)) {
      console.log(`  - ${sheetId}`);
    }
    if (summary.missing.length > 20) {
      console.log(`  ... and ${summary.missing.length - 20} more`);
    }
    if (!clientId) {
      console.log("Re-run with --clientId <id> to create missing clinics.");
    }
  }
  if (summary.nameConflicts.length > 0) {
    console.log(`Name conflicts (${summary.nameConflicts.length}):`);
    for (const sheetId of summary.nameConflicts.slice(0, 20)) {
      console.log(`  - ${sheetId}`);
    }
    if (summary.nameConflicts.length > 20) {
      console.log(`  ... and ${summary.nameConflicts.length - 20} more`);
    }
  }
}

async function main() {
  const configsDir = path.resolve(repoRoot, readArg("--configs") ?? "../Reporting-Tool/configs");
  const outputPath = path.resolve(
    repoRoot,
    readArg("--output") ?? "scripts/output/legacy-clinic-columns.json"
  );
  const shouldApply = hasFlag("--apply");
  const shouldExecute = hasFlag("--execute");
  const clientId = readArg("--clientId");

  const parsed = parseLegacyConfigs(configsDir);
  const importFile: LegacyImportFile = {
    generatedAt: new Date().toISOString(),
    configsDir,
    clinicCount: parsed.clinics.length,
    duplicateSheetIds: parsed.duplicateSheetIds,
    clinics: parsed.clinics,
  };

  await writeImportFile(outputPath, importFile);
  console.log(`Wrote ${parsed.clinics.length} clinic(s) to ${outputPath}`);
  if (parsed.duplicateSheetIds.length > 0) {
    console.log(
      `Skipped ${parsed.duplicateSheetIds.length} duplicate googleSheetId value(s) across legacy files.`
    );
  }

  if (!shouldApply) {
    console.log("Review the JSON file, then run with --apply to preview Convex updates.");
    return;
  }

  const entries = buildApplyPayload(parsed.clinics);
  runConvexApply(!shouldExecute, entries, clientId);
  if (!shouldExecute) {
    console.log("No data was written. Re-run with --apply --execute to apply clinics.");
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : "Import failed.");
});
