import { resolvePatientFlags, detectKeywordPresence } from './nlpEngine';

/**
 * Un paciente con Clasificación Final no vacía (sincronizada desde la Matriz
 * Pre-Screening en Google Sheets — ver POST /api/sync/patient-status) queda
 * excluido de toda evaluación de elegibilidad futura en Aptus, sin importar
 * el protocolo: ya sea porque falleció, ya está vinculado a otro protocolo,
 * o fue excluido por criterio médico/social. Esto se evalúa antes de
 * cualquier criterio de inclusión/exclusión propio del protocolo.
 */
export function getGlobalExclusion(patient) {
  if (!patient?.estadoClasificacion) return null;
  return {
    reason: patient.estadoClasificacion,
    protocolo: patient.estadoProtocoloNombre ?? null,
  };
}

/**
 * Evalúa un único criterio (inclusión o exclusión) contra un paciente
 * ya resuelto (con flags NLP aplicados). Los criterios personalizados
 * (field === 'custom') se evalúan buscando sus palabras clave en el texto
 * de diagnósticos mediante el mismo motor NLP de negaciones.
 */
export function evaluateCriterion(patient, criterion) {
  const label = criterion.label;
  let value;
  let fromNLP = false;

  if (criterion.field === 'custom') {
    value = detectKeywordPresence(patient.diagnostics, criterion.keywords);
    fromNLP = value !== undefined;
  } else {
    value = patient[criterion.field];
    fromNLP = Boolean(patient._nlpSource?.[criterion.field]);
  }

  const suffix = fromNLP ? ' (detectado por NLP en diagnósticos)' : '';
  const isNumericOperator = ['<', '<=', '>', '>='].includes(criterion.operator);

  if (value === null || value === undefined) {
    // Para criterios numéricos (IMC, UACR, FEVI, Edad) sin el dato estructurado,
    // si el criterio tiene palabras clave de respaldo (ej. "obesidad", "sobrepeso"
    // para IMC), se busca esa condición en el texto de diagnósticos. Una mención
    // afirmada implica que el valor numérico está elevado, así que solo satisface
    // el criterio cuando el operador también exige un valor alto (> o >=).
    if (isNumericOperator && criterion.keywords?.length) {
      const keywordResult = detectKeywordPresence(patient.diagnostics, criterion.keywords);
      if (keywordResult !== undefined) {
        const requiresHigh = criterion.operator === '>' || criterion.operator === '>=';
        const pass = keywordResult === requiresHigh;
        const estado = keywordResult ? 'presente' : 'ausente';
        return {
          pass,
          reason: `${label}: sin dato numérico, palabras clave en diagnósticos (${estado}) sugieren que ${
            pass ? 'sí cumple' : 'no cumple'
          } el criterio`,
        };
      }
    }
    // Respaldo específico para IMC: cuando la historia no trae IMC ni talla
    // (así que no se pudo calcular con la fórmula del CDC en el backend), pero
    // sí trae el peso, un peso > 80kg se asume suficiente para cumplir un
    // criterio de IMC que exige un valor alto (>, >=) — regla de negocio
    // explícita, no un cálculo real de IMC.
    if (criterion.field === 'imc' && patient.peso !== null && patient.peso !== undefined) {
      const requiresHigh = criterion.operator === '>' || criterion.operator === '>=';
      if (requiresHigh) {
        const pass = Number(patient.peso) > 80;
        return {
          pass,
          reason: `${label}: sin IMC ni talla, peso registrado (${patient.peso}kg) ${
            pass ? '> 80kg → se asume que cumple' : '≤ 80kg → no se asume que cumple'
          }`,
        };
      }
    }
    return {
      pass: false,
      indeterminate: true,
      reason: `${label}: dato no disponible`,
    };
  }

  switch (criterion.operator) {
    case 'true':
      return value === true
        ? { pass: true, reason: `${label}: presente${suffix}` }
        : { pass: false, reason: `${label}: no registrado como presente${suffix}` };
    case 'false':
      return value === false
        ? { pass: true, reason: `${label}: ausente (correcto)${suffix}` }
        : { pass: false, reason: `${label}: presente (incumple)${suffix}` };
    case '<':
      return Number(value) < Number(criterion.value)
        ? { pass: true, reason: `${label} = ${value} (< ${criterion.value})` }
        : { pass: false, reason: `${label} = ${value} (requiere < ${criterion.value})` };
    case '<=':
      return Number(value) <= Number(criterion.value)
        ? { pass: true, reason: `${label} = ${value} (≤ ${criterion.value})` }
        : { pass: false, reason: `${label} = ${value} (requiere ≤ ${criterion.value})` };
    case '>':
      return Number(value) > Number(criterion.value)
        ? { pass: true, reason: `${label} = ${value} (> ${criterion.value})` }
        : { pass: false, reason: `${label} = ${value} (requiere > ${criterion.value})` };
    case '>=':
      return Number(value) >= Number(criterion.value)
        ? { pass: true, reason: `${label} = ${value} (≥ ${criterion.value})` }
        : { pass: false, reason: `${label} = ${value} (requiere ≥ ${criterion.value})` };
    default:
      return { pass: false, reason: 'Operador de criterio desconocido' };
  }
}

/**
 * Describe en una sola línea el resultado de un grupo, listando cada hijo con
 * su propio ✔/✘ para que se pueda ver exactamente cuál de las condiciones del
 * grupo falló, sin tener que abrir un detalle aparte.
 */
function describeGroupResult(node, childResults, pass) {
  const opLabel = node.logicalOperator === 'OR' ? 'al menos uno de' : 'todos de';
  const title = node.label?.trim() || `Grupo (${opLabel})`;
  const parts = childResults.map((r) => `${r.pass ? '✔' : '✘'} ${r.reason}`);
  return `${title} [${opLabel}]: ${pass ? 'cumple' : 'no cumple'} (${parts.join(' · ')})`;
}

/**
 * Evalúa un nodo del árbol de criterios: una hoja (mismo comportamiento que
 * siempre, vía evaluateCriterion) o un grupo (AND/OR) que combina los
 * resultados de sus hijos recursivamente. Los grupos permiten representar
 * protocolos con lógica del tipo "al menos uno de X, Y, Z" o combinaciones
 * anidadas, algo que una lista plana de criterios no puede expresar.
 */
export function evaluateNode(patient, node) {
  if (node.type === 'group') {
    const childResults = (node.children || []).map((child) => evaluateNode(patient, child));
    const pass = node.logicalOperator === 'OR'
      ? childResults.some((r) => r.pass)
      : childResults.every((r) => r.pass);
    return {
      pass,
      isGroup: true,
      logicalOperator: node.logicalOperator,
      children: childResults,
      reason: describeGroupResult(node, childResults, pass),
    };
  }
  return evaluateCriterion(patient, node);
}

/**
 * Evalúa un paciente contra un protocolo completo, aplicando primero el
 * motor NLP de negaciones para completar campos faltantes.
 */
export function evaluatePatientForProtocol(patient, protocol) {
  const globalExclusion = getGlobalExclusion(patient);
  if (globalExclusion) {
    return {
      apto: false,
      excluded: true,
      exclusionReason: globalExclusion.reason,
      exclusionProtocolo: globalExclusion.protocolo,
      inclusionResults: [],
      exclusionResults: [],
      reasons: [`Excluido: ${globalExclusion.reason}`],
      resolvedPatient: patient,
    };
  }

  const resolved = resolvePatientFlags(patient);

  const inclusionResults = protocol.inclusionCriteria.map((c) => ({
    ...evaluateNode(resolved, c),
    criterion: c,
  }));
  const exclusionResults = protocol.exclusionCriteria.map((c) => ({
    ...evaluateNode(resolved, c),
    criterion: c,
  }));

  const failedInclusion = inclusionResults.filter((r) => !r.pass);
  const triggeredExclusion = exclusionResults.filter((r) => r.pass);

  const apto = failedInclusion.length === 0 && triggeredExclusion.length === 0;

  const reasons = apto
    ? ['Cumple todos los criterios de inclusión sin exclusiones aplicables']
    : [
        ...failedInclusion.map((r) => `✗ ${r.reason}`),
        ...triggeredExclusion.map((r) => `✗ Exclusión: ${r.reason}`),
      ];

  return {
    apto,
    inclusionResults,
    exclusionResults,
    reasons,
    resolvedPatient: resolved,
  };
}
