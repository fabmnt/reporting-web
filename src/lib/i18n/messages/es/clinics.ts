export const clinics = {
  pageTitle: "Clínicas",
  accessDeniedTitle: "Se requiere una cuenta de personal activa",
  accessDeniedBody: "Tu cuenta no puede configurar clínicas.",
  noneAssigned: "Aún no tienes clínicas asignadas. Añade las clínicas en las que trabajas.",
  noneAssignedByAdmin:
    "Aún no tienes clínicas asignadas. Pídele a un administrador que las asigne.",
  assignedByAdmin: "Un administrador asigna las clínicas en las que trabajas.",
  addClinic: "Añadir clínica",
  addFailedTitle: "No se pudo añadir la clínica",
  addFailed: "No se pudo añadir la clínica.",
  removeFailedTitle: "No se pudo quitar la clínica",
  removeFailed: "No se pudo quitar la clínica.",
  addDialog: {
    title: "Añadir clínicas",
    description:
      "Elige las clínicas en las que ejecutas reportes. Permanecen en tu cuenta hasta que las quites.",
    search: "Buscar clínicas",
    noneAvailable: "Todas las clínicas activas ya están en tu cuenta.",
    noMatches: "Ninguna clínica coincide con esta búsqueda.",
    limit: (limit: number) => `Mostrando las primeras ${limit} clínicas. Puede que falten algunas.`,
  },
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
