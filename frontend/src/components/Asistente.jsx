import { useMemo, useState } from 'react';
import { Sparkles, Send, Loader2, DollarSign, User, X } from 'lucide-react';
import { evaluatePatientForProtocol } from '../utils/matchEngine';
import { resolvePatientFlags } from '../utils/nlpEngine';
import { askAboutData } from '../utils/api';
import ConfirmResetButton from './ConfirmResetButton';

const EXAMPLE_QUESTIONS = [
  '¿Cuántos pacientes tienen HTA y DM2 a la vez?',
  '¿Cuál paciente tiene el IMC más alto?',
  '¿Qué pacientes son Aptos para más de un protocolo?',
  'Nombra 5 pacientes No Aptos para Maritime 0227 por falta de dato de FEVI',
];

export default function Asistente({ patients, protocols, history, onHistoryChange }) {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);

  // Reutiliza exactamente la misma lógica de evaluación que ya se ve en
  // Matriz de Compatibilidad (matchEngine + resolvePatientFlags), para que
  // el asistente responda con el mismo resultado Apto/No Apto que el resto
  // de la herramienta — en vez de que el modelo vuelva a interpretar los
  // criterios por su cuenta y termine dando una respuesta distinta.
  const enrichedPatients = useMemo(() => {
    return patients.map((p) => {
      const resolved = resolvePatientFlags(p);
      const protocolResults = {};
      for (const protocol of protocols) {
        const result = evaluatePatientForProtocol(p, protocol);
        protocolResults[protocol.name] = {
          apto: result.apto,
          motivos: result.apto
            ? []
            : [
                ...result.inclusionResults
                  .filter((r) => !r.pass)
                  .map((r) => `${r.criterion.label}${r.indeterminate ? ' (sin dato)' : ' (no cumple)'}`),
                ...result.exclusionResults
                  .filter((r) => r.pass)
                  .map((r) => `${r.criterion.label} (exclusión activada)`),
              ],
        };
      }
      return {
        nombre: p.name,
        identificacion: p.identification,
        edad: resolved.edad,
        hta: resolved.hta,
        dm2: resolved.dm2,
        erc: resolved.erc,
        icc: resolved.icc,
        fa: resolved.fa,
        imc: p.imc,
        fevi: p.fevi,
        eventoCV: resolved.eventoCV,
        demencia: resolved.dementia,
        diagnosticos: p.diagnostics,
        protocolos: protocolResults,
      };
    });
  }, [patients, protocols]);

  async function handleAsk(q) {
    const finalQuestion = (q ?? question).trim();
    if (!finalQuestion || loading) return;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setLoading(true);
    setQuestion('');
    onHistoryChange((prev) => [...prev, { id, question: finalQuestion, answer: null, costUsd: null, error: null }]);
    try {
      const { answer, costUsd } = await askAboutData(finalQuestion, enrichedPatients);
      onHistoryChange((prev) => prev.map((h) => (h.id === id ? { ...h, answer, costUsd } : h)));
    } catch (err) {
      onHistoryChange((prev) => prev.map((h) => (h.id === id ? { ...h, error: err.message } : h)));
    } finally {
      setLoading(false);
    }
  }

  function handleDeleteEntry(id) {
    onHistoryChange((prev) => prev.filter((h) => h.id !== id));
  }

  function handleDeleteAll() {
    onHistoryChange([]);
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-indigo-100 text-indigo-600">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-slate-800">Preguntas sobre tus datos</h2>
            <p className="text-xs text-slate-400">
              Preguntá en lenguaje natural sobre los {patients.length} pacientes cargados. Las respuestas usan los
              mismos resultados de elegibilidad que ves en Matriz de Compatibilidad.
            </p>
          </div>
          {history.length > 0 && (
            <ConfirmResetButton
              label="Eliminar todo el chat"
              itemLabel="preguntas de este chat"
              count={history.length}
              onConfirm={handleDeleteAll}
            />
          )}
        </div>
      </div>

      {history.length === 0 && (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-5">
          <p className="text-xs font-medium text-slate-400 mb-2">Ejemplos:</p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => handleAsk(q)}
                disabled={loading || patients.length === 0}
                className="text-xs px-3 py-1.5 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        {history.map((h) => (
          <div key={h.id} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
            <div className="flex items-start gap-2">
              <div className="p-1.5 rounded-lg bg-slate-100 text-slate-500 shrink-0">
                <User className="w-3.5 h-3.5" />
              </div>
              <p className="text-sm text-slate-700 font-medium flex-1 min-w-0">{h.question}</p>
              <button
                onClick={() => handleDeleteEntry(h.id)}
                title="Eliminar esta pregunta"
                className="text-slate-300 hover:text-red-500 transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex items-start gap-2">
              <div className="p-1.5 rounded-lg bg-indigo-100 text-indigo-600 shrink-0">
                <Sparkles className="w-3.5 h-3.5" />
              </div>
              {h.error ? (
                <p className="text-sm text-red-600">{h.error}</p>
              ) : h.answer === null ? (
                <p className="text-sm text-slate-400 flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Pensando...
                </p>
              ) : (
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{h.answer}</p>
                  {typeof h.costUsd === 'number' && (
                    <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-slate-400">
                      <DollarSign className="w-3 h-3" /> {h.costUsd.toFixed(4)}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="sticky bottom-4 bg-white rounded-xl border border-slate-200 p-3 shadow-lg flex items-center gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleAsk();
            }
          }}
          placeholder="Preguntá algo sobre los pacientes cargados..."
          disabled={loading || patients.length === 0}
          className="flex-1 text-sm rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-slate-50"
        />
        <button
          onClick={() => handleAsk()}
          disabled={loading || !question.trim() || patients.length === 0}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Preguntar
        </button>
      </div>
    </div>
  );
}
