import { useState } from 'react';
import { Plus, Trash2, Pencil, X, Save, ClipboardList, Sparkles, Loader2, Wand2 } from 'lucide-react';
import { FIELD_DEFS } from '../data/mockData';
import { suggestKeywords } from '../utils/api';

const CUSTOM_FIELD_KEY = 'custom';

const BOOLEAN_OPERATORS = [
  { value: 'true', label: 'Debe estar presente' },
  { value: 'false', label: 'Debe estar ausente' },
];
const NUMERIC_OPERATORS = [
  { value: '<', label: 'Menor que (<)' },
  { value: '<=', label: 'Menor o igual (≤)' },
  { value: '>', label: 'Mayor que (>)' },
  { value: '>=', label: 'Mayor o igual (≥)' },
];

// Condiciones sin campo estructurado en el modelo de paciente: se ofrecen
// como criterios personalizados preestablecidos (con palabras clave ya
// cargadas) que el motor NLP busca en el texto de diagnósticos, igual que
// cualquier criterio personalizado creado manualmente.
const PRESET_CUSTOM_CRITERIA = [
  {
    key: 'preset_cancer',
    label: 'Cáncer',
    keywords: ['cáncer', 'cancer', 'neoplasia', 'oncológico', 'oncologico', 'tumor maligno', 'carcinoma', 'metástasis', 'metastasis'],
  },
  {
    key: 'preset_dialisis',
    label: 'Diálisis o hemodiálisis',
    keywords: ['diálisis', 'dialisis', 'hemodiálisis', 'hemodialisis', 'dialítico', 'dialitico', 'terapia de reemplazo renal'],
  },
  {
    key: 'preset_hepatitis',
    label: 'Hepatitis Aguda',
    keywords: ['hepatitis aguda', 'hepatitis viral aguda', 'hepatitis fulminante'],
  },
];

// Opciones del selector de campo: los campos estructurados predefinidos, las
// condiciones preestablecidas sin campo estructurado, y la opción de criterio
// personalizado manual — todas resueltas por el motor NLP a partir de
// palabras clave buscadas en el texto de diagnósticos.
const FIELD_OPTIONS = [
  ...FIELD_DEFS,
  ...PRESET_CUSTOM_CRITERIA.map((p) => ({ key: p.key, label: p.label, type: 'custom-preset', keywords: p.keywords })),
  { key: CUSTOM_FIELD_KEY, label: 'Personalizado (definir manualmente)…', type: 'custom' },
];

// Palabras clave de respaldo preestablecidas para criterios cuantitativos:
// cuando la historia no trae el valor numérico pero sí menciona estas
// condiciones en el texto de diagnósticos, se usan para inferir si el
// criterio se cumple (ver evaluateCriterion en matchEngine.js).
const DEFAULT_NUMERIC_KEYWORDS = {
  imc: ['obesidad', 'sobrepeso'],
};

function emptyCriterion() {
  const first = FIELD_DEFS[0];
  const defaultKeywords = DEFAULT_NUMERIC_KEYWORDS[first.key] || [];
  return {
    id: `c${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    field: first.key,
    operator: first.type === 'boolean' ? 'true' : '<',
    value: first.type === 'number' ? 0 : undefined,
    label: first.label,
    keywords: defaultKeywords,
    keywordsInput: defaultKeywords.join(', '),
  };
}

function emptyCustomCriterion() {
  return {
    id: `c${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    field: CUSTOM_FIELD_KEY,
    operator: 'true',
    label: '',
    keywords: [],
    keywordsInput: '',
  };
}

function parseKeywords(text) {
  return text.split(',').map((k) => k.trim()).filter(Boolean);
}

function formatCriterionLabel(c) {
  if (c.field === CUSTOM_FIELD_KEY) {
    const name = c.label?.trim() || 'Criterio personalizado sin nombre';
    const state = c.operator === 'true' ? 'presente' : 'ausente';
    return `${name} (personalizado) = ${state}`;
  }
  return `${c.label} ${c.operator === 'true' ? '= sí' : c.operator === 'false' ? '= no' : `${c.operator} ${c.value}`}`;
}

function CriteriaEditor({ title, criteria, onChange }) {
  const [suggestingIds, setSuggestingIds] = useState(() => new Set());
  const [suggestError, setSuggestError] = useState(null);

  function updateCriterion(id, patch) {
    onChange(criteria.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function addCriterion() {
    onChange([...criteria, emptyCriterion()]);
  }

  function addCustomCriterion() {
    onChange([...criteria, emptyCustomCriterion()]);
  }

  function removeCriterion(id) {
    onChange(criteria.filter((c) => c.id !== id));
  }

  async function handleSuggestKeywords(c) {
    const name = c.label?.trim();
    if (!name) {
      setSuggestError('Escribe primero un nombre para el criterio antes de sugerir palabras clave.');
      return;
    }
    setSuggestError(null);
    setSuggestingIds((prev) => new Set(prev).add(c.id));
    try {
      const suggested = await suggestKeywords(name);
      const merged = Array.from(new Set([...(c.keywords || []), ...suggested]));
      updateCriterion(c.id, { keywords: merged, keywordsInput: merged.join(', ') });
    } catch (err) {
      setSuggestError(`No se pudieron sugerir palabras clave: ${err.message}`);
    } finally {
      setSuggestingIds((prev) => {
        const next = new Set(prev);
        next.delete(c.id);
        return next;
      });
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-semibold text-slate-700">{title}</p>
        <div className="flex items-center gap-3">
          <button
            onClick={addCriterion}
            className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
          >
            <Plus className="w-3.5 h-3.5" /> Agregar criterio
          </button>
          <button
            onClick={addCustomCriterion}
            className="inline-flex items-center gap-1 text-xs font-medium text-purple-600 hover:text-purple-700"
          >
            <Sparkles className="w-3.5 h-3.5" /> Criterio personalizado
          </button>
        </div>
      </div>
      {criteria.length === 0 && (
        <p className="text-xs text-slate-400 italic mb-2">Sin criterios definidos.</p>
      )}
      <div className="space-y-2">
        {criteria.map((c) => {
          const isCustom = c.field === CUSTOM_FIELD_KEY;
          const fieldDef = FIELD_OPTIONS.find((f) => f.key === c.field) || FIELD_OPTIONS[0];
          const operators =
            fieldDef.type === 'number' ? NUMERIC_OPERATORS : BOOLEAN_OPERATORS;
          return (
            <div key={c.id} className="bg-slate-50 rounded-lg p-2 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={c.field}
                  onChange={(e) => {
                    const nextField = FIELD_OPTIONS.find((f) => f.key === e.target.value);
                    if (nextField.key === CUSTOM_FIELD_KEY) {
                      updateCriterion(c.id, {
                        field: CUSTOM_FIELD_KEY,
                        label: isCustom ? c.label : '',
                        operator: 'true',
                        value: undefined,
                        keywords: c.keywords || [],
                        keywordsInput: c.keywordsInput || '',
                      });
                    } else if (nextField.type === 'custom-preset') {
                      updateCriterion(c.id, {
                        field: CUSTOM_FIELD_KEY,
                        label: nextField.label,
                        operator: 'true',
                        value: undefined,
                        keywords: nextField.keywords,
                        keywordsInput: nextField.keywords.join(', '),
                      });
                    } else {
                      const defaultKeywords =
                        nextField.type === 'number' ? DEFAULT_NUMERIC_KEYWORDS[nextField.key] || [] : [];
                      updateCriterion(c.id, {
                        field: nextField.key,
                        label: nextField.label,
                        operator: nextField.type === 'boolean' ? 'true' : '<',
                        value: nextField.type === 'number' ? 0 : undefined,
                        keywords: nextField.type === 'number' ? defaultKeywords : undefined,
                        keywordsInput: nextField.type === 'number' ? defaultKeywords.join(', ') : undefined,
                      });
                    }
                  }}
                  className="text-sm rounded-md border border-slate-300 px-2 py-1.5 bg-white"
                >
                  {FIELD_OPTIONS.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>

                <select
                  value={c.operator}
                  onChange={(e) => updateCriterion(c.id, { operator: e.target.value })}
                  className="text-sm rounded-md border border-slate-300 px-2 py-1.5 bg-white"
                >
                  {operators.map((op) => (
                    <option key={op.value} value={op.value}>
                      {op.label}
                    </option>
                  ))}
                </select>

                {fieldDef.type === 'number' && (
                  <input
                    type="number"
                    value={c.value ?? 0}
                    onChange={(e) => updateCriterion(c.id, { value: Number(e.target.value) })}
                    className="w-24 text-sm rounded-md border border-slate-300 px-2 py-1.5"
                  />
                )}

                <button
                  onClick={() => removeCriterion(c.id)}
                  className="ml-auto text-slate-400 hover:text-red-500 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {!isCustom && fieldDef.type === 'number' && (
                <div>
                  <div className="flex items-center justify-between mb-0.5">
                    <label className="text-[11px] font-medium text-slate-500">
                      Palabras clave de respaldo en diagnósticos (opcional, separadas por coma)
                    </label>
                    <button
                      onClick={() => handleSuggestKeywords(c)}
                      disabled={suggestingIds.has(c.id)}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-purple-600 hover:text-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {suggestingIds.has(c.id) ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Wand2 className="w-3 h-3" />
                      )}
                      Sugerir con IA
                    </button>
                  </div>
                  <input
                    value={c.keywordsInput ?? ''}
                    onChange={(e) => {
                      const raw = e.target.value;
                      updateCriterion(c.id, { keywordsInput: raw, keywords: parseKeywords(raw) });
                    }}
                    placeholder="Ej: obesidad, sobrepeso"
                    className="w-full text-sm rounded-md border border-slate-300 px-2 py-1.5"
                  />
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Si la historia no trae el valor numérico de {fieldDef.label}, se buscarán estas palabras en el
                    texto de diagnósticos para decidir si el criterio se cumple.
                  </p>
                </div>
              )}

              {isCustom && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] font-medium text-slate-500 block mb-0.5">
                      Nombre del criterio
                    </label>
                    <input
                      value={c.label}
                      onChange={(e) => updateCriterion(c.id, { label: e.target.value })}
                      placeholder="Ej: Cáncer activo"
                      className="w-full text-sm rounded-md border border-slate-300 px-2 py-1.5"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-0.5">
                      <label className="text-[11px] font-medium text-slate-500">
                        Palabras clave en diagnósticos (separadas por coma)
                      </label>
                      <button
                        onClick={() => handleSuggestKeywords(c)}
                        disabled={suggestingIds.has(c.id)}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-purple-600 hover:text-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {suggestingIds.has(c.id) ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Wand2 className="w-3 h-3" />
                        )}
                        Sugerir con IA
                      </button>
                    </div>
                    <input
                      value={c.keywordsInput ?? ''}
                      onChange={(e) => {
                        const raw = e.target.value;
                        updateCriterion(c.id, {
                          keywordsInput: raw,
                          keywords: parseKeywords(raw),
                        });
                      }}
                      placeholder="Ej: cáncer, neoplasia, oncológico"
                      className="w-full text-sm rounded-md border border-slate-300 px-2 py-1.5"
                    />
                  </div>
                  {(!c.keywords || c.keywords.length === 0) && (
                    <p className="text-[11px] text-amber-600 sm:col-span-2">
                      Agrega al menos una palabra clave para que el motor NLP pueda evaluar este criterio
                      contra el texto de diagnósticos, o usa "Sugerir con IA".
                    </p>
                  )}
                  {suggestError && (
                    <p className="text-[11px] text-red-600 sm:col-span-2">{suggestError}</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProtocolEditor({ protocol, onSave, onCancel, saving }) {
  const [name, setName] = useState(protocol?.name || '');
  const [description, setDescription] = useState(protocol?.description || '');
  const [inclusionCriteria, setInclusionCriteria] = useState(protocol?.inclusionCriteria || []);
  const [exclusionCriteria, setExclusionCriteria] = useState(protocol?.exclusionCriteria || []);

  function handleSave() {
    if (!name.trim()) return;
    onSave({
      id: protocol?.id || `proto${Date.now()}`,
      name: name.trim(),
      description: description.trim(),
      inclusionCriteria,
      exclusionCriteria,
    });
  }

  return (
    <div className="bg-white rounded-xl border-2 border-blue-200 p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-800">
          {protocol ? 'Editar protocolo' : 'Nuevo protocolo'}
        </h3>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-600">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">Nombre del protocolo</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full text-sm rounded-lg border border-slate-300 px-3 py-2"
            placeholder="Ej: Control Metabólico HTA-DM2"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">Descripción</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full text-sm rounded-lg border border-slate-300 px-3 py-2"
            placeholder="Breve descripción del protocolo"
          />
        </div>
      </div>

      <CriteriaEditor
        title="Criterios de inclusión"
        criteria={inclusionCriteria}
        onChange={setInclusionCriteria}
      />
      <CriteriaEditor
        title="Criterios de exclusión"
        criteria={exclusionCriteria}
        onChange={setExclusionCriteria}
      />

      <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
        >
          Cancelar
        </button>
        <button
          onClick={handleSave}
          disabled={!name.trim() || saving}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Guardando...' : 'Guardar protocolo'}
        </button>
      </div>
    </div>
  );
}

export default function Protocolos({ protocols, onSaveProtocol, onDeleteProtocol }) {
  const [editingId, setEditingId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [saving, setSaving] = useState(false);

  async function handleSave(protocol) {
    setSaving(true);
    try {
      await onSaveProtocol(protocol);
      setEditingId(null);
      setCreating(false);
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete(id) {
    await onDeleteProtocol(id);
    setPendingDeleteId(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-800 flex items-center gap-2">
          <ClipboardList className="w-5 h-5 text-blue-600" /> Protocolos clínicos
          <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
            {protocols.length} protocolos
          </span>
        </h3>
        {!creating && (
          <button
            onClick={() => {
              setCreating(true);
              setEditingId(null);
            }}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" /> Nuevo protocolo
          </button>
        )}
      </div>

      {creating && (
        <ProtocolEditor onSave={handleSave} onCancel={() => setCreating(false)} saving={saving} />
      )}

      <div className="space-y-3">
        {protocols.map((protocol) =>
          editingId === protocol.id ? (
            <ProtocolEditor
              key={protocol.id}
              protocol={protocol}
              onSave={handleSave}
              onCancel={() => setEditingId(null)}
              saving={saving}
            />
          ) : (
            <div
              key={protocol.id}
              className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="font-semibold text-slate-800">{protocol.name}</h4>
                  <p className="text-sm text-slate-500 mt-0.5">{protocol.description}</p>
                </div>
                {pendingDeleteId === protocol.id ? (
                  <div className="flex items-center gap-2 shrink-0 bg-red-50 rounded-lg px-2 py-1.5">
                    <span className="text-xs text-red-700 font-medium">¿Eliminar?</span>
                    <button
                      onClick={() => confirmDelete(protocol.id)}
                      className="px-2 py-1 rounded-md bg-red-600 text-white text-xs font-medium hover:bg-red-700 transition-colors"
                    >
                      Sí, eliminar
                    </button>
                    <button
                      onClick={() => setPendingDeleteId(null)}
                      className="px-2 py-1 rounded-md text-xs font-medium text-slate-600 hover:bg-slate-200 transition-colors"
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => {
                        setEditingId(protocol.id);
                        setCreating(false);
                      }}
                      className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setPendingDeleteId(protocol.id)}
                      className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="font-medium text-slate-500 mb-1">Inclusión</p>
                  <ul className="space-y-1">
                    {protocol.inclusionCriteria.map((c) => (
                      <li key={c.id} className="px-2 py-1 rounded bg-green-50 text-green-700">
                        {formatCriterionLabel(c)}
                      </li>
                    ))}
                    {protocol.inclusionCriteria.length === 0 && (
                      <li className="text-slate-400 italic">Ninguno</li>
                    )}
                  </ul>
                </div>
                <div>
                  <p className="font-medium text-slate-500 mb-1">Exclusión</p>
                  <ul className="space-y-1">
                    {protocol.exclusionCriteria.map((c) => (
                      <li key={c.id} className="px-2 py-1 rounded bg-red-50 text-red-700">
                        {formatCriterionLabel(c)}
                      </li>
                    ))}
                    {protocol.exclusionCriteria.length === 0 && (
                      <li className="text-slate-400 italic">Ninguno</li>
                    )}
                  </ul>
                </div>
              </div>
            </div>
          )
        )}

        {protocols.length === 0 && !creating && (
          <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-400">
            No hay protocolos definidos. Crea el primero con el botón "Nuevo protocolo".
          </div>
        )}
      </div>
    </div>
  );
}
