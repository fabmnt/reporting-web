export const conditions = {
  pageTitle: "Configuración",
  pageDescription:
    "Crea los tipos de reporte que ejecutas. Un tipo decide qué filas de la hoja devuelve cada reporte.",
  backToReports: "Volver a los reportes",
  accessDeniedTitle: "Se requiere acceso de personal activo",
  accessDeniedBody: "Tu cuenta no puede editar los tipos de reporte.",
  updateFailedTitle: "No se pudo actualizar el tipo de reporte",
  updatedTitle: "Actualizado",
  reportType: "Tipo de reporte",
  newReportType: "Nuevo tipo de reporte",
  noneMine:
    "Aún no tienes tipos de reporte. Crea uno para ejecutarlo con tus propias reglas de filas.",
  noneBuiltin:
    "Aún no hay tipos de reporte integrados. Crea uno para compartirlo con todas las cuentas.",
  sharedNote: "Todos ejecutan este tipo de reporte. Solo los administradores pueden cambiarlo.",
  appliesNote: "Este tipo de reporte se aplica a todas tus clínicas asignadas.",
  changesNote:
    "Los cambios se aplican a todas las clínicas y a los reportes que ejecutes desde ahora.",
  firstMatchDescription: "Una fila entra en el primer grupo que coincide con ella.",
  dropDescription: "Las filas que no coinciden quedan fuera del reporte.",
  verificationFilter: "Filtrar por tipo de verificación",
  verificationFilterNote:
    "Muestra el selector de verificación en el formulario del reporte. El valor elegido allí restringe todos los grupos de filas.",
  confirmDelete: "Confirmar eliminación",
  deleteType: "Eliminar tipo de reporte",
  saveType: "Guardar tipo de reporte",
  notices: {
    saved: "Tipo de reporte guardado.",
    deleted: "Tipo de reporte eliminado.",
    created: "Tipo de reporte creado.",
  },
  failures: {
    saveType: "No se pudo guardar el tipo de reporte.",
    deleteType: "No se pudo eliminar el tipo de reporte.",
    createType: "No se pudo crear el tipo de reporte.",
  },
  newType: {
    title: "Nuevo tipo de reporte",
    description: "Crea reglas de filas sobre las hojas de las clínicas.",
    name: "Nombre",
    namePlaceholder: "Verificaciones tardías",
    nameTakenNote:
      "Otro tipo de reporte ya usa este nombre. Ambos aparecen en el formulario del reporte.",
    startingPoint: "Punto de partida",
    templateBlank: "Empezar vacío",
    templateCopyNote: "Copiar te inicia con las reglas del tipo de reporte seleccionado.",
    createFailedTitle: "No se pudo crear el tipo de reporte",
    creating: "Creando",
    create: "Crear tipo de reporte",
  },
  editor: {
    name: "Nombre",
    description: "Descripción",
    rowGroups: "Grupos de filas",
    rowGroupsNote:
      "Una fila entra en el primer grupo que coincide con ella. Solo el último grupo de un tipo con varios grupos puede capturar todo.",
    group: (index: number) => `Grupo ${index + 1}`,
    moveUp: (index: number) => `Subir el grupo ${index + 1}`,
    moveDown: (index: number) => `Bajar el grupo ${index + 1}`,
    removeGroup: (index: number) => `Eliminar el grupo ${index + 1}`,
    addRowGroup: "Añadir grupo de filas",
  },
  rowGroup: "Grupo de filas",
  bucket: {
    allConditions: "Todas las condiciones",
    anyCondition: "Cualquier condición",
    alwaysApply: "Aplicar siempre",
    alwaysApplyNote:
      "Todas las condiciones de aquí deben coincidir para que una fila entre en este grupo.",
    addCondition: "Añadir condición",
    clauseLimit: (max: number) =>
      `Esta lista ya tiene el máximo de ${max} condiciones. Elimina una para añadir otra.`,
    matchAny: "Coincidir con cualquiera de estos grupos",
    matchAnyNote: "Al menos un grupo debe coincidir. Deja la lista vacía para ignorar los grupos.",
    groupMatch: (index: number) => `Coincidencia del grupo ${index + 1}`,
    groupLimit: (max: number) =>
      `Esta lista de grupos ya tiene el máximo de ${max} entradas. Elimina una para añadir otra.`,
    addGroup: "Añadir grupo",
    catchAllTitle: "Capturar todas las filas restantes",
    catchAllNote:
      "Toda fila que ningún grupo anterior haya tomado entra aquí. Las condiciones de arriba se ignoran.",
    noConditionsTitle: "Este grupo no tiene condiciones",
    noConditionsNote:
      "Toda fila que llegue a este grupo entra aquí. Añade una condición si quieres que sea más restrictivo.",
  },
  clause: {
    column: "Columna",
    operator: "Operador",
    remove: "Eliminar condición",
    values: "Valores",
    emptyNegated: "Sin valores: esta condición coincide con todas las filas.",
    emptyPositive: "Sin valores: esta condición no coincide con ninguna fila.",
  },
  markers: {
    remove: (value: string) => `Eliminar ${value}`,
    placeholder: "Escribe un valor y pulsa Enter",
    limit: (max: number) =>
      `Esta regla ya tiene el máximo de ${max} valores. Elimina uno para añadir otro.`,
  },
  columns: {
    L: "Ejecución (columna L)",
    M: "Mensaje (columna M)",
    updateStatus: "Estado de actualización",
    uploadStatus: "Estado de subida",
    verificationType: "Tipo de verificación",
    fileUrl: "URL del archivo",
  },
  operators: {
    contains: "Contiene alguno de",
    notContains: "No contiene ninguno de",
    equals: "Es uno de",
    notEquals: "No es uno de",
    isEmpty: "Está vacío",
    isNotEmpty: "No está vacío",
  },
};
