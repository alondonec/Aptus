// Motor NLP simple de detección de negaciones clínicas.
// Analiza el texto libre de diagnósticos e infiere el valor booleano de
// condiciones cuando el campo estructurado no fue diligenciado (null/undefined).

import { getPatientAge } from './patientAge';

const CONDITION_KEYWORDS = {
  hta: ['hta', 'hipertensión arterial', 'hipertension arterial', 'hipertenso', 'hipertensa'],
  dm2: ['dm2', 'diabetes mellitus tipo 2', 'diabetes tipo 2', 'diabetes mellitus', 'diabético', 'diabetica'],
  erc: ['erc', 'enfermedad renal crónica', 'enfermedad renal cronica', 'insuficiencia renal'],
  icc: ['icc', 'insuficiencia cardíaca', 'insuficiencia cardiaca', 'falla cardíaca', 'falla cardiaca'],
  fa: ['fa', 'fibrilación auricular', 'fibrilacion auricular'],
  eventoCV: ['evento cardiovascular', 'infarto', 'accidente cerebrovascular', 'acv', 'ictus'],
  dementia: ['demencia', 'deterioro cognitivo'],
};

const NEGATION_MARKERS = [
  'niega',
  'no presenta',
  'sin antecedentes de',
  'sin antecedente de',
  'descarta',
  'ausencia de',
  'no tiene',
  'negativo para',
];

const AFFIRMATION_MARKERS = [
  'presenta',
  'antecedente de',
  'antecedentes de',
  'diagnosticado con',
  'diagnosticada con',
  'diagnosticada',
  'diagnosticado',
  'positivo para',
  'con historia de',
  'de difícil control',
];

// Quita tildes/diacríticos y pasa a minúsculas, para que "cardiomiopatía" y
// "CARDIOMIOPATIA" (como suelen venir extraídas de los PDF, sin tildes)
// se traten como el mismo texto al buscar palabras clave. Antes de este
// arreglo, una palabra clave con tilde nunca coincidía con el mismo término
// sin tilde en el texto, lo que producía "sin dato" en pacientes que sí
// tenían la condición mencionada explícitamente.
function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

const NORMALIZED_NEGATION_MARKERS = NEGATION_MARKERS.map(normalizeText);
const NORMALIZED_AFFIRMATION_MARKERS = AFFIRMATION_MARKERS.map(normalizeText);

/**
 * Determina si un conjunto de palabras clave está afirmado o negado dentro
 * de un texto clínico, evaluando oración por oración. Es el núcleo del motor
 * NLP y se reutiliza tanto para las condiciones predefinidas como para los
 * criterios personalizados que defina el usuario.
 * @param {string} text
 * @param {string[]} keywords
 * @returns {boolean | undefined} true (afirmado) | false (negado) | undefined (no mencionado)
 */
export function detectKeywordPresence(text, keywords) {
  if (!text || typeof text !== 'string') return undefined;
  const cleanKeywords = (keywords || []).map(normalizeText).filter(Boolean);
  if (!cleanKeywords.length) return undefined;

  const lower = normalizeText(text);
  // Un punto entre dígitos (ej. "IMC 29.38") no es un final de oración real,
  // así que no se corta ahí para no fragmentar valores numéricos.
  const sentences = lower.split(/[;\n]|\.(?!\d)/);
  let result;

  for (const sentence of sentences) {
    const mentioned = cleanKeywords.some((kw) => sentence.includes(kw));
    if (!mentioned) continue;

    const negated = NORMALIZED_NEGATION_MARKERS.some((marker) => sentence.includes(marker));
    const affirmed = NORMALIZED_AFFIRMATION_MARKERS.some((marker) => sentence.includes(marker));

    if (negated) {
      result = false;
    } else if (affirmed) {
      result = true;
    } else if (result === undefined) {
      // Mención simple sin marcador explícito: se asume afirmación clínica.
      result = true;
    }
  }

  return result;
}

/**
 * Detecta condiciones predefinidas mencionadas en un texto clínico y
 * determina si están negadas o afirmadas según el contexto de la oración.
 * @param {string} text
 * @returns {Record<string, boolean>}
 */
export function inferFlagsFromText(text) {
  const result = {};
  for (const [field, keywords] of Object.entries(CONDITION_KEYWORDS)) {
    const value = detectKeywordPresence(text, keywords);
    if (value !== undefined) {
      result[field] = value;
    }
  }
  return result;
}

/**
 * Devuelve una copia del paciente con los campos booleanos null/undefined
 * completados a partir del texto de diagnósticos, marcando el origen del dato.
 */
export function resolvePatientFlags(patient) {
  const inferred = inferFlagsFromText(patient.diagnostics);
  const resolved = { ...patient, _nlpSource: {} };

  // La edad de los criterios se evalúa siempre a partir de la fecha de
  // nacimiento cuando está disponible, para que cambie con el tiempo en vez
  // de quedar fija en el valor extraído el día de la carga.
  resolved.edad = getPatientAge(patient);

  for (const field of Object.keys(inferred)) {
    if (resolved[field] === null || resolved[field] === undefined) {
      resolved[field] = inferred[field];
      resolved._nlpSource[field] = true;
    }
  }

  return resolved;
}
