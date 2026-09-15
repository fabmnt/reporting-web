export const reports = {
  pageTitle: "Run report",
  pageDescription:
    "Reads your assigned clinic sheets for the selected dates and applies the same row rules as the desktop tool.",
  loading: {
    page: "Loading report page",
    settings: "Loading report settings",
    results: "Loading results",
  },
  settingsTitle: "Report settings",
  settingsDescription: "Choose what to read and which dates to cover.",
  dateRange: "Date range",
  reportType: "Report type",
  builtIn: "Built-in",
  myReportTypes: "My report types",
  verificationType: "Verification type",
  verificationAll: "All",
  includedClinics: "Included clinics",
  noAssignedClinics: "No clinics assigned yet. Ask an admin to assign clinics to your account.",
  run: "Run report",
  running: "Running report",
  failedTitle: "Report failed",
  outcomes: {
    noAssignedClinics: "No assigned clinics to run.",
    noReportType: "No report type to run.",
    pickDates: "Pick a start and end date.",
    invalidRange: "The start date must be on or before the end date.",
    failed: "The report failed.",
  },
  reading: {
    title: "Reading sheets",
    body: (clinicCount: number) =>
      `Reading ${clinicCount} clinic ${clinicCount === 1 ? "sheet" : "sheets"}. This can take a moment.`,
  },
  empty: {
    title: "No results yet",
    body: "Choose a date range and run a report. Rows appear here, grouped by clinic and sheet tab.",
  },
  results: {
    title: "Results",
    rows: (count: number) => (count === 1 ? "1 row" : `${count} rows`),
    clinics: (count: number) => (count === 1 ? "1 clinic" : `${count} clinics`),
    summary: (clinics: string, startDate: string, endDate: string) =>
      `${clinics}, ${startDate} to ${endDate}. Sheet row numbers match the Google Sheet.`,
    noneProcessed: "No sheets were processed. Check your assigned clinics and the selected dates.",
    sheetError: "Sheet error",
    noMatchingRows: "No matching rows.",
    noTabsFound: (startDate: string, endDate: string) =>
      `No tabs found between ${startDate} and ${endDate}.`,
  },
};
