import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutDashboard,
  Database,
  FileStack,
  Database as DatabaseExternal,
  ClipboardList,
  Grid3x3,
  Sparkles,
  Stethoscope,
  Loader2,
  AlertTriangle,
  X,
} from 'lucide-react';
import {
  fetchPatients,
  createPatient,
  updatePatientApi,
  deletePatientApi,
  deleteAllPatientsApi,
  replacePatientsApi,
  fetchProtocols,
  createProtocol,
  updateProtocolApi,
  deleteProtocolApi,
  replaceProtocolsApi,
} from './utils/api';
import { normalizeExternalPatient } from './utils/normalizeExternalPatient';
import { findPatientByIdentification } from './utils/patientIdentity';
import { mergeDuplicatePatients } from './utils/patientMerge';
import { LEGACY_LOTE_ID } from './utils/loteConstants';
import {
  loadHistoriaItems,
  saveHistoriaItems,
  loadHistoriaSentIds,
  saveHistoriaSentIds,
  loadHistoriaLotes,
  saveHistoriaLotes,
  clearHistoriaStorage,
} from './utils/historiaStorage';
import Dashboard from './components/Dashboard';
import BaseMaestra from './components/BaseMaestra';
import HistoriasClinicas from './components/HistoriasClinicas';
import BDExterna from './components/BDExterna';
import Protocolos from './components/Protocolos';
import MatrizCompatibilidad from './components/MatrizCompatibilidad';
import Asistente from './components/Asistente';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'maestra', label: 'Base Maestra', icon: Database },
  { id: 'historias', label: 'Historias Clínicas', icon: FileStack },
  { id: 'externa', label: 'BD Externa', icon: DatabaseExternal },
  { id: 'protocolos', label: 'Protocolos', icon: ClipboardList },
  { id: 'matriz', label: 'Matriz de Compatibilidad', icon: Grid3x3 },
  { id: 'asistente', label: 'Preguntas (IA)', icon: Sparkles },
];

// El modelo no siempre devuelve `diagnostics` como string: a veces es un
// arreglo de frases. El motor NLP (nlpEngine.js) descarta cualquier valor que
// no sea string (`typeof text !== 'string'`), así que si este campo llega
// como arreglo sin unir, "Historias Clínicas cargadas" deja de detectar
// condiciones mencionadas en el texto libre (ej. "infarto") aunque el mismo
// paciente sí las detecte correctamente una vez enviado a Base Maestra, que
// sí pasaba por esta normalización.
function normalizeDiagnostics(value) {
  return Array.isArray(value) ? value.join(' ') : value ?? null;
}

function normalizeExtractedPatient(raw, source) {
  return {
    name: raw.name ?? 'Sin nombre',
    identification: raw.identification ?? null,
    edad: raw.edad ?? null,
    fechaNacimiento: raw.fechaNacimiento ?? null,
    phone: raw.phone ?? null,
    address: raw.address ?? null,
    imc: raw.imc ?? null,
    hta: raw.hta ?? null,
    dm2: raw.dm2 ?? null,
    erc: raw.erc ?? null,
    icc: raw.icc ?? null,
    fa: raw.fa ?? null,
    uacr: raw.uacr ?? null,
    fevi: raw.fevi ?? null,
    eventoCV: raw.eventoCV ?? null,
    dementia: raw.dementia ?? null,
    diagnostics: normalizeDiagnostics(raw.diagnostics),
    fechaIngreso: new Date().toISOString().slice(0, 10),
    source: source ?? null,
  };
}

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [patients, setPatients] = useState([]);
  const [protocols, setProtocols] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [actionError, setActionError] = useState(null);

  // Estado de BD Externa (filas importadas del último archivo cargado) se
  // mantiene aquí, no dentro del componente, para que sobreviva al cambiar
  // de pestaña en vez de perderse al desmontar BDExterna.
  const [externalRows, setExternalRows] = useState([]);
  const [externalFileName, setExternalFileName] = useState(null);

  // Igual que BD Externa: el listado de historias clínicas cargadas/procesadas
  // se mantiene aquí para que no se pierda al cambiar de pestaña. Además se
  // respalda en localStorage para que sobreviva a un refresco de página —
  // antes se perdía todo al recargar, incluso después de enviarlas a la
  // Base Maestra, lo que impedía cruzarlas en la Matriz de Compatibilidad.
  const [historiaItems, setHistoriaItems] = useState(loadHistoriaItems);
  const [historiaSentIds, setHistoriaSentIds] = useState(loadHistoriaSentIds);

  // Bloques de carga: agrupan las historias cargadas juntas (una sesión de
  // carga) con su fecha y fuente, para poder auditar cuántas se cargaron,
  // cuántas ya existían, y cruzar la Matriz de Compatibilidad contra un
  // bloque específico en vez de todas las historias mezcladas.
  const [historiaLotes, setHistoriaLotes] = useState(loadHistoriaLotes);
  const [activeLoteId, setActiveLoteId] = useState(null);

  // Selecciones del Dashboard y de Matriz de Compatibilidad: se mantienen acá
  // (no como useState local de cada componente) porque App.jsx solo renderiza
  // la pestaña activa — al cambiar de pestaña el componente anterior se
  // desmonta por completo, y con él cualquier estado local que tuviera. Antes
  // esto hacía que la combinación de bloque/protocolo elegida se reseteara
  // cada vez que se volvía a la pestaña.
  const [dashboardLoteIds, setDashboardLoteIds] = useState([]);
  const [dashboardProtocolIds, setDashboardProtocolIds] = useState([]);
  const [matrizDataSource, setMatrizDataSource] = useState('maestra');
  const [matrizLoteFilters, setMatrizLoteFilters] = useState([]);
  const [matrizProtocolIds, setMatrizProtocolIds] = useState([]);
  const [matrizAptoFilter, setMatrizAptoFilter] = useState('all');

  // Historial del asistente de preguntas (IA): mismo motivo que las
  // selecciones de arriba — si viviera como useState local de Asistente, se
  // perdería cada vez que se cambia de pestaña.
  const [assistantHistory, setAssistantHistory] = useState([]);

  useEffect(() => {
    saveHistoriaItems(historiaItems);
  }, [historiaItems]);

  useEffect(() => {
    saveHistoriaSentIds(historiaSentIds);
  }, [historiaSentIds]);

  useEffect(() => {
    saveHistoriaLotes(historiaLotes);
  }, [historiaLotes]);

  // Versiones "tipo paciente" de Historias Clínicas y BD Externa, para que
  // Matriz de Compatibilidad pueda cruzarlas contra los protocolos sin
  // necesidad de que el usuario las envíe primero a la Base Maestra.
  const historiaPatients = useMemo(
    () =>
      historiaItems
        .filter((it) => it.status === 'done' && it.patient)
        .map((it) => ({
          ...it.patient,
          diagnostics: normalizeDiagnostics(it.patient.diagnostics),
          id: it.id,
          source: 'historias',
          loteId: it.loteId ?? null,
        })),
    [historiaItems]
  );
  const externalPatients = useMemo(
    () => externalRows.map((row, i) => ({ ...normalizeExternalPatient(row), id: `externa-${i}` })),
    [externalRows]
  );

  async function loadInitialData() {
    setLoading(true);
    setLoadError(null);
    try {
      const [patientsData, protocolsData] = await Promise.all([fetchPatients(), fetchProtocols()]);
      setPatients(patientsData);
      setProtocols(protocolsData);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadInitialData();
  }, []);

  // Mantiene patientsRef sincronizado también para las mutaciones que no
  // pasan por la cola de envío (borrar, restaurar respaldo, BD Externa, etc.).
  useEffect(() => {
    patientsRef.current = patients;
  }, [patients]);

  // Guarda un paciente evitando duplicados: si ya existe alguien con la misma
  // identificación (normalizada), fusiona campo por campo tomando el dato
  // disponible de la historia más completa entre la nueva y la existente,
  // en vez de sobrescribir a ciegas (lo que antes podía borrar datos reales
  // con valores vacíos de una carga incompleta).
  async function upsertPatient(candidate, currentList) {
    const existing = findPatientByIdentification(currentList, candidate.identification);
    if (existing) {
      const merged = mergeDuplicatePatients(existing, candidate);
      return await updatePatientApi(existing.id, { ...merged, id: existing.id });
    }
    return await createPatient(candidate);
  }

  // Copia siempre-actualizada de `patients`, usada dentro de la cola de envío
  // de más abajo. `patients` (el estado de React) no sirve para esto porque
  // su valor queda "congelado" en el closure de cada llamada — si varias
  // historias del mismo paciente se envían casi al mismo tiempo (ej. "Enviar
  // todos"), todas verían la misma lista desactualizada y ninguna encontraría
  // a las demás, creando registros duplicados en vez de fusionarlos.
  const patientsRef = useRef(patients);

  // Cola de envío: procesa los pacientes de Historias Clínicas de a uno en
  // vez de en paralelo, para que la búsqueda de duplicados de cada uno vea
  // el resultado ya guardado del anterior. "Enviar todos" sigue disparando
  // las llamadas "al mismo tiempo" desde la UI, pero aquí se serializan.
  const sendQueueRef = useRef(Promise.resolve());

  function enqueueSend(task) {
    const result = sendQueueRef.current.then(task, task);
    // Evita que un fallo en una tarea bloquee las siguientes en la cola.
    sendQueueRef.current = result.catch(() => {});
    return result;
  }

  async function handleAddPatient(rawPatient, source) {
    return enqueueSend(async () => {
      try {
        const candidate = normalizeExtractedPatient(rawPatient, source);
        const saved = await upsertPatient(candidate, patientsRef.current);
        setPatients((prev) => {
          const exists = prev.some((p) => p.id === saved.id);
          const next = exists ? prev.map((p) => (p.id === saved.id ? saved : p)) : [...prev, saved];
          patientsRef.current = next;
          return next;
        });
      } catch (err) {
        setActionError(`No se pudo guardar el paciente: ${err.message}`);
      }
    });
  }

  async function handleSendExternalToMaestra(rows) {
    return enqueueSend(async () => {
      try {
        let working = [...patientsRef.current];
        for (const row of rows) {
          const candidate = normalizeExternalPatient(row);
          const saved = await upsertPatient(candidate, working);
          const exists = working.some((p) => p.id === saved.id);
          working = exists ? working.map((p) => (p.id === saved.id ? saved : p)) : [...working, saved];
        }
        patientsRef.current = working;
        setPatients(working);
      } catch (err) {
        setActionError(`No se pudo enviar los datos de BD Externa a la Base Maestra: ${err.message}`);
      }
    });
  }

  async function handleDeletePatient(id) {
    try {
      await deletePatientApi(id);
      setPatients((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setActionError(`No se pudo eliminar el paciente: ${err.message}`);
    }
  }

  async function handleDeleteAllPatients() {
    try {
      await deleteAllPatientsApi();
      setPatients([]);
    } catch (err) {
      setActionError(`No se pudo vaciar la Base Maestra: ${err.message}`);
    }
  }

  function handleResetHistorias() {
    setHistoriaItems([]);
    setHistoriaSentIds(new Set());
    setHistoriaLotes([]);
    setActiveLoteId(null);
    clearHistoriaStorage();
  }

  function handleCreateLote(fuente) {
    const lote = {
      id: `lote-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      fuente: fuente?.trim() || '',
      createdAt: new Date().toISOString(),
    };
    setHistoriaLotes((prev) => [...prev, lote]);
    setActiveLoteId(lote.id);
    return lote.id;
  }

  function handleDeleteLote(loteId) {
    setHistoriaItems((prev) => prev.filter((it) => it.loteId !== loteId));
    setHistoriaLotes((prev) => prev.filter((l) => l.id !== loteId));
    setActiveLoteId((prev) => (prev === loteId ? null : prev));
  }

  function handleRenameLote(loteId, fuente) {
    setHistoriaLotes((prev) =>
      prev.map((l) => (l.id === loteId ? { ...l, fuente: fuente?.trim() || '' } : l))
    );
  }

  // Fusiona dos o más bloques de carga en uno solo: todas las historias de
  // los bloques "de más" pasan a pertenecer al bloque destino (targetLoteId,
  // que debe ser uno de los elegidos), y esos otros bloques desaparecen como
  // entidad — sin perder ninguna historia, solo se reagrupan. Si entre los
  // elegidos está el grupo "sin bloque" (historias de antes de este
  // sistema), esas también pasan a tener el loteId del destino.
  function handleMergeLotes(loteIdsToMerge, targetLoteId) {
    if (!targetLoteId || !loteIdsToMerge.includes(targetLoteId)) return;
    setHistoriaItems((prev) =>
      prev.map((it) => {
        const currentGroup = it.loteId || LEGACY_LOTE_ID;
        if (loteIdsToMerge.includes(currentGroup) && currentGroup !== targetLoteId) {
          return { ...it, loteId: targetLoteId };
        }
        return it;
      })
    );
    setHistoriaLotes((prev) =>
      prev.filter((l) => l.id === targetLoteId || !loteIdsToMerge.includes(l.id))
    );
    setActiveLoteId((prev) =>
      loteIdsToMerge.includes(prev) && prev !== targetLoteId ? targetLoteId : prev
    );
  }

  function handleResetExterna() {
    setExternalRows([]);
    setExternalFileName(null);
  }

  async function handleRestoreBackup(backup) {
    try {
      if (Array.isArray(backup?.patients)) {
        const saved = await replacePatientsApi(backup.patients);
        setPatients(saved);
      }
      if (Array.isArray(backup?.protocols)) {
        const saved = await replaceProtocolsApi(backup.protocols);
        setProtocols(saved);
      }
    } catch (err) {
      setActionError(`No se pudo restaurar el respaldo: ${err.message}`);
    }
  }

  async function handleSaveProtocol(protocol) {
    try {
      const exists = protocols.some((p) => p.id === protocol.id);
      if (exists) {
        const updated = await updateProtocolApi(protocol.id, protocol);
        setProtocols((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      } else {
        const created = await createProtocol(protocol);
        setProtocols((prev) => [...prev, created]);
      }
    } catch (err) {
      setActionError(`No se pudo guardar el protocolo: ${err.message}`);
    }
  }

  async function handleDeleteProtocol(id) {
    try {
      await deleteProtocolApi(id);
      setProtocols((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setActionError(`No se pudo eliminar el protocolo: ${err.message}`);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 print:hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-600 text-white">
            <Stethoscope className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-800 leading-tight">Aptus</h1>
            <p className="text-xs text-slate-400 leading-tight">Clinical Pre-Screener</p>
          </div>
        </div>
        <nav className="max-w-7xl mx-auto px-4 sm:px-6 flex gap-1 overflow-x-auto">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                  isActive
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {actionError && (
          <div className="mb-4 flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3 print:hidden">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{actionError}</span>
            <button onClick={() => setActionError(null)} className="ml-auto text-red-400 hover:text-red-600">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin" />
            <p className="text-sm">Cargando datos desde el servidor...</p>
          </div>
        )}

        {!loading && loadError && (
          <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
            <AlertTriangle className="w-10 h-10 text-red-400" />
            <p className="text-sm text-red-600 max-w-md">{loadError}</p>
            <button
              onClick={loadInitialData}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              Reintentar
            </button>
          </div>
        )}

        {!loading && !loadError && (
          <>
            {activeTab === 'dashboard' && (
              <Dashboard
                patients={patients}
                protocols={protocols}
                historiaPatients={historiaPatients}
                historiaLotes={historiaLotes}
                selectedLoteIds={dashboardLoteIds}
                onSelectedLoteIdsChange={setDashboardLoteIds}
                selectedProtocolIds={dashboardProtocolIds}
                onSelectedProtocolIdsChange={setDashboardProtocolIds}
              />
            )}
            {activeTab === 'maestra' && (
              <BaseMaestra
                patients={patients}
                protocols={protocols}
                onDeletePatient={handleDeletePatient}
                onDeleteAllPatients={handleDeleteAllPatients}
                onRestoreBackup={handleRestoreBackup}
              />
            )}
            {activeTab === 'historias' && (
              <HistoriasClinicas
                items={historiaItems}
                onItemsChange={setHistoriaItems}
                sentIds={historiaSentIds}
                onSentIdsChange={setHistoriaSentIds}
                onAddPatient={(patient) => handleAddPatient(patient, 'historias')}
                onReset={handleResetHistorias}
                maestraPatients={patients}
                lotes={historiaLotes}
                activeLoteId={activeLoteId}
                onActiveLoteChange={setActiveLoteId}
                onCreateLote={handleCreateLote}
                onDeleteLote={handleDeleteLote}
                onRenameLote={handleRenameLote}
                onMergeLotes={handleMergeLotes}
              />
            )}
            {activeTab === 'externa' && (
              <BDExterna
                rows={externalRows}
                onRowsChange={setExternalRows}
                fileName={externalFileName}
                onFileNameChange={setExternalFileName}
                onSendToMaestra={handleSendExternalToMaestra}
                onReset={handleResetExterna}
              />
            )}
            {activeTab === 'protocolos' && (
              <Protocolos
                protocols={protocols}
                onSaveProtocol={handleSaveProtocol}
                onDeleteProtocol={handleDeleteProtocol}
              />
            )}
            {activeTab === 'matriz' && (
              <MatrizCompatibilidad
                maestraPatients={patients}
                historiaPatients={historiaPatients}
                historiaLotes={historiaLotes}
                externalPatients={externalPatients}
                protocols={protocols}
                dataSource={matrizDataSource}
                onDataSourceChange={setMatrizDataSource}
                loteFilters={matrizLoteFilters}
                onLoteFiltersChange={setMatrizLoteFilters}
                selectedProtocolIds={matrizProtocolIds}
                onSelectedProtocolIdsChange={setMatrizProtocolIds}
                aptoFilter={matrizAptoFilter}
                onAptoFilterChange={setMatrizAptoFilter}
              />
            )}
            {activeTab === 'asistente' && (
              <Asistente
                patients={patients}
                protocols={protocols}
                history={assistantHistory}
                onHistoryChange={setAssistantHistory}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
