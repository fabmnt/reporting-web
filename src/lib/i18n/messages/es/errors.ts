// One entry per backend error code. Entries that take data receive the values
// the backend sent with the code, already resolved by src/lib/i18n/errors.ts.
export const errors = {
  UNAUTHENTICATED: "Inicia sesión para continuar.",
  INVALID_CREDENTIALS: "Usuario o contraseña incorrectos.",
  INVALID_USERNAME:
    "El nombre de usuario debe tener entre 3 y 32 caracteres y usar solo letras, números, puntos, guiones o guiones bajos.",
  TOO_MANY_FAILED_ATTEMPTS: "Demasiados intentos fallidos. Inténtalo de nuevo más tarde.",
  ACCOUNT_ALREADY_EXISTS: "Ese nombre de usuario ya está en uso.",
  ADMIN_REQUIRED: "Se requiere acceso de administrador.",
  ACTIVE_STAFF_REQUIRED: "Se requiere una cuenta de personal activa.",
  OPERATOR_REQUIRED: "Se requiere acceso de operador.",
  USER_RECORD_MISSING: "No se encontró el registro del usuario autenticado.",
  PROFILE_NOT_FOUND: "No se encontró el perfil del usuario.",
  CANNOT_CHANGE_OWN_ROLE: "No puedes cambiar tu propio rol.",
  CANNOT_DISABLE_SELF: "No puedes deshabilitar tu propia cuenta.",
  PASSWORD_TOO_SHORT: "La contraseña debe tener al menos 8 caracteres.",
  PASSWORD_SETUP_LINK_INVALID: "Este enlace ya no es válido. Pídele a un administrador uno nuevo.",
  SELECTED_CLINIC_NOT_FOUND: "No se encontró una de las clínicas seleccionadas.",
  CLIENT_NOT_FOUND: "No se encontró el cliente.",
  CLIENT_DISABLED: "Este cliente está deshabilitado.",
  CLINIC_NOT_FOUND: "No se encontró la clínica.",
  CLINIC_NOT_ASSIGNED: "Esta clínica no está asignada a tu cuenta.",
  CLINIC_ASSIGNMENT_LIMIT: (limit: number) =>
    `Puedes trabajar en hasta ${limit} clínicas. Quita una antes de añadir otra.`,
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
  INVALID_DATE_FORMAT: "Las fechas deben usar el formato AAAA-MM-DD.",
  REPORT_TYPE_NAME_TAKEN: (name: string) => `Ya existe un tipo de reporte llamado "${name}".`,
  REPORT_TYPE_NOT_FOUND: "Este tipo de reporte no existe.",
  REPORT_TYPE_NAME_REQUIRED: "El tipo de reporte necesita un nombre.",
  REPORT_TYPE_GROUP_REQUIRED: "Un tipo de reporte necesita al menos un grupo de filas.",
  REPORT_TYPE_GROUP_LIMIT: (limit: number) =>
    `Un tipo de reporte admite hasta ${limit} grupos de filas.`,
  REPORT_TYPE_GROUP_KEYS: "Las claves de los grupos de filas deben ser únicas y no estar vacías.",
  SHEET_NO_TABS: (startDate: string, endDate: string) =>
    `No se encontraron pestañas entre ${startDate} y ${endDate}.`,
  SHEET_INVALID_COLUMN: (column: string) =>
    `Columna de hoja no válida "${column}". Usa letras como A, T o AB.`,
  SHEET_RATE_LIMITED:
    "Google limitó la velocidad de nuestras solicitudes. Espera un minuto e inténtalo de nuevo.",
  CARRIER_SIGN_IN_REJECTED:
    "La API de carriers rechazó las credenciales de la aplicación. Pide a un administrador que las revise.",
  CARRIER_API_UNAVAILABLE: "La API de carriers no respondió. Inténtalo de nuevo en un momento.",
  SHEET_CARRIER_ID_MISSING:
    "Esta clínica no tiene id de Control Central, así que no se pueden leer sus carriers.",
  SHEET_CARRIER_ACCESS_DENIED: "La API de carriers no da acceso a la aplicación a esta clínica.",
  SHEET_CARRIER_CLINIC_UNKNOWN: "La API de carriers no conoce esta clínica.",
  SHEET_CARRIER_UNAVAILABLE:
    "La API de carriers no respondió para esta clínica. Inténtalo de nuevo en un momento.",
  SHEET_NO_CARRIER_BOTS:
    "Esta clínica no tiene ningún bot de carriers que el reporte pueda ejecutar.",
};
