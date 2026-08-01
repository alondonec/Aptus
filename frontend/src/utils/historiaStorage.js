// Persiste en localStorage los resultados ya procesados de Historias
// Clínicas, para que la tabla sobreviva a un refresco de página (el estado
// en memoria de React se pierde en cada recarga). Solo se guardan los items
// terminados (done/error): los que estaban subiéndose al momento de la
// recarga no se pueden retomar, así que se descartan silenciosamente.

const ITEMS_KEY = 'aptus_historia_items';
const SENT_IDS_KEY = 'aptus_historia_sent_ids';
const LOTES_KEY = 'aptus_historia_lotes';

export function loadHistoriaItems() {
  try {
    const raw = localStorage.getItem(ITEMS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveHistoriaItems(items) {
  try {
    const persistable = items
      .filter((it) => it.status === 'done' || it.status === 'error')
      .map((it) => ({
        id: it.id,
        loteId: it.loteId,
        fileName: it.fileName,
        fileSize: it.fileSize,
        status: it.status,
        progress: it.progress,
        patient: it.patient,
        error: it.error,
        splitInto: it.splitInto,
        costUsd: it.costUsd,
      }));
    localStorage.setItem(ITEMS_KEY, JSON.stringify(persistable));
  } catch {
    // Si el almacenamiento está lleno o no disponible, se pierde la
    // persistencia entre recargas pero la app sigue funcionando en memoria.
  }
}

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
    // ver nota en saveHistoriaItems
  }
}

export function loadHistoriaLotes() {
  try {
    const raw = localStorage.getItem(LOTES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveHistoriaLotes(lotes) {
  try {
    localStorage.setItem(LOTES_KEY, JSON.stringify(lotes));
  } catch {
    // ver nota en saveHistoriaItems
  }
}

export function clearHistoriaStorage() {
  localStorage.removeItem(ITEMS_KEY);
  localStorage.removeItem(SENT_IDS_KEY);
  localStorage.removeItem(LOTES_KEY);
}
