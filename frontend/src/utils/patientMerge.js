// Fusiona dos registros del mismo paciente (mismo número de identificación)
// tomando, campo por campo, el dato disponible de cualquiera de las dos
// historias — en vez de sobrescribir a ciegas una con la otra, lo que antes
// podía borrar información real con valores vacíos de una carga incompleta.

const MERGE_FIELDS = [
  'name', 'identification', 'edad', 'fechaNacimiento', 'phone', 'address',
  'imc', 'peso', 'hta', 'dm2', 'erc', 'icc', 'fa', 'uacr', 'fevi', 'eventoCV', 'dementia',
  'creatinina', 'tfg', 'pas', 'pad', 'hba1c', 'medicamentos', 'fechaUltimoACV', 'fechaUltimoIAM',
  'sexo', 'tfgMetodo', 'fechaFuncionRenal',
];

function wordSet(text) {
  return new Set(
    String(text)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2)
  );
}

/** Dos textos de diagnósticos casi idénticos (≥ 90 % de palabras en común) son
 * la misma historia extraída dos veces — por ejemplo al volver a cargar un PDF
 * para completar los datos nuevos — y no deben concatenarse: eso duplicaría
 * todo el texto del paciente. */
function isNearDuplicateText(a, b) {
  const wordsA = wordSet(a);
  const wordsB = wordSet(b);
  if (!wordsA.size || !wordsB.size) return false;
  let shared = 0;
  for (const w of wordsA) if (wordsB.has(w)) shared += 1;
  return shared / (wordsA.size + wordsB.size - shared) >= 0.9;
}

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
  if (diagnosticsParts.length === 2 && isNearDuplicateText(diagnosticsParts[0], diagnosticsParts[1])) {
    // Misma historia extraída dos veces: se conserva la versión más completa.
    diagnosticsParts.splice(
      0,
      2,
      wordSet(diagnosticsParts[1]).size > wordSet(diagnosticsParts[0]).size ? diagnosticsParts[1] : diagnosticsParts[0]
    );
  }
  merged.diagnostics = diagnosticsParts.length ? diagnosticsParts.join(' ') : null;

  merged.fechaIngreso = incoming.fechaIngreso || existing.fechaIngreso;
  merged.source = incoming.source || existing.source;

  return merged;
}
