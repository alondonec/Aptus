// Convierte una fila arbitraria proveniente de un archivo Excel/CSV externo
// (columnas variables, nombres no estandarizados) en el modelo de paciente
// de Aptus, mediante coincidencia flexible de nombres de columna comunes.

export function normalizeKey(key) {
  return String(key)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

function findValue(row, candidates) {
  const keys = Object.keys(row);
  for (const candidate of candidates) {
    const match = keys.find((k) => normalizeKey(k) === candidate);
    if (match && row[match] !== '' && row[match] !== undefined) return row[match];
  }
  return null;
}

function parseNumber(raw) {
  return raw !== null && raw !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : null;
}

// Interpreta valores booleanos tal como suelen venir en hojas de cálculo
// (Sí/No, Verdadero/Falso, 1/0, X) en vez de asumir que siempre son true/false.
function parseBooleanValue(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const v = normalizeKey(String(raw));
  if (['si', 'true', 'verdadero', '1', 'yes', 'y', 'x', 'positivo'].includes(v)) return true;
  if (['no', 'false', 'falso', '0', 'n', 'negativo'].includes(v)) return false;
  return null;
}

export function normalizeExternalPatient(row) {
  return {
    name: findValue(row, ['nombre', 'name', 'paciente']) ?? 'Sin nombre',
    identification: findValue(row, [
      'identificacion',
      'cedula',
      'documento',
      'cc',
    ]),
    edad: parseNumber(findValue(row, ['edad', 'age'])),
    phone: findValue(row, ['telefono', 'celular', 'phone']),
    address: findValue(row, ['direccion', 'address']),
    imc: parseNumber(findValue(row, ['imc', 'indice de masa corporal', 'bmi'])),
    hta: parseBooleanValue(findValue(row, ['hta', 'hipertension', 'hipertension arterial'])),
    dm2: parseBooleanValue(findValue(row, ['dm2', 'diabetes', 'diabetes tipo 2', 'diabetes mellitus'])),
    erc: parseBooleanValue(findValue(row, ['erc', 'enfermedad renal cronica'])),
    icc: parseBooleanValue(findValue(row, ['icc', 'insuficiencia cardiaca'])),
    fa: parseBooleanValue(findValue(row, ['fa', 'fibrilacion auricular'])),
    uacr: parseNumber(findValue(row, ['uacr'])),
    fevi: parseNumber(findValue(row, ['fevi'])),
    eventoCV: parseBooleanValue(
      findValue(row, ['eventocv', 'evento cv', 'evento cardiovascular', 'evento cardiovascular previo'])
    ),
    dementia: parseBooleanValue(findValue(row, ['demencia'])),
    diagnostics: findValue(row, ['diagnostico', 'diagnosticos', 'diagnostico(s)']),
    fechaIngreso: new Date().toISOString().slice(0, 10),
    source: 'externa',
  };
}
