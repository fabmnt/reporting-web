// Account security and recovery codes.
export const security = {
  pageTitle: "Seguridad",
  title: "Autenticación en dos pasos",
  description:
    "Pide un código de una app de autenticación además de tu contraseña al iniciar sesión.",
  status: {
    on: "Activada",
    off: "Desactivada",
  },
  enable: "Configurar app de autenticación",
  setup: {
    title: "Configura tu app de autenticación",
    description:
      "Escanea el código QR con Google Authenticator, 1Password, Authy u otra app de autenticación, o ingresa la clave manualmente.",
    passwordHint: "Confirma tu contraseña antes de configurar una app de autenticación.",
    keyLabel: "Clave de configuración",
    codeLabel: "Código de la app",
    codeHint: "Ingresa el código de 6 dígitos que la app muestra para esta cuenta.",
    confirm: "Activar",
    restart: "Empezar de nuevo",
  },
  recovery: {
    title: "Guarda tus códigos de recuperación",
    description:
      "Cada código inicia sesión una vez si pierdes tu teléfono. Solo se muestran esta vez.",
    copy: "Copiar códigos",
    copied: "Copiado",
    done: "Listo",
  },
  enabled: {
    remaining: (count: number) =>
      count === 0
        ? "No quedan códigos de recuperación."
        : count === 1
          ? "Queda 1 código de recuperación."
          : `Quedan ${count} códigos de recuperación.`,
    disable: "Desactivar",
  },
  disable: {
    title: "Desactivar la autenticación en dos pasos",
    description: "Ingresa tu contraseña y un código actual de tu app de autenticación.",
    password: "Contraseña",
    code: "Código o código de recuperación",
    confirm: "Desactivar",
  },
  regenerate: {
    title: "Generar nuevos códigos de recuperación",
    description:
      "Ingresa tu contraseña y un código de autenticación o recuperación. Todos los códigos de recuperación anteriores dejarán de funcionar.",
    confirm: "Generar códigos",
  },
  failures: {
    regenerate: "No se pudieron generar nuevos códigos de recuperación.",
    setup: "No se pudo iniciar la configuración.",
    confirm: "No se pudo activar la autenticación en dos pasos.",
    disable: "No se pudo desactivar la autenticación en dos pasos.",
    copy: "No se pudo copiar. Selecciona los códigos y cópialos a mano.",
  },
};
