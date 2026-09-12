// One entry per backend error code. Entries that take data receive the values
// the backend sent with the code, already resolved by src/lib/i18n/errors.ts.
export const errors = {
  UNAUTHENTICATED: "Inicia sesión para continuar.",
  ADMIN_REQUIRED: "Se requiere acceso de administrador.",
  ACTIVE_STAFF_REQUIRED: "Se requiere una cuenta de personal activa.",
  OPERATOR_REQUIRED: "Se requiere acceso de operador.",
  USER_RECORD_MISSING: "No se encontró el registro del usuario autenticado.",
  PROFILE_NOT_FOUND: "No se encontró el perfil del usuario.",
  CANNOT_CHANGE_OWN_ROLE: "No puedes cambiar tu propio rol.",
  CANNOT_DISABLE_SELF: "No puedes deshabilitar tu propia cuenta.",
  SELECTED_CLINIC_NOT_FOUND: "No se encontró una de las clínicas seleccionadas.",
  CLIENT_NOT_FOUND: "No se encontró el cliente.",
  CLIENT_DISABLED: "Este cliente está deshabilitado.",
  CLINIC_NOT_FOUND: "No se encontró la clínica.",
  CLINIC_NOT_ASSIGNED: "Esta clínica no está asignada a tu cuenta.",
  INVALID_SHEET_COLUMN: (column: string) =>
    `Columna de hoja no válida "${column}". Usa letras como A, T o AB.`,
  CLINIC_NAME_TAKEN: "Ya existe una clínica con este nombre para este cliente.",
  CLIENT_NAME_TAKEN: "Ya existe un cliente con este nombre.",
  CLIENT_NAME_INVALID: "El nombre del cliente debe contener letras o números.",
  GOOGLE_SHEET_TAKEN: "Otra clínica ya usa esta hoja de Google.",
  CLIENT_HAS_CLINICS: (clientName: string, clinicCount: number) =>
    `${clientName} todavía tiene ${clinicCount} ${clinicCount === 1 ? "clínica" : "clínicas"}. Muévelas o elimínalas primero.`,
  CLIENT_NAME_REQUIRED: "El nombre del cliente es obligatorio.",
  CLINIC_NAME_REQUIRED: "El nombre de la clínica es obligatorio.",
  GOOGLE_SHEET_REQUIRED: "El ID de la hoja de Google es obligatorio.",
  INVALID_DATE_RANGE: "La fecha de inicio debe ser anterior o igual a la fecha de fin.",
  OPERATION_NOT_CONFIGURED: (label: string) =>
    `Todavía no hay condiciones definidas para "${label}".`,
  OPERATION_NOT_SUPPORTED: (label: string) => `"${label}" todavía no admite condiciones.`,
  REPORT_TYPE_NAME_TAKEN: (name: string) => `Ya tienes un tipo de reporte llamado "${name}".`,
  REPORT_TYPE_NOT_FOUND: "Este tipo de reporte no existe.",
  REPORT_TYPE_NAME_REQUIRED: "El tipo de reporte necesita un nombre.",
  REPORT_TYPE_GROUP_REQUIRED: "Un tipo de reporte necesita al menos un grupo de filas.",
  REPORT_TYPE_GROUP_LIMIT: (limit: number) =>
    `Un tipo de reporte admite hasta ${limit} grupos de filas.`,
  REPORT_TYPE_GROUP_KEYS: "Las claves de los grupos de filas deben ser únicas y no estar vacías.",
  BUCKET_KEYS_MISMATCH: (label: string, expected: string) =>
    `Los grupos de filas de "${label}" deben ser exactamente ${expected}.`,
  SHEET_NO_TABS: (startDate: string, endDate: string) =>
    `No se encontraron pestañas entre ${startDate} y ${endDate}.`,
  SHEET_INVALID_COLUMN: (column: string) =>
    `Columna de hoja no válida "${column}". Usa letras como A, T o AB.`,
};
