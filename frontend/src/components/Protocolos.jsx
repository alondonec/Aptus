import { useState, useMemo } from 'react';
import { Plus, Trash2, Pencil, X, Save, ClipboardList, Sparkles, Loader2, Wand2, ChevronDown, ChevronRight, AlertCircle, List, GitBranch, Search } from 'lucide-react';
import { FIELD_DEFS } from '../data/mockData';
import { suggestKeywords, parseProtocolCriteria } from '../utils/api';
import { evaluatePatientForProtocol } from '../utils/matchEngine';

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

/** El texto generado por IA (o pegado desde otra fuente) no trae "id" en sus
 * nodos — Aptus siempre los asigna acá, recorriendo el árbol completo, para
 * garantizar que sean únicos incluso entre nodos generados en el mismo
 * milisegundo. También completa "keywordsInput" a partir de "keywords" para
 * que el campo de texto del editor arranque ya lleno. */
function assignIdsRecursive(nodes) {
  let counter = 0;
  function walk(list) {
    return (list || []).map((node) => {
      counter += 1;
      if (node.type === 'group') {
        return {
          ...node,
          id: node.id || `g${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 6)}`,
          children: walk(node.children),
        };
      }
      return {
        ...node,
        id: node.id || `c${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 6)}`,
        keywordsInput: node.keywordsInput ?? (node.keywords ? node.keywords.join(', ') : ''),
      };
    });
  }
  return walk(nodes);
}

/** Punto de color que muestra si un criterio/grupo se cumplió (verde), no se
 * cumplió (rojo) o no se pudo evaluar (gris) al probar el árbol contra un
 * paciente real — ver el selector de "paciente de prueba" en ProtocolEditor. */
// Para inclusión, pass:true es bueno (verde). Para exclusión es al revés:
// pass:true significa que la exclusión SÍ se activó (malo, rojo), y
// pass:false significa que no hay evidencia de esa condición (bueno para el
// paciente, no debe verse en rojo) — mismo criterio que ya usa CriterionRow
// en MatrizCompatibilidad.jsx para esto.
function StatusDot({ result, invert }) {
  if (!result) return null;
  const good = result.indeterminate ? invert : invert ? !result.pass : result.pass;
  const color = result.indeterminate ? 'bg-slate-300' : good ? 'bg-green-500' : 'bg-red-500';
  return <span title={result.reason} className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${color}`} />;
}

/** Describe una hoja como prosa legible para la vista de texto — igual que
 * formatCriterionLabel pero identificando además los criterios de "revisar
 * manualmente" (personalizado sin palabras clave) para marcarlos aparte. */
function describeLeafForOutline(c) {
  const isManual = c.field === CUSTOM_FIELD_KEY && (!c.keywords || c.keywords.length === 0);
  return { text: formatCriterionLabel(c), manual: isManual };
}

/** Nodo recursivo de la vista de texto (outline): un grupo se numera con
 * letras (a, b, c) y su título se colorea según sea O (morado) o Y (azul);
 * una hoja de "revisar manualmente" lleva una pastilla ámbar aparte, para que
 * se pueda leer el protocolo de corrido como si fuera el documento original,
 * en vez de tener que reconstruir la lógica leyendo cajas y flechas. */
function CriteriaOutlineNode({ node }) {
  if (node?.type === 'group') {
    const isOr = node.logicalOperator === 'OR';
    const title = node.label?.trim() || (isOr ? 'Al menos uno de' : 'Todos los siguientes');
    return (
      <li>
        <span className={`font-medium ${isOr ? 'text-purple-700' : 'text-blue-700'}`}>{title}:</span>
        <ol className="list-[lower-alpha] ml-5 mt-0.5 space-y-1">
          {(node.children || []).map((child) => (
            <CriteriaOutlineNode key={child.id} node={child} />
          ))}
        </ol>
      </li>
    );
  }
  const { text, manual } = describeLeafForOutline(node);
  return (
    <li>
      {text}
      {manual && (
        <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full align-middle">
          <AlertCircle className="w-2.5 h-2.5" /> revisar manualmente
        </span>
      )}
    </li>
  );
}

function CriteriaOutline({ criteria }) {
  if (!criteria || criteria.length === 0) {
    return <p className="text-xs text-slate-400 italic">Sin criterios definidos.</p>;
  }
  return (
    <ol className="list-decimal ml-5 space-y-1.5 text-sm text-slate-700">
      {criteria.map((node) => (
        <CriteriaOutlineNode key={node.id} node={node} />
      ))}
    </ol>
  );
}

/** Editor de una hoja (criterio simple): mismo formulario de siempre (campo,
 * operador, valor/palabras clave), ahora parametrizado por props en vez de
 * cerrar sobre el arreglo plano del padre, para poder anidarse dentro de
 * grupos a cualquier profundidad. */
function LeafEditor({ criterion: c, onChange, onRemove, suggestingIds, suggestError, onSuggestKeywords, testResult, invert }) {
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

        <span className="ml-auto flex items-center gap-2">
          <StatusDot result={testResult} invert={invert} />
          <button onClick={onRemove} className="text-slate-400 hover:text-red-500 transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        </span>
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
function GroupEditor({ group, onChange, onRemove, suggestingIds, suggestError, onSuggestKeywords, depth, testResult, invert }) {
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
        <StatusDot result={testResult} invert={invert} />
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
                  testResult={testResult?.children?.[i]}
                  invert={invert}
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
function CriterionNode({ node, onChange, onRemove, suggestingIds, suggestError, onSuggestKeywords, depth, testResult, invert }) {
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
        testResult={testResult}
        invert={invert}
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
      testResult={testResult}
      invert={invert}
    />
  );
}

function CriteriaEditor({ title, criteria, onChange, testResults, invert }) {
  const [suggestingIds, setSuggestingIds] = useState(() => new Set());
  const [suggestError, setSuggestError] = useState(null);
  const [viewMode, setViewMode] = useState('tree');

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
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-slate-700">{title}</p>
          <div className="inline-flex rounded-md border border-slate-300 overflow-hidden text-[11px] font-medium">
            <button
              onClick={() => setViewMode('tree')}
              title="Ver como árbol editable"
              className={`px-2 py-1 inline-flex items-center gap-1 transition-colors ${
                viewMode === 'tree' ? 'bg-slate-700 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
              }`}
            >
              <GitBranch className="w-3 h-3" /> Árbol
            </button>
            <button
              onClick={() => setViewMode('text')}
              title="Ver como texto para revisar de corrido"
              className={`px-2 py-1 inline-flex items-center gap-1 transition-colors ${
                viewMode === 'text' ? 'bg-slate-700 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
              }`}
            >
              <List className="w-3 h-3" /> Texto
            </button>
          </div>
        </div>
        {viewMode === 'tree' && (
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
        )}
      </div>

      {viewMode === 'text' ? (
        <CriteriaOutline criteria={criteria} />
      ) : (
        <>
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
                    testResult={testResults?.[i]}
                    invert={invert}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Cuadro de texto para pegar los criterios del documento original del
 * estudio y que la IA arme el árbol de criterios automáticamente. El
 * resultado no se aplica solo: se muestra un resumen y hay que confirmarlo,
 * porque una redacción ambigua puede interpretarse mal (ver el caso real del
 * LDL en el protocolo Azure) — la revisión visual en el árbol/texto sigue
 * siendo necesaria después de generar. */
function AiGeneratorPanel({ onApply, onClose, hasExistingCriteria }) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(null);

  async function handleGenerate() {
    if (!text.trim() || loading) return;
    setLoading(true);
    setError(null);
    setPending(null);
    try {
      const result = await parseProtocolCriteria(text);
      setPending(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleApply() {
    onApply(pending);
    setPending(null);
    setText('');
  }

  return (
    <div className="rounded-lg border border-purple-200 bg-purple-50/60 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-purple-800 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5" /> Generar criterios desde texto con IA
        </p>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
          <X className="w-4 h-4" />
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={7}
        placeholder="Pega aquí el texto de los criterios de inclusión y exclusión del protocolo, tal como viene en el documento del estudio…"
        className="w-full text-sm rounded-md border border-slate-300 px-2.5 py-2 bg-white"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={handleGenerate}
          disabled={!text.trim() || loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-purple-600 text-white text-xs font-medium hover:bg-purple-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {loading ? 'Generando…' : 'Generar'}
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
      {pending && (
        <div className="rounded-md border border-purple-300 bg-white p-2.5 space-y-2">
          <p className="text-xs text-slate-600">
            Se generaron <strong>{pending.inclusionCriteria.length}</strong> criterio(s) de inclusión y{' '}
            <strong>{pending.exclusionCriteria.length}</strong> de exclusión
            {typeof pending.costUsd === 'number' && ` (costo: $${pending.costUsd.toFixed(4)})`}.
            {hasExistingCriteria && ' Esto reemplazará los criterios que ya tienes en el editor.'}
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleApply}
              className="px-3 py-1.5 rounded-md bg-purple-600 text-white text-xs font-medium hover:bg-purple-700"
            >
              Aplicar al editor
            </button>
            <button
              onClick={() => setPending(null)}
              className="px-3 py-1.5 rounded-md text-xs font-medium text-slate-600 hover:bg-slate-100"
            >
              Descartar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Buscador compacto de un paciente real de Base Maestra para probar el
 * árbol de criterios en vivo mientras se edita — mucho más confiable para
 * detectar un error de lógica que releer condiciones anidadas, porque el
 * usuario ya sabe (por su propio criterio clínico) si ese paciente debería o
 * no calificar. */
function TestPatientPicker({ patients, testPatientId, onSelect }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const selected = (patients || []).find((p) => p.id === testPatientId);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return (patients || [])
      .filter((p) => (p.name || '').toLowerCase().includes(q) || (p.identification || '').includes(q))
      .slice(0, 8);
  }, [patients, query]);

  if (selected) {
    return (
      <div className="inline-flex items-center gap-2 text-xs bg-white border border-slate-300 rounded-full pl-3 pr-1.5 py-1">
        <Search className="w-3 h-3 text-slate-400" />
        <span className="font-medium text-slate-700">Probando con: {selected.name}</span>
        <button onClick={() => onSelect(null)} className="text-slate-400 hover:text-red-500">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Probar con un paciente de Base Maestra…"
          className="text-xs rounded-full border border-slate-300 pl-8 pr-3 py-1.5 w-64 bg-white"
        />
      </div>
      {open && matches.length > 0 && (
        <div className="absolute z-10 mt-1 w-72 bg-white border border-slate-200 rounded-md shadow-lg max-h-56 overflow-y-auto">
          {matches.map((p) => (
            <button
              key={p.id}
              onMouseDown={() => {
                onSelect(p.id);
                setQuery('');
                setOpen(false);
              }}
              className="block w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50"
            >
              {p.name} <span className="text-slate-400">· {p.identification}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ProtocolEditor({ protocol, patients, onSave, onCancel, saving }) {
  const [name, setName] = useState(protocol?.name || '');
  const [description, setDescription] = useState(protocol?.description || '');
  const [inclusionCriteria, setInclusionCriteria] = useState(protocol?.inclusionCriteria || []);
  const [exclusionCriteria, setExclusionCriteria] = useState(protocol?.exclusionCriteria || []);
  const [showGenerator, setShowGenerator] = useState(false);
  const [testPatientId, setTestPatientId] = useState(null);

  const testPatient = useMemo(
    () => (testPatientId ? (patients || []).find((p) => p.id === testPatientId) : null),
    [patients, testPatientId]
  );

  const testResult = useMemo(() => {
    if (!testPatient) return null;
    return evaluatePatientForProtocol(testPatient, { inclusionCriteria, exclusionCriteria });
  }, [testPatient, inclusionCriteria, exclusionCriteria]);

  function handleApplyGenerated({ inclusionCriteria: inc, exclusionCriteria: exc }) {
    setInclusionCriteria(assignIdsRecursive(inc));
    setExclusionCriteria(assignIdsRecursive(exc));
    setShowGenerator(false);
  }

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

  const hasExistingCriteria = inclusionCriteria.length > 0 || exclusionCriteria.length > 0;

  return (
    <div className="bg-white rounded-xl border-2 border-blue-200 p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-800">
          {protocol ? 'Editar protocolo' : 'Nuevo protocolo'}
        </h3>
        <div className="flex items-center gap-3">
          {!showGenerator && (
            <button
              onClick={() => setShowGenerator(true)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-purple-600 hover:text-purple-700"
            >
              <Sparkles className="w-3.5 h-3.5" /> Generar con IA desde texto
            </button>
          )}
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>
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

      {showGenerator && (
        <AiGeneratorPanel
          onApply={handleApplyGenerated}
          onClose={() => setShowGenerator(false)}
          hasExistingCriteria={hasExistingCriteria}
        />
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <TestPatientPicker patients={patients} testPatientId={testPatientId} onSelect={setTestPatientId} />
        {testPatient && testResult && (
          testResult.excluded ? (
            <span className="px-2 py-1 rounded-full bg-slate-200 text-slate-700 text-xs font-medium">
              Excluido globalmente: {testResult.exclusionReason}
            </span>
          ) : (
            <span
              className={`px-2 py-1 rounded-full text-xs font-medium ${
                testResult.apto ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
              }`}
            >
              {testResult.apto ? '✔ Apto' : '✘ No apto'}
            </span>
          )
        )}
      </div>

      <CriteriaEditor
        title="Criterios de inclusión"
        criteria={inclusionCriteria}
        onChange={setInclusionCriteria}
        testResults={testResult && !testResult.excluded ? testResult.inclusionResults : undefined}
      />
      <CriteriaEditor
        title="Criterios de exclusión"
        criteria={exclusionCriteria}
        onChange={setExclusionCriteria}
        testResults={testResult && !testResult.excluded ? testResult.exclusionResults : undefined}
        invert
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

export default function Protocolos({ protocols, patients, onSaveProtocol, onDeleteProtocol }) {
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
        <ProtocolEditor patients={patients} onSave={handleSave} onCancel={() => setCreating(false)} saving={saving} />
      )}

      <div className="space-y-3">
        {protocols.map((protocol) =>
          editingId === protocol.id ? (
            <ProtocolEditor
              key={protocol.id}
              protocol={protocol}
              patients={patients}
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
