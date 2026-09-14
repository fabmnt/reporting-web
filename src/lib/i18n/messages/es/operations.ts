// Labels of the built-in report operations. The keys are the operation keys
// the backend stores and sends, so a new operation shows up here as a missing
// translation instead of a wrong label.
export const operations = {
  "pending-audit": {
    label: "Auditoría pendiente",
    description: "Filas marcadas como hechas que aún esperan la revisión de auditoría.",
    buckets: { audit: "Auditoría pendiente" },
  },
  "pending-execution": {
    label: "Ejecución pendiente",
    description: "Filas que esperan ejecutarse contra los datos de la aseguradora.",
    buckets: {},
  },
  "smilist-filters": {
    label: "Filtros de Smilist",
    description: "Reconstruye las vistas de filtros de QA para las hojas de Smilist.",
    buckets: {},
  },
  "luna-formulas": {
    label: "Fórmulas de Luna",
    description: "Aplica las reglas de formato condicional de Luna.",
    buckets: {},
  },
  "diva-formulas": {
    label: "Fórmulas de Diva",
    description: "Aplica las reglas de formato condicional de Diva.",
    buckets: {},
  },
  "depot-row-highlight": {
    label: "Resaltado de filas de Depot",
    description: "Colorea las filas de Depot según el estado de verificación.",
    buckets: {},
  },
};
