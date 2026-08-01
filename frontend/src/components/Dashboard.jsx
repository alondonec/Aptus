import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LabelList,
} from 'recharts';
import { Users, ClipboardList, Activity, Copy, FileDown, Info, UserCheck } from 'lucide-react';
import { FIELD_DEFS } from '../data/mockData';
import { evaluatePatientForProtocol } from '../utils/matchEngine';
import { resolvePatientFlags } from '../utils/nlpEngine';
import { normalizeIdentification } from '../utils/patientIdentity';
import { LEGACY_LOTE_ID } from '../utils/loteConstants';
import MultiSelectDropdown from './MultiSelectDropdown';

const COLORS = ['#16a34a', '#dc2626'];
const CONDITION_COLORS = [
  '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#16a34a', '#0891b2', '#ca8a04',
];

// Cuenta cuántas historias "de más" hay por pacientes que aparecen repetidos
// dentro del mismo conjunto (el mismo paciente subido dos veces en un
// bloque) — la misma lógica que el badge "repetidas en este bloque" de
// Historias Clínicas, para que el número coincida en ambos lugares.
function countRepeatedInBatch(historiaItems) {
  const counts = {};
  for (const p of historiaItems) {
    const key = normalizeIdentification(p.identification);
    if (key) counts[key] = (counts[key] || 0) + 1;
  }
  return Object.values(counts)
    .filter((c) => c > 1)
    .reduce((sum, c) => sum + (c - 1), 0);
}

// Botón "i" que muestra, al hacer clic, una breve explicación de cómo
// interpretar el indicador o gráfico junto al que aparece. Se cierra solo al
// hacer clic afuera o de nuevo sobre el botón. Se oculta al imprimir (no
// aporta nada en el PDF y complicaría el layout).
function InfoTooltip({ text }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex print:hidden">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        className="text-slate-300 hover:text-blue-500 transition-colors"
        aria-label="Ver explicación"
      >
        <Info className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute z-20 top-full left-0 mt-1.5 w-60 p-2.5 rounded-lg bg-slate-800 text-white text-xs leading-relaxed shadow-lg">
          {text}
        </div>
      )}
    </span>
  );
}

function MetricCard({ icon: Icon, label, value, tone, info }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 print:p-2.5 flex items-center gap-4 print:gap-2 shadow-sm">
      <div className={`p-3 print:p-1.5 rounded-lg ${tone}`}>
        <Icon className="w-6 h-6 print:w-4 print:h-4" />
      </div>
      <div>
        <div className="text-sm print:text-xs text-slate-500 flex items-center gap-1">
          {label}
          {info && <InfoTooltip text={info} />}
        </div>
        <p className="text-2xl print:text-base font-semibold text-slate-800">{value}</p>
      </div>
    </div>
  );
}

export default function Dashboard({
  patients,
  protocols,
  historiaPatients = [],
  historiaLotes = [],
  selectedLoteIds,
  onSelectedLoteIdsChange,
  selectedProtocolIds,
  onSelectedProtocolIdsChange,
}) {
  // Selección vacía = "Total" / "Todos los protocolos". Elegir uno o varios
  // restringe el alcance a la unión de esos bloques, o a ese subconjunto de
  // protocolos — así se pueden analizar combinaciones puntuales (ej. 2 de 3
  // bloques, o 2 de 3 protocolos) en vez de solo "uno" o "todos".
  const scopedProtocols = useMemo(
    () =>
      selectedProtocolIds.length === 0
        ? protocols
        : protocols.filter((p) => selectedProtocolIds.includes(p.id)),
    [protocols, selectedProtocolIds]
  );

  // Al exportar a PDF (window.print), los gráficos se redibujan más
  // compactos para que las tarjetas y los 3 gráficos quepan en una sola
  // página vertical — con el tamaño normal de pantalla no entran.
  const [isPrinting, setIsPrinting] = useState(false);
  useEffect(() => {
    const onBeforePrint = () => setIsPrinting(true);
    const onAfterPrint = () => setIsPrinting(false);
    window.addEventListener('beforeprint', onBeforePrint);
    window.addEventListener('afterprint', onAfterPrint);
    return () => {
      window.removeEventListener('beforeprint', onBeforePrint);
      window.removeEventListener('afterprint', onAfterPrint);
    };
  }, []);

  const loteOptions = useMemo(() => {
    const opts = historiaLotes.map((l) => ({ id: l.id, label: l.fuente || 'Bloque sin nombre' }));
    if (historiaPatients.some((p) => !p.loteId)) {
      opts.push({ id: LEGACY_LOTE_ID, label: 'Historias cargadas antes de tener bloques' });
    }
    return opts;
  }, [historiaLotes, historiaPatients]);

  const { scopedPatients, duplicateCount } = useMemo(() => {
    if (selectedLoteIds.length === 0) {
      const total = loteOptions.reduce((sum, opt) => {
        const items = historiaPatients.filter((p) => (p.loteId || LEGACY_LOTE_ID) === opt.id);
        return sum + countRepeatedInBatch(items);
      }, 0);
      return { scopedPatients: patients, duplicateCount: total };
    }

    // Unión de historias de todos los bloques elegidos, para poder analizar
    // combinaciones (ej. "bloque A + bloque C" juntos).
    const itemsInLotes = historiaPatients.filter((p) =>
      selectedLoteIds.includes(p.loteId || LEGACY_LOTE_ID)
    );
    const identSet = new Set(
      itemsInLotes.map((p) => normalizeIdentification(p.identification)).filter(Boolean)
    );
    const duplicates = selectedLoteIds.reduce((sum, loteId) => {
      const items = historiaPatients.filter((p) => (p.loteId || LEGACY_LOTE_ID) === loteId);
      return sum + countRepeatedInBatch(items);
    }, 0);
    return {
      scopedPatients: patients.filter((p) => identSet.has(normalizeIdentification(p.identification))),
      duplicateCount: duplicates,
    };
  }, [selectedLoteIds, patients, historiaPatients, loteOptions]);

  const conditionCounts = useMemo(() => {
    const booleanFields = FIELD_DEFS.filter((f) => f.type === 'boolean');
    return booleanFields
      .map((f) => {
        const count = scopedPatients.filter((p) => resolvePatientFlags(p)[f.key] === true).length;
        return { condition: f.label.replace(/\s*\(.*\)/, ''), pacientes: count };
      })
      .sort((a, b) => b.pacientes - a.pacientes);
  }, [scopedPatients]);

  const protocolStats = useMemo(() => {
    return [...scopedProtocols]
      .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
      .map((protocol) => {
        const results = scopedPatients.map((p) => evaluatePatientForProtocol(p, protocol));
        const aptos = results.filter((r) => r.apto).length;
        return {
          protocolo: protocol.name.length > 22 ? protocol.name.slice(0, 22) + '…' : protocol.name,
          aptos,
          noAptos: scopedPatients.length - aptos,
        };
      });
  }, [scopedPatients, scopedProtocols]);

  const globalPie = useMemo(() => {
    let apto = 0;
    let noApto = 0;
    for (const protocol of scopedProtocols) {
      for (const patient of scopedPatients) {
        const r = evaluatePatientForProtocol(patient, protocol);
        if (r.apto) apto += 1;
        else noApto += 1;
      }
    }
    return [
      { name: 'Apto', value: apto },
      { name: 'No apto', value: noApto },
    ];
  }, [scopedPatients, scopedProtocols]);

  const avgEligibility = useMemo(() => {
    const total = globalPie[0].value + globalPie[1].value;
    if (!total) return 0;
    return Math.round((globalPie[0].value / total) * 100);
  }, [globalPie]);

  // A diferencia de "Elegibilidad global" (que cuenta pares paciente ×
  // protocolo y por eso puede superar el total de pacientes), este indicador
  // cuenta pacientes distintos: cada uno se cuenta una sola vez si califica
  // para al menos uno de los protocolos del alcance, sin importar cuántos.
  const patientsAptoForAny = useMemo(() => {
    if (!scopedProtocols.length) return 0;
    return scopedPatients.filter((patient) =>
      scopedProtocols.some((protocol) => evaluatePatientForProtocol(patient, protocol).apto)
    ).length;
  }, [scopedPatients, scopedProtocols]);

  const scopeLabel = useMemo(() => {
    const loteLabel =
      selectedLoteIds.length === 0
        ? 'Total (Base Maestra)'
        : selectedLoteIds.map((id) => loteOptions.find((o) => o.id === id)?.label || 'bloque').join(' + ');
    const protocolLabel =
      selectedProtocolIds.length === 0
        ? 'Todos los protocolos'
        : selectedProtocolIds.map((id) => protocols.find((p) => p.id === id)?.name || 'protocolo').join(' + ');
    return { loteLabel, protocolLabel };
  }, [selectedLoteIds, loteOptions, selectedProtocolIds, protocols]);

  // Texto breve con los hallazgos más relevantes del alcance seleccionado,
  // para que el reporte (en pantalla y en el PDF) no dependa solo de leer
  // los gráficos.
  const summaryInsights = useMemo(() => {
    const insights = [];
    const total = scopedPatients.length;

    if (conditionCounts.length && total > 0) {
      const top = conditionCounts[0];
      const pct = Math.round((top.pacientes / total) * 100);
      insights.push(
        `La condición clínica más prevalente es ${top.condition}, presente en ${top.pacientes} de ${total} pacientes (${pct}%).`
      );
    }

    if (protocolStats.length > 1) {
      const withRate = protocolStats.map((p) => ({
        ...p,
        rate: p.aptos + p.noAptos > 0 ? p.aptos / (p.aptos + p.noAptos) : 0,
      }));
      const best = [...withRate].sort((a, b) => b.rate - a.rate)[0];
      const worst = [...withRate].sort((a, b) => a.rate - b.rate)[0];
      insights.push(
        `El protocolo con mayor elegibilidad es ${best.protocolo} (${Math.round(best.rate * 100)}%); el de menor elegibilidad es ${worst.protocolo} (${Math.round(worst.rate * 100)}%).`
      );
    } else if (protocolStats.length === 1) {
      const p = protocolStats[0];
      const rate = p.aptos + p.noAptos > 0 ? Math.round((p.aptos / (p.aptos + p.noAptos)) * 100) : 0;
      insights.push(`Para ${p.protocolo}, ${p.aptos} de ${p.aptos + p.noAptos} pacientes (${rate}%) resultan Aptos.`);
    }

    insights.push(`Elegibilidad promedio combinada: ${avgEligibility}% sobre ${total} pacientes.`);

    insights.push(
      duplicateCount > 0
        ? `Se detectaron ${duplicateCount} historias duplicadas (mismo paciente cargado más de una vez) en el alcance seleccionado — se recomienda revisarlas antes de reportar cifras finales.`
        : 'No se detectaron historias duplicadas en el alcance seleccionado.'
    );

    return insights;
  }, [scopedPatients, conditionCounts, protocolStats, avgEligibility, duplicateCount]);

  return (
    <div className="space-y-6 print:space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500">Ver indicadores de:</span>
          <MultiSelectDropdown
            options={loteOptions}
            selected={selectedLoteIds}
            onChange={onSelectedLoteIdsChange}
            allLabel="Total (Base Maestra)"
          />
          <MultiSelectDropdown
            options={protocols.map((p) => ({ id: p.id, label: p.name }))}
            selected={selectedProtocolIds}
            onChange={onSelectedProtocolIdsChange}
            allLabel="Todos los protocolos"
          />
        </div>
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <FileDown className="w-4 h-4" /> Exportar a PDF
        </button>
      </div>

      {/* Título visible solo al imprimir/exportar, para identificar el
          alcance (bloque o total) del reporte fuera de la app. */}
      <h2 className="hidden print:block text-lg font-bold text-slate-800">
        Dashboard Aptus — {scopeLabel.loteLabel} · {scopeLabel.protocolLabel}
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 print:grid-cols-5 gap-4 print:gap-2">
        <MetricCard
          icon={Users}
          label="Total pacientes"
          value={scopedPatients.length}
          tone="bg-blue-100 text-blue-600"
          info="Cantidad de pacientes de Base Maestra que caen dentro del alcance seleccionado arriba (un bloque de carga específico, o el total si elegiste 'Total')."
        />
        <MetricCard
          icon={ClipboardList}
          label="Protocolos activos"
          value={protocols.length}
          tone="bg-purple-100 text-purple-600"
          info="Cantidad total de protocolos configurados en el sistema (módulo Protocolos). No cambia según el bloque o protocolo que filtres arriba."
        />
        <MetricCard
          icon={Activity}
          label="Elegibilidad promedio"
          value={`${avgEligibility}%`}
          tone="bg-green-100 text-green-600"
          info="Porcentaje de evaluaciones que resultaron Apto. Si el filtro de protocolo está en 'Todos', cada paciente se evalúa contra cada protocolo por separado (paciente × protocolo); si elegiste un protocolo puntual, es la tasa de aptitud de ese protocolo."
        />
        <MetricCard
          icon={UserCheck}
          label="Pacientes Aptos (algún protocolo)"
          value={patientsAptoForAny}
          tone="bg-teal-100 text-teal-600"
          info="Cantidad de pacientes distintos que califican como Apto para al menos uno de los protocolos del alcance seleccionado. A diferencia de 'Elegibilidad global', cada paciente se cuenta una sola vez sin importar para cuántos protocolos aplique."
        />
        <MetricCard
          icon={Copy}
          label="Historias duplicadas"
          value={duplicateCount}
          tone="bg-rose-100 text-rose-600"
          info="Historias 'de más' por pacientes que fueron cargados más de una vez dentro del mismo bloque (ej. el mismo PDF subido dos veces). No cuenta pacientes que ya existían en Base Maestra de antes."
        />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 print:p-2 shadow-sm">
        <div className="flex items-center gap-1 mb-3 print:mb-1">
          <h3 className="text-sm font-semibold text-slate-700">Resumen del reporte</h3>
          <InfoTooltip text="Hallazgos calculados automáticamente a partir del alcance seleccionado arriba (bloque y protocolo). Se recalculan cada vez que cambiás el filtro." />
        </div>
        <ul className="space-y-1.5 print:space-y-0.5 text-sm print:text-[10px] text-slate-600 list-disc list-inside">
          {summaryInsights.map((text, i) => (
            <li key={i}>{text}</li>
          ))}
        </ul>
      </div>

      {/* Misma distribución en pantalla y al imprimir: Prevalencia + Elegibilidad
          global comparten fila (2+1) y Elegibilidad por Protocolo va debajo a
          todo el ancho. Nada de reacomodar en columnas distintas para el PDF:
          los gráficos (Recharts) miden su contenedor de forma asíncrona, y un
          cambio de ancho entre pantalla e impresión no siempre alcanza a
          redibujarse a tiempo para el PDF — por eso antes se veían recortados
          o superpuestos. Manteniendo la misma grilla, solo se ajustan alturas
          (con la prop height, no por medición del contenedor) para que quepa
          mejor en la hoja. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 print:grid-cols-3 gap-6 print:gap-2">
        <div className="lg:col-span-2 print:col-span-2 min-w-0 overflow-hidden bg-white rounded-xl border border-slate-200 p-5 print:p-2 shadow-sm">
          <div className="flex items-center gap-1 mb-4 print:mb-1">
            <h3 className="text-sm font-semibold text-slate-700">Prevalencia de condiciones clínicas</h3>
            <InfoTooltip text="Para cada condición clínica, cuenta cuántos pacientes del alcance seleccionado la tienen registrada como presente. Son conteos independientes: un mismo paciente con varias condiciones se suma en cada barra correspondiente, por eso el total de todas las barras puede superar el total de pacientes." />
          </div>
          <ResponsiveContainer width={isPrinting ? 430 : '100%'} height={isPrinting ? 205 : 340}>
            <BarChart
              data={conditionCounts}
              margin={{ top: isPrinting ? 45 : 5, right: 10, left: -10, bottom: isPrinting ? 34 : 90 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="condition"
                tick={{ fontSize: isPrinting ? 8 : 11 }}
                angle={-40}
                textAnchor="end"
                interval={0}
                height={isPrinting ? 34 : 90}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: isPrinting ? 10 : 12 }}
                domain={[0, (max) => max + 40]}
              />
              <Tooltip />
              <Bar dataKey="pacientes" radius={[4, 4, 0, 0]}>
                {conditionCounts.map((_, i) => (
                  <Cell key={i} fill={CONDITION_COLORS[i % CONDITION_COLORS.length]} />
                ))}
                <LabelList dataKey="pacientes" position="top" style={{ fontSize: isPrinting ? 9 : 11, fill: '#334155' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 print:p-2 shadow-sm">
          <div className="flex items-center gap-1 mb-4 print:mb-1">
            <h3 className="text-sm font-semibold text-slate-700">Elegibilidad global (paciente × protocolo)</h3>
            <InfoTooltip text="Evalúa a cada paciente del alcance seleccionado contra cada protocolo filtrado. Si el filtro de protocolo está en 'Todos', el total no es igual a la cantidad de pacientes, sino a pacientes × protocolos (cada paciente aporta un resultado por cada protocolo evaluado). Si filtraste por un protocolo específico, el total sí coincide con el total de pacientes." />
          </div>
          <ResponsiveContainer width="100%" height={isPrinting ? 205 : 300}>
            <PieChart margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
              <Pie
                data={globalPie}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={isPrinting ? 52 : 75}
                label={({ value }) => value}
              >
                {globalPie.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend wrapperStyle={{ paddingTop: isPrinting ? 4 : 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="min-w-0 overflow-hidden bg-white rounded-xl border border-slate-200 p-5 print:p-2 shadow-sm">
        <div className="flex items-center gap-1 mb-4 print:mb-1">
          <h3 className="text-sm font-semibold text-slate-700">Elegibilidad por Protocolo</h3>
          <InfoTooltip text="Para cada protocolo del alcance seleccionado, cuántos pacientes resultan Aptos o No aptos según sus criterios de inclusión y exclusión. Un mismo paciente puede ser Apto en un protocolo y No apto en otro." />
        </div>
        <ResponsiveContainer width={isPrinting ? 670 : '100%'} height={isPrinting ? 205 : 260}>
          <BarChart data={protocolStats} margin={{ top: isPrinting ? 45 : 5, right: 20, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="protocolo" tick={{ fontSize: isPrinting ? 9 : 12 }} />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: isPrinting ? 9 : 12 }}
              domain={[0, (max) => max + 40]}
            />
            <Tooltip />
            <Legend />
            <Bar dataKey="aptos" name="Aptos" fill="#16a34a" radius={[4, 4, 0, 0]}>
              <LabelList dataKey="aptos" position="top" style={{ fontSize: isPrinting ? 9 : 11, fill: '#166534' }} />
            </Bar>
            <Bar dataKey="noAptos" name="No aptos" fill="#dc2626" radius={[4, 4, 0, 0]}>
              <LabelList dataKey="noAptos" position="top" style={{ fontSize: isPrinting ? 9 : 11, fill: '#991b1b' }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
