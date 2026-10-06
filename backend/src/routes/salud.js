const express = require('express');
const { fechaEfectivaEvento, verificarEventoSobreAnimalActivo } = require('../eventoAnimalActivo');
const { ejecutarIdempotente, responderIdempotente } = require('../idempotency');
const { mensajePublicoError } = require('../middleware/errorHandler');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { registrarBitacora } = require('../bitacora');
const { enTransaccion } = require('../transaction');

const router = express.Router();

// Registrar vacuna/tratamiento/diagnóstico (CU3)
router.post('/', asyncHandler(async (req, res) => {
  const { animal_id, tipo, insumo_id, enfermedad, descripcion, fecha, proxima_dosis, veterinario_id, plan_item_id } = req.body;
  if (!animal_id || !tipo) {
    return res.status(400).json({ error: 'animal_id y tipo son obligatorios' });
  }
  // P8.3: con Idempotency-Key, un reenvío por mala conexión devuelve el mismo
  // evento en lugar de registrar otra vacuna o tratamiento.
  const ejecucion = await ejecutarIdempotente(req, {
    tipo: 'evento_salud.crear', entidad: 'evento_salud', payload: { body: req.body }, httpStatus: 201,
  }, async (client, contexto) => {
    if (contexto.offline) await verificarEventoSobreAnimalActivo(client, animal_id, fechaEfectivaEvento(fecha, contexto));
    const { rows } = await client.query(
    `INSERT INTO evento_salud (animal_id, tipo, insumo_id, enfermedad, descripcion, fecha, proxima_dosis, veterinario_id, plan_item_id)
     VALUES ($1,$2,$3,$4,$5, COALESCE($6, CURRENT_DATE), $7, $8, $9) RETURNING *`,
    [animal_id, tipo, insumo_id, enfermedad, descripcion, fecha, proxima_dosis, veterinario_id, plan_item_id || null]
    );
    await registrarBitacora(req.usuario, 'registrar_salud', 'evento_salud', rows[0].id, { despues: rows[0] }, client);
    return rows[0];
  });
  return responderIdempotente(res, ejecucion);
}));

// Registrar el mismo evento de salud (ej. una vacuna) a varios animales a la vez.
// No se hace en una sola transacción a propósito: si un animal falla (ej. nació
// después de la fecha del evento), el resto no debe perder su registro.
router.post('/lote', asyncHandler(async (req, res) => {
  const { animal_ids, tipo, insumo_id, enfermedad, descripcion, fecha, proxima_dosis } = req.body;
  if (!Array.isArray(animal_ids) || animal_ids.length === 0 || !tipo) {
    return res.status(400).json({ error: 'animal_ids (lista) y tipo son obligatorios' });
  }

  const creados = [];
  const errores = [];

  for (const animal_id of animal_ids) {
    try {
      const evento = await enTransaccion(async (client) => {
        const { rows } = await client.query(
          `INSERT INTO evento_salud (animal_id, tipo, insumo_id, enfermedad, descripcion, fecha, proxima_dosis)
           VALUES ($1,$2,$3,$4,$5, COALESCE($6, CURRENT_DATE), $7) RETURNING *`,
          [animal_id, tipo, insumo_id || null, enfermedad || null, descripcion || null, fecha || null, proxima_dosis || null]
        );
        await registrarBitacora(req.usuario, 'registrar_salud_lote', 'evento_salud', rows[0].id, {
          despues: rows[0], contexto: { operacion_lote: true },
        }, client);
        return rows[0];
      });
      creados.push(evento);
    } catch (err) {
      errores.push({ animal_id, error: mensajePublicoError(err) });
    }
  }

  res.status(201).json({ creados, errores });
}));

// Lista global de eventos de salud (todos los animales) para el módulo de
// Sanidad — filtrable por tipo/animal/rango de fechas. Antes solo se podía
// leer por animal vía /animales/:id/historial; esta ruta es nueva y aditiva,
// no toca los INSERT/PATCH/DELETE de arriba.
router.get('/', asyncHandler(async (req, res) => {
  const { tipo, animal_id, desde, hasta } = req.query;
  const condiciones = [];
  const valores = [];

  if (tipo) {
    valores.push(tipo);
    condiciones.push(`es.tipo = $${valores.length}`);
  }
  if (animal_id) {
    valores.push(animal_id);
    condiciones.push(`es.animal_id = $${valores.length}`);
  }
  if (desde) {
    valores.push(desde);
    condiciones.push(`es.fecha >= $${valores.length}`);
  }
  if (hasta) {
    valores.push(hasta);
    condiciones.push(`es.fecha <= $${valores.length}`);
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  const { rows } = await db.query(
    `SELECT es.*, a.arete_id, a.nombre_alias
     FROM evento_salud es
     JOIN animal a ON a.id = es.animal_id
     ${where}
     ORDER BY es.fecha DESC
     LIMIT 300`,
    valores
  );
  res.json(rows);
}));

// Próximas dosis / vacunas pendientes (alimenta el módulo de alertas).
// ?incluirVencidas=true además trae las que ya pasaron de fecha (para
// distinguir severidad crítica/advertencia en el módulo de Alertas) — el
// comportamiento por default (sin el parámetro) no cambia.
router.get('/proximas', asyncHandler(async (req, res) => {
  const dias = parseInt(req.query.dias || '30', 10);
  const incluirVencidas = req.query.incluirVencidas === 'true';
  const { rows } = await db.query(
    `SELECT es.*, a.arete_id
     FROM evento_salud es JOIN animal a ON a.id = es.animal_id
     WHERE es.proxima_dosis IS NOT NULL
       AND es.proxima_dosis <= CURRENT_DATE + $1::int
       ${incluirVencidas ? '' : 'AND es.proxima_dosis >= CURRENT_DATE'}
     ORDER BY es.proxima_dosis`,
    [dias]
  );
  res.json(rows);
}));

// Corregir un evento de salud mal capturado
router.patch('/:id', asyncHandler(async (req, res) => {
  const { tipo, insumo_id, enfermedad, descripcion, fecha, proxima_dosis } = req.body;
  const evento = await enTransaccion(async (client) => {
    const anterior = await client.query('SELECT * FROM evento_salud WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!anterior.rows.length) return null;
    const { rows } = await client.query(
      `UPDATE evento_salud SET
         tipo = COALESCE($1, tipo), insumo_id = $2, enfermedad = $3, descripcion = $4,
         fecha = COALESCE($5, fecha), proxima_dosis = $6
       WHERE id = $7 RETURNING *`,
      [tipo || null, insumo_id || null, enfermedad || null, descripcion || null, fecha || null, proxima_dosis || null, req.params.id]
    );
    await registrarBitacora(req.usuario, 'editar_salud', 'evento_salud', rows[0].id, {
      antes: anterior.rows[0], despues: rows[0],
    }, client);
    return rows[0];
  });
  if (!evento) return res.status(404).json({ error: 'Evento no encontrado' });
  res.json(evento);
}));

// Eliminar un evento de salud capturado por error
router.delete('/:id', asyncHandler(async (req, res) => {
  const eliminado = await enTransaccion(async (client) => {
    const anterior = await client.query('SELECT * FROM evento_salud WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!anterior.rows.length) return null;
    await client.query('DELETE FROM evento_salud WHERE id = $1', [req.params.id]);
    await registrarBitacora(req.usuario, 'eliminar_salud', 'evento_salud', Number(req.params.id), {
      antes: anterior.rows[0], despues: null,
    }, client);
    return anterior.rows[0];
  });
  if (!eliminado) return res.status(404).json({ error: 'Evento no encontrado' });
  res.status(204).send();
}));

module.exports = router;
