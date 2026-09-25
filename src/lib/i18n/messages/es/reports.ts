export const reports = {
  pageTitle: "Ejecutar reporte",
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
  groups: {
    title: "Grupos de reportes",
    manage: "Administrar grupos",
    none: "Aún no hay grupos de reportes. Crea uno para guardar un conjunto de clientes y clínicas.",
    clinicsTitle: "Clínicas",
    clinicsInGroups: "Clínicas de los grupos seleccionados",
    count: (count: number) => (count === 1 ? "1 clínica" : `${count} clínicas`),
    manager: {
      title: "Grupos de reportes",
      description:
        "Guarda los clientes y las clínicas sobre los que ejecutas un reporte, para volver a elegirlos.",
      newGroup: "Nuevo grupo",
      empty: "Aún no tienes grupos de reportes.",
      deleteTitle: (name: string) => `¿Eliminar "${name}"?`,
      deleteDescription:
        "El grupo se elimina. Las clínicas y los clientes que contiene se quedan como están.",
      formCreateTitle: "Nuevo grupo de reportes",
      formEditTitle: "Editar grupo de reportes",
      formDescription: "El grupo es solo tuyo. Marca clientes completos, clínicas sueltas o ambos.",
      name: "Nombre del grupo",
      namePlaceholder: "ej. Lote de septiembre",
      members: "Clientes y clínicas",
      membersHint:
        "Marcar un cliente incluye todas sus clínicas, también las que se añadan después.",
      noClinics: "Aún no hay clínicas asignadas para agrupar.",
      covered: (covered: number, total: number) => `${covered} de ${total} clínicas incluidas.`,
      create: "Crear grupo",
      saveFailedTitle: "No se pudo guardar el grupo",
      saveFailed: "Falló el guardado del grupo.",
    },
  },
  noReportTypes:
    "Aún no hay tipos de reporte. Crea uno en Configuración o pide a un administrador que comparta uno integrado.",
  run: "Ejecutar reporte",
  running: "Ejecutando reporte",
  cancel: "Cancelar ejecución",
  cancelling: "Cancelando la ejecución",
  failedTitle: "El reporte falló",
  cancelled: {
    title: "Reporte cancelado",
    body: "Detuviste esta ejecución. Las filas que se leyeron antes de detenerla aparecen abajo.",
    nothing: "Detuviste esta ejecución antes de que leyera alguna hoja.",
  },
  outcomes: {
    noAssignedClinics: "No hay clínicas asignadas para ejecutar.",
    noSelectedClinics: "Selecciona al menos una clínica para ejecutar.",
    noReportType: "No hay ningún tipo de reporte para ejecutar.",
    pickDates: "Elige una fecha de inicio y una de fin.",
    invalidRange: "La fecha de inicio debe ser anterior o igual a la fecha de fin.",
    failed: "El reporte falló.",
    cancelFailed: "No se pudo cancelar la ejecución.",
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
  overview: {
    title: "Resumen",
    copyAll: "Copiar resumen",
    copiedAll: "Resumen copiado",
    copyFor: (label: string) => `Copiar los números de fila de ${label}`,
    copiedFor: (label: string) => `Se copiaron los números de fila de ${label}`,
  },
  inactiveCarriers: {
    title: "Carriers no activos",
    note: "Bots que la API de carriers no reporta como activos, y bots cuyo patrón esta aplicación no puede ejecutar. Revisa esta lista para distinguir un resultado corto de uno completo.",
    patternUnsupported: "Patrón que esta aplicación no puede ejecutar",
  },
  unmatchedCarrierRows: {
    title: "Filas sin un bot que coincida",
    note: "Filas pendientes de ejecutar que ningún bot de la clínica puede ejecutar, por eso quedan fuera de los resultados de arriba.",
    carrier: "Carrier",
  },
  results: {
    title: "Resultados",
    rows: (count: number) => (count === 1 ? "1 fila" : `${count} filas`),
    carriers: "Carriers",
    noneProcessed:
      "No se procesó ninguna hoja. Revisa tus clínicas asignadas y las fechas elegidas.",
    sheetError: "Error en la hoja",
    readWithAppAccount: "Lectura con la cuenta de Google de la aplicación",
    readWithServiceAccount: (email: string) => `Lectura con la cuenta de servicio ${email}`,
    fallbackTitle: "Lectura con la cuenta de la aplicación",
    fallbackDenied: (email: string) =>
      `La cuenta de servicio ${email} no pudo leer esta hoja, así que se leyó con la cuenta de Google de la aplicación. Comparte la hoja con ese correo.`,
    fallbackKeyRefused: (email: string) =>
      `Google rechazó la clave de la cuenta de servicio ${email}, así que la hoja se leyó con la cuenta de Google de la aplicación. Pide a un administrador que reemplace su clave.`,
    fallbackMissing:
      "La cuenta de servicio vinculada a este cliente ya no existe, así que la hoja se leyó con la cuenta de Google de la aplicación. Pide a un administrador que vincule otra.",
    noMatchingRows: "No hay filas coincidentes.",
    noTabsFound: (startDate: string, endDate: string) =>
      `No se encontraron pestañas entre ${startDate} y ${endDate}.`,
  },
};
