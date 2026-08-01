// Identificador de "bloque" usado para agrupar historias que se cargaron
// antes de que existiera el concepto de bloques de carga (no tienen loteId
// propio). Se centraliza acá porque varios componentes (HistoriasClinicas,
// Dashboard, MatrizCompatibilidad, App) necesitan usar exactamente el mismo
// valor para agrupar/filtrar/fusionar bloques de forma consistente.
export const LEGACY_LOTE_ID = '__legacy__';
