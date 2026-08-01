import { useMemo, useRef, useState } from 'react';
import { Search, Download, FileJson, Upload, Trash2, AlertTriangle, CheckCircle2, X, Loader2, SlidersHorizontal } from 'lucide-react';
import { downloadStyledXLSX, downloadJSON } from '../utils/fileExport';
import { patientToExportRow } from '../utils/patientColumns';
import { getPatientAge } from '../utils/patientAge';
import TruncatedCell from './TruncatedCell';
import ConfirmResetButton from './ConfirmResetButton';

const EMPTY_FILTERS = {
  source: '',
  hta: '',
  dm2: '',
  erc: '',
  icc: '',
  fa: '',
  edadMin: '',
  edadMax: '',
};

const BOOLEAN_FILTER_FIELDS = [
  { key: 'hta', label: 'HTA' },
  { key: 'dm2', label: 'DM2' },
  { key: 'erc', label: 'ERC' },
  { key: 'icc', label: 'ICC' },
  { key: 'fa', label: 'FA' },
];

function BoolCell({ value }) {
  if (value === null || value === undefined) {
    return <span className="text-slate-300">—</span>;
  }
  return value ? (
    <span className="text-green-600 font-semibold">Sí</span>
  ) : (
    <span className="text-slate-400">No</span>
  );
}

const SOURCE_CONFIG = {
  historias: { label: 'Historia Clínica', className: 'bg-blue-50 text-blue-600' },
  externa: { label: 'BD Externa', className: 'bg-purple-50 text-purple-600' },
  demo: { label: 'Demo', className: 'bg-slate-100 text-slate-500' },
};

function SourceBadge({ source }) {
  if (!source || !SOURCE_CONFIG[source]) return <span className="text-slate-300">—</span>;
  const { label, className } = SOURCE_CONFIG[source];
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${className}`}>
      {label}
    </span>
  );
}

// Solo lectura: este dato entra únicamente por la sincronización con las
// Matrices Pre-Screening en Google Sheets (POST /api/sync/patient-status),
// nunca se edita desde la UI de Aptus, para que quede protegido igual que en
// la hoja de Sheets.
function EstadoBadge({ patient }) {
  if (!patient.estadoClasificacion) return <span className="text-slate-300">—</span>;
  const title = [
    patient.estadoComentario,
    patient.estadoActualizadoEn && `Actualizado: ${new Date(patient.estadoActualizadoEn).toLocaleString()}`,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap bg-amber-50 text-amber-700"
      title={title || undefined}
    >
      🚫 {patient.estadoClasificacion}
    </span>
  );
}

export default function BaseMaestra({ patients, protocols, onDeletePatient, onDeleteAllPatients, onRestoreBackup }) {
  const [query, setQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [pendingRestore, setPendingRestore] = useState(null);
  const [importError, setImportError] = useState(null);
  const [importSuccess, setImportSuccess] = useState(null);
  const [exporting, setExporting] = useState(false);
  const fileInputRef = useRef(null);

  const activeFilterCount = Object.values(filters).filter((v) => v !== '').length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return patients
      .filter((p) => {
        if (q && !(p.name.toLowerCase().includes(q) || (p.identification || '').toLowerCase().includes(q))) {
          return false;
        }
        if (filters.source && (p.source || '') !== filters.source) return false;
        for (const { key } of BOOLEAN_FILTER_FIELDS) {
          if (filters[key] === 'true' && p[key] !== true) return false;
          if (filters[key] === 'false' && p[key] !== false) return false;
        }
        const age = getPatientAge(p);
        if (filters.edadMin !== '' && (age === null || age < Number(filters.edadMin))) return false;
        if (filters.edadMax !== '' && (age === null || age > Number(filters.edadMax))) return false;
        return true;
      })
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' }));
  }, [patients, query, filters]);

  async function handleExportXLSX() {
    setExporting(true);
    try {
      const rows = patients.map(patientToExportRow);
      await downloadStyledXLSX('aptus_base_maestra.xlsx', rows, 'Base Maestra');
    } finally {
      setExporting(false);
    }
  }

  function handleBackupJSON() {
    downloadJSON('aptus_respaldo.json', {
      fecha: new Date().toISOString(),
      patients,
      protocols,
    });
  }

  function handleFileSelected(file) {
    if (!file) return;
    setImportError(null);
    setImportSuccess(null);

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const hasPatients = Array.isArray(parsed?.patients);
        const hasProtocols = Array.isArray(parsed?.protocols);
        if (!hasPatients && !hasProtocols) {
          throw new Error('El archivo no tiene el formato esperado (se esperaba "patients" y/o "protocols")');
        }
        setPendingRestore({
          data: parsed,
          patientCount: hasPatients ? parsed.patients.length : null,
          protocolCount: hasProtocols ? parsed.protocols.length : null,
          fecha: parsed?.fecha ?? null,
        });
      } catch (err) {
        setImportError(`No se pudo leer el respaldo: ${err.message}`);
      }
    };
    reader.onerror = () => setImportError('No se pudo leer el archivo seleccionado');
    reader.readAsText(file);
  }

  function confirmRestore() {
    onRestoreBackup(pendingRestore.data);
    setImportSuccess(
      `Respaldo restaurado: ${pendingRestore.patientCount ?? 0} pacientes, ${pendingRestore.protocolCount ?? 0} protocolos.`
    );
    setPendingRestore(null);
  }

  function cancelRestore() {
    setPendingRestore(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">Base Maestra</h2>
        <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
          {patients.length} pacientes
        </span>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nombre o identificación..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
              showFilters || activeFilterCount > 0
                ? 'border-blue-300 bg-blue-50 text-blue-700'
                : 'border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" /> Filtros
            {activeFilterCount > 0 && (
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-600 text-white text-[10px]">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleExportXLSX}
            disabled={exporting}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
          >
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Exportar XLSX
          </button>
          <button
            onClick={handleBackupJSON}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-700 text-white text-sm font-medium hover:bg-slate-800 transition-colors"
          >
            <FileJson className="w-4 h-4" /> Respaldo JSON
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            <Upload className="w-4 h-4" /> Importar respaldo JSON
          </button>
          <ConfirmResetButton
            label="Vaciar Base Maestra"
            itemLabel="pacientes"
            count={patients.length}
            onConfirm={onDeleteAllPatients}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              handleFileSelected(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {showFilters && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="text-[11px] font-medium text-slate-500 block mb-1">Origen</label>
              <select
                value={filters.source}
                onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))}
                className="text-sm rounded-lg border border-slate-300 px-2 py-1.5"
              >
                <option value="">Cualquiera</option>
                <option value="historias">Historia Clínica</option>
                <option value="externa">BD Externa</option>
                <option value="demo">Demo</option>
              </select>
            </div>
            {BOOLEAN_FILTER_FIELDS.map(({ key, label }) => (
              <div key={key}>
                <label className="text-[11px] font-medium text-slate-500 block mb-1">{label}</label>
                <select
                  value={filters[key]}
                  onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value }))}
                  className="text-sm rounded-lg border border-slate-300 px-2 py-1.5"
                >
                  <option value="">Cualquiera</option>
                  <option value="true">Sí</option>
                  <option value="false">No</option>
                </select>
              </div>
            ))}
            <div>
              <label className="text-[11px] font-medium text-slate-500 block mb-1">Edad mín.</label>
              <input
                type="number"
                value={filters.edadMin}
                onChange={(e) => setFilters((f) => ({ ...f, edadMin: e.target.value }))}
                className="w-20 text-sm rounded-lg border border-slate-300 px-2 py-1.5"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-slate-500 block mb-1">Edad máx.</label>
              <input
                type="number"
                value={filters.edadMax}
                onChange={(e) => setFilters((f) => ({ ...f, edadMax: e.target.value }))}
                className="w-20 text-sm rounded-lg border border-slate-300 px-2 py-1.5"
              />
            </div>
            <button
              onClick={() => setFilters(EMPTY_FILTERS)}
              disabled={activeFilterCount === 0}
              className="text-xs font-medium text-slate-500 hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Limpiar filtros
            </button>
          </div>
        </div>
      )}

      {pendingRestore && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <div className="flex items-start gap-2 text-sm text-amber-800">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <p>
              Este respaldo {pendingRestore.fecha && `(${new Date(pendingRestore.fecha).toLocaleString()}) `}
              contiene{' '}
              {pendingRestore.patientCount !== null && (
                <strong>{pendingRestore.patientCount} pacientes</strong>
              )}
              {pendingRestore.patientCount !== null && pendingRestore.protocolCount !== null && ' y '}
              {pendingRestore.protocolCount !== null && (
                <strong>{pendingRestore.protocolCount} protocolos</strong>
              )}
              . Al restaurar se <strong>reemplazarán</strong> los datos actuales. ¿Continuar?
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={confirmRestore}
              className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 transition-colors"
            >
              Sí, restaurar
            </button>
            <button
              onClick={cancelRestore}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-200 transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {importError && (
        <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{importError}</span>
          <button onClick={() => setImportError(null)} className="ml-auto text-red-400 hover:text-red-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {importSuccess && (
        <div className="flex items-start gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{importSuccess}</span>
          <button onClick={() => setImportSuccess(null)} className="ml-auto text-green-400 hover:text-green-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Nombre</th>
                <th className="text-left px-4 py-3 font-medium">Identificación</th>
                <th className="text-center px-3 py-3 font-medium">Edad</th>
                <th className="text-left px-4 py-3 font-medium">Teléfono</th>
                <th className="text-left px-4 py-3 font-medium">Dirección</th>
                <th className="text-center px-3 py-3 font-medium">IMC</th>
                <th className="text-center px-3 py-3 font-medium">HTA</th>
                <th className="text-center px-3 py-3 font-medium">DM2</th>
                <th className="text-center px-3 py-3 font-medium">ERC</th>
                <th className="text-center px-3 py-3 font-medium">ICC</th>
                <th className="text-center px-3 py-3 font-medium">FA</th>
                <th className="text-center px-3 py-3 font-medium">FEVI</th>
                <th className="text-left px-4 py-3 font-medium">Diagnósticos</th>
                <th className="text-left px-4 py-3 font-medium">Origen</th>
                <th className="text-left px-4 py-3 font-medium">Estado</th>
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">{p.name}</td>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{p.identification}</td>
                  <td className="px-3 py-3 text-center text-slate-700">{getPatientAge(p) ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{p.phone}</td>
                  <td className="px-4 py-3 text-slate-500">
                    <TruncatedCell text={p.address} />
                  </td>
                  <td className="px-3 py-3 text-center text-slate-700">{p.imc ?? '—'}</td>
                  <td className="px-3 py-3 text-center"><BoolCell value={p.hta} /></td>
                  <td className="px-3 py-3 text-center"><BoolCell value={p.dm2} /></td>
                  <td className="px-3 py-3 text-center"><BoolCell value={p.erc} /></td>
                  <td className="px-3 py-3 text-center"><BoolCell value={p.icc} /></td>
                  <td className="px-3 py-3 text-center"><BoolCell value={p.fa} /></td>
                  <td className="px-3 py-3 text-center text-slate-700">{p.fevi ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500">
                    <TruncatedCell text={p.diagnostics} />
                  </td>
                  <td className="px-4 py-3"><SourceBadge source={p.source} /></td>
                  <td className="px-4 py-3"><EstadoBadge patient={p} /></td>
                  <td className="px-3 py-3 text-center">
                    <button
                      onClick={() => onDeletePatient(p.id)}
                      className="text-slate-300 hover:text-red-500 transition-colors"
                      title="Eliminar de la base maestra"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={16} className="px-4 py-10 text-center text-slate-400">
                    No se encontraron pacientes con ese criterio de búsqueda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-slate-400">{filtered.length} de {patients.length} pacientes mostrados</p>
    </div>
  );
}
