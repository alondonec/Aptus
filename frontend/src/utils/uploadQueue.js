import { API_BASE } from './api';

const EXTRACT_ENDPOINT = `${API_BASE}/extract-pdf`;
const HEALTH_ENDPOINT = `${API_BASE}/health`;

// Cuando el servidor no responde (se reinició, se quedó sin memoria o está
// desplegando una versión nueva) no tiene sentido marcar cada PDF como error al
// instante: la cola entera esperaba a un servidor caído y quemaba todos los
// archivos pendientes en segundos. Ahora todos los PDFs en proceso esperan juntos
// a que /health vuelva a responder y reintentan. Es un objeto para poder
// ajustarlo en las pruebas.
export const retryConfig = {
  maxRetries: 4,
  backendWaitMs: 5 * 60 * 1000, // cuánto se espera a que vuelva el servidor
  healthPollMs: 5000,
  giveUpCooldownMs: 2 * 60 * 1000, // tras rendirse, los PDFs siguientes fallan sin esperar de nuevo
};

// 502/503/504 son las respuestas del proxy mientras la instancia se reinicia.
const TRANSIENT_STATUS = new Set([502, 503, 504]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Ejecuta `worker` sobre `items` respetando un límite de concurrencia. */
export async function runWithConcurrency(items, limit, worker) {
  let index = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (index < items.length) {
      const current = index++;
      await worker(items[current], current);
    }
  });
  await Promise.all(runners);
}

async function isBackendUp() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(HEALTH_ENDPOINT, { cache: 'no-store', signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// La espera es compartida: si 5 PDFs fallan a la vez, solo hay un sondeo a
// /health y los 5 se reanudan juntos cuando el servidor responde.
let backendGate = null;
let gaveUpAt = 0;

/** Espera a que el backend responda. Devuelve true si volvió, false si pasó
 * el tiempo máximo. */
export function waitForBackend() {
  if (backendGate) return backendGate;
  const gate = (async () => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < retryConfig.backendWaitMs) {
      if (await isBackendUp()) return true;
      await sleep(retryConfig.healthPollMs);
    }
    return false;
  })();
  backendGate = gate;
  gate.finally(() => {
    if (backendGate === gate) backendGate = null;
  });
  return gate;
}

/** Un solo intento de subida vía XHR (para poder reportar progreso). Si falla
 * por algo que se arregla esperando (sin conexión o proxy reiniciando) lo marca
 * con `transient: true`; cualquier otra respuesta del servidor se devuelve tal cual. */
function attemptUpload(file, onProgress) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('file', file);

    xhr.open('POST', EXTRACT_ENDPOINT);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (TRANSIENT_STATUS.has(xhr.status)) {
        resolve({ transient: true });
        return;
      }
      try {
        resolve(JSON.parse(xhr.responseText));
      } catch {
        resolve({ success: false, error: `Respuesta inválida del servidor (HTTP ${xhr.status})` });
      }
    };

    xhr.onerror = () => resolve({ transient: true });

    onProgress(0);
    xhr.send(formData);
  });
}

/** Sube un PDF a /extract-pdf, reintentando si el servidor no responde.
 * `onRetry({ attempt, max })` avisa a la pantalla de cada reintento. */
export async function uploadAndExtract(file, onProgress, onRetry) {
  for (let attempt = 0; ; attempt += 1) {
    const result = await attemptUpload(file, onProgress);
    if (!result.transient) return result;

    const waited =
      retryConfig.backendWaitMs >= 60000
        ? `${Math.round(retryConfig.backendWaitMs / 60000)} minutos`
        : `${Math.round(retryConfig.backendWaitMs / 1000)} segundos`;
    if (attempt >= retryConfig.maxRetries) {
      return {
        success: false,
        error: `No se pudo conectar con el backend en ${API_BASE} tras ${attempt + 1} intentos. Usa "Reintentar fallidas" cuando el servidor esté de nuevo disponible.`,
      };
    }
    if (Date.now() - gaveUpAt < retryConfig.giveUpCooldownMs) {
      return {
        success: false,
        error: `El backend en ${API_BASE} sigue sin responder. Usa "Reintentar fallidas" cuando vuelva.`,
      };
    }

    onRetry?.({ attempt: attempt + 1, max: retryConfig.maxRetries });
    const backIsUp = await waitForBackend();
    if (!backIsUp) {
      gaveUpAt = Date.now();
      return {
        success: false,
        error: `El backend en ${API_BASE} no respondió en ${waited}. Usa "Reintentar fallidas" cuando vuelva.`,
      };
    }
    // Pequeño retraso distinto por PDF para que no lleguen los 5 de golpe.
    await sleep(500 + Math.random() * 2500 + attempt * 1000);
  }
}
