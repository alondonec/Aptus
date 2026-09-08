import { useState } from 'react';
import { Plus, Trash2, Pencil, X, Save, ClipboardList, Sparkles, Loader2, Wand2, ChevronDown, ChevronRight, AlertCircle } from 'lucide-react';
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

// Un grupo combina varios criterios (u otros grupos, anidados) con lógica
// "al menos uno de" (OR) o "todos" (AND) — necesario para protocolos cuyos
// criterios de inclusión no son una simple lista plana, sino algo como
// "Edad ≥ 18 Y (Evento CV O Enfermedad coronaria intervenida O (DM2 Y
// (Edad > 65 O ...)))".
function emptyGroup() {
  return {
    id: `g${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: 'group',
    logicalOperator: 'OR',
    label: '',
    children: [],
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

/** Versión recursiva de formatCriterionLabel: para un grupo, describe su
 * operador lógico y encierra la descripción de cada hijo (hoja o subgrupo). */
function formatNodeLabel(node) {
  if (node?.type === 'group') {
    const joiner = node.logicalOperator === 'OR' ? ' O ' : ' Y ';
    const title = node.label?.trim() ? `${node.label}: ` : node.logicalOperator === 'OR' ? 'Al menos uno de: ' : 'Todos: ';
    const inner = (node.children || []).map(formatNodeLabel).join(joiner);
    return `${title}(${inner || 'vacío'})`;
  }
  return formatCriterionLabel(node);
}

/** Editor de una hoja (criterio simple): mismo formulario de siempre (campo,
 * operador, valor/palabras clave), ahora parametrizado por props en vez de
 * cerrar sobre el arreglo plano del padre, para poder anidarse dentro de
 * grupos a cualquier profundidad. */
function LeafEditor({ criterion: c, onChange, onRemove, suggestingIds, suggestError, onSuggestKeywords }) {
  const isCustom = c.field === CUSTOM_FIELD_KEY;
  const fieldDef = FIELD_OPTIONS.find((f) => f.key === c.field) || FIELD_OPTIONS[0];
  const operators = fieldDef.type === 'number' ? NUMERIC_OPERATORS : BOOLEAN_OPERATORS;

  function updateCriterion(patch) {
    onChange({ ...c, ...patch });
  }

  return (
    <div className="bg-white border border-slate-200 rounded-md px-2.5 py-2 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={c.field}
          onChange={(e) => {
            const nextField = FIELD_OPTIONS.find((f) => f.key === e.target.value);
            if (nextField.key === CUSTOM_FIELD_KEY) {
              updateCriterion({
                field: CUSTOM_FIELD_KEY,
                label: isCustom ? c.label : '',
                operator: 'true',
                value: undefined,
                keywords: c.keywords || [],
                keywordsInput: c.keywordsInput || '',
              });
            } else if (nextField.type === 'custom-preset') {
              updateCriterion({
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
              updateCriterion({
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
          onChange={(e) => updateCriterion({ operator: e.target.value })}
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
            onChange={(e) => updateCriterion({ value: Number(e.target.value) })}
            className="w-24 text-sm rounded-md border border-slate-300 px-2 py-1.5"
          />
        )}

        <button
          onClick={onRemove}
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
              onClick={() => onSuggestKeywords(c, updateCriterion)}
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
              updateCriterion({ keywordsInput: raw, keywords: parseKeywords(raw) });
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
              onChange={(e) => updateCriterion({ label: e.target.value })}
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
                onClick={() => onSuggestKeywords(c, updateCriterion)}
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
                updateCriterion({ keywordsInput: raw, keywords: parseKeywords(raw) });
              }}
              placeholder="Ej: cáncer, neoplasia, oncológico"
              className="w-full text-sm rounded-md border border-slate-300 px-2 py-1.5"
            />
          </div>
          {(!c.keywords || c.keywords.length === 0) && (
            <p className="text-[11px] text-slate-400 sm:col-span-2 flex items-center gap-1">
              <AlertCircle className="w-3 h-3 shrink-0" />
              Sin palabras clave: este criterio siempre quedará "sin dato" — útil si es intencional
              (revisión manual), o agrega palabras clave / usa "Sugerir con IA" para automatizarlo.
            </p>
          )}
          {suggestError && (
            <p className="text-[11px] text-red-600 sm:col-span-2">{suggestError}</p>
          )}
        </div>
      )}
    </div>
  );
}

/** Pastilla compacta para alternar entre O (al menos uno) y Y (todos) — un
 * solo control de dos letras en vez de dos botones con texto largo, para que
 * el ojo lo lea como un símbolo, no como una frase más que leer. */
function LogicToggle({ value, onChange }) {
  const isOr = value === 'OR';
  return (
    <div className="inline-flex rounded-full border border-slate-300 overflow-hidden text-xs font-bold shrink-0">
      <button
        type="button"
        onClick={() => onChange('OR')}
        title="Al menos uno de sus hijos debe cumplirse"
        className={`w-7 h-7 flex items-center justify-center transition-colors ${
          isOr ? 'bg-purple-600 text-white' : 'bg-white text-slate-400 hover:bg-slate-50'
        }`}
      >
        O
      </button>
      <button
        type="button"
        onClick={() => onChange('AND')}
        title="Todos sus hijos deben cumplirse"
        className={`w-7 h-7 flex items-center justify-center transition-colors ${
          !isOr ? 'bg-blue-600 text-white' : 'bg-white text-slate-400 hover:bg-slate-50'
        }`}
      >
        Y
      </button>
    </div>
  );
}

/** Línea divisoria con una pastilla "O"/"Y" al centro, entre cada par de
 * condiciones hermanas dentro de un grupo — así la lógica se lee de corrido
 * ("condición A" → O → "condición B") en vez de tener que subir la vista al
 * encabezado del grupo para recordar qué operador aplica. */
function LogicConnector({ operator }) {
  const isOr = operator === 'OR';
  return (
    <div className="flex items-center gap-2 py-0.5" aria-hidden="true">
      <div className="flex-1 border-t border-dashed border-slate-300" />
      <span
        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
          isOr ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
        }`}
      >
        {isOr ? 'O' : 'Y'}
      </span>
      <div className="flex-1 border-t border-dashed border-slate-300" />
    </div>
  );
}

/** Resumen de una línea para un grupo colapsado — "3 condiciones: Evento
 * cardiovascular, Enfermedad coronaria intervenida y 1 más". */
function summarizeGroupChildren(children) {
  if (!children || children.length === 0) return 'vacío';
  const names = children.map((c) => (c.type === 'group' ? c.label?.trim() || 'subgrupo' : c.label?.trim() || 'criterio sin nombre'));
  if (names.length <= 2) return names.join(' · ');
  return `${names.slice(0, 2).join(' · ')} y ${names.length - 2} más`;
}

/** Editor de un grupo: alterna entre "Al menos uno de" (OR) y "Todos" (AND),
 * y renderiza sus hijos recursivamente — cada hijo puede ser a su vez otro
 * grupo, lo que permite anidar (ej. un AND dentro de un OR) a cualquier
 * profundidad, como requiere el criterio "DM2 con complicaciones Y (edad>65
 * O tabaquismo O TFG<45)" dentro de un grupo OR más grande. Se muestra como
 * una barra de color a la izquierda (no una caja completa) para que anidar
 * varios niveles no se sienta como cajas dentro de cajas dentro de cajas. */
function GroupEditor({ group, onChange, onRemove, suggestingIds, suggestError, onSuggestKeywords, depth }) {
  const [collapsed, setCollapsed] = useState(false);

  function updateChildAt(index, updatedChild) {
    onChange({ ...group, children: group.children.map((c, i) => (i === index ? updatedChild : c)) });
  }
  function removeChildAt(index) {
    onChange({ ...group, children: group.children.filter((_, i) => i !== index) });
  }
  function addLeafChild() {
    onChange({ ...group, children: [...group.children, emptyCriterion()] });
  }
  function addCustomLeafChild() {
    onChange({ ...group, children: [...group.children, emptyCustomCriterion()] });
  }
  function addSubgroup() {
    onChange({ ...group, children: [...group.children, emptyGroup()] });
  }

  const isOr = group.logicalOperator === 'OR';
  const accent = isOr ? 'border-purple-400' : 'border-blue-400';
  const headerBg = isOr ? 'bg-purple-50' : 'bg-blue-50';

  return (
    <div className={`border-l-4 ${accent} rounded-sm`}>
      <div className={`flex flex-wrap items-center gap-2 ${headerBg} rounded-r-md pl-2 pr-1.5 py-1.5`}>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="text-slate-500 hover:text-slate-700 shrink-0"
          title={collapsed ? 'Expandir grupo' : 'Colapsar grupo'}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        <LogicToggle value={group.logicalOperator} onChange={(op) => onChange({ ...group, logicalOperator: op })} />
        <input
          value={group.label || ''}
          onChange={(e) => onChange({ ...group, label: e.target.value })}
          placeholder={isOr ? 'Nombre del grupo (ej: Al menos uno de)' : 'Nombre del grupo (ej: Todos estos)'}
          className="flex-1 min-w-[140px] text-sm font-medium rounded-md border border-transparent bg-white/70 px-2 py-1 focus:border-slate-300 focus:bg-white"
        />
        <span className="text-[11px] text-slate-400 shrink-0">
          {group.children.length} {group.children.length === 1 ? 'condición' : 'condiciones'}
        </span>
        <button onClick={onRemove} className="text-slate-400 hover:text-red-500 transition-colors shrink-0">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {collapsed ? (
        <p className="text-xs text-slate-500 italic pl-4 py-1.5">{summarizeGroupChildren(group.children)}</p>
      ) : (
        <div className="pl-4 pt-2 space-y-0">
          {group.children.length === 0 && (
            <p className="text-xs text-slate-400 italic pb-2">Grupo vacío — agrega condiciones abajo.</p>
          )}
          {group.children.map((child, i) => (
            <div key={child.id}>
              {i > 0 && <LogicConnector operator={group.logicalOperator} />}
              <div className="py-1">
                <CriterionNode
                  node={child}
                  onChange={(updated) => updateChildAt(i, updated)}
                  onRemove={() => removeChildAt(i)}
                  suggestingIds={suggestingIds}
                  suggestError={suggestError}
                  onSuggestKeywords={onSuggestKeywords}
                  depth={depth + 1}
                />
              </div>
            </div>
          ))}

          <div className="flex items-center gap-3 pt-1 pb-2">
            <button
              onClick={addLeafChild}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              <Plus className="w-3.5 h-3.5" /> Criterio
            </button>
            <button
              onClick={addCustomLeafChild}
              className="inline-flex items-center gap-1 text-xs font-medium text-purple-600 hover:text-purple-700"
            >
              <Sparkles className="w-3.5 h-3.5" /> Personalizado
            </button>
            {depth < 4 && (
              <button
                onClick={addSubgroup}
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-700"
              >
                <Plus className="w-3.5 h-3.5" /> Subgrupo
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Despacha entre LeafEditor y GroupEditor según el tipo de nodo. */
function CriterionNode({ node, onChange, onRemove, suggestingIds, suggestError, onSuggestKeywords, depth }) {
  if (node.type === 'group') {
    return (
      <GroupEditor
        group={node}
        onChange={onChange}
        onRemove={onRemove}
        suggestingIds={suggestingIds}
        suggestError={suggestError}
        onSuggestKeywords={onSuggestKeywords}
        depth={depth}
      />
    );
  }
  return (
    <LeafEditor
      criterion={node}
      onChange={onChange}
      onRemove={onRemove}
      suggestingIds={suggestingIds}
      suggestError={suggestError}
      onSuggestKeywords={onSuggestKeywords}
    />
  );
}

function CriteriaEditor({ title, criteria, onChange }) {
  const [suggestingIds, setSuggestingIds] = useState(() => new Set());
  const [suggestError, setSuggestError] = useState(null);

  function updateAt(index, updatedNode) {
    onChange(criteria.map((c, i) => (i === index ? updatedNode : c)));
  }

  function removeAt(index) {
    onChange(criteria.filter((_, i) => i !== index));
  }

  function addCriterion() {
    onChange([...criteria, emptyCriterion()]);
  }

  function addCustomCriterion() {
    onChange([...criteria, emptyCustomCriterion()]);
  }

  function addGroup() {
    onChange([...criteria, emptyGroup()]);
  }

  async function handleSuggestKeywords(c, applyPatch) {
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
      applyPatch({ keywords: merged, keywordsInput: merged.join(', ') });
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
          <button
            onClick={addGroup}
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-700"
          >
            <Plus className="w-3.5 h-3.5" /> Agregar grupo (O / Y)
          </button>
        </div>
      </div>
      {criteria.length === 0 && (
        <p className="text-xs text-slate-400 italic mb-2">Sin criterios definidos.</p>
      )}
      <div>
        {criteria.map((node, i) => (
          <div key={node.id}>
            {i > 0 && <LogicConnector operator="AND" />}
            <div className="py-1">
              <CriterionNode
                node={node}
                onChange={(updated) => updateAt(i, updated)}
                onRemove={() => removeAt(i)}
                suggestingIds={suggestingIds}
                suggestError={suggestError}
                onSuggestKeywords={handleSuggestKeywords}
                depth={0}
              />
            </div>
          </div>
        ))}
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
                        {formatNodeLabel(c)}
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
                        {formatNodeLabel(c)}
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
