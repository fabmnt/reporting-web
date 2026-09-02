const SPREADSHEET_URL_ID_PATTERN = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/;

/**
 * Extracts the Google Sheet ID from a pasted spreadsheet URL. Input that is
 * already a bare ID is returned unchanged.
 */
export function parseSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  return SPREADSHEET_URL_ID_PATTERN.exec(trimmed)?.[1] ?? trimmed;
}
