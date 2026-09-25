export const reports = {
  pageTitle: "Run report",
  configure: "Configure",
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
  noReportTypes:
    "No report types yet. Create one in Configuration, or ask an administrator to share a built-in.",
  run: "Run report",
  running: "Running report",
  cancel: "Cancel run",
  cancelling: "Cancelling report",
  failedTitle: "Report failed",
  cancelled: {
    title: "Report cancelled",
    body: "You stopped this run. The rows it read before stopping are shown below.",
    nothing: "You stopped this run before it read any sheet.",
  },
  outcomes: {
    noAssignedClinics: "No assigned clinics to run.",
    noSelectedClinics: "Select at least one clinic to run.",
    noReportType: "No report type to run.",
    pickDates: "Pick a start and end date.",
    invalidRange: "The start date must be on or before the end date.",
    failed: "The report failed.",
    cancelFailed: "The run could not be cancelled.",
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
  overview: {
    title: "Overview",
    copyFor: (label: string) => `Copy the row numbers of ${label}`,
    copiedFor: (label: string) => `Copied the row numbers of ${label}`,
  },
  inactiveCarriers: {
    title: "Carriers not active",
    note: "Bots the carrier API does not report as active, and bots whose pattern this app cannot run. Check this list to tell a short result from a complete one.",
    patternUnsupported: "Pattern this app cannot run",
  },
  unmatchedCarrierRows: {
    title: "Rows without a matching bot",
    note: "Rows that are pending to execute but no clinic bot can run, so they stay out of the results above.",
    carrier: "Carrier",
  },
  results: {
    title: "Results",
    rows: (count: number) => (count === 1 ? "1 row" : `${count} rows`),
    carriers: "Carriers",
    noneProcessed: "No sheets were processed. Check your assigned clinics and the selected dates.",
    sheetError: "Sheet error",
    noMatchingRows: "No matching rows.",
    noTabsFound: (startDate: string, endDate: string) =>
      `No tabs found between ${startDate} and ${endDate}.`,
  },
};
