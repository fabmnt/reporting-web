export const reports = {
  pageTitle: "Ejecutar reporte",
  pageDescription:
    "Lee las hojas de tus clínicas asignadas para las fechas elegidas y aplica las mismas reglas de filas que la herramienta de escritorio.",
  configure: "Configurar",
  loading: {
    page: "Cargando la página del reporte",
    settings: "Cargando la configuración del reporte",
    results: "Cargando resultados",
  },
  settingsTitle: "Configuración del reporte",
  settingsDescription: "Elige qué leer y qué fechas cubrir.",
  dateRange: "Rango de fechas",
  reportType: "Tipo de reporte",
  builtIn: "Integrados",
  myReportTypes: "Mis tipos de reporte",
  verificationType: "Tipo de verificación",
  verificationAll: "Todos",
  includedClinics: "Clínicas incluidas",
  noAssignedClinics:
    "Aún no tienes clínicas asignadas. Pide a un administrador que te asigne clínicas.",
  noReportTypes:
    "Aún no hay tipos de reporte. Crea uno en Configuración o pide a un administrador que comparta uno integrado.",
  run: "Ejecutar reporte",
  running: "Ejecutando reporte",
  failedTitle: "El reporte falló",
  outcomes: {
    noAssignedClinics: "No hay clínicas asignadas para ejecutar.",
    noReportType: "No hay ningún tipo de reporte para ejecutar.",
    pickDates: "Elige una fecha de inicio y una de fin.",
    invalidRange: "La fecha de inicio debe ser anterior o igual a la fecha de fin.",
    failed: "El reporte falló.",
  },
  reading: {
    title: "Leyendo hojas",
    body: (clinicCount: number) =>
      `Leyendo ${clinicCount} ${clinicCount === 1 ? "hoja de clínica" : "hojas de clínicas"}. Esto puede tardar un momento.`,
  },
  empty: {
    title: "Aún no hay resultados",
    body: "Elige un rango de fechas y ejecuta un reporte. Las filas aparecen aquí, agrupadas por clínica y pestaña de la hoja.",
  },
  results: {
    title: "Resultados",
    rows: (count: number) => (count === 1 ? "1 fila" : `${count} filas`),
    clinics: (count: number) => (count === 1 ? "1 clínica" : `${count} clínicas`),
    summary: (clinics: string, startDate: string, endDate: string) =>
      `${clinics}, de ${startDate} a ${endDate}. Los números de fila coinciden con la hoja de Google.`,
    noneProcessed:
      "No se procesó ninguna hoja. Revisa tus clínicas asignadas y las fechas elegidas.",
    sheetError: "Error en la hoja",
    noMatchingRows: "No hay filas coincidentes.",
    noTabsFound: (startDate: string, endDate: string) =>
      `No se encontraron pestañas entre ${startDate} y ${endDate}.`,
  },
};
