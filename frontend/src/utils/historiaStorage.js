// Las historias clínicas y sus bloques de carga viven en el backend (ver
// utils/api.js: fetchHistoriaItems/replaceHistoriaItemsApi y equivalentes de
// lotes) para que se vean igual sin importar el navegador o entorno. Lo único
// que sigue en localStorage es el set de IDs ya enviados a Base Maestra: es
// solo una caché local para no repetir la sugerencia de envío, no un dato que
// deba sobrevivir entre dispositivos.

const SENT_IDS_KEY = 'aptus_historia_sent_ids';

export function loadHistoriaSentIds() {
  try {
    const raw = localStorage.getItem(SENT_IDS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

export function saveHistoriaSentIds(sentIds) {
  try {
    localStorage.setItem(SENT_IDS_KEY, JSON.stringify(Array.from(sentIds)));
  } catch {
    // Si el almacenamiento está lleno o no disponible, se pierde la caché
    // entre recargas pero la app sigue funcionando en memoria.
  }
}

export function clearHistoriaStorage() {
  localStorage.removeItem(SENT_IDS_KEY);
}
