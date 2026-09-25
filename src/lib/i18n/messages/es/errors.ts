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
  CLIENT_NOT_FOUND: "No se encontró el cliente.",
  CLIENT_DISABLED: "Este cliente está deshabilitado.",
  CLIENT_NOT_ASSIGNED: "Este cliente no está asignado a tu cuenta.",
  SERVICE_ACCOUNT_NOT_FOUND: "Esta cuenta de servicio ya no existe.",
  SERVICE_ACCOUNT_LIMIT: (limit: number) =>
    `Puedes guardar hasta ${limit} cuentas de servicio. Elimina una antes de añadir otra.`,
  SERVICE_ACCOUNT_EMAIL_INVALID:
    "El correo dentro del archivo de clave no es una dirección válida.",
  SERVICE_ACCOUNT_EMAIL_TAKEN: "Otra cuenta de servicio ya usa este correo.",
  SERVICE_ACCOUNT_KEY_REQUIRED: "La clave de la cuenta de servicio es obligatoria.",
  SERVICE_ACCOUNT_KEY_INVALID:
    "Esto no es un archivo de clave de cuenta de servicio. Pega el archivo JSON que te dio Google.",
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
  CARRIER_ID_REQUIRED: "El ID de la clínica en Control Central es obligatorio.",
  INVALID_DATE_RANGE: "La fecha de inicio debe ser anterior o igual a la fecha de fin.",
  INVALID_DATE_FORMAT: "Las fechas deben usar el formato AAAA-MM-DD.",
  REPORT_TYPE_NAME_TAKEN: (name: string) => `Ya existe un tipo de reporte llamado "${name}".`,
  REPORT_TYPE_NOT_FOUND: "Este tipo de reporte no existe.",
  REPORT_TYPE_NAME_REQUIRED: "El tipo de reporte necesita un nombre.",
  REPORT_TYPE_GROUP_REQUIRED: "Un tipo de reporte necesita al menos un grupo de filas.",
  REPORT_TYPE_GROUP_LIMIT: (limit: number) =>
    `Un tipo de reporte admite hasta ${limit} grupos de filas.`,
  REPORT_TYPE_GROUP_KEYS: "Las claves de los grupos de filas deben ser únicas y no estar vacías.",
  REPORT_GROUP_NOT_FOUND: "Este grupo de reportes no existe.",
  REPORT_GROUP_NAME_REQUIRED: "El grupo de reportes necesita un nombre.",
  REPORT_GROUP_NAME_TAKEN: (name: string) => `Ya existe un grupo de reportes llamado "${name}".`,
  REPORT_GROUP_EMPTY: "Elige al menos un cliente o una clínica para el grupo.",
  REPORT_GROUP_MEMBER_LIMIT: (limit: number) =>
    `Un grupo de reportes admite hasta ${limit} clientes y clínicas.`,
  REPORT_GROUP_LIMIT: (limit: number) => `Puedes guardar hasta ${limit} grupos de reportes.`,
  REPORT_RUN_NOT_FOUND: "Esta ejecución de reporte ya no está disponible.",
  REPORT_RUN_ALREADY_STARTED: "Esta ejecución de reporte ya se había iniciado.",
  SHEET_NO_TABS: (startDate: string, endDate: string) =>
    `No se encontraron pestañas entre ${startDate} y ${endDate}.`,
  SHEET_INVALID_COLUMN: (column: string) =>
    `Columna de hoja no válida "${column}". Usa letras como A, T o AB.`,
  SHEET_RATE_LIMITED:
    "Google limitó la velocidad de nuestras solicitudes. Espera un minuto e inténtalo de nuevo.",
  SHEET_SERVICE_ACCOUNT_MISSING:
    "La cuenta de servicio que lee las hojas de este cliente ya no existe. Pide a un administrador que vincule otra.",
  SHEET_SERVICE_ACCOUNT_DENIED: (email: string) =>
    `La cuenta de servicio ${email} no tiene acceso a la hoja. Comparte la hoja con ese correo.`,
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
