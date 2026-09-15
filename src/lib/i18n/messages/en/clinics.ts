export const clinics = {
  pageTitle: "Clinics",
  pageDescription:
    "Configure the Google Sheet link and column letters for clinics assigned to you.",
  accessDeniedTitle: "Active staff access required",
  accessDeniedBody: "Your account cannot configure clinics.",
  noneAssigned:
    "No clinics are assigned to you yet. Ask an admin to assign clinics before you can configure them.",
  table: {
    clinic: "Clinic",
    client: "Client",
    googleSheet: "Google Sheet",
    columns: "Columns",
    actions: "Actions",
    configure: "Configure",
  },
  externalId: (id: string) => `External ID ${id}`,
  dialog: {
    configureTitle: (name: string) => `Configure ${name}`,
    configureDescription: "Update the Google Sheet link and column letters for this clinic.",
    sheetLabel: "Google Sheet URL or ID",
    saveFailedTitle: "Could not save clinic",
    saveFailed: "Saving the clinic failed.",
    invalidSheet: "Paste a Google Sheet URL or ID.",
  },
  sheetColumns: {
    title: "Sheet columns",
    note: "Leave a field empty to use the global default shown in the placeholder.",
    updateStatus: "Update status",
    uploadStatus: "Upload status",
    verificationType: "Verification type",
    fileUrl: "Files URLs",
  },
};
