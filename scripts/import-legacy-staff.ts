/**
 * Parse the legacy Reporting-Tool USERS_DB and create the accounts in Convex.
 * Clinic assignments come from the same practice aliases the clinic import
 * uses, resolved to Google Sheet ids. Aliases that point at no config file are
 * skipped and listed in the output.
 *
 * No legacy password is imported. Every account starts with a secret nobody
 * knows, and an administrator hands each person a one-shot link from the
 * accounts panel so they choose their own password.
 *
 * Step 1, export JSON from the legacy configs (safe, no Convex writes):
 *   pnpm import:legacy-staff
 *
 * Step 2, preview what would change in Convex:
 *   pnpm import:legacy-staff --apply
 *
 * Step 3, write to Convex, after reviewing step 2:
 *   pnpm import:legacy-staff --apply --execute
 *
 * Convex calls target the dev deployment in .env.local. Add --prod to target
 * this project's default production deployment instead.
 *
 * Options:
 *   --configs <dir>   Legacy configs directory (default: ../Reporting-Tool/configs)
 *   --output <file>   JSON output path (default: scripts/output/legacy-staff.json)
 *   --prod            Run Convex against the production deployment
 */
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

// The legacy tool had one account with every operation enabled and no way to
// say "administrator". MezaMeza owned all of them, so it keeps the role that
// can manage accounts. Everyone else becomes an operator.
const ADMIN_USERNAMES = new Set(["mezameza"]);

// Legacy keys are not all valid usernames: this app allows letters, numbers,
// dots, dashes and underscores only, so "Richard Olivero" needs a rename. Any
// other key that does not fit is reported by the backend instead of guessed at.
const USERNAME_OVERRIDES: Record<string, string> = {
  "Richard Olivero": "richardolivero",
};

type StaffRole = "admin" | "operator";

type ParsedStaffEntry = {
  username: string;
  clinicSheetIds: string[];
  unresolvedAliases: string[];
};

type LegacyStaffAccount = {
  username: string;
  legacyName: string;
  displayName: string;
  role: StaffRole;
  googleSheetIds: string[];
  unresolvedAliases: string[];
};

type LegacyStaffFile = {
  generatedAt: string;
  configsDir: string;
  accountCount: number;
  clinicCount: number;
  accounts: LegacyStaffAccount[];
};

type ApplyEntry = {
  username: string;
  displayName: string;
  role: StaffRole;
  googleSheetIds: string[];
};

type ApplySummary = {
  created: string[];
  existing: string[];
  rejected: string[];
  unmatchedSheets: string[];
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

function usernameFromLegacyName(legacyName: string): string {
  const renamed = USERNAME_OVERRIDES[legacyName] ?? legacyName;
  return renamed.trim().toLowerCase();
}

function parseLegacyStaff(configsDir: string, configsModule: string): ParsedStaffEntry[] {
  const pythonScript = `
import ast
import json
import sys
from pathlib import Path

configs_dir = Path(sys.argv[1])
configs_module = Path(sys.argv[2])


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


def read_sheet_ids(path):
    try:
        data = ast.literal_eval(path.read_text(encoding="utf-8"))
    except (SyntaxError, ValueError):
        return []
    if not isinstance(data, list):
        return []

    sheet_ids = []
    for entry in data:
        if not isinstance(entry, dict):
            continue
        sheet_id = entry.get("GSHEETS_ID")
        if not sheet_id:
            continue
        sheet_id = str(sheet_id).strip()
        if sheet_id and sheet_id not in sheet_ids:
            sheet_ids.append(sheet_id)
    return sheet_ids


sheet_ids_by_file = {}
for path in sorted(configs_dir.glob("*.py")):
    sheet_ids = read_sheet_ids(path)
    if sheet_ids:
        sheet_ids_by_file[path.name] = sheet_ids

module = read_literal_assignments(configs_module)
users = module.get("USERS_DB") if isinstance(module.get("USERS_DB"), dict) else {}
alias_files = module.get("cl") if isinstance(module.get("cl"), dict) else {}

staff = []
for username, record in users.items():
    if not isinstance(record, dict):
        continue

    practices = record.get("practices")
    if not isinstance(practices, dict):
        practices = {}

    sheet_ids = []
    unresolved = []
    for practice in sorted(practices):
        aliases = practices[practice]
        if not isinstance(aliases, list):
            continue
        for alias in aliases:
            alias = str(alias).strip()
            filename = alias_files.get(alias)
            if not filename:
                unresolved.append(alias)
                continue
            rows = sheet_ids_by_file.get(filename + ".py")
            if not rows:
                unresolved.append(alias)
                continue
            for sheet_id in rows:
                if sheet_id not in sheet_ids:
                    sheet_ids.append(sheet_id)

    staff.append({
        "username": str(username),
        "clinicSheetIds": sheet_ids,
        "unresolvedAliases": unresolved,
    })

print(json.dumps(staff))
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

  return JSON.parse(result.stdout) as ParsedStaffEntry[];
}

function buildAccount(entry: ParsedStaffEntry): LegacyStaffAccount {
  const username = usernameFromLegacyName(entry.username);

  return {
    username,
    legacyName: entry.username,
    displayName: entry.username,
    role: ADMIN_USERNAMES.has(username) ? "admin" : "operator",
    googleSheetIds: entry.clinicSheetIds,
    unresolvedAliases: entry.unresolvedAliases,
  };
}

function buildApplyPayload(accounts: LegacyStaffAccount[]): ApplyEntry[] {
  return accounts.map((account) => ({
    username: account.username,
    displayName: account.displayName,
    role: account.role,
    googleSheetIds: account.googleSheetIds,
  }));
}

async function writeImportFile(outputPath: string, payload: LegacyStaffFile) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
}

function printList(label: string, values: string[]) {
  if (values.length === 0) return;
  console.log(`${label} (${values.length}):`);
  for (const value of values) {
    console.log(`  - ${value}`);
  }
}

function printParseSummary(importFile: LegacyStaffFile, outputPath: string) {
  console.log(
    `Wrote ${importFile.accountCount} account(s) with ${importFile.clinicCount} clinic assignment(s) to ${outputPath}`
  );
  for (const account of importFile.accounts) {
    console.log(
      `  - ${account.username} (${account.role}): ${account.googleSheetIds.length} clinic(s)`
    );
    if (account.unresolvedAliases.length > 0) {
      console.log(`      aliases skipped: ${account.unresolvedAliases.join(", ")}`);
    }
  }
}

function runConvexApply(dryRun: boolean, targetProd: boolean, entries: ApplyEntry[]) {
  const payload = { dryRun, entries };
  const args = [
    "convex",
    "run",
    "migrations/importLegacyStaff:applyLegacyStaff",
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
  const verb = dryRun ? "would create" : "created";

  console.log(
    `${prefix}${target}: ${summary.created.length} account(s) ${verb}, ${summary.existing.length} already existed.`
  );
  if (dryRun) {
    printList("Accounts", summary.created);
  }
  printList("Usernames this app cannot store, rename them and run again", summary.rejected);
  printList("Clinic sheets missing in Convex, assignment skipped", summary.unmatchedSheets);
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
    readArg("--output") ?? "scripts/output/legacy-staff.json"
  );
  const shouldApply = hasFlag("--apply");
  const shouldExecute = hasFlag("--execute");
  const targetProd = hasFlag("--prod");

  const accounts = parseLegacyStaff(configsDir, configsModule).map(buildAccount);
  const importFile: LegacyStaffFile = {
    generatedAt: new Date().toISOString(),
    configsDir,
    accountCount: accounts.length,
    clinicCount: accounts.reduce((total, account) => total + account.googleSheetIds.length, 0),
    accounts,
  };

  await writeImportFile(outputPath, importFile);
  printParseSummary(importFile, outputPath);

  if (!shouldApply) {
    console.log("Review the JSON file, then run with --apply to preview Convex updates.");
    return;
  }

  runConvexApply(!shouldExecute, targetProd, buildApplyPayload(accounts));
  if (!shouldExecute) {
    console.log(
      `No data was written. Re-run with --apply --execute${targetProd ? " --prod" : ""} to create the accounts.`
    );
  }
  if (shouldExecute) {
    console.log(
      "Accounts still cannot sign in: open the accounts panel and hand out a password link."
    );
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : "Import failed.");
});
