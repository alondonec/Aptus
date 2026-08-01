import { useState } from 'react';

/**
 * Celda de tabla para texto potencialmente largo (diagnósticos, columnas
 * anchas de BD Externa, etc). Por defecto se trunca con "...", y al hacer
 * clic se expande para mostrar el texto completo (con salto de línea si
 * hace falta). Al hacer clic de nuevo, vuelve a truncarse.
 */
export default function TruncatedCell({ text, maxWidth = 240, className = '' }) {
  const [expanded, setExpanded] = useState(false);
  const value = text === null || text === undefined || text === '' ? null : String(text);

  if (!value) {
    return <span className="text-slate-300">—</span>;
  }

  return (
    <button
      type="button"
      onClick={() => setExpanded((e) => !e)}
      title={expanded ? 'Clic para contraer' : 'Clic para ver el texto completo'}
      className={`text-left align-top ${
        expanded
          ? 'whitespace-normal break-words'
          : 'whitespace-nowrap overflow-hidden text-ellipsis block'
      } ${className}`}
      style={{ maxWidth: expanded ? '420px' : `${maxWidth}px` }}
    >
      {value}
    </button>
  );
}
