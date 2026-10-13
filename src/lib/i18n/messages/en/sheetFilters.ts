export const sheetFilters = {
  pageTitle: "Apply sheet filter",
  open: "Sheet filters",
  admin: {
    pageTitle: "Sheet filters",
    accessDeniedBody: "Your account cannot manage sheet filters.",
    intro:
      "Operators apply these filters to clinic sheets. The filter name becomes the name of the filter view on each date tab. Renaming a filter leaves views that used the previous name on the sheet.",
    empty: "No sheet filters yet.",
    newFilter: "New filter",
    createTitle: "New sheet filter",
    createDescription: "You can set its conditions after creating it.",
    name: "Name",
    description: "Description",
    conditionsTitle: "Rows to keep",
    conditionsNote:
      "A row stays in the view only when every condition matches. With no conditions, the view keeps every row.",
    addCondition: "Add condition",
    noConditions: "No conditions yet. The view will keep every row.",
    save: "Save filter",
    delete: "Delete filter",
    confirmDelete: "Delete this filter?",
    deleteNote: "Deleting it here does not remove filter views already written to clinic sheets.",
    notices: {
      created: "Filter created.",
      saved: "Filter saved.",
      deleted: "Filter deleted.",
    },
    failures: {
      title: "Could not update the filter",
      create: "Creating the filter failed.",
      save: "Saving the filter failed.",
      delete: "Deleting the filter failed.",
    },
  },
  apply: {
    settingsTitle: "Filter settings",
    settingsDescription: "Choose a filter, the dates, and the clinics.",
    filter: "Filter",
    noFilters: "No sheet filters yet. An administrator has to create one.",
    dateRange: "Date range",
    clinics: "Clinics",
    noAssignedClinics: "No clinics assigned yet. Ask an admin to assign clinics to your account.",
    selectAll: "Select all",
    clear: "Clear",
    selected: (count: number) => (count === 1 ? "1 clinic" : `${count} clinics`),
    apply: "Apply filter",
    applyingTitle: "Applying the filter",
    applyingBody: (count: number) =>
      count === 1
        ? "Writing the filter view on 1 clinic."
        : `Writing the filter view on ${count} clinics.`,
    snapshotNote:
      "The view keeps the rows that match at the moment you apply it. Apply it again after the sheet changes. The Google account needs edit access to the sheet.",
    resultsTitle: "Result",
    resultsDescription:
      "Each date tab gets a filter view with the filter's name, replacing the previous one.",
    emptyResults: "Apply a filter to write it onto the selected clinic sheets.",
    matched: (count: number) => (count === 1 ? "1 matching row" : `${count} matching rows`),
    failedTitle: "Could not apply the filter",
    failed: "Applying the filter failed.",
  },
  formulaTooLong: (rowCount: number) =>
    `The filter matches ${rowCount} rows, which is too many to store in one Google Sheets formula.`,
  tooManyRows: (rowCount: number) =>
    `This tab has at least ${rowCount} rows. Rows after that would stay visible, so the tab was left unchanged.`,
};
