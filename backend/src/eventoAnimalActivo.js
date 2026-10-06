const { conflicto } = require('./errors');
const { fechaISOEnZona } = require('./periodos');

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Fecha efectiva de un evento capturado en campo: la fecha de negocio del
// propio registro si la trae; si no (p. ej. una nota), la fecha local en que
// se capturó en el dispositivo. Nunca el momento técnico de sincronización.
function fechaEfectivaEvento(fechaNegocio, contexto = {}, ahora = new Date()) {
  if (typeof fechaNegocio === 'string' && FECHA.test(fechaNegocio.slice(0, 10))) return fechaNegocio.slice(0, 10);
  if (fechaNegocio instanceof Date) return fechaISOEnZona(fechaNegocio);
  if (contexto.fechaLocal instanceof Date) return fechaISOEnZona(contexto.fechaLocal);
  return fechaISOEnZona(ahora);
}

// Decisión D2 (P8): un evento append-only capturado sin conexión sobre un
// animal que fue dado de baja mientras tanto solo se acepta si ocurrió en la
// fecha de baja o antes. Se evalúa dentro de la transacción del evento.
async function verificarEventoSobreAnimalActivo(client, animalId, fechaEfectiva) {
  const { rows } = await client.query(
    'SELECT estado, fecha_baja::text AS fecha_baja FROM animal WHERE id = $1 FOR SHARE',
    [animalId]
  );
  const animal = rows[0];
  if (!animal || animal.estado === 'vivo') return;
  if (animal.fecha_baja && fechaEfectiva <= animal.fecha_baja) return;
  throw conflicto('ANIMAL_DADO_DE_BAJA', 'El animal fue dado de baja antes de la fecha de este registro.', {
    details: [{
      field: 'fecha',
      message: 'La fecha del registro es posterior a la baja del animal.',
      fecha_evento: fechaEfectiva,
      fecha_baja: animal.fecha_baja,
      estado: animal.estado,
    }],
  });
}

module.exports = { fechaEfectivaEvento, verificarEventoSobreAnimalActivo };
