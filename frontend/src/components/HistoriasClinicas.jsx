import { useCallback, useMemo, useRef, useState } from 'react';
import {
  UploadCloud,
  FileText,
  CheckCircle2,
  XCircle,
  Loader2,
  Send,
  X,
  Table2,
  Plus,
  ChevronDown,
  ChevronRight,
  Copy,
  Pencil,
  Check,
  Trash2,
  DollarSign,
} from 'lucide-react';
import { runWithConcurrency, uploadAndExtract } from '../utils/uploadQueue';
import { getPatientAge } from '../utils/patientAge';
import { normalizeIdentification } from '../utils/patientIdentity';
import TruncatedCell from './TruncatedCell';
import ConfirmResetButton from './ConfirmResetButton';
import { LEGACY_LOTE_ID } from '../utils/loteConstants';

const CONCURRENCY_LIMIT = 5;

function StatusIcon({ status }) {
  if (status === 'uploading') return <Loader2 className="w-4 h-4 animate-spin text-blue-500" />;
  if (status === 'done') return <CheckCircle2 className="w-4 h-4 text-green-600" />;
  if (status === 'error') return <XCircle className="w-4 h-4 text-red-500" />;
  return <FileText className="w-4 h-4 text-slate-400" />;
}

function ProgressBar({ progress, status }) {
  const color =
    status === 'error' ? 'bg-red-500' : status === 'done' ? 'bg-green-500' : 'bg-blue-500';
  return (
    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
      <div
        className={`h-full ${color} transition-all duration-200`}
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

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

function formatFecha(iso) {
  if (!iso) return 'Sin fecha';
  return new Date(iso).toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function HistoriasClinicas({
  items,
  onItemsChange,
  sentIds,
  onSentIdsChange,
  onAddPatient,
  onReset,
  maestraPatients,
  lotes,
  activeLoteId,
  onActiveLoteChange,
  onCreateLote,
  onDeleteLote,
  onRenameLote,
  onMergeLotes,
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragOverLoteId, setDragOverLoteId] = useState(null);
  const [sendingIds, setSendingIds] = useState(() => new Set());
  const [showNewLoteForm, setShowNewLoteForm] = useState(false);
  const [newLoteFuente, setNewLoteFuente] = useState('');
  const [expandedLoteIds, setExpandedLoteIds] = useState(() => new Set());
  const [editingLoteId, setEditingLoteId] = useState(null);
  const [editingFuente, setEditingFuente] = useState('');
  const [mergeSelection, setMergeSelection] = useState([]);
  const [mergeTargetId, setMergeTargetId] = useState(null);
  const [confirmingMerge, setConfirmingMerge] = useState(false);
  const inputRef = useRef(null);
  const addToLoteInputRefs = useRef({});

  function toggleMergeSelection(loteId) {
    const next = mergeSelection.includes(loteId)
      ? mergeSelection.filter((id) => id !== loteId)
      : [...mergeSelection, loteId];
    setMergeSelection(next);
    if (!next.includes(mergeTargetId)) {
      setMergeTargetId(next[0] ?? null);
    }
  }

  function cancelMerge() {
    setMergeSelection([]);
    setMergeTargetId(null);
    setConfirmingMerge(false);
  }

  function confirmMerge() {
    onMergeLotes(mergeSelection, mergeTargetId);
    setExpandedLoteIds((prev) => new Set(prev).add(mergeTargetId));
    cancelMerge();
  }

  function updateItem(id, patch) {
    onItemsChange((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  const maestraIdSet = useMemo(
    () =>
      new Set(
        (maestraPatients || [])
          .map((p) => normalizeIdentification(p.identification))
          .filter(Boolean)
      ),
    [maestraPatients]
  );

  function isDuplicate(item) {
    const id = item.patient?.identification;
    if (!id) return false;
    return maestraIdSet.has(normalizeIdentification(id));
  }

  const processFiles = useCallback(
    (fileList, targetLoteId) => {
      const pdfFiles = Array.from(fileList).filter((f) => f.type === 'application/pdf');
      if (!pdfFiles.length) return;

      const loteId = targetLoteId || activeLoteId || onCreateLote('');
      setExpandedLoteIds((prev) => new Set(prev).add(loteId));

      const newItems = pdfFiles.map((file) => ({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        loteId,
        file,
        fileName: file.name,
        fileSize: file.size,
        status: 'pending',
        progress: 0,
        patient: null,
        error: null,
      }));

      onItemsChange((prev) => [...prev, ...newItems]);

      runWithConcurrency(newItems, CONCURRENCY_LIMIT, async (item) => {
        updateItem(item.id, { status: 'uploading' });
        const result = await uploadAndExtract(item.file, (progress) => {
          updateItem(item.id, { progress });
        });
        if (result.success) {
          updateItem(item.id, {
            status: 'done',
            progress: 100,
            patient: result.patient,
            splitInto: result.splitInto,
            costUsd: result.costUsd,
          });
        } else {
          updateItem(item.id, {
            status: 'error',
            progress: 100,
            error: result.error || 'Error desconocido al procesar el PDF',
          });
        }
      });
    },
    [activeLoteId, onCreateLote]
  );

  function handleDrop(e) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.length) {
      processFiles(e.dataTransfer.files);
    }
  }

  // Arrastrar y soltar PDFs directamente sobre la tarjeta de un bloque ya
  // existente, como alternativa más rápida al botón "+ Agregar historias a
  // este bloque" (que abre el explorador de archivos).
  function handleLoteDrop(e, loteId) {
    e.preventDefault();
    e.stopPropagation();
    setDragOverLoteId(null);
    if (e.dataTransfer.files?.length) {
      processFiles(e.dataTransfer.files, loteId);
    }
  }

  async function sendOne(item) {
    if (!item.patient || sentIds.has(item.id) || sendingIds.has(item.id)) return;
    setSendingIds((prev) => new Set(prev).add(item.id));
    try {
      await onAddPatient(item.patient);
      onSentIdsChange((prev) => new Set(prev).add(item.id));
    } finally {
      setSendingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }

  async function handleSendLote(loteItems) {
    const toSend = loteItems.filter(
      (it) => it.status === 'done' && it.patient && !sentIds.has(it.id) && !sendingIds.has(it.id)
    );
    await Promise.all(toSend.map((it) => sendOne(it)));
  }

  function removeItem(id) {
    onItemsChange((prev) => prev.filter((it) => it.id !== id));
  }

  function toggleLote(loteId) {
    setExpandedLoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(loteId)) next.delete(loteId);
      else next.add(loteId);
      return next;
    });
  }

  function handleCreateLoteSubmit() {
    const loteId = onCreateLote(newLoteFuente);
    setNewLoteFuente('');
    setShowNewLoteForm(false);
    setExpandedLoteIds((prev) => new Set(prev).add(loteId));
  }

  function startEditingLote(lote) {
    setEditingLoteId(lote.id);
    setEditingFuente(lote.fuente || '');
  }

  function saveEditingLote() {
    onRenameLote(editingLoteId, editingFuente);
    setEditingLoteId(null);
    setEditingFuente('');
  }

  function cancelEditingLote() {
    setEditingLoteId(null);
    setEditingFuente('');
  }

  function handleDeleteLegacyItems() {
    onItemsChange((prev) => prev.filter((it) => it.loteId));
  }

  const loteGroups = useMemo(() => {
    const groups = lotes.map((lote) => ({
      ...lote,
      items: items.filter((it) => it.loteId === lote.id),
    }));
    const legacyItems = items.filter((it) => !it.loteId);
    if (legacyItems.length) {
      groups.push({
        id: LEGACY_LOTE_ID,
        fuente: 'Historias cargadas antes de tener bloques',
        createdAt: null,
        items: legacyItems,
        isLegacy: true,
      });
    }
    return groups.sort((a, b) => {
      if (a.isLegacy) return 1;
      if (b.isLegacy) return -1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }, [items, lotes]);

  const totalExtractedPatients = items.filter((it) => it.status === 'done' && it.patient).length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">Historias Clínicas</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
            {totalExtractedPatients} pacientes
          </span>
          <ConfirmResetButton
            label="Vaciar Historias Clínicas"
            itemLabel="archivos cargados (todos los bloques)"
            count={items.length}
            onConfirm={onReset}
          />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-700">Bloques de carga</h3>
          {!showNewLoteForm && (
            <button
              onClick={() => setShowNewLoteForm(true)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              <Plus className="w-3.5 h-3.5" /> Nuevo bloque de carga
            </button>
          )}
        </div>

        {showNewLoteForm && (
          <div className="bg-slate-50 rounded-lg p-3 mb-3 flex items-end gap-2">
            <div className="flex-1">
              <label className="text-[11px] font-medium text-slate-500 block mb-0.5">
                Fuente del bloque (ej: IPS Central, Consulta externa julio)
              </label>
              <input
                value={newLoteFuente}
                onChange={(e) => setNewLoteFuente(e.target.value)}
                placeholder="Opcional"
                className="w-full text-sm rounded-md border border-slate-300 px-2 py-1.5"
                autoFocus
              />
            </div>
            <button
              onClick={handleCreateLoteSubmit}
              className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 transition-colors"
            >
              Crear bloque
            </button>
            <button
              onClick={() => {
                setShowNewLoteForm(false);
                setNewLoteFuente('');
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-200 transition-colors"
            >
              Cancelar
            </button>
          </div>
        )}

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
            isDragging ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-white hover:bg-slate-50'
          }`}
        >
          <UploadCloud className="w-8 h-8 mx-auto text-blue-500 mb-2" />
          <p className="text-slate-700 font-medium text-sm">Arrastra historias clínicas en PDF aquí</p>
          <p className="text-xs text-slate-400 mt-1">
            {activeLoteId
              ? `Se agregarán al bloque activo (${lotes.find((l) => l.id === activeLoteId)?.fuente || 'sin nombre'})`
              : 'Se creará un nuevo bloque automáticamente'}{' '}
            · procesamiento concurrente de hasta {CONCURRENCY_LIMIT} PDFs
          </p>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && processFiles(e.target.files)}
          />
        </div>
      </div>

      {mergeSelection.length >= 2 && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-indigo-700">
            {mergeSelection.length} bloques seleccionados para fusionar
          </span>
          <span className="text-xs text-indigo-400">Fusionar en:</span>
          <select
            value={mergeTargetId ?? ''}
            onChange={(e) => setMergeTargetId(e.target.value)}
            className="text-xs rounded-lg border border-indigo-300 px-2 py-1.5 bg-white"
          >
            {mergeSelection.map((id) => {
              const lote = loteGroups.find((l) => l.id === id);
              return (
                <option key={id} value={id}>
                  {lote?.fuente || (lote?.isLegacy ? 'Historias sin bloque' : 'Bloque sin nombre')}
                </option>
              );
            })}
          </select>
          {confirmingMerge ? (
            <>
              <span className="text-xs text-indigo-700">
                ¿Confirmar fusión de {mergeSelection.length} bloques? Las historias de los demás pasarán a este
                bloque y los otros desaparecerán como bloque separado.
              </span>
              <button
                onClick={confirmMerge}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 transition-colors"
              >
                Confirmar fusión
              </button>
              <button
                onClick={() => setConfirmingMerge(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-indigo-100 transition-colors"
              >
                Volver
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setConfirmingMerge(true)}
                className="ml-auto px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 transition-colors"
              >
                Fusionar bloques
              </button>
              <button
                onClick={cancelMerge}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-indigo-100 transition-colors"
              >
                Cancelar
              </button>
            </>
          )}
        </div>
      )}

      {loteGroups.map((lote) => {
        const doneCount = lote.items.filter((it) => it.status === 'done').length;
        const extractedInLote = lote.items
          .filter((it) => it.status === 'done' && it.patient)
          .sort((a, b) => (a.patient.name || '').localeCompare(b.patient.name || '', 'es', { sensitivity: 'base' }));
        const duplicateCount = extractedInLote.filter(isDuplicate).length;
        // Identificaciones que aparecen más de una vez dentro de este mismo
        // bloque (el mismo paciente subido dos veces, ej. por error al
        // arrastrar el mismo PDF dos veces) — distinto de "ya existe en Base
        // Maestra", que compara contra pacientes ya guardados previamente.
        const identCountsInLote = {};
        for (const it of extractedInLote) {
          const key = normalizeIdentification(it.patient?.identification);
          if (key) identCountsInLote[key] = (identCountsInLote[key] || 0) + 1;
        }
        const repeatedInBatchExtraCount = Object.values(identCountsInLote)
          .filter((c) => c > 1)
          .reduce((sum, c) => sum + (c - 1), 0);
        const isRepeatedInBatch = (item) => {
          const key = normalizeIdentification(item.patient?.identification);
          return Boolean(key) && identCountsInLote[key] > 1;
        };
        const pendingSendInLote = extractedInLote.filter((it) => !sentIds.has(it.id)).length;
        // Costo real (no estimado) reportado por el backend para cada
        // historia extraída, según los tokens que realmente consumió esa
        // llamada al modelo. Las historias cargadas antes de este cambio (o
        // creadas por otro medio) no tienen este dato, así que se excluyen
        // del promedio en vez de contarlas como $0.
        const itemsWithCost = extractedInLote.filter((it) => typeof it.costUsd === 'number');
        const totalCostInLote = itemsWithCost.reduce((sum, it) => sum + it.costUsd, 0);
        const avgCostInLote = itemsWithCost.length ? totalCostInLote / itemsWithCost.length : null;
        const expanded = expandedLoteIds.has(lote.id);

        return (
          <div
            key={lote.id}
            onDragOver={(e) => {
              if (lote.isLegacy) return;
              e.preventDefault();
              setDragOverLoteId(lote.id);
            }}
            onDragLeave={() => setDragOverLoteId((prev) => (prev === lote.id ? null : prev))}
            onDrop={(e) => {
              if (lote.isLegacy) return;
              handleLoteDrop(e, lote.id);
            }}
            className={`bg-white rounded-xl border shadow-sm overflow-hidden transition-colors ${
              dragOverLoteId === lote.id ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200'
            }`}
          >
            <div
              onClick={() => toggleLote(lote.id)}
              className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-slate-50"
            >
              <div className="flex items-center gap-2 min-w-0">
                <input
                  type="checkbox"
                  checked={mergeSelection.includes(lote.id)}
                  onChange={() => toggleMergeSelection(lote.id)}
                  onClick={(e) => e.stopPropagation()}
                  title="Seleccionar para fusionar con otro bloque"
                  className="w-4 h-4 shrink-0 accent-indigo-600"
                />
                {expanded ? (
                  <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                )}
                {editingLoteId === lote.id ? (
                  <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <input
                      value={editingFuente}
                      onChange={(e) => setEditingFuente(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEditingLote();
                        if (e.key === 'Escape') cancelEditingLote();
                      }}
                      placeholder="Nombre del bloque"
                      autoFocus
                      className="text-sm rounded-md border border-slate-300 px-2 py-1 min-w-[200px]"
                    />
                    <button
                      onClick={saveEditingLote}
                      className="text-green-600 hover:text-green-700 shrink-0"
                      title="Guardar"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      onClick={cancelEditingLote}
                      className="text-slate-400 hover:text-red-500 shrink-0"
                      title="Cancelar"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="min-w-0 flex items-center gap-1.5 group">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">
                        {lote.fuente || 'Bloque sin nombre'}
                      </p>
                      <p className="text-xs text-slate-400">{formatFecha(lote.createdAt)}</p>
                    </div>
                    {!lote.isLegacy && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          startEditingLote(lote);
                        }}
                        className="text-slate-300 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        title="Editar nombre del bloque"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-1 rounded-full">
                  {lote.items.length} cargadas
                </span>
                <span
                  title="Pacientes cuya identificación ya existe en la Base Maestra"
                  className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${
                    duplicateCount > 0 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  <Copy className="w-3 h-3" /> {duplicateCount} ya en Base Maestra
                </span>
                <span
                  title="El mismo paciente fue subido más de una vez dentro de este bloque"
                  className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${
                    repeatedInBatchExtraCount > 0 ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  <Copy className="w-3 h-3" /> {repeatedInBatchExtraCount} repetidas en este bloque
                </span>
                {itemsWithCost.length > 0 && (
                  <span
                    title={`Costo real reportado por la API para ${itemsWithCost.length} de ${extractedInLote.length} historias de este bloque (promedio $${avgCostInLote.toFixed(4)}/HC)`}
                    className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full bg-emerald-50 text-emerald-700"
                  >
                    <DollarSign className="w-3 h-3" /> ${totalCostInLote.toFixed(2)} (~${avgCostInLote.toFixed(3)}/HC)
                  </span>
                )}
                <div onClick={(e) => e.stopPropagation()}>
                  <ConfirmResetButton
                    label="Eliminar bloque"
                    itemLabel="historias de este bloque"
                    count={lote.items.length}
                    onConfirm={() => (lote.isLegacy ? handleDeleteLegacyItems() : onDeleteLote(lote.id))}
                    disableWhenEmpty={false}
                  />
                </div>
              </div>
            </div>

            {expanded && (
              <div className="border-t border-slate-100">
                {!lote.isLegacy && (
                  <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-400">O arrastrá archivos PDF sobre este bloque</span>
                    <button
                      onClick={() => addToLoteInputRefs.current[lote.id]?.click()}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700"
                    >
                      <Plus className="w-3.5 h-3.5" /> Agregar historias a este bloque
                    </button>
                    <input
                      ref={(el) => {
                        addToLoteInputRefs.current[lote.id] = el;
                      }}
                      type="file"
                      accept="application/pdf"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files?.length) processFiles(e.target.files, lote.id);
                        e.target.value = '';
                      }}
                    />
                  </div>
                )}
                {lote.items.length > 0 && (
                  <ul className="divide-y divide-slate-100">
                    {lote.items.map((item) => (
                      <li key={item.id} className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <StatusIcon status={item.status} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-medium text-slate-800 truncate">{item.fileName}</p>
                              <span className="text-xs text-slate-400 shrink-0">
                                {((item.fileSize || 0) / 1024).toFixed(0)} KB
                              </span>
                            </div>
                            <div className="mt-1.5">
                              <ProgressBar progress={item.progress} status={item.status} />
                            </div>
                            {item.status === 'error' && (
                              <p className="text-xs text-red-500 mt-1">{item.error}</p>
                            )}
                            {item.status === 'done' && item.splitInto && (
                              <p className="text-xs text-slate-400 mt-1">
                                Documento extenso: dividido en {item.splitInto} partes para procesarlo
                              </p>
                            )}
                          </div>
                          <button
                            onClick={() => removeItem(item.id)}
                            className="text-slate-300 hover:text-red-500 transition-colors shrink-0"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {extractedInLote.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50">
                      <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                        <Table2 className="w-4 h-4 text-blue-600" /> Datos extraídos ({extractedInLote.length})
                      </h4>
                      <button
                        onClick={() => handleSendLote(extractedInLote)}
                        disabled={pendingSendInLote === 0}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors"
                      >
                        <Send className="w-4 h-4" /> Enviar todos a Base Maestra ({pendingSendInLote})
                      </button>
                    </div>
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
                            <th className="text-center px-3 py-3 font-medium">Costo</th>
                            <th className="px-3 py-3"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {extractedInLote.map((item) => {
                            const p = item.patient;
                            const sent = sentIds.has(item.id);
                            const sending = sendingIds.has(item.id);
                            const duplicate = isDuplicate(item);
                            const repeated = isRepeatedInBatch(item);
                            return (
                              <tr key={item.id} className="hover:bg-slate-50">
                                <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">
                                  <div className="flex items-center gap-1.5">
                                    {p.name || 'Sin nombre'}
                                    {repeated && (
                                      <span
                                        title="El mismo paciente fue subido más de una vez dentro de este bloque"
                                        className="inline-flex items-center gap-1 text-[10px] font-medium text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded"
                                      >
                                        <Copy className="w-2.5 h-2.5" /> Repetido en el bloque
                                      </span>
                                    )}
                                    {duplicate && (
                                      <span
                                        title="Ya existe un paciente con esta identificación en la Base Maestra"
                                        className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded"
                                      >
                                        <Copy className="w-2.5 h-2.5" /> Ya en Base Maestra
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                                  {p.identification ?? '—'}
                                </td>
                                <td className="px-3 py-3 text-center text-slate-700">{getPatientAge(p) ?? '—'}</td>
                                <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{p.phone ?? '—'}</td>
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
                                <td className="px-3 py-3 text-center text-slate-500 whitespace-nowrap">
                                  {typeof item.costUsd === 'number' ? `$${item.costUsd.toFixed(4)}` : '—'}
                                </td>
                                <td className="px-3 py-3 text-center">
                                  <div className="inline-flex items-center gap-1.5">
                                    <button
                                      onClick={() => sendOne(item)}
                                      disabled={sent || sending}
                                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                                    >
                                      {sending ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      ) : (
                                        <Send className="w-3.5 h-3.5" />
                                      )}
                                      {sent ? 'Enviado' : 'Enviar'}
                                    </button>
                                    <button
                                      onClick={() => removeItem(item.id)}
                                      title="Eliminar esta historia del bloque"
                                      className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {loteGroups.length === 0 && (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-400">
          No hay bloques de carga todavía. Crea uno y arrastra los PDF de historias clínicas.
        </div>
      )}
    </div>
  );
}
