const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const multer = require('multer');
const fetch = require('node-fetch');
const FormData = require('form-data');
const cors = require('cors');
const { PDFDocument } = require('@cantoo/pdf-lib');
const db = require('./db');

// Evita que un error no controlado (ej. una promesa rechazada que nadie
// esperó) tumbe todo el servidor — desde Node 15 el comportamiento por
// defecto ante un unhandledRejection es terminar el proceso. Aquí solo se
// registra el error para poder diagnosticarlo, y el servidor sigue de pie.
process.on('unhandledRejection', (reason) => {
  console.error('Rechazo de promesa no controlado:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Excepción no controlada:', err);
});

const app = express();
const PORT = process.env.PORT || 3001;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const SHEETS_SYNC_API_KEY = process.env.SHEETS_SYNC_API_KEY;
const ANTHROPIC_VERSION = '2023-06-01';
const FILES_API_BETA = 'files-api-2025-04-14';
const MODEL = 'claude-sonnet-4-6';
const MAX_SPLIT_DEPTH = 3; // hasta 2^3 = 8 partes

// Precios oficiales de Sonnet 4.6 (USD por token). Si el modelo o su precio
// cambian, actualizar acá para que el costo estimado por historia siga
// siendo correcto.
const INPUT_PRICE_PER_TOKEN = 3 / 1_000_000;
const OUTPUT_PRICE_PER_TOKEN = 15 / 1_000_000;

// Acepta cualquier puerto de localhost (para desarrollo, ya que el puerto de
// Vite puede variar) más el/los orígenes de producción indicados en
// FRONTEND_URL (uno o varios, separados por coma; ej. el dominio de Vercel).
const allowedProdOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      const normalizedOrigin = (origin || '').replace(/\/+$/, '');
      if (!origin || /^http:\/\/localhost:\d+$/.test(origin) || allowedProdOrigins.includes(normalizedOrigin)) {
        callback(null, true);
      } else {
        callback(new Error('Origen no permitido por CORS'));
      }
    },
  })
);
app.use(express.json({ limit: '5mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 32 * 1024 * 1024 }, // 32MB, matches Anthropic PDF request limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('Solo se permiten archivos PDF'));
    }
    cb(null, true);
  },
});

const EXTRACTION_PROMPT = `Eres un extractor clínico. Analiza esta historia clínica y
devuelve ÚNICAMENTE este JSON sin texto adicional:
{name, identification (SOLO dígitos, sin prefijos como "CC-", "TI-" ni espacios),
fechaNacimiento (formato YYYY-MM-DD si el documento la indica; si no, null),
edad (number, solo como respaldo si no hay fecha de nacimiento en el documento),
phone, address, imc, peso (kg, number; solo si el IMC no viene explícito pero el
peso sí aparece en el documento), talla (metros, number, ej. 1.70; solo si el IMC
no viene explícito pero la talla sí aparece — si el documento la da en centímetros
conviértela a metros), hta (boolean), dm2 (boolean), erc (boolean), icc (boolean),
fa (boolean), uacr, fevi, eventoCV (boolean), dementia (boolean), diagnostics}
Reglas de negación: 'niega HTA' → hta:false | no menciona → null`;

/** Elimina prefijos de tipo de documento (CC-, TI-, CE-, etc.) dejando solo
 * los dígitos, para que la identificación quede en el mismo formato que
 * BD Externa. Si el valor no tiene ese patrón, se deja intacto. */
function stripIdPrefix(identification) {
  if (typeof identification !== 'string') return identification;
  return identification.replace(/^[A-Za-z]{1,4}[\s.-]*/, '').trim() || identification;
}

/** Calcula el IMC con la fórmula del CDC (peso[kg] / talla[m]²) cuando el
 * documento no lo trae explícito pero sí menciona peso y talla por separado.
 * Normaliza la talla a metros si vino en centímetros (el modelo puede no
 * hacer la conversión de forma consistente). */
function computeImcFromPesoTalla(peso, talla) {
  const pesoNum = Number(peso);
  const tallaNum = Number(talla);
  if (!Number.isFinite(pesoNum) || !Number.isFinite(tallaNum) || pesoNum <= 0 || tallaNum <= 0) {
    return null;
  }
  const tallaMetros = tallaNum > 3 ? tallaNum / 100 : tallaNum;
  const imc = pesoNum / (tallaMetros * tallaMetros);
  return Math.round(imc * 10) / 10;
}

/** Si el IMC no vino explícito en la historia, intenta completarlo a partir
 * de peso/talla extraídos del texto. `peso` se conserva en el paciente aunque
 * no haya talla: matchEngine.js lo usa como criterio de respaldo (peso > 80kg
 * ⇒ Apto) cuando de verdad no hay forma de calcular el IMC real. */
function applyImcFallback(patient) {
  if (!patient || (patient.imc !== null && patient.imc !== undefined && patient.imc !== '')) {
    return patient;
  }
  const computed = computeImcFromPesoTalla(patient.peso, patient.talla);
  if (computed !== null) {
    patient.imc = computed;
  }
  return patient;
}

function translateAnthropicError(message) {
  if (!message) return 'Error desconocido al procesar el PDF';
  if (message.includes('credit balance is too low')) {
    return 'La cuenta de Anthropic no tiene saldo suficiente para procesar PDFs. Ve a console.anthropic.com → Plans & Billing para agregar créditos.';
  }
  if (isContextTooLongError(message)) {
    return 'Este PDF es demasiado extenso para procesarse, incluso dividiéndolo en partes más pequeñas. Intenta reducir la resolución de los escaneos o separarlo manualmente en documentos más cortos.';
  }
  return message;
}

function isContextTooLongError(message) {
  if (!message) return false;
  return message.includes('prompt is too long') || message.includes('maximum context length');
}

/** Divide un PDF en `numParts` documentos independientes (por rango de
 * páginas). Si el documento tiene menos páginas que partes solicitadas,
 * devuelve el buffer original sin dividir (el llamador debe detectar esto).
 * Muchas historias clínicas exportadas desde sistemas EMR vienen protegidas
 * contra edición/impresión pero sin contraseña de usuario real (password
 * vacía) — se intenta desencriptar con password vacía, que es el caso común.
 * Si el documento tiene una contraseña de usuario real, se lanza un error
 * claro en vez de producir páginas con contenido corrupto. */
async function splitPdfBuffer(buffer, numParts) {
  let src;
  try {
    src = await PDFDocument.load(buffer, { ignoreEncryption: true, password: '' });
  } catch (err) {
    throw new Error(
      'Este PDF está protegido con una contraseña real y es demasiado extenso para procesarse en una sola solicitud. Quítale la contraseña con un lector de PDF antes de subirlo.'
    );
  }
  if (src.isEncrypted) {
    throw new Error(
      'Este PDF está protegido con una contraseña real y es demasiado extenso para procesarse en una sola solicitud. Quítale la contraseña con un lector de PDF antes de subirlo.'
    );
  }
  const totalPages = src.getPageCount();
  if (totalPages < numParts) return [buffer];

  const chunkSize = Math.ceil(totalPages / numParts);
  const buffers = [];
  for (let start = 0; start < totalPages; start += chunkSize) {
    const end = Math.min(start + chunkSize, totalPages);
    const doc = await PDFDocument.create();
    const indices = Array.from({ length: end - start }, (_, i) => start + i);
    const pages = await doc.copyPages(src, indices);
    pages.forEach((p) => doc.addPage(p));
    buffers.push(Buffer.from(await doc.save()));
  }
  return buffers;
}

/** Combina los pacientes extraídos de varias partes de un mismo PDF dividido:
 * para cada campo estructurado se toma el primer valor no nulo encontrado, y
 * los diagnósticos de todas las partes se concatenan para no perder texto. */
function mergePatientResults(results) {
  const fields = [
    'name', 'identification', 'edad', 'fechaNacimiento', 'phone', 'address',
    'imc', 'peso', 'talla', 'hta', 'dm2', 'erc', 'icc', 'fa', 'uacr', 'fevi', 'eventoCV', 'dementia',
  ];
  const merged = {};
  for (const field of fields) {
    merged[field] = null;
    for (const r of results) {
      const value = r?.[field];
      if (value !== null && value !== undefined && value !== '') {
        merged[field] = value;
        break;
      }
    }
  }
  const diagnosticsParts = results
    .map((r) => (Array.isArray(r?.diagnostics) ? r.diagnostics.join(' ') : r?.diagnostics))
    .filter((d) => d && String(d).trim().length > 0);
  merged.diagnostics = diagnosticsParts.length ? diagnosticsParts.join(' ') : null;
  return merged;
}

/** Extrae los datos de un PDF, dividiéndolo automáticamente en partes más
 * pequeñas si el modelo responde que el documento supera su límite de
 * contexto, y combinando los resultados de cada parte al final. */
async function extractPatientWithSplitting(buffer, filename, depth = 0) {
  try {
    const fileId = await uploadFileToAnthropic(buffer, filename);
    return [await extractPatientFromFile(fileId)];
  } catch (err) {
    if (!isContextTooLongError(err.message) || depth >= MAX_SPLIT_DEPTH) {
      throw err;
    }
    const parts = await splitPdfBuffer(buffer, 2);
    if (parts.length < 2) throw err; // no se pudo dividir más (p. ej. una sola página)

    console.log(`PDF "${filename}" supera el límite de contexto — dividiendo en ${parts.length} partes (profundidad ${depth + 1})`);
    const results = [];
    for (let i = 0; i < parts.length; i++) {
      const partResults = await extractPatientWithSplitting(parts[i], `${filename}-part${i + 1}`, depth + 1);
      results.push(...partResults);
    }
    return results;
  }
}

async function uploadFileToAnthropic(buffer, filename) {
  const form = new FormData();
  form.append('file', buffer, { filename, contentType: 'application/pdf' });

  const response = await fetch('https://api.anthropic.com/v1/files', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-beta': FILES_API_BETA,
      ...form.getHeaders(),
    },
    body: form,
  });

  const data = await response.json();
  if (!response.ok) {
    const message = data?.error?.message || `Files API respondió con estado ${response.status}`;
    throw new Error(message);
  }
  return data.id;
}

async function extractPatientFromFile(fileId) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-beta': FILES_API_BETA,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'file', file_id: fileId },
            },
            {
              type: 'text',
              text: EXTRACTION_PROMPT,
            },
          ],
        },
      ],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    const message = data?.error?.message || `Messages API respondió con estado ${response.status}`;
    throw new Error(message);
  }

  if (data.stop_reason === 'refusal') {
    throw new Error('El modelo rechazó procesar este documento');
  }

  const textBlock = (data.content || []).find((block) => block.type === 'text');
  if (!textBlock) {
    throw new Error('La respuesta del modelo no contiene texto');
  }

  const patient = parsePatientJSON(textBlock.text);
  if (patient && typeof patient === 'object') {
    patient.identification = stripIdPrefix(patient.identification);
  }
  return { patient, usage: data.usage || null };
}

/** Extrae y parsea el JSON devuelto por el modelo, tolerando que lo envuelva
 * en bloques de código markdown pese a que se le pida no hacerlo. */
function extractJSON(rawText, openChar, closeChar) {
  let cleaned = rawText.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }
  if (!cleaned.startsWith(openChar)) {
    const start = cleaned.indexOf(openChar);
    const end = cleaned.lastIndexOf(closeChar);
    if (start !== -1 && end !== -1) {
      cleaned = cleaned.slice(start, end + 1);
    }
  }
  return JSON.parse(cleaned);
}

function parsePatientJSON(rawText) {
  try {
    return extractJSON(rawText, '{', '}');
  } catch (err) {
    throw new Error('No se pudo interpretar el JSON devuelto por el modelo');
  }
}

const KEYWORD_SUGGESTION_PROMPT = (criterionName) => `Eres un asistente clínico. Para el término médico
"${criterionName}" en español (contexto: historias clínicas colombianas), genera una lista de palabras
clave y variantes de escritura que podrían aparecer en el texto libre de diagnósticos, para detectarlo
mediante búsqueda literal de texto (sin corrección automática de tildes).

Incluye: el término con y sin tilde, sinónimos clínicos comunes, abreviaturas usuales, y el nombre en
texto de condiciones relacionadas con códigos CIE-10 si aplica. Entre 6 y 15 variantes.

Devuelve ÚNICAMENTE un arreglo JSON de strings en minúsculas, sin texto adicional.
Ejemplo de formato: ["cáncer", "cancer", "neoplasia", "tumor maligno"]`;

function parseKeywordArray(rawText) {
  let parsed;
  try {
    parsed = extractJSON(rawText, '[', ']');
  } catch (err) {
    throw new Error('No se pudo interpretar las palabras clave devueltas por el modelo');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('No se pudo interpretar las palabras clave devueltas por el modelo');
  }
  return parsed
    .filter((k) => typeof k === 'string' && k.trim())
    .map((k) => k.trim().toLowerCase());
}

async function suggestKeywordsForCriterion(criterionName) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 512,
      messages: [{ role: 'user', content: KEYWORD_SUGGESTION_PROMPT(criterionName) }],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    const message = data?.error?.message || `Messages API respondió con estado ${response.status}`;
    throw new Error(message);
  }

  const textBlock = (data.content || []).find((block) => block.type === 'text');
  if (!textBlock) {
    throw new Error('La respuesta del modelo no contiene texto');
  }

  return parseKeywordArray(textBlock.text);
}

app.post('/extract-pdf', upload.single('file'), async (req, res) => {
  try {
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY no está configurada en el servidor');
    }
    if (!req.file) {
      throw new Error('No se recibió ningún archivo PDF');
    }

    const results = await extractPatientWithSplitting(req.file.buffer, req.file.originalname);
    const patients = results.map((r) => r.patient);
    const patient = applyImcFallback(patients.length > 1 ? mergePatientResults(patients) : patients[0]);

    // Costo real (no estimado): suma los tokens de entrada/salida de todas las
    // llamadas al modelo que hizo falta hacer para esta historia (una sola,
    // o varias si el PDF se tuvo que dividir), usando el uso que devuelve la
    // propia API de Anthropic en cada respuesta.
    const totalUsage = results.reduce(
      (acc, r) => ({
        inputTokens: acc.inputTokens + (r.usage?.input_tokens || 0),
        outputTokens: acc.outputTokens + (r.usage?.output_tokens || 0),
      }),
      { inputTokens: 0, outputTokens: 0 }
    );
    const costUsd =
      totalUsage.inputTokens * INPUT_PRICE_PER_TOKEN + totalUsage.outputTokens * OUTPUT_PRICE_PER_TOKEN;

    res.json({
      success: true,
      patient,
      splitInto: results.length > 1 ? results.length : undefined,
      costUsd,
      inputTokens: totalUsage.inputTokens,
      outputTokens: totalUsage.outputTokens,
    });
  } catch (err) {
    const message = translateAnthropicError(err.message);
    console.error('Error en /extract-pdf:', err.message);
    res.status(500).json({ success: false, error: message });
  }
});

app.post('/suggest-keywords', async (req, res) => {
  try {
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY no está configurada en el servidor');
    }
    const criterionName = req.body?.criterionName?.trim();
    if (!criterionName) {
      throw new Error('Se requiere el nombre del criterio');
    }

    const keywords = await suggestKeywordsForCriterion(criterionName);
    res.json({ success: true, keywords });
  } catch (err) {
    const message = translateAnthropicError(err.message);
    console.error('Error en /suggest-keywords:', err.message);
    res.status(500).json({ success: false, error: message });
  }
});

// Precio del caché de prompts (multiplicadores sobre el precio base de
// entrada), para poder reportar el costo real de cada pregunta. La primera
// pregunta de una sesión "escribe" el caché (más cara), las siguientes leen
// de ahí si Aptus vuelve a enviar los mismos datos dentro de los ~5 minutos
// de vigencia — mucho más barato que reprocesar todo de nuevo.
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

const ASK_SYSTEM_PROMPT = `Eres un asistente que responde preguntas sobre los pacientes y protocolos cargados
en Aptus, una herramienta de preselección clínica. A continuación recibirás los datos de los pacientes (ya
evaluados contra cada protocolo, con el resultado Apto/No Apto y los motivos cuando no es Apto) en JSON.

Reglas:
- Respondé ÚNICAMENTE con base en los datos proporcionados. Si la pregunta no se puede responder con esos
  datos, decilo claramente en vez de inventar.
- Respondé en español, de forma breve y directa (no repitas la pregunta, no agregues disclaimers largos).
- Si la respuesta involucra una lista de pacientes, mencioná sus nombres.
- Los datos ya incluyen el resultado de elegibilidad calculado por la herramienta (campo "protocolos") — usá
  ese resultado tal cual en vez de volver a evaluar los criterios vos mismo.`;

app.post('/api/ask', async (req, res) => {
  try {
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY no está configurada en el servidor');
    }
    const question = req.body?.question?.trim();
    const patients = req.body?.patients;
    if (!question) {
      throw new Error('Se requiere una pregunta');
    }
    if (!Array.isArray(patients)) {
      throw new Error('Se requieren los datos de pacientes');
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: ASK_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Datos de pacientes (JSON):\n${JSON.stringify(patients)}`,
                cache_control: { type: 'ephemeral' },
              },
              {
                type: 'text',
                text: `Pregunta: ${question}`,
              },
            ],
          },
        ],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      const message = data?.error?.message || `Messages API respondió con estado ${response.status}`;
      throw new Error(message);
    }
    if (data.stop_reason === 'refusal') {
      throw new Error('El modelo rechazó responder esta pregunta');
    }

    const textBlock = (data.content || []).find((block) => block.type === 'text');
    const answer = textBlock?.text || 'No se recibió respuesta del modelo.';

    const usage = data.usage || {};
    const baseInputTokens = usage.input_tokens || 0;
    const cacheWriteTokens = usage.cache_creation_input_tokens || 0;
    const cacheReadTokens = usage.cache_read_input_tokens || 0;
    const outputTokens = usage.output_tokens || 0;
    const costUsd =
      baseInputTokens * INPUT_PRICE_PER_TOKEN +
      cacheWriteTokens * INPUT_PRICE_PER_TOKEN * CACHE_WRITE_MULTIPLIER +
      cacheReadTokens * INPUT_PRICE_PER_TOKEN * CACHE_READ_MULTIPLIER +
      outputTokens * OUTPUT_PRICE_PER_TOKEN;

    res.json({ success: true, answer, costUsd });
  } catch (err) {
    const message = translateAnthropicError(err.message);
    console.error('Error en /api/ask:', err.message);
    res.status(500).json({ success: false, error: message });
  }
});

// Requiere una API key para el endpoint de sincronización desde Google
// Sheets (Apps Script llama desde fuera del navegador, no puede depender de
// CORS como control de acceso). El resto de la API queda como está.
function requireSyncApiKey(req, res, next) {
  if (!SHEETS_SYNC_API_KEY || req.get('x-api-key') !== SHEETS_SYNC_API_KEY) {
    return res.status(401).json({ success: false, error: 'API key inválida o no configurada' });
  }
  next();
}

// ---- Pacientes (persistidos en SQLite) ----

app.get('/api/patients', (req, res) => {
  try {
    res.json({ success: true, patients: db.getAllPatients() });
  } catch (err) {
    console.error('Error en GET /api/patients:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/patients', (req, res) => {
  try {
    const patient = db.insertPatient(req.body || {});
    res.status(201).json({ success: true, patient });
  } catch (err) {
    console.error('Error en POST /api/patients:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reemplazo masivo — usado para restaurar un respaldo JSON completo.
app.put('/api/patients', (req, res) => {
  try {
    const incoming = req.body?.patients;
    if (!Array.isArray(incoming)) {
      return res.status(400).json({ success: false, error: 'Se esperaba un arreglo "patients"' });
    }
    const patients = db.replaceAllPatients(incoming);
    res.json({ success: true, patients });
  } catch (err) {
    console.error('Error en PUT /api/patients:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/patients/:id', (req, res) => {
  try {
    const patient = db.updatePatient(req.params.id, req.body || {});
    if (!patient) {
      return res.status(404).json({ success: false, error: 'Paciente no encontrado' });
    }
    res.json({ success: true, patient });
  } catch (err) {
    console.error('Error en PUT /api/patients/:id:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/patients/:id', (req, res) => {
  try {
    const deleted = db.deletePatient(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Paciente no encontrado' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Error en DELETE /api/patients/:id:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Elimina todos los pacientes — usado por el botón "Vaciar Base Maestra".
app.delete('/api/patients', (req, res) => {
  try {
    const deletedCount = db.deleteAllPatients();
    res.json({ success: true, deletedCount });
  } catch (err) {
    console.error('Error en DELETE /api/patients:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Sincronización de estado del paciente desde las Matrices Pre-Screening en
// Google Sheets (Apps Script). Una Clasificación Final no vacía excluye al
// paciente de toda evaluación de elegibilidad futura en Aptus — ver
// getGlobalExclusion en frontend/src/utils/matchEngine.js. Solo actualiza
// pacientes que ya existen en Base Maestra, nunca crea pacientes nuevos.
app.post('/api/sync/patient-status', requireSyncApiKey, (req, res) => {
  try {
    const updates = req.body?.updates;
    if (!Array.isArray(updates)) {
      return res.status(400).json({ success: false, error: 'Se esperaba un arreglo "updates"' });
    }
    const result = db.applyPatientStatusSync(updates);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Error en POST /api/sync/patient-status:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---- Protocolos (persistidos en SQLite) ----

app.get('/api/protocols', (req, res) => {
  try {
    res.json({ success: true, protocols: db.getAllProtocols() });
  } catch (err) {
    console.error('Error en GET /api/protocols:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/protocols', (req, res) => {
  try {
    if (!req.body?.name) {
      return res.status(400).json({ success: false, error: 'El protocolo requiere un nombre' });
    }
    const protocol = db.insertProtocol(req.body);
    res.status(201).json({ success: true, protocol });
  } catch (err) {
    console.error('Error en POST /api/protocols:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reemplazo masivo — usado para restaurar un respaldo JSON completo.
app.put('/api/protocols', (req, res) => {
  try {
    const incoming = req.body?.protocols;
    if (!Array.isArray(incoming)) {
      return res.status(400).json({ success: false, error: 'Se esperaba un arreglo "protocols"' });
    }
    const protocols = db.replaceAllProtocols(incoming);
    res.json({ success: true, protocols });
  } catch (err) {
    console.error('Error en PUT /api/protocols:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/protocols/:id', (req, res) => {
  try {
    const protocol = db.updateProtocol(req.params.id, req.body || {});
    if (!protocol) {
      return res.status(404).json({ success: false, error: 'Protocolo no encontrado' });
    }
    res.json({ success: true, protocol });
  } catch (err) {
    console.error('Error en PUT /api/protocols/:id:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/protocols/:id', (req, res) => {
  try {
    const deleted = db.deleteProtocol(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Protocolo no encontrado' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Error en DELETE /api/protocols/:id:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---- Bloques de carga de Historias Clínicas (persistidos en SQLite, antes
// vivían solo en localStorage del navegador — por eso no se veían al abrir la
// app desde otro dispositivo/entorno).

app.get('/api/historia-lotes', (req, res) => {
  try {
    res.json({ success: true, lotes: db.getAllHistoriaLotes() });
  } catch (err) {
    console.error('Error en GET /api/historia-lotes:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/historia-lotes', (req, res) => {
  try {
    const incoming = req.body?.lotes;
    if (!Array.isArray(incoming)) {
      return res.status(400).json({ success: false, error: 'Se esperaba un arreglo "lotes"' });
    }
    const lotes = db.replaceAllHistoriaLotes(incoming);
    res.json({ success: true, lotes });
  } catch (err) {
    console.error('Error en PUT /api/historia-lotes:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/historia-items', (req, res) => {
  try {
    res.json({ success: true, items: db.getAllHistoriaItems() });
  } catch (err) {
    console.error('Error en GET /api/historia-items:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/historia-items', (req, res) => {
  try {
    const incoming = req.body?.items;
    if (!Array.isArray(incoming)) {
      return res.status(400).json({ success: false, error: 'Se esperaba un arreglo "items"' });
    }
    const items = db.replaceAllHistoriaItems(incoming);
    res.json({ success: true, items });
  } catch (err) {
    console.error('Error en PUT /api/historia-items:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', hasApiKey: Boolean(ANTHROPIC_API_KEY) });
});

// Multer / general error handler
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  res.status(400).json({ success: false, error: err.message || 'Error desconocido' });
});

app.listen(PORT, () => {
  console.log(`Aptus backend escuchando en http://localhost:${PORT}`);
});
