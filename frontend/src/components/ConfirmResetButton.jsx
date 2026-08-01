import { useState } from 'react';
import { Trash2, AlertTriangle, X } from 'lucide-react';

const CONFIRM_WORD = 'ELIMINAR';

/** Botón de eliminación/reinicio con doble verificación: un primer aviso con
 * el número de registros afectados, y una confirmación final que exige
 * escribir la palabra "ELIMINAR" antes de ejecutar la acción. */
export default function ConfirmResetButton({ label, itemLabel, count, onConfirm, disableWhenEmpty = true }) {
  const [stage, setStage] = useState(0); // 0 = inactivo, 1 = primer aviso, 2 = confirmación final
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);

  function cancel() {
    setStage(0);
    setConfirmText('');
  }

  async function handleFinalConfirm() {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
      cancel();
    }
  }

  if (stage === 0) {
    return (
      <button
        onClick={() => setStage(1)}
        disabled={disableWhenEmpty && count === 0}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <Trash2 className="w-4 h-4" /> {label}
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
      <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-5 space-y-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-6 h-6 text-red-500 shrink-0" />
          <div>
            <h3 className="font-semibold text-slate-800">{label}</h3>
            <p className="text-sm text-slate-500 mt-1">
              {stage === 1
                ? count === 0
                  ? 'Este bloque no tiene historias cargadas. Se eliminará igual. Esta acción no se puede deshacer.'
                  : `Esto eliminará permanentemente ${count} ${itemLabel}. Esta acción no se puede deshacer.`
                : `Confirmación final: escribe ${CONFIRM_WORD} para continuar.`}
            </p>
          </div>
          <button onClick={cancel} className="ml-auto text-slate-400 hover:text-slate-600 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {stage === 2 && (
          <input
            autoFocus
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={CONFIRM_WORD}
            className="w-full text-sm rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-400"
          />
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={cancel}
            className="px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
          >
            Cancelar
          </button>
          {stage === 1 ? (
            <button
              onClick={() => setStage(2)}
              className="px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
            >
              Continuar
            </button>
          ) : (
            <button
              onClick={handleFinalConfirm}
              disabled={confirmText.trim().toUpperCase() !== CONFIRM_WORD || busy}
              className="px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
            >
              {busy ? 'Eliminando...' : 'Eliminar definitivamente'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
