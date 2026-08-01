/**
 * Aptus — sincronización de estado del paciente desde Google Sheets.
 *
 * Qué hace:
 * 1) "Generar Listas de Trabajo": lee la hoja "Matriz Pre-Selección" y, por
 *    cada paciente con "Filtro Médico" asignado, lo copia (si no está ya) a
 *    una hoja dedicada "Matriz Pre-Screening - {Protocolo}".
 * 2) "Sincronizar con Aptus": recorre todas las hojas
 *    "Matriz Pre-Screening - *", toma la Clasificación Final (y campos
 *    relacionados) de cada paciente, los escribe en la hoja protegida
 *    "Base de Datos Maestra", y los envía al backend de Aptus.
 *
 * Instalación (hacerlo una sola vez):
 *   1. Abre el Google Sheet → Extensiones → Apps Script.
 *   2. Borra el contenido de Code.gs y pega este archivo completo.
 *   3. Ejecuta una vez la función `protegerColumnasEstado` (menú ▶ arriba,
 *      elige esa función) para proteger las columnas de estado en
 *      "Base de Datos Maestra" — Apps Script pedirá autorización la primera
 *      vez, acéptala.
 *   4. Ve a Configuración del proyecto (ícono de engranaje) → Propiedades
 *      del script → agrega una propiedad `APTUS_API_KEY` con el valor que
 *      te dio Claude (el mismo que se configuró en Render como
 *      SHEETS_SYNC_API_KEY). NUNCA la pegues directamente en el código.
 *   5. Recarga el Google Sheet (F5) — debería aparecer un menú "Aptus" nuevo
 *      junto a Archivo/Edición/etc.
 *
 * Importante: pruébalo primero sobre una COPIA del archivo (Archivo → Hacer
 * una copia). Este script no se pudo probar en un entorno real de Apps
 * Script — revisa los resultados de la primera corrida antes de usarlo con
 * los datos reales.
 */

// ---- Configuración ----

const APTUS_API_URL = 'https://aptus-ddxq.onrender.com/api/sync/patient-status';
const MASTER_SHEET_NAME = 'Matriz Pre-Selección';
const BASE_MAESTRA_SHEET_NAME = 'Base de Datos Maestra';
const WORKLIST_PREFIX = 'Matriz Pre-Screening - ';

// Columnas base que se copian tal cual desde "Matriz Pre-Selección" hacia
// cada hoja de trabajo por protocolo (deben existir con estos nombres
// exactos en el encabezado de esa hoja).
const BASE_COLUMNS = [
  'Nombre', 'Identificacion', 'Edad', 'Telefono', 'Direccion', 'IMC', 'HTA',
  'DM2', 'ERC', 'ICC', 'FA', 'UACR', 'FEVI', 'EventoCV', 'Demencia',
  'Diagnosticos', 'FechaIngreso', 'Origen', 'Fuente',
];

// Columnas de trabajo nuevas en cada "Matriz Pre-Screening - {Protocolo}",
// además de las BASE_COLUMNS de arriba.
const WORKLIST_COLUMNS = [
  'Filtro Médico',
  'Comentarios Médico',
  'Comentarios Post-Contacto',
  'Screening (Sí/No)',
  'Fecha Screening',
  'Aleatorización (Sí/No)',
  'Fecha Aleatorización',
  'Motivo de no Aleatorización',
  'Apto para Otro Protocolo (Sí/No)',
  'Clasificación Final',
];

// Categorías planas de Clasificación Final. "{PROTOCOLO}" se sustituye por
// el nombre real del protocolo al crear cada hoja.
const CLASIFICACION_FINAL_OPCIONES = [
  'Criterio Social: Vive fuera de la ciudad',
  'Criterio Social: No red de apoyo',
  'Criterio Social: No contactable',
  'Criterio Social: Acceso inseguro a domicilio',
  'Estado vital: Fallecido',
  'Estado vital: Vivo con dependencia total',
  'Estado vital: Vivo con baja expectativa de vida',
  'Estado vital: Vivo con enfermedad psiquiátrica no controlada',
  'Estado vital: Vivo con cáncer',
  'Criterio Clínico: No cumple criterio de inclusión',
  'Criterio Clínico: Cumple criterios de exclusión',
  'Aleatorizado protocolo ({PROTOCOLO})',
  'Falla de Screening',
];

// Columnas de estado agregadas a "Base de Datos Maestra" (protegidas).
const ESTADO_COLUMNS_BASE_MAESTRA = ['Estado', 'Comentario Estado', 'Apto para Otro Protocolo'];

// ---- Menú ----

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Aptus')
    .addItem('Generar Listas de Trabajo', 'generarListasDeTrabajo')
    .addItem('Sincronizar con Aptus', 'sincronizarConAptus')
    .addSeparator()
    .addItem('Proteger columnas de Estado (una sola vez)', 'protegerColumnasEstado')
    .addToUi();
}

// ---- Utilidades ----

function headerIndexMap_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  headers.forEach((h, i) => {
    if (h) map[String(h).trim()] = i; // 0-based
  });
  return map;
}

function normalizeId_(value) {
  return String(value || '').replace(/[^0-9a-zA-Z]/g, '').toLowerCase();
}

function getApiKey_() {
  const key = PropertiesService.getScriptProperties().getProperty('APTUS_API_KEY');
  if (!key) {
    throw new Error(
      'Falta configurar APTUS_API_KEY en Configuración del proyecto → Propiedades del script.'
    );
  }
  return key;
}

// Detecta las columnas de protocolo en "Matriz Pre-Selección": son las que
// están entre "Fuente" y "Filtro Médico" en el encabezado.
function getProtocolColumns_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const startIdx = headers.indexOf('Fuente') + 1;
  const endIdx = headers.indexOf('Filtro Médico');
  if (startIdx <= 0 || endIdx < 0 || endIdx <= startIdx) {
    throw new Error('No se encontraron las columnas "Fuente" y/o "Filtro Médico" en Matriz Pre-Selección.');
  }
  return headers.slice(startIdx, endIdx);
}

function sheetNameForProtocol_(protocolo) {
  return `${WORKLIST_PREFIX}${protocolo}`;
}

// ---- 1) Generar Listas de Trabajo ----

function generarListasDeTrabajo() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const master = ss.getSheetByName(MASTER_SHEET_NAME);
  if (!master) throw new Error(`No se encontró la hoja "${MASTER_SHEET_NAME}".`);

  const protocolos = getProtocolColumns_(master);
  const idx = headerIndexMap_(master);
  const colFiltroMedico = idx['Filtro Médico'];
  const colIdentificacion = idx['Identificacion'];
  if (colFiltroMedico === undefined || colIdentificacion === undefined) {
    throw new Error('Faltan columnas "Filtro Médico" o "Identificacion" en Matriz Pre-Selección.');
  }

  // Dropdown de Filtro Médico limitado a los protocolos reales de la hoja,
  // para evitar valores libres/ambiguos (ej. abreviaturas) que no se puedan
  // mapear de forma confiable a una hoja de trabajo.
  const filtroRange = master.getRange(2, colFiltroMedico + 1, Math.max(master.getLastRow() - 1, 1), 1);
  filtroRange.setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(protocolos, true).setAllowInvalid(false).build()
  );

  const data = master.getRange(2, 1, Math.max(master.getLastRow() - 1, 0), master.getLastColumn()).getValues();
  let copiados = 0;

  data.forEach((row) => {
    const protocolo = String(row[colFiltroMedico] || '').trim();
    const identificacion = String(row[colIdentificacion] || '').trim();
    if (!protocolo || !identificacion || !protocolos.includes(protocolo)) return;

    const sheetName = sheetNameForProtocol_(protocolo);
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      const headers = [...BASE_COLUMNS, ...WORKLIST_COLUMNS];
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
      sheet.setFrozenRows(1);

      const clasifOptions = CLASIFICACION_FINAL_OPCIONES.map((o) => o.replace('{PROTOCOLO}', protocolo));
      const clasifColIndex = headers.indexOf('Clasificación Final') + 1;
      const siNoCols = ['Screening (Sí/No)', 'Aleatorización (Sí/No)', 'Apto para Otro Protocolo (Sí/No)'];
      siNoCols.forEach((colName) => {
        const colIndex = headers.indexOf(colName) + 1;
        sheet
          .getRange(2, colIndex, 500, 1)
          .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Sí', 'No'], true).build());
      });
      sheet
        .getRange(2, clasifColIndex, 500, 1)
        .setDataValidation(
          SpreadsheetApp.newDataValidation().requireValueInList(clasifOptions, true).setAllowInvalid(true).build()
        );
    }

    const existingIds = sheet
      .getRange(2, BASE_COLUMNS.indexOf('Identificacion') + 1, Math.max(sheet.getLastRow() - 1, 0), 1)
      .getValues()
      .map((r) => normalizeId_(r[0]));
    if (existingIds.includes(normalizeId_(identificacion))) return; // ya está — no se toca, puede tener avance

    const baseValues = BASE_COLUMNS.map((col) => row[idx[col]] ?? '');
    const newRow = [...baseValues, protocolo, ...Array(WORKLIST_COLUMNS.length - 1).fill('')];
    sheet.appendRow(newRow);
    copiados += 1;
  });

  SpreadsheetApp.getUi().alert(`Listo. ${copiados} paciente(s) copiados a sus Listas de Trabajo.`);
}

// ---- 2) Sincronizar con Aptus ----

function sincronizarConAptus() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const updates = [];

  ss.getSheets()
    .filter((s) => s.getName().indexOf(WORKLIST_PREFIX) === 0)
    .forEach((sheet) => {
      const protocolo = sheet.getName().slice(WORKLIST_PREFIX.length);
      const idx = headerIndexMap_(sheet);
      const lastRow = sheet.getLastRow();
      if (lastRow < 2) return;
      const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

      data.forEach((row) => {
        const identification = String(row[idx['Identificacion']] || '').trim();
        const clasificacion = String(row[idx['Clasificación Final']] || '').trim();
        if (!identification) return;

        updates.push({
          identification,
          protocoloNombre: protocolo,
          clasificacion,
          aptoOtroProtocolo: row[idx['Apto para Otro Protocolo (Sí/No)']] === 'Sí',
          comentarioMedico: String(row[idx['Comentarios Médico']] || '').trim(),
          comentarioPostContacto: String(row[idx['Comentarios Post-Contacto']] || '').trim(),
          motivoNoAleatorizacion: String(row[idx['Motivo de no Aleatorización']] || '').trim(),
          fecha: new Date().toISOString(),
        });
      });
    });

  if (!updates.length) {
    SpreadsheetApp.getUi().alert('No hay filas con Identificación en ninguna Lista de Trabajo.');
    return;
  }

  const response = UrlFetchApp.fetch(APTUS_API_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': getApiKey_() },
    payload: JSON.stringify({ updates }),
    muteHttpExceptions: true,
  });

  const result = JSON.parse(response.getContentText());
  if (!result.success) {
    SpreadsheetApp.getUi().alert(`Error al sincronizar: ${result.error || response.getContentText()}`);
    return;
  }

  escribirEstadoEnBaseMaestra_(updates);

  const notFoundMsg = result.notFound && result.notFound.length
    ? `\nNo encontrados en Base Maestra: ${result.notFound.join(', ')}`
    : '';
  SpreadsheetApp.getUi().alert(`Sincronizado. ${result.updated.length} paciente(s) actualizados.${notFoundMsg}`);
}

// Refleja el resultado también en la hoja "Base de Datos Maestra" (sin
// esperar respuesta del backend — usa los mismos datos ya calculados
// arriba), para que quede visible ahí sin tener que abrir Aptus.
function escribirEstadoEnBaseMaestra_(updates) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(BASE_MAESTRA_SHEET_NAME);
  if (!sheet) return;

  let idx = headerIndexMap_(sheet);
  const missingCols = ESTADO_COLUMNS_BASE_MAESTRA.filter((c) => idx[c] === undefined);
  if (missingCols.length) {
    const startCol = sheet.getLastColumn() + 1;
    sheet.getRange(1, startCol, 1, missingCols.length).setValues([missingCols]).setFontWeight('bold');
    idx = headerIndexMap_(sheet);
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const idColIndex = idx['Identificacion'];
  const ids = sheet.getRange(2, idColIndex + 1, lastRow - 1, 1).getValues().map((r) => normalizeId_(r[0]));

  const byId = new Map();
  updates.forEach((u) => byId.set(normalizeId_(u.identification), u));

  ids.forEach((id, i) => {
    const u = byId.get(id);
    if (!u) return;
    const rowNumber = i + 2;
    const comentarioParts = [u.comentarioMedico, u.comentarioPostContacto, u.motivoNoAleatorizacion].filter(Boolean);
    sheet.getRange(rowNumber, idx['Estado'] + 1).setValue(u.clasificacion || '');
    sheet.getRange(rowNumber, idx['Comentario Estado'] + 1).setValue(comentarioParts.join(' | '));
    sheet.getRange(rowNumber, idx['Apto para Otro Protocolo'] + 1).setValue(u.aptoOtroProtocolo ? 'Sí' : 'No');
  });
}

// ---- Protección de columnas de estado en Base de Datos Maestra ----
// Ejecutar una sola vez manualmente (menú Aptus → "Proteger columnas de
// Estado"). Deja esas columnas editables solo por quien corre el script
// (el dueño de la hoja) — el resto del equipo las ve pero no puede tocarlas.
function protegerColumnasEstado() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(BASE_MAESTRA_SHEET_NAME);
  if (!sheet) throw new Error(`No se encontró la hoja "${BASE_MAESTRA_SHEET_NAME}".`);

  let idx = headerIndexMap_(sheet);
  const missingCols = ESTADO_COLUMNS_BASE_MAESTRA.filter((c) => idx[c] === undefined);
  if (missingCols.length) {
    const startCol = sheet.getLastColumn() + 1;
    sheet.getRange(1, startCol, 1, missingCols.length).setValues([missingCols]).setFontWeight('bold');
    idx = headerIndexMap_(sheet);
  }

  const colIndexes = ESTADO_COLUMNS_BASE_MAESTRA.map((c) => idx[c] + 1).sort((a, b) => a - b);
  const first = colIndexes[0];
  const last = colIndexes[colIndexes.length - 1];
  const range = sheet.getRange(1, first, sheet.getMaxRows(), last - first + 1);
  const protection = range.protect().setDescription('Estado del paciente — solo vía sincronización con Aptus');
  protection.removeEditors(protection.getEditors());
  if (protection.canDomainEdit()) protection.setDomainEdit(false);

  SpreadsheetApp.getUi().alert('Columnas de Estado protegidas. Solo tú (el dueño de la hoja) puedes editarlas ahora.');
}
