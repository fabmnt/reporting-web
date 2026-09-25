import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { JWT } from "google-auth-library";
import { google } from "googleapis";

/**
 * Creates the spreadsheet the service-account end-to-end test reads, with the
 * test account as its owner, so no sheet has to be shared by hand.
 *
 * The rows are written to match the rules of the seeded "Pending audit" report:
 * the bot status column holds "DONE", the message column holds something else,
 * the upload status is the sheet's empty marker and the update status is
 * untouched. The account lives in the environment, never in the repository:
 *
 *   GOOGLE_SERVICE_ACCOUNT_FILE=/path/to/key.json
 * or
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL=bot@project.iam.gserviceaccount.com
 *   GOOGLE_SERVICE_ACCOUNT_KEY="-----BEGIN PRIVATE KEY-----\\n..."
 *
 * The talk in this project is about "the client's service account", and the
 * Google account this script runs as IS the service account: it writes the rows
 * during setup and only reads them from then on, because the app itself holds
 * the read-only scope.
 */

// The app only signs with the read-only scope. Creating a spreadsheet and
// writing rows is this script's job, so it asks for the writable one.
const SHEETS_WRITE_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

// Where the fixture is left for the Playwright spec, which reads it to know
// which spreadsheet and tab a run should cover.
const FIXTURE_PATH = resolve("scripts/output/google-test-sheet.json");

const UPDATE_STATUS_COLUMN = 19; // T, the default the clinics are read with.
const BOT_STATUS_COLUMN = 11; // L, the column the seeded bot rules read.
const BOT_MESSAGE_COLUMN = 12; // M, the column the seeded bot rules read.
const UPLOAD_STATUS_COLUMN = 17; // R, the default the clinics are read with.
const ROW_WIDTH = 21; // Up to column U, which the default file-url mapping uses.

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is not set. See the header of this script for the expected values.`);
  }
  return value;
}

// Google hands the key out as JSON, and an environment variable holds it as one
// line, where a real PEM only survives with escaped newlines.
function readServiceAccount(): { email: string; privateKey: string } {
  const file = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  if (file !== undefined && file.trim() !== "") {
    const parsed = JSON.parse(readFileSync(resolve(file), "utf8")) as {
      client_email?: unknown;
      private_key?: unknown;
    };
    if (typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") {
      throw new Error(`${file} does not hold a service account key.`);
    }
    return { email: parsed.client_email, privateKey: parsed.private_key };
  }

  return {
    email: required("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    privateKey: required("GOOGLE_SERVICE_ACCOUNT_KEY").replace(/\\n/g, "\n"),
  };
}

function rowAt(marker: string): string[] {
  const row = Array.from({ length: ROW_WIDTH }, () => "");
  row[0] = marker;
  // "DONE" has to be the inside of the cell, not the whole of it: the seeded
  // rule looks for the text, because the sheets write "DONE BY DIVA" as well.
  row[BOT_STATUS_COLUMN] = "DONE BY DIVA";
  row[BOT_MESSAGE_COLUMN] = "REVIEWED BY E2E";
  row[UPLOAD_STATUS_COLUMN] = "EMPTY";
  row[UPDATE_STATUS_COLUMN] = "";
  return row;
}

function headerRow(): string[] {
  const row = Array.from({ length: ROW_WIDTH }, () => "");
  row[0] = "Patient";
  row[BOT_STATUS_COLUMN] = "Bot status";
  row[BOT_MESSAGE_COLUMN] = "Bot message";
  row[UPLOAD_STATUS_COLUMN] = "Upload status";
  row[UPDATE_STATUS_COLUMN] = "Update status";
  return row;
}

async function main(): Promise<void> {
  const account = readServiceAccount();
  const auth = new JWT({
    email: account.email,
    key: account.privateKey,
    scopes: [SHEETS_WRITE_SCOPE],
  });
  const sheets = google.sheets({ version: "v4", auth });

  // Asking for a token first turns a key that was pasted wrong into one clear
  // failure here, instead of a half-made fixture.
  const token = await auth.getAccessToken();
  if (!token.token) throw new Error("Google answered without an access token.");
  console.log(`Signed in as ${account.email}.`);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const tabTitle = new Date().toISOString().slice(0, 10);
  const rowMarker = `E2E-${stamp}`;

  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: `Reporting Web test ${stamp}` },
      sheets: [{ properties: { title: tabTitle } }],
    },
  });
  const spreadsheetId = created.data.spreadsheetId;
  if (spreadsheetId === undefined || spreadsheetId === null || spreadsheetId === "") {
    throw new Error("Google did not answer with a spreadsheet id.");
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabTitle}!A1`,
    valueInputOption: "RAW",
    requestBody: {
      values: [headerRow(), rowAt(`${rowMarker}-1`), rowAt(`${rowMarker}-2`)],
    },
  });

  const fixture = {
    spreadsheetId,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
    tabTitle,
    // What the run should show: the marker of every row the conditions keep.
    rowMarkers: [`${rowMarker}-1`, `${rowMarker}-2`],
    serviceAccountEmail: account.email,
    createdAt: new Date().toISOString(),
  };

  mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
  writeFileSync(FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`);

  console.log(`Spreadsheet: ${fixture.spreadsheetUrl}`);
  console.log(`Tab: ${tabTitle}, rows: ${fixture.rowMarkers.join(", ")}`);
  console.log(`Fixture written to ${FIXTURE_PATH}`);
  console.log("");
  console.log("Next: put the account in .env.e2e and run `pnpm e2e`.");
  console.log(
    `  GOOGLE_SERVICE_ACCOUNT_FILE=${process.env.GOOGLE_SERVICE_ACCOUNT_FILE ?? "<path to the key file>"}`
  );
}

await main();
