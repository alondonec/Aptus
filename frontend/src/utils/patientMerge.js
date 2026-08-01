// Fusiona dos registros del mismo paciente (mismo número de identificación)
// tomando, campo por campo, el dato disponible de cualquiera de las dos
// historias — en vez de sobrescribir a ciegas una con la otra, lo que antes
// podía borrar información real con valores vacíos de una carga incompleta.

const MERGE_FIELDS = [
  'name', 'identification', 'edad', 'fechaNacimiento', 'phone', 'address',
  'imc', 'hta', 'dm2', 'erc', 'icc', 'fa', 'uacr', 'fevi', 'eventoCV', 'dementia',
];

function countFilledFields(patient) {
  return MERGE_FIELDS.filter(
    (f) => patient[f] !== null && patient[f] !== undefined && patient[f] !== ''
  ).length;
}

/** Devuelve un paciente fusionado a partir de dos historias del mismo
 * paciente: para cada campo usa el valor de la historia más completa (más
 * campos diligenciados) y solo recurre a la otra cuando esa está vacía.
 * Los diagnósticos de ambas se concatenan para no perder información clínica. */
export function mergeDuplicatePatients(existing, incoming) {
  const primary = countFilledFields(incoming) >= countFilledFields(existing) ? incoming : existing;
  const secondary = primary === incoming ? existing : incoming;

  const merged = {};
  for (const field of MERGE_FIELDS) {
    const primaryValue = primary[field];
    merged[field] = primaryValue !== null && primaryValue !== undefined && primaryValue !== ''
      ? primaryValue
      : secondary[field] ?? null;
  }

  const diagnosticsParts = [primary.diagnostics, secondary.diagnostics]
    .filter((d) => d && String(d).trim())
    .filter((d, i, arr) => arr.indexOf(d) === i); // sin duplicar texto idéntico
  merged.diagnostics = diagnosticsParts.length ? diagnosticsParts.join(' ') : null;

  merged.fechaIngreso = incoming.fechaIngreso || existing.fechaIngreso;
  merged.source = incoming.source || existing.source;

  return merged;
}
