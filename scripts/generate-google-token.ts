/**
 * One-time OAuth consent flow to get a Google refresh token for the
 * Sheets backend.
 *
 * Log in with the Google account that already has access to the clinic
 * spreadsheets. The script starts a local server, opens the consent page,
 * receives the authorization code, exchanges it for tokens, and prints
 * the `npx convex env set` commands to store everything in the Convex
 * deployment.
 *
 * Requires an OAuth client ID of type "Desktop app" from the Google
 * Cloud project that has the Sheets API enabled. Desktop clients accept
 * loopback redirects on any port, so no redirect URI setup is needed.
 * Web application clients must register http://127.0.0.1:3117 as an
 * authorized redirect URI instead.
 *
 * Run with: pnpm google:token [account-email]
 *
 * Pass the email when you have several Google accounts, so the consent
 * page preselects the one that has access to the spreadsheets.
 */
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SHEETS_READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const REDIRECT_PORT = 3117;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}`;
const CONSENT_TIMEOUT_MS = 5 * 60 * 1000;

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

function fail(message: string): never {
  console.error(`\nError: ${message}`);
  process.exit(1);
}

function openBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(command, [url], { detached: true, stdio: "ignore" })
    .on("error", () => {})
    .unref();
}

function buildAuthUrl(clientId: string, state: string, loginHint?: string): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SHEETS_READONLY_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  if (loginHint) {
    url.searchParams.set("login_hint", loginHint);
  }
  return url.toString();
}

function waitForAuthorizationCode(authUrl: string, expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", REDIRECT_URI);
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      if (error) {
        res.end("<p>Authorization failed. You can close this tab.</p>");
        server.close();
        reject(new Error(`Google returned "${error}" during the consent flow`));
        return;
      }
      if (!code || state !== expectedState) {
        res.statusCode = 400;
        res.end("<p>Invalid callback. You can close this tab.</p>");
        return;
      }

      res.end("<p>Token received. You can close this tab and go back to the terminal.</p>");
      server.close();
      resolve(code);
    });

    server.on("error", (err) =>
      reject(new Error(`Could not listen on ${REDIRECT_URI}: ${err.message}`))
    );

    server.listen(REDIRECT_PORT, "127.0.0.1", () => {
      console.log(
        `\nOpening the consent page. If no browser opens, visit this URL:\n\n${authUrl}\n`
      );
      openBrowser(authUrl);
    });

    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for Google's redirect (5 minutes)"));
    }, CONSENT_TIMEOUT_MS);
    timeout.unref();
  });
}

async function exchangeCodeForTokens(
  code: string,
  clientId: string,
  clientSecret: string
): Promise<TokenResponse> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  return (await response.json()) as TokenResponse;
}

function printResult(tokens: TokenResponse, clientId: string, clientSecret: string): void {
  if (tokens.error) {
    fail(`Token exchange failed: ${tokens.error_description ?? tokens.error}`);
  }
  if (!tokens.refresh_token) {
    fail(
      "Google did not return a refresh token. Make sure the OAuth client is valid and try again."
    );
  }

  console.log(`
Refresh token obtained. Store the credentials in the Convex deployment:

  npx convex env set GOOGLE_REFRESH_TOKEN ${tokens.refresh_token}
  npx convex env set GOOGLE_OAUTH_CLIENT_ID ${clientId}
  npx convex env set GOOGLE_OAUTH_CLIENT_SECRET ${clientSecret}

The token gives read-only access to every spreadsheet your account can open.
Revoke it any time at https://myaccount.google.com/permissions.

Reminder: if the OAuth consent screen is in "Testing" status, this token
expires after 7 days. Set the app's publishing status to "In production".
`);
}

async function main(): Promise<void> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    fail(
      "Missing GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET.\n" +
        'Create an OAuth client ID of type "Desktop app" in the Google Cloud project,\n' +
        "add the credentials to .env.local, then run:\n" +
        "  pnpm google:token"
    );
  }

  const loginHint = process.argv[2];
  if (loginHint && !loginHint.includes("@")) {
    fail(`"${loginHint}" does not look like an email. Usage: pnpm google:token [account-email]`);
  }

  const state = randomBytes(16).toString("hex");
  const authUrl = buildAuthUrl(clientId, state, loginHint);
  const code = await waitForAuthorizationCode(authUrl, state);
  const tokens = await exchangeCodeForTokens(code, clientId, clientSecret);
  printResult(tokens, clientId, clientSecret);
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
