// Definiciones de campos clínicos estructurados, usadas por el editor de
// criterios de Protocolos y por los gráficos del Dashboard.
//
// Los datos de pacientes y protocolos de ejemplo ya no viven aquí: ahora se
// cargan desde el backend (SQLite), que los siembra una sola vez en el
// primer arranque — ver backend/seedData.js.

export const FIELD_DEFS = [
  { key: 'hta', label: 'Hipertensión (HTA)', type: 'boolean' },
  { key: 'dm2', label: 'Diabetes tipo 2 (DM2)', type: 'boolean' },
  { key: 'erc', label: 'Enfermedad renal crónica (ERC)', type: 'boolean' },
  { key: 'icc', label: 'Insuficiencia cardíaca (ICC)', type: 'boolean' },
  { key: 'fa', label: 'Fibrilación auricular (FA)', type: 'boolean' },
  { key: 'eventoCV', label: 'Evento cardiovascular previo', type: 'boolean' },
  { key: 'dementia', label: 'Demencia', type: 'boolean' },
  { key: 'edad', label: 'Edad', type: 'number' },
  { key: 'imc', label: 'IMC', type: 'number' },
  { key: 'uacr', label: 'UACR (mg/g)', type: 'number' },
  { key: 'fevi', label: 'FEVI (%)', type: 'number' },
];
