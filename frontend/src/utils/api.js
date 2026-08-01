// Cliente del API del backend (Express + SQLite). Reemplaza la persistencia
// en localStorage: ahora los pacientes y protocolos viven en la base de
// datos del servidor y sobreviven tanto a un refresco de página como a
// reinicios del backend o cambios de navegador/dispositivo.

export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3002';

async function request(path, options) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch (err) {
    throw new Error(
      `No se pudo conectar con el backend en ${API_BASE}. ¿Está corriendo el servidor? (${err.message})`
    );
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Respuesta inválida del servidor (HTTP ${response.status})`);
  }

  if (!response.ok || data.success === false) {
    throw new Error(data.error || `El servidor respondió con estado ${response.status}`);
  }

  return data;
}

// ---- Sugerencia de palabras clave (IA) ----

export async function suggestKeywords(criterionName) {
  const data = await request('/suggest-keywords', {
    method: 'POST',
    body: JSON.stringify({ criterionName }),
  });
  return data.keywords;
}

// ---- Asistente de preguntas (IA) ----

export async function askAboutData(question, patients) {
  const data = await request('/api/ask', {
    method: 'POST',
    body: JSON.stringify({ question, patients }),
  });
  return { answer: data.answer, costUsd: data.costUsd };
}

// ---- Pacientes ----

export async function fetchPatients() {
  const data = await request('/api/patients');
  return data.patients;
}

export async function createPatient(patient) {
  const data = await request('/api/patients', { method: 'POST', body: JSON.stringify(patient) });
  return data.patient;
}

export async function updatePatientApi(id, patient) {
  const data = await request(`/api/patients/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(patient),
  });
  return data.patient;
}

export async function deletePatientApi(id) {
  await request(`/api/patients/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function deleteAllPatientsApi() {
  await request('/api/patients', { method: 'DELETE' });
}

export async function replacePatientsApi(patients) {
  const data = await request('/api/patients', { method: 'PUT', body: JSON.stringify({ patients }) });
  return data.patients;
}

// ---- Protocolos ----

export async function fetchProtocols() {
  const data = await request('/api/protocols');
  return data.protocols;
}

export async function createProtocol(protocol) {
  const data = await request('/api/protocols', { method: 'POST', body: JSON.stringify(protocol) });
  return data.protocol;
}

export async function updateProtocolApi(id, protocol) {
  const data = await request(`/api/protocols/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(protocol),
  });
  return data.protocol;
}

export async function deleteProtocolApi(id) {
  await request(`/api/protocols/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function replaceProtocolsApi(protocols) {
  const data = await request('/api/protocols', { method: 'PUT', body: JSON.stringify({ protocols }) });
  return data.protocols;
}
