// Normaliza una identificación (cédula/documento) para poder comparar el
// mismo paciente aunque venga con prefijos de tipo de documento, espacios o
// guiones distintos entre Historias Clínicas, BD Externa y Base Maestra.
// Se descarta cualquier letra (no solo símbolos) porque las cédulas/NIT
// colombianas son numéricas — cualquier letra que quede es un prefijo de
// tipo de documento (CC, TI, CE...), y si dos cargas del mismo paciente
// difieren solo en ese prefijo (ej. una extraída antes de quitarlo
// automáticamente y otra después), antes se trataban como personas
// distintas y nunca se fusionaban.
export function normalizeIdentification(value) {
  return String(value ?? '').replace(/[^0-9]/g, '');
}

/** Busca, dentro de una lista de pacientes ya cargados, uno cuya
 * identificación normalizada coincida con la indicada. */
export function findPatientByIdentification(patients, identification) {
  const target = normalizeIdentification(identification);
  if (!target) return null;
  return patients.find((p) => normalizeIdentification(p.identification) === target) || null;
}
