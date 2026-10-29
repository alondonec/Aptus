// Fusiona dos registros del mismo paciente (mismo número de identificación).
//
// Regla: el registro que se subió DESPUÉS ("incoming") manda campo por campo, y
// el anterior solo aporta lo que el nuevo no trae — así una carga incompleta
// nunca borra datos reales, pero un dato nuevo siempre reemplaza al viejo. El
// único criterio de "más reciente" que Aptus conoce para estas historias es el
// orden de carga, salvo para el examen de función renal, que sí trae la fecha
// del laboratorio (ver pickRenalSource).

const MERGE_FIELDS = [
  'name', 'identification', 'edad', 'fechaNacimiento', 'phone', 'address',
  'imc', 'peso', 'hta', 'dm2', 'erc', 'icc', 'fa', 'uacr', 'fevi', 'eventoCV', 'dementia',
  'pas', 'pad', 'hba1c', 'medicamentos', 'fechaUltimoACV', 'fechaUltimoIAM', 'sexo',
];

// Creatinina, TFG, método y fecha describen UN solo examen: se toman juntos de
// un mismo registro para no mezclar la creatinina de un laboratorio con la TFG
// de otro.
const RENAL_FIELDS = ['creatinina', 'tfg', 'tfgMetodo', 'fechaFuncionRenal'];

const isFilled = (value) => value !== null && value !== undefined && value !== '';

function hasRenalData(patient) {
  return isFilled(patient.creatinina) || isFilled(patient.tfg);
}

/** De cuál de los dos registros sale el bloque renal: el que tenga la fecha de
 * laboratorio más reciente; si no se pueden comparar (falta una fecha o son la
 * misma), el que se subió después. */
function pickRenalSource(existing, incoming) {
  if (!hasRenalData(incoming)) return existing;
  if (!hasRenalData(existing)) return incoming;
  const a = existing.fechaFuncionRenal;
  const b = incoming.fechaFuncionRenal;
  if (isFilled(a) && isFilled(b) && a !== b) return String(a) > String(b) ? existing : incoming;
  return incoming;
}

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

/** Devuelve un paciente fusionado a partir de dos historias del mismo
 * paciente. `incoming` es la que se subió después; `existing` la ya guardada.
 * Los diagnósticos de ambas se concatenan para no perder información clínica. */
export function mergeDuplicatePatients(existing, incoming) {
  const primary = incoming;
  const secondary = existing;

  const merged = {};
  for (const field of MERGE_FIELDS) {
    merged[field] = isFilled(primary[field]) ? primary[field] : secondary[field] ?? null;
  }
  const renalSource = pickRenalSource(existing, incoming);
  for (const field of RENAL_FIELDS) {
    merged[field] = renalSource[field] ?? null;
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
