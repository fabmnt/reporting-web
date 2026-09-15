export const clinics = {
  pageTitle: "Clínicas",
  accessDeniedTitle: "Se requiere acceso de personal activo",
  accessDeniedBody: "Tu cuenta no puede configurar clínicas.",
  noneAssigned:
    "Aún no tienes clínicas asignadas. Pide a un administrador que te asigne clínicas antes de configurarlas.",
  table: {
    clinic: "Clínica",
    client: "Cliente",
    googleSheet: "Hoja de Google",
    columns: "Columnas",
    actions: "Acciones",
    configure: "Configurar",
  },
  externalId: (id: string) => `ID externo ${id}`,
  dialog: {
    configureTitle: (name: string) => `Configurar ${name}`,
    configureDescription:
      "Actualiza el enlace de la hoja de Google y las letras de columna de esta clínica.",
    sheetLabel: "URL o ID de la hoja de Google",
    saveFailedTitle: "No se pudo guardar la clínica",
    saveFailed: "No se pudo guardar la clínica.",
    invalidSheet: "Pega una URL o un ID de hoja de Google.",
  },
  sheetColumns: {
    title: "Columnas de la hoja",
    note: "Deja un campo vacío para usar el valor predeterminado global que se muestra en el marcador.",
    updateStatus: "Estado de actualización",
    uploadStatus: "Estado de subida",
    verificationType: "Tipo de verificación",
    fileUrl: "URLs de archivos",
  },
};
