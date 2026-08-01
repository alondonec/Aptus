import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Download, Loader2, Users, SlidersHorizontal } from 'lucide-react';
import { evaluatePatientForProtocol } from '../utils/matchEngine';
import { downloadStyledXLSX } from '../utils/fileExport';
import { patientToExportRow, SOURCE_LABELS } from '../utils/patientColumns';
import { mergeDuplicatePatients } from '../utils/patientMerge';
import { normalizeIdentification } from '../utils/patientIdentity';
import { LEGACY_LOTE_ID } from '../utils/loteConstants';
import MultiSelectDropdown from './MultiSelectDropdown';

const APTO_FILTER_ALL = 'all';
const APTO_FILTER_APTO = 'apto';
const APTO_FILTER_NO_APTO = 'no_apto';

const DATA_SOURCES = [
  { key: 'maestra', label: 'Base Maestra' },
  { key: 'historias', label: 'Historias Clínicas cargadas' },
  { key: 'externa', label: 'BD Externa' },
];

function AptoBadge({ result }) {
  if (result.excluded) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-200 text-slate-600 text-xs font-semibold"
        title={result.exclusionReason}
      >
        🚫 EXCLUIDO
      </span>
    );
  }
  return result.apto ? (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-green-100 text-green-700 text-xs font-semibold">
      ✅ APTO
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-100 text-red-700 text-xs font-semibold">
      ❌ NO
    </span>
  );
}

// Las historias clínicas cargadas se guardan sin deduplicar: cada PDF
// procesado es una fila independiente, tal como se subió, hasta que se envía
// a la Base Maestra. Si el mismo paciente se cargó más de una vez (en el
// mismo bloque o en bloques distintos), aquí aparecería repetido y cada copia
// se evaluaría por separado contra los protocolos — pudiendo mostrar "sin
// dato"/"No Apto" en una copia con menos información aunque otra copia sí
// tenga el dato completo. Para el cruce con protocolos se fusionan primero,
// igual que ya ocurre automáticamente al enviarlas a la Base Maestra.
function dedupePatients(list) {
  const byKey = new Map();
  const order = [];
  for (const patient of list) {
    const key = normalizeIdentification(patient.identification) || `noid-${patient.id}`;
    const existing = byKey.get(key);
    if (existing) {
      byKey.set(key, { ...mergeDuplicatePatients(existing, patient), id: existing.id, loteId: existing.loteId });
    } else {
      byKey.set(key, patient);
      order.push(key);
    }
  }
  return order.map((key) => byKey.get(key));
}

function CriterionRow({ result, invert }) {
  // Para criterios de exclusión, "pass" significa que la exclusión se activó
  // (algo malo), así que la semántica visual (verde = bien) se invierte.
  // Cuando no hay dato, matchEngine.js siempre deja pass:false — para
  // inclusión eso sí bloquea el Apto (no se puede confirmar que cumple), pero
  // para exclusión significa que la exclusión NO se activó (no hay evidencia
  // de esa condición), así que no debe mostrarse en rojo como si incumpliera.
  const good = result.indeterminate ? invert : invert ? !result.pass : result.pass;
  return (
    <li
      className={`flex items-center gap-2 px-2 py-1 rounded text-xs ${
        good ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
      }`}
    >
      <span>{good ? '✔' : '✘'}</span>
      <span>{result.reason}</span>
      {result.indeterminate && (
        <span className="ml-auto italic text-slate-400">sin dato</span>
      )}
    </li>
  );
}

export default function MatrizCompatibilidad({
  maestraPatients,
  historiaPatients,
  historiaLotes,
  externalPatients,
  protocols,
  dataSource,
  onDataSourceChange,
  loteFilters,
  onLoteFiltersChange,
  selectedProtocolIds,
  onSelectedProtocolIdsChange,
  aptoFilter,
  onAptoFilterChange,
}) {
  const [expandedPatient, setExpandedPatient] = useState(null);
  const [exporting, setExporting] = useState(false);

  // Selección vacía = "todos los protocolos". Elegir uno o varios acota tanto
  // la matriz en pantalla como la exportación, para poder analizar
  // combinaciones puntuales (ej. 2 de 3 protocolos a la vez).
  const visibleProtocols = useMemo(
    () =>
      selectedProtocolIds.length === 0
        ? protocols
        : protocols.filter((p) => selectedProtocolIds.includes(p.id)),
    [protocols, selectedProtocolIds]
  );

  const loteOptions = useMemo(() => {
    const opts = (historiaLotes || []).map((l) => ({
      id: l.id,
      label: l.fuente || 'Bloque sin nombre',
    }));
    if (historiaPatients.some((p) => !p.loteId)) {
      opts.push({ id: LEGACY_LOTE_ID, label: 'Historias cargadas antes de tener bloques' });
    }
    return opts;
  }, [historiaLotes, historiaPatients]);

  const patients = useMemo(() => {
    let source =
      dataSource === 'historias' ? historiaPatients : dataSource === 'externa' ? externalPatients : maestraPatients;
    if (dataSource === 'historias') {
      // Selección vacía = "todos los bloques". Elegir varios cruza la unión
      // de esos bloques (ej. bloque A + bloque C juntos).
      if (loteFilters.length > 0) {
        source = source.filter((p) => loteFilters.includes(p.loteId || LEGACY_LOTE_ID));
      }
      source = dedupePatients(source);
    }
    return [...source].sort((a, b) =>
      (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' })
    );
  }, [dataSource, maestraPatients, historiaPatients, externalPatients, loteFilters]);

  // Mapa identificación -> nombre del bloque de carga, para poder mostrar de
  // qué bloque proviene cada paciente en la exportación XLSX sin importar la
  // fuente de datos activa (Base Maestra y BD Externa no guardan el loteId
  // directamente, así que se busca por identificación entre las historias
  // cargadas). Si un paciente nunca pasó por un bloque, se usa su Origen
  // general (Historia Clínica / BD Externa) como respaldo.
  const identToFuente = useMemo(() => {
    const map = new Map();
    for (const p of historiaPatients) {
      const key = normalizeIdentification(p.identification);
      if (!key || map.has(key)) continue;
      const loteId = p.loteId || LEGACY_LOTE_ID;
      map.set(key, loteOptions.find((o) => o.id === loteId)?.label || 'Bloque sin nombre');
    }
    return map;
  }, [historiaPatients, loteOptions]);

  function getFuenteLabel(patient) {
    if (dataSource === 'historias') {
      const loteId = patient.loteId || LEGACY_LOTE_ID;
      return loteOptions.find((o) => o.id === loteId)?.label || 'Bloque sin nombre';
    }
    const key = normalizeIdentification(patient.identification);
    return identToFuente.get(key) || SOURCE_LABELS[patient.source] || '—';
  }

  const matrix = useMemo(() => {
    const map = {};
    for (const patient of patients) {
      map[patient.id] = {};
      for (const protocol of visibleProtocols) {
        map[patient.id][protocol.id] = evaluatePatientForProtocol(patient, protocol);
      }
    }
    return map;
  }, [patients, visibleProtocols]);

  const protocolCounts = useMemo(() => {
    const counts = {};
    for (const protocol of visibleProtocols) {
      const apto = patients.filter((patient) => matrix[patient.id][protocol.id].apto).length;
      counts[protocol.id] = { apto, noApto: patients.length - apto };
    }
    return counts;
  }, [patients, visibleProtocols, matrix]);

  // Para cada protocolo, entre los pacientes No Apto, cuenta cuántas veces
  // aparece cada criterio como motivo real (una inclusión que no se cumplió,
  // o una exclusión que sí se activó) — para saber de un vistazo cuál es el
  // criterio que más está dejando gente afuera, sin tener que abrir paciente
  // por paciente.
  const exclusionStats = useMemo(() => {
    const statsByProtocol = {};
    for (const protocol of visibleProtocols) {
      const counts = new Map();
      let noAptoCount = 0;
      for (const patient of patients) {
        const result = matrix[patient.id]?.[protocol.id];
        if (!result || result.apto) continue;
        noAptoCount += 1;
        for (const r of result.inclusionResults) {
          if (r.pass) continue;
          const key = `${r.criterion.id}|${r.indeterminate ? 'sin dato' : 'no cumple'}`;
          const entry = counts.get(key) || { label: r.criterion.label, type: r.indeterminate ? 'sin dato' : 'no cumple', count: 0 };
          entry.count += 1;
          counts.set(key, entry);
        }
        for (const r of result.exclusionResults) {
          if (!r.pass) continue;
          const key = `${r.criterion.id}|exclusión`;
          const entry = counts.get(key) || { label: r.criterion.label, type: 'exclusión activada', count: 0 };
          entry.count += 1;
          counts.set(key, entry);
        }
      }
      const top = [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 5);
      statsByProtocol[protocol.id] = { noAptoCount, top };
    }
    return statsByProtocol;
  }, [patients, visibleProtocols, matrix]);

  function toggleExpand(patientId) {
    setExpandedPatient((prev) => (prev === patientId ? null : patientId));
  }

  function passesAptoFilter(isApto) {
    if (aptoFilter === APTO_FILTER_APTO) return isApto;
    if (aptoFilter === APTO_FILTER_NO_APTO) return !isApto;
    return true;
  }

  async function handleExportProtocol() {
    setExporting(true);
    try {
      if (visibleProtocols.length !== 1) {
        const rows = patients
          .filter((patient) => {
            const results = visibleProtocols.map((protocol) => matrix[patient.id][protocol.id].apto);
            const anyApto = results.some(Boolean);
            return passesAptoFilter(anyApto);
          })
          .map((patient) => {
            const row = patientToExportRow(patient);
            row.Fuente = getFuenteLabel(patient);
            for (const protocol of visibleProtocols) {
              const result = matrix[patient.id][protocol.id];
              row[protocol.name] = result.excluded ? 'EXCLUIDO' : result.apto ? 'APTO' : 'NO APTO';
              row[`${protocol.name} - Motivos`] = result.reasons.join(' | ');
            }
            return row;
          });
        const isAll = visibleProtocols.length === protocols.length;
        const fileName = isAll ? 'aptus_matriz_completa.xlsx' : 'aptus_matriz_combinada.xlsx';
        const sheetName = isAll ? 'Matriz completa' : 'Matriz combinada';
        await downloadStyledXLSX(fileName, rows, sheetName);
        return;
      }

      const protocol = visibleProtocols[0];
      const rows = patients
        .filter((patient) => passesAptoFilter(matrix[patient.id][protocol.id].apto))
        .map((patient) => {
          const result = matrix[patient.id][protocol.id];
          return {
            ...patientToExportRow(patient),
            Fuente: getFuenteLabel(patient),
            Protocolo: protocol.name,
            Resultado: result.excluded ? 'EXCLUIDO' : result.apto ? 'APTO' : 'NO APTO',
            Motivos: result.reasons.join(' | '),
          };
        });
      await downloadStyledXLSX(
        `aptus_matriz_${protocol.name.replace(/\s+/g, '_').toLowerCase()}.xlsx`,
        rows,
        protocol.name
      );
    } finally {
      setExporting(false);
    }
  }

  if (protocols.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-400">
        Crea al menos un protocolo en el módulo "Protocolos" para ver la matriz de compatibilidad.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="p-4 flex flex-wrap items-center gap-3">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide shrink-0">
            Cruzar protocolos con
          </span>
          <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden shrink-0">
            {DATA_SOURCES.map((s) => (
              <button
                key={s.key}
                onClick={() => onDataSourceChange(s.key)}
                className={`px-3 py-2 text-xs font-medium transition-colors ${
                  dataSource === s.key
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          {dataSource === 'historias' && loteOptions.length > 0 && (
            <MultiSelectDropdown
              options={loteOptions}
              selected={loteFilters}
              onChange={onLoteFiltersChange}
              allLabel="Todos los bloques"
            />
          )}
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 bg-blue-50 px-2.5 py-1.5 rounded-full shrink-0">
            <Users className="w-3.5 h-3.5" />
            {patients.length} pacientes en esta fuente
          </span>
        </div>

        <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 rounded-b-xl flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wide shrink-0">
            <SlidersHorizontal className="w-3.5 h-3.5" /> Filtrar
          </span>
          <MultiSelectDropdown
            label="Protocolos"
            options={protocols.map((p) => ({ id: p.id, label: p.name }))}
            selected={selectedProtocolIds}
            onChange={onSelectedProtocolIdsChange}
            allLabel="Todos (matriz completa)"
          />
          <select
            value={aptoFilter}
            onChange={(e) => onAptoFilterChange(e.target.value)}
            className="text-sm rounded-lg border border-slate-300 px-2.5 py-2 bg-white"
          >
            <option value={APTO_FILTER_ALL}>Todos (Apto y No Apto)</option>
            <option value={APTO_FILTER_APTO}>Solo APTO</option>
            <option value={APTO_FILTER_NO_APTO}>Solo NO APTO</option>
          </select>
          <button
            onClick={handleExportProtocol}
            disabled={exporting || patients.length === 0}
            className="ml-auto inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium shadow-sm hover:bg-blue-700 disabled:bg-slate-300 disabled:shadow-none disabled:cursor-not-allowed transition-colors"
          >
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Exportar XLSX
          </button>
        </div>
      </div>

      {patients.length > 0 && visibleProtocols.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">
            Principales motivos de exclusión por protocolo
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {visibleProtocols.map((protocol) => {
              const stat = exclusionStats[protocol.id];
              return (
                <div key={protocol.id} className="border border-slate-100 rounded-lg p-3">
                  <p className="text-xs font-semibold text-slate-700 mb-2">
                    {protocol.name}{' '}
                    <span className="text-slate-400 font-normal">({stat?.noAptoCount ?? 0} no aptos)</span>
                  </p>
                  {!stat || stat.noAptoCount === 0 ? (
                    <p className="text-xs text-slate-400 italic">Todos los pacientes son Aptos.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {stat.top.map((item, i) => (
                        <li key={i} className="flex items-center justify-between gap-2 text-xs text-slate-600">
                          <span className="truncate">
                            {item.label}{' '}
                            <span className="text-slate-400 italic">({item.type})</span>
                          </span>
                          <span className="font-medium text-slate-700 shrink-0">
                            {item.count} ({Math.round((item.count / stat.noAptoCount) * 100)}%)
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {patients.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-400">
          No hay pacientes disponibles en esta fuente de datos todavía.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Paciente</th>
                  {visibleProtocols.map((p) => (
                    <th key={p.id} className="text-center px-3 py-3 font-medium">
                      <div>{p.name}</div>
                      <div className="mt-1 flex items-center justify-center gap-2 text-[11px] font-normal normal-case">
                        <span className="text-green-600">✅ {protocolCounts[p.id]?.apto ?? 0}</span>
                        <span className="text-red-600">❌ {protocolCounts[p.id]?.noApto ?? 0}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {patients.map((patient) => (
                  <Fragment key={patient.id}>
                    <tr
                      onClick={() => toggleExpand(patient.id)}
                      className="hover:bg-slate-50 cursor-pointer"
                    >
                      <td className="px-4 py-3 font-medium text-slate-800">
                        <span className="inline-flex items-center gap-1.5">
                          {expandedPatient === patient.id ? (
                            <ChevronDown className="w-4 h-4 text-slate-400" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-slate-400" />
                          )}
                          {patient.name}
                        </span>
                      </td>
                      {visibleProtocols.map((protocol) => (
                        <td key={protocol.id} className="px-3 py-3 text-center">
                          <AptoBadge result={matrix[patient.id][protocol.id]} />
                        </td>
                      ))}
                    </tr>
                    {expandedPatient === patient.id && (
                      <tr>
                        <td colSpan={visibleProtocols.length + 1} className="bg-slate-50 px-4 py-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {visibleProtocols.map((protocol) => {
                              const result = matrix[patient.id][protocol.id];
                              return (
                                <div
                                  key={protocol.id}
                                  className="bg-white rounded-lg border border-slate-200 p-3"
                                >
                                  <div className="flex items-center justify-between mb-2">
                                    <p className="text-xs font-semibold text-slate-700">
                                      {protocol.name}
                                    </p>
                                    <AptoBadge result={result} />
                                  </div>
                                  <div className="space-y-2">
                                    {result.excluded && (
                                      <p className="text-xs text-slate-500">
                                        Excluido de forma general en Aptus: <strong>{result.exclusionReason}</strong>
                                        {result.exclusionProtocolo && ` (${result.exclusionProtocolo})`}
                                      </p>
                                    )}
                                    {result.inclusionResults.length > 0 && (
                                      <div>
                                        <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">
                                          Inclusión
                                        </p>
                                        <ul className="space-y-1">
                                          {result.inclusionResults.map((r, i) => (
                                            <CriterionRow key={i} result={r} />
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                    {result.exclusionResults.length > 0 && (
                                      <div>
                                        <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">
                                          Exclusión
                                        </p>
                                        <ul className="space-y-1">
                                          {result.exclusionResults.map((r, i) => (
                                            <CriterionRow key={i} result={r} invert />
                                          ))}
                                        </ul>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
