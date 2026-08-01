// Calcula la edad a partir de la fecha de nacimiento para que se actualice
// sola con el paso del tiempo, en vez de quedar fija en el valor extraído
// el día de la carga.
export function calculateAge(fechaNacimiento) {
  if (!fechaNacimiento) return null;
  const birth = new Date(fechaNacimiento);
  if (Number.isNaN(birth.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age;
}

/** Edad a mostrar: calculada desde la fecha de nacimiento si está disponible,
 * o el valor estático de respaldo (pacientes antiguos sin fecha de nacimiento). */
export function getPatientAge(patient) {
  const computed = calculateAge(patient?.fechaNacimiento);
  return computed !== null ? computed : patient?.edad ?? null;
}
