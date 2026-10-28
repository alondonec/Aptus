// Función renal: cuando la historia trae creatinina sérica pero no una TFG
// reportada por el laboratorio, Aptus la calcula aquí con la ecuación
// CKD-EPI 2021 (sin coeficiente de raza). El modelo de extracción nunca la
// calcula: una fórmula fija en código es verificable y repetible.

const CKD_EPI_2021_LABEL = 'CKD-EPI 2021 (calculada)';

/** CKD-EPI 2021, creatinina en mg/dL → mL/min/1.73m². Solo es válida para
 * adultos y necesita el sexo; devuelve null si falta algo. */
function ckdEpi2021({ creatinina, sexo, edad }) {
  const scr = Number(creatinina);
  const age = Number(edad);
  if (!(scr > 0) || !Number.isFinite(age) || age < 18) return null;
  if (sexo !== 'F' && sexo !== 'M') return null;

  const female = sexo === 'F';
  const kappa = female ? 0.7 : 0.9;
  const alpha = female ? -0.241 : -0.302;
  const ratio = scr / kappa;
  const egfr =
    142 *
    Math.min(ratio, 1) ** alpha *
    Math.max(ratio, 1) ** -1.2 *
    0.9938 ** age *
    (female ? 1.012 : 1);
  return Math.round(egfr * 10) / 10;
}

/** Fecha de referencia de un valor "YYYY", "YYYY-MM" o "YYYY-MM-DD". Cuando
 * está incompleta se usa la mitad del periodo: para calcular una edad en años
 * la diferencia es despreciable. */
function parsePartialDate(text) {
  const match = String(text ?? '').match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/);
  if (!match) return null;
  return new Date(Number(match[1]), match[2] ? Number(match[2]) - 1 : 6, match[3] ? Number(match[3]) : 15);
}

function yearsBetween(from, to) {
  let years = to.getFullYear() - from.getFullYear();
  const beforeBirthday =
    to.getMonth() < from.getMonth() || (to.getMonth() === from.getMonth() && to.getDate() < from.getDate());
  if (beforeBirthday) years -= 1;
  return years;
}

/** Edad con la que se calcula la TFG: la que tenía el paciente el día del
 * laboratorio si se conocen su fecha de nacimiento y la fecha del examen; si
 * no, su edad de hoy; y como último recurso la edad escrita en la historia. */
function ageForRenalCalc(patient, now) {
  const birth = parsePartialDate(patient.fechaNacimiento);
  if (birth) {
    const labDate = parsePartialDate(patient.fechaFuncionRenal);
    return yearsBetween(birth, labDate && labDate <= now ? labDate : now);
  }
  const fallback = Number(patient.edad);
  return Number.isFinite(fallback) ? fallback : null;
}

/** Si el paciente no tiene TFG pero sí creatinina, sexo y edad, la calcula y
 * deja anotado el método para que no se confunda con una TFG reportada. */
function applyTfgFallback(patient, now = new Date()) {
  if (!patient || (patient.tfg !== null && patient.tfg !== undefined)) return patient;
  if (patient.creatinina === null || patient.creatinina === undefined) return patient;

  const tfg = ckdEpi2021({
    creatinina: patient.creatinina,
    sexo: patient.sexo,
    edad: ageForRenalCalc(patient, now),
  });
  if (tfg !== null && tfg >= 1 && tfg <= 200) {
    patient.tfg = tfg;
    patient.tfgMetodo = CKD_EPI_2021_LABEL;
  }
  return patient;
}

module.exports = { ckdEpi2021, applyTfgFallback, CKD_EPI_2021_LABEL };
