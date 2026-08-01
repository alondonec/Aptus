import { API_BASE } from './api';

const EXTRACT_ENDPOINT = `${API_BASE}/extract-pdf`;

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

/** Sube un PDF vía XHR (para poder reportar progreso) y llama a /extract-pdf. */
export function uploadAndExtract(file, onProgress) {
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
      try {
        const data = JSON.parse(xhr.responseText);
        resolve(data);
      } catch {
        resolve({ success: false, error: `Respuesta inválida del servidor (HTTP ${xhr.status})` });
      }
    };

    xhr.onerror = () => {
      resolve({
        success: false,
        error: `No se pudo conectar con el backend en ${API_BASE}. ¿Está corriendo el servidor?`,
      });
    };

    xhr.send(formData);
  });
}
