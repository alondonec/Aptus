import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';

// Selector múltiple con checkboxes, para elegir varios bloques de carga o
// varios protocolos a la vez (en vez de uno solo o "todos"). `selected` vacío
// se interpreta como "todos" en los componentes que lo usan.
export default function MultiSelectDropdown({ label, options, selected, onChange, allLabel = 'Todos' }) {
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

  function toggleOption(id) {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      onChange([...selected, id]);
    }
  }

  const summary =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? options.find((o) => o.id === selected[0])?.label || allLabel
        : 'seleccionados';

  const isActive = selected.length > 0;

  return (
    <span ref={ref} className="relative inline-flex">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 text-sm rounded-lg border px-2.5 py-2 bg-white hover:bg-slate-50 transition-colors ${
          isActive ? 'border-blue-300 ring-1 ring-blue-100' : 'border-slate-300'
        }`}
      >
        {label && <span className="text-xs text-slate-400">{label}:</span>}
        {selected.length > 1 && (
          <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-blue-600 text-white text-[10px] font-semibold">
            {selected.length}
          </span>
        )}
        <span className={`max-w-[180px] truncate ${isActive ? 'text-slate-800' : 'text-slate-600'}`}>{summary}</span>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-20 top-full left-0 mt-1 w-64 max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg py-1">
          <button
            onClick={() => onChange([])}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50 text-left"
          >
            <span
              className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                selected.length === 0 ? 'bg-blue-600 border-blue-600' : 'border-slate-300'
              }`}
            >
              {selected.length === 0 && <Check className="w-3 h-3 text-white" />}
            </span>
            <span className="italic text-slate-500">{allLabel}</span>
          </button>
          <div className="my-1 border-t border-slate-100" />
          {options.map((opt) => {
            const checked = selected.includes(opt.id);
            return (
              <button
                key={opt.id}
                onClick={() => toggleOption(opt.id)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50 text-left"
              >
                <span
                  className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                    checked ? 'bg-blue-600 border-blue-600' : 'border-slate-300'
                  }`}
                >
                  {checked && <Check className="w-3 h-3 text-white" />}
                </span>
                <span className="truncate">{opt.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
}
