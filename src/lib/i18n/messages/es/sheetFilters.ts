export const sheetFilters = {
  pageTitle: "Aplicar filtro de hoja",
  open: "Filtros de hoja",
  admin: {
    pageTitle: "Filtros de hoja",
    accessDeniedBody: "Tu cuenta no puede gestionar los filtros de hoja.",
    intro:
      "Los operadores aplican estos filtros a las hojas de las clínicas. El nombre del filtro es el nombre de la vista de filtro en cada pestaña de fecha. Si cambias el nombre, las vistas que usaban el nombre anterior se quedan en la hoja.",
    empty: "Aún no hay filtros de hoja.",
    newFilter: "Nuevo filtro",
    createTitle: "Nuevo filtro de hoja",
    createDescription: "Puedes definir sus condiciones después de crearlo.",
    name: "Nombre",
    description: "Descripción",
    conditionsTitle: "Filas que se conservan",
    conditionsNote:
      "Una fila se conserva en la vista solo si cumple todas las condiciones. Sin condiciones, la vista conserva todas las filas.",
    addCondition: "Añadir condición",
    noConditions: "Aún no hay condiciones. La vista conservará todas las filas.",
    save: "Guardar filtro",
    delete: "Eliminar filtro",
    confirmDelete: "¿Eliminar este filtro?",
    deleteNote:
      "Eliminarlo aquí no quita las vistas de filtro que ya se escribieron en las hojas de las clínicas.",
    notices: {
      created: "Filtro creado.",
      saved: "Filtro guardado.",
      deleted: "Filtro eliminado.",
    },
    failures: {
      title: "No se pudo actualizar el filtro",
      create: "No se pudo crear el filtro.",
      save: "No se pudo guardar el filtro.",
      delete: "No se pudo eliminar el filtro.",
    },
  },
  apply: {
    settingsTitle: "Ajustes del filtro",
    settingsDescription: "Elige un filtro, las fechas y las clínicas.",
    filter: "Filtro",
    noFilters: "Aún no hay filtros de hoja. Un administrador tiene que crear uno.",
    dateRange: "Rango de fechas",
    clinics: "Clínicas",
    noAssignedClinics:
      "Aún no tienes clínicas asignadas. Pide a un administrador que asigne clínicas a tu cuenta.",
    selectAll: "Seleccionar todas",
    clear: "Quitar",
    selected: (count: number) => (count === 1 ? "1 clínica" : `${count} clínicas`),
    apply: "Aplicar filtro",
    applyingTitle: "Aplicando el filtro",
    applyingBody: (count: number) =>
      count === 1
        ? "Escribiendo la vista de filtro en 1 clínica."
        : `Escribiendo la vista de filtro en ${count} clínicas.`,
    snapshotNote:
      "La vista conserva las filas que coinciden en el momento en que la aplicas. Vuelve a aplicarla cuando la hoja cambie. La cuenta de Google necesita permiso de edición sobre la hoja.",
    resultsTitle: "Resultado",
    resultsDescription:
      "Cada pestaña de fecha recibe una vista de filtro con el nombre del filtro, que reemplaza a la anterior.",
    emptyResults: "Aplica un filtro para escribirlo en las hojas de las clínicas elegidas.",
    matched: (count: number) =>
      count === 1 ? "1 fila coincidente" : `${count} filas coincidentes`,
    failedTitle: "No se pudo aplicar el filtro",
    failed: "No se pudo aplicar el filtro.",
  },
  formulaTooLong: (rowCount: number) =>
    `El filtro coincide con ${rowCount} filas, demasiadas para guardarlas en una fórmula de Google Sheets.`,
};
