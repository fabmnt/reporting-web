import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The end-to-end path of a service account: an administrator stores the key,
 * links it to a client, and a report reads that client's sheet with it.
 *
 * The test needs a real Google account and a spreadsheet it owns, which
 * `pnpm google:test-sheet` creates from the same environment values. Without
 * them the test skips itself: nothing here reaches Google on its own, so a
 * machine without the account still runs the rest of the suite.
 *
 * The fixture's rows are what prove the read: the service account is the only
 * identity that can read that spreadsheet, because the app's own account was
 * never given access to it. The suite runs right after a seeding run: the
 * script makes a new spreadsheet every time, and a clinic can only point at
 * one, so a fixture that an earlier run already gave a clinic to cannot be
 * used again.
 */

// Where the seeding script leaves the spreadsheet it created.
const FIXTURE_PATH = resolve("scripts/output/google-test-sheet.json");

// The seeded row report the fixture's rows are written for. Its rules read the
// bot status and message columns, so the run keeps them.
const REPORT_TYPE_NAME = "Pending audit";

// The client the test links the account to, reused between runs so the
// deployment keeps one of them. The clinic is made fresh each time, because a
// clinic points at one spreadsheet and the script makes a new one.
const CLIENT_NAME = process.env.E2E_CLIENT_NAME ?? "E2E Service Account Client";

type SheetFixture = {
  spreadsheetId: string;
  spreadsheetUrl: string;
  tabTitle: string;
  rowMarkers: string[];
  serviceAccountEmail: string;
};

type E2eSetup = {
  fixture: SheetFixture;
  account: { email: string; key: string };
  username: string;
  password: string;
};

function readFixture(): SheetFixture | null {
  try {
    return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as SheetFixture;
  } catch {
    return null;
  }
}

// The key travels as the whole JSON file Google handed out, which is the only
// thing the admin form takes: the address is read from the file.
function readAccount(): { email: string; key: string } | null {
  const file = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  if (file !== undefined && file.trim() !== "") {
    const contents = readFileSync(resolve(file), "utf8");
    const parsed = JSON.parse(contents) as { client_email?: unknown };
    if (typeof parsed.client_email !== "string") return null;
    return { email: parsed.client_email, key: contents };
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? "";
  const key = (process.env.GOOGLE_SERVICE_ACCOUNT_KEY ?? "").replace(/\\n/g, "\n");
  if (email === "" || key === "") return null;
  return { email, key };
}

function e2eSetup(): E2eSetup | null {
  const fixture = readFixture();
  const account = readAccount();
  const username = process.env.USERNAME ?? "";
  const password = process.env.PASSWORD ?? "";
  if (fixture === null || account === null || username === "" || password === "") return null;
  return { fixture, account, username, password };
}

async function signIn(page: Page, setup: E2eSetup): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Username").fill(setup.username);
  await page.getByLabel("Password").fill(setup.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Run report" })).toBeVisible();
}

/**
 * Stores the key and asks Google to sign a token with it. That request runs
 * through the same libraries a report reads a sheet with, so it fails here when
 * the account is wrong instead of midway through the run.
 */
async function storeServiceAccount(page: Page, account: { email: string; key: string }) {
  await page.goto("/admin/service-accounts");
  await expect(page.getByRole("heading", { name: "Service accounts" })).toBeVisible();

  if (await page.getByText("Administrator access required").isVisible()) {
    throw new Error(
      "The account in USERNAME cannot manage service accounts, so the test cannot set one up."
    );
  }

  // A rerun finds the account of the previous run: one row per address, so the
  // key is only checked again.
  const existing = page.getByRole("cell", { name: account.email });
  if ((await existing.count()) === 0) {
    await page.getByRole("button", { name: "Add service account" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Key file (JSON)").fill(account.key);
    await dialog.getByRole("button", { name: "Create service account" }).click();
    await expect(existing).toBeVisible();
  }

  await page
    .getByRole("row", { name: account.email })
    .getByRole("button", { name: "Test" })
    .click();
  await expect(page.getByText("Key accepted")).toBeVisible({ timeout: 30_000 });
}

/** The client whose sheets are read with the account, created once. */
async function linkClientToAccount(page: Page, serviceAccountEmail: string): Promise<void> {
  await page.goto("/admin/clients");
  await page.getByLabel("Search clients").fill(CLIENT_NAME);

  const row = page.getByRole("row", { name: CLIENT_NAME });
  if ((await row.count()) === 0) {
    await page.getByRole("button", { name: "Add client" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Client name").fill(CLIENT_NAME);
    await dialog.getByLabel("Service account").click();
    await page.getByRole("option", { name: serviceAccountEmail }).click();
    await dialog.getByRole("button", { name: "Create client" }).click();
  } else {
    await row.getByRole("button", { name: "Edit" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Service account").click();
    await page.getByRole("option", { name: serviceAccountEmail }).click();
    await dialog.getByRole("button", { name: "Save changes" }).click();
  }

  // What the list shows is the point of the link: the client reads its sheets
  // with the account, not with the app.
  await expect(page.getByRole("row", { name: CLIENT_NAME })).toContainText(serviceAccountEmail);
}

/** The clinic that points at the spreadsheet the fixture created. */
async function createClinic(page: Page, fixture: SheetFixture, clinicName: string): Promise<void> {
  await page.goto("/admin/clinics");
  await page.getByRole("button", { name: "Add clinic" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Clinic name").fill(clinicName);
  await dialog.getByLabel("Client").click();
  await page.getByRole("option", { name: CLIENT_NAME }).click();
  await dialog.getByLabel("Google Sheet URL or ID").fill(fixture.spreadsheetId);
  await dialog.getByLabel("Control Central clinic ID").fill(`e2e-${Date.now()}`);
  await dialog.getByRole("button", { name: "Create clinic" }).click();
  await expect(page.getByRole("row", { name: clinicName })).toBeVisible();
}

/**
 * A run reads the clinics of the signed-in account, so the clinic has to be
 * assigned to it. The dialog holds the whole directory, and the search narrows
 * it to the client the test just made.
 */
async function assignClinic(page: Page, setup: E2eSetup, clinicName: string): Promise<void> {
  await page.goto("/admin");
  await page
    .getByRole("row", { name: setup.username })
    .getByRole("button", { name: "Assignments" })
    .click();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Search clients or clinics").fill(CLIENT_NAME);
  const clinic = dialog.getByLabel(clinicName);
  if (!(await clinic.isChecked())) await clinic.check();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).not.toBeVisible();
}

/**
 * Runs the report over the test clinic alone. The addresses of the run live in
 * the query string, so the form opens on the tab the fixture wrote.
 */
async function runReport(page: Page, fixture: SheetFixture, clinicName: string): Promise<void> {
  await page.goto(`/?startDate=${fixture.tabTitle}&endDate=${fixture.tabTitle}`);

  await page.getByLabel("Report type").click();
  await page.getByRole("option", { name: REPORT_TYPE_NAME }).click();

  // Every clinic the account holds is covered by default, and the run should
  // read the one this test made.
  const clinics = page.locator("section", { hasText: "Included clinics" }).locator("li");
  for (const clinic of await clinics.all()) {
    if ((await clinic.innerText()).trim().startsWith(clinicName)) continue;
    const toggle = clinic.locator('input[type="checkbox"]');
    if (await toggle.isChecked()) await toggle.uncheck();
  }

  await page.getByRole("button", { name: "Run report" }).click();

  // The rows are what the run read from the sheet. A run that could not read it
  // answers with a sheet error instead, which is what makes this the assertion
  // that the service account was used: the app's own account has no access to
  // that spreadsheet.
  for (const marker of fixture.rowMarkers) {
    await expect(page.getByText(marker).first()).toBeVisible({ timeout: 120_000 });
  }
}

test("a report reads a client's sheet with the account linked to it", async ({ page }) => {
  test.setTimeout(180_000);

  const setup = e2eSetup();
  test.skip(
    setup === null,
    "Set USERNAME, PASSWORD and the GOOGLE_SERVICE_ACCOUNT_* values in .env.e2e, and run `pnpm google:test-sheet` first."
  );
  if (setup === null) return;

  const clinicName = `${CLIENT_NAME} clinic ${Date.now()}`;

  await signIn(page, setup);
  await storeServiceAccount(page, setup.account);
  await linkClientToAccount(page, setup.account.email);
  await createClinic(page, setup.fixture, clinicName);
  await assignClinic(page, setup, clinicName);
  await runReport(page, setup.fixture, clinicName);
});
