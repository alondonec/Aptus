// Definición única de las columnas de exportación de pacientes, compartida
// entre Base Maestra y Matriz de Compatibilidad para garantizar que ambos
// archivos .xlsx contengan exactamente la misma información por paciente.

import { getPatientAge } from './patientAge';

export const SOURCE_LABELS = {
  historias: 'Historia Clínica',
  externa: 'BD Externa',
  demo: 'Demo',
};

export function patientToExportRow(p) {
  return {
    Nombre: p.name,
    Identificacion: p.identification,
    Edad: getPatientAge(p),
    Telefono: p.phone,
    Direccion: p.address,
    IMC: p.imc,
    'Peso (kg)': p.peso,
    HTA: p.hta,
    DM2: p.dm2,
    ERC: p.erc,
    ICC: p.icc,
    FA: p.fa,
    UACR: p.uacr,
    FEVI: p.fevi,
    'Creatinina (mg/dL)': p.creatinina,
    'TFG (mL/min)': p.tfg,
    'PAS (mmHg)': p.pas,
    'PAD (mmHg)': p.pad,
    'HbA1c (%)': p.hba1c,
    Medicamentos: p.medicamentos,
    'Ultimo ACV': p.fechaUltimoACV,
    'Ultimo SCA/Infarto': p.fechaUltimoIAM,
    EventoCV: p.eventoCV,
    Demencia: p.dementia,
    Diagnosticos: p.diagnostics,
    FechaIngreso: p.fechaIngreso,
    Origen: SOURCE_LABELS[p.source] ?? '',
    Estado: p.estadoClasificacion ?? '',
    'Comentario Estado': p.estadoComentario ?? '',
    'Apto para Otro Protocolo': p.aptoOtroProtocolo === null || p.aptoOtroProtocolo === undefined
      ? ''
      : p.aptoOtroProtocolo
        ? 'Sí'
        : 'No',
  };
}
