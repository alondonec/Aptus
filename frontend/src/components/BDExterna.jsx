import { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { UploadCloud, Database, AlertTriangle, Send, Loader2 } from 'lucide-react';
import { parseCSV } from '../utils/fileExport';
import { normalizeKey } from '../utils/normalizeExternalPatient';
import TruncatedCell from './TruncatedCell';
import ConfirmResetButton from './ConfirmResetButton';

function findColumn(columns, candidates) {
  return columns.find((c) => candidates.includes(normalizeKey(c)));
}

/**
 * Convierte una hoja de cálculo en filas de objetos, detectando la fila de
 * encabezado real (saltando títulos o filas en blanco antes de la tabla) y
 * descartando columnas sin nombre. Esto evita los encabezados "__EMPTY",
 * "__EMPTY_1", etc. que genera sheet_to_json cuando la primera fila de la
 * hoja no es realmente el encabezado.
 */
function parseSheetSmart(worksheet) {
  const raw = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', blankrows: false });
  if (!raw.length) return [];

  let headerRowIndex = raw.findIndex(
    (row) => row.filter((cell) => String(cell).trim() !== '').length >= 2
  );
  if (headerRowIndex === -1) headerRowIndex = 0;

  const headerRow = raw[headerRowIndex];
  const dataRows = raw.slice(headerRowIndex + 1);

  const validColumns = headerRow
    .map((cell, idx) => ({ idx, label: String(cell).trim() }))
    .filter((c) => c.label !== '');

  return dataRows
    .filter((row) => row.some((cell) => String(cell).trim() !== ''))
    .map((row) => {
      const obj = {};
      validColumns.forEach(({ idx, label }) => {
        obj[label] = row[idx] !== undefined ? row[idx] : '';
      });
      return obj;
    });
}

/** Reordena Edad justo después de Identificación y Dirección después de
 * Teléfono, cuando ambas columnas existen en los datos cargados. */
function reorderColumns(columns) {
  const result = [...columns];
  const keyOf = (c) => normalizeKey(c);

  function moveAfter(fieldCandidates, anchorCandidates) {
    const fieldIdx = result.findIndex((c) => fieldCandidates.includes(keyOf(c)));
    const anchorIdx = result.findIndex((c) => anchorCandidates.includes(keyOf(c)));
    if (fieldIdx === -1 || anchorIdx === -1 || fieldIdx === anchorIdx) return;
    const [field] = result.splice(fieldIdx, 1);
    const newAnchorIdx = result.findIndex((c) => anchorCandidates.includes(keyOf(c)));
    result.splice(newAnchorIdx + 1, 0, field);
  }

  moveAfter(['edad', 'age'], ['identificacion', 'cedula', 'documento', 'cc']);
  moveAfter(['direccion', 'address'], ['telefono', 'celular', 'phone']);

  return result;
}

export default function BDExterna({ rows, onRowsChange, fileName, onFileNameChange, onSendToMaestra, onReset }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(null);
  const inputRef = useRef(null);

  function handleFile(file) {
    if (!file) return;
    onFileNameChange(file.name);
    setError(null);
    setSendSuccess(null);
    setLoading(true);

    const isCSV = file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv';

    if (isCSV) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = parseCSV(String(reader.result));
          onRowsChange(parsed);
        } catch (err) {
          setError(`No se pudo leer el archivo CSV: ${err.message}`);
          onRowsChange([]);
        } finally {
          setLoading(false);
        }
      };
      reader.onerror = () => {
        setError('No se pudo leer el archivo CSV');
        setLoading(false);
      };
      reader.readAsText(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          if (!firstSheetName) {
            throw new Error('El archivo no contiene hojas de cálculo');
          }
          const worksheet = workbook.Sheets[firstSheetName];
          const json = parseSheetSmart(worksheet);
          if (!json.length) {
            throw new Error('No se encontraron datos con encabezados válidos en la hoja de cálculo');
          }
          onRowsChange(json);
        } catch (err) {
          setError(`No se pudo procesar el archivo Excel: ${err.message}`);
          onRowsChange([]);
        } finally {
          setLoading(false);
        }
      };
      reader.onerror = () => {
        setError('No se pudo leer el archivo Excel');
        setLoading(false);
      };
      reader.readAsArrayBuffer(file);
    }
  }

  async function handleSendToMaestra() {
    setSending(true);
    setSendSuccess(null);
    try {
      await onSendToMaestra(rows);
      setSendSuccess(`${rows.length} registros enviados a la Base Maestra.`);
    } finally {
      setSending(false);
    }
  }

  const columns = rows.length ? reorderColumns(Object.keys(rows[0])) : [];
  const nameColumn = findColumn(columns, ['nombre', 'name', 'paciente']);
  const sortedRows = useMemo(() => {
    if (!nameColumn) return rows;
    return [...rows].sort((a, b) =>
      String(a[nameColumn] ?? '').localeCompare(String(b[nameColumn] ?? ''), 'es', { sensitivity: 'base' })
    );
  }, [rows, nameColumn]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">BD Externa</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
            {rows.length} registros
          </span>
          <ConfirmResetButton
            label="Vaciar BD Externa"
            itemLabel="registros cargados"
            count={rows.length}
            onConfirm={onReset}
          />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-1">
          <Database className="w-5 h-5 text-blue-600" />
          <h3 className="font-semibold text-slate-800">Carga de Base de Datos Externa</h3>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          Integra fuentes externas (EPS, IPS, aseguradoras) mediante archivos Excel (.xlsx/.xls) o CSV reales.
        </p>

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <UploadCloud className="w-4 h-4" /> Cargar archivo .xlsx / .csv
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => {
              handleFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>

        {fileName && !error && (
          <p className="text-xs text-slate-400 mt-3">
            Archivo cargado: <span className="font-medium text-slate-600">{fileName}</span>
          </p>
        )}

        {error && (
          <div className="mt-3 flex items-start gap-2 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {loading && (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-400 shadow-sm">
          Procesando archivo...
        </div>
      )}

      {sendSuccess && (
        <div className="flex items-start gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
          <span>{sendSuccess}</span>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <p className="text-xs text-slate-400">{rows.length} registros cargados desde fuente externa</p>
            <button
              onClick={handleSendToMaestra}
              disabled={sending}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Enviar a Base Maestra
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <tr>
                  {columns.map((col) => (
                    <th key={col} className="text-left px-4 py-3 font-medium whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedRows.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    {columns.map((col) => (
                      <td key={col} className="px-4 py-3 text-slate-600">
                        <TruncatedCell text={row[col]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
