import ExcelJS from 'exceljs';

const HEADER_FILL = 'FF1D4ED8';
const HEADER_FONT_COLOR = 'FFFFFFFF';
const STRIPE_FILL = 'FFF1F5F9';
const BORDER_COLOR = 'FFE2E8F0';
const OK_FONT_COLOR = 'FF15803D';
const BAD_FONT_COLOR = 'FF94A3B8';
const APTO_FILL = 'FFDCFCE7';
const APTO_FONT_COLOR = 'FF15803D';
const NO_APTO_FILL = 'FFFEE2E2';
const NO_APTO_FONT_COLOR = 'FFB91C1C';

function formatCellValue(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'boolean') return val ? 'Sí' : 'No';
  return val;
}

function computeColumnWidth(header, formattedRows) {
  const headerLen = header.length;
  const maxContentLen = formattedRows.reduce((max, row) => {
    const len = String(row[header] ?? '').length;
    return len > max ? len : max;
  }, 0);
  return Math.min(Math.max(headerLen, maxContentLen) + 2, 60);
}

/**
 * Exporta un arreglo de objetos como un archivo .xlsx con formato profesional:
 * encabezado en negrita con relleno de color, franjas alternas, bordes y
 * resaltado de valores Sí/No/APTO/NO APTO. Usa exceljs porque la edición
 * gratuita de SheetJS no soporta escribir estilos de celda (se descartan
 * silenciosamente al guardar).
 */
export async function downloadStyledXLSX(filename, rows, sheetName = 'Datos') {
  if (!rows || !rows.length) return;
  const headers = Object.keys(rows[0]);
  const formattedRows = rows.map((row) => {
    const out = {};
    headers.forEach((h) => {
      out[h] = formatCellValue(row[h]);
    });
    return out;
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Aptus';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet(sheetName.slice(0, 31));
  worksheet.columns = headers.map((h) => ({
    header: h,
    key: h,
    width: computeColumnWidth(h, formattedRows),
  }));

  formattedRows.forEach((row) => worksheet.addRow(row));

  const headerRow = worksheet.getRow(1);
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: HEADER_FONT_COLOR }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
  });

  for (let i = 0; i < formattedRows.length; i++) {
    const row = worksheet.getRow(i + 2);
    const isStripe = i % 2 === 1;
    row.eachCell({ includeEmpty: true }, (cell) => {
      if (isStripe) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STRIPE_FILL } };
      }
      cell.border = { bottom: { style: 'thin', color: { argb: BORDER_COLOR } } };
      cell.alignment = { vertical: 'middle' };

      if (cell.value === 'Sí') {
        cell.font = { bold: true, color: { argb: OK_FONT_COLOR } };
      } else if (cell.value === 'No') {
        cell.font = { color: { argb: BAD_FONT_COLOR } };
      } else if (cell.value === 'APTO') {
        cell.font = { bold: true, color: { argb: APTO_FONT_COLOR } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: APTO_FILL } };
      } else if (cell.value === 'NO APTO') {
        cell.font = { bold: true, color: { argb: NO_APTO_FONT_COLOR } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NO_APTO_FILL } };
      }
    });
  }

  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length },
  };
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  triggerDownload(blob, filename);
}

export function downloadJSON(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  triggerDownload(blob, filename);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Parser CSV simple para la carga de BD Externa (sin dependencias externas). */
export function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) return [];
  const headers = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row = {};
    headers.forEach((h, i) => {
      row[h] = (cells[i] || '').trim();
    });
    return row;
  });
}
