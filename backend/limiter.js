// Limita cuántas tareas pesadas corren a la vez; el resto espera su turno en
// orden de llegada. Se usa para la extracción de PDFs: procesar muchos al mismo
// tiempo (cada uno se carga entera en memoria y, si es muy largo, se divide con
// pdf-lib, que consume mucha más memoria que el archivo) puede dejar sin memoria
// a una instancia pequeña y tumbar todo el servidor.

function createLimiter(maxConcurrent) {
  const max = Math.max(1, Math.floor(Number(maxConcurrent)) || 1);
  let active = 0;
  const waiting = [];

  function startNext() {
    if (active < max && waiting.length > 0) {
      active += 1;
      waiting.shift()();
    }
  }

  /** Ejecuta `task` cuando haya un cupo libre y libera el cupo al terminar,
   * haya salido bien o con error. */
  async function run(task) {
    await new Promise((resolve) => {
      waiting.push(resolve);
      startNext();
    });
    try {
      return await task();
    } finally {
      active -= 1;
      startNext();
    }
  }

  return { run, stats: () => ({ active, queued: waiting.length, max }) };
}

module.exports = { createLimiter };
