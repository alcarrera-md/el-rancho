const express = require('express');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { registrarBitacora } = require('../bitacora');
const { enTransaccion } = require('../transaction');
const { ejecutarIdempotente, responderIdempotente } = require('../idempotency');
const { fechaEfectivaEvento, verificarEventoSobreAnimalActivo } = require('../eventoAnimalActivo');

const router = express.Router();

router.get('/animal/:animal_id', asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    'SELECT id, fecha, puntuacion, observacion FROM condicion_corporal WHERE animal_id = $1 ORDER BY fecha',
    [req.params.animal_id]
  );
  res.json(rows);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { animal_id, fecha, puntuacion, observacion } = req.body;
  if (!animal_id || puntuacion === undefined) {
    return res.status(400).json({ error: 'animal_id y puntuacion son obligatorios' });
  }
  if (puntuacion < 1 || puntuacion > 5) {
    return res.status(400).json({ error: 'puntuacion debe estar entre 1 y 5' });
  }
  const ejecucion = await ejecutarIdempotente(req, {
    tipo: 'condicion_corporal.crear', entidad: 'condicion_corporal', payload: { body: req.body }, httpStatus: 201,
  }, async (client, contexto) => {
    let trabajadorId = req.body.trabajador_id || null;
    if (contexto.offline) {
      await verificarEventoSobreAnimalActivo(client, animal_id, fechaEfectivaEvento(fecha, contexto));
      // Offline el responsable sale de la sesión autenticada, nunca del cliente.
      const trabajador = await client.query(
        'SELECT id FROM trabajador WHERE usuario_id = $1 AND activo = true ORDER BY id LIMIT 1',
        [req.usuario.id]
      );
      trabajadorId = trabajador.rows[0]?.id || null;
    }
    const { rows } = await client.query(
      `INSERT INTO condicion_corporal (animal_id, fecha, puntuacion, observacion, trabajador_id)
       VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4, $5) RETURNING *`,
      [animal_id, fecha, puntuacion, observacion || null, trabajadorId]
    );
    await registrarBitacora(req.usuario, 'registrar_condicion_corporal', 'condicion_corporal', rows[0].id, { despues: rows[0] }, client);
    return rows[0];
  });
  return responderIdempotente(res, ejecucion);
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const { fecha, puntuacion, observacion } = req.body;
  const registro = await enTransaccion(async (client) => {
    const anterior = await client.query('SELECT * FROM condicion_corporal WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!anterior.rows.length) return null;
    const { rows } = await client.query(
      `UPDATE condicion_corporal SET fecha = COALESCE($1, fecha), puntuacion = COALESCE($2, puntuacion), observacion = $3
       WHERE id = $4 RETURNING *`,
      [fecha || null, puntuacion || null, observacion, req.params.id]
    );
    await registrarBitacora(req.usuario, 'editar_condicion_corporal', 'condicion_corporal', rows[0].id, { antes: anterior.rows[0], despues: rows[0] }, client);
    return rows[0];
  });
  if (!registro) return res.status(404).json({ error: 'Registro no encontrado' });
  res.json(registro);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const registro = await enTransaccion(async (client) => {
    const anterior = await client.query('SELECT * FROM condicion_corporal WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!anterior.rows.length) return null;
    await client.query('DELETE FROM condicion_corporal WHERE id = $1', [req.params.id]);
    await registrarBitacora(req.usuario, 'eliminar_condicion_corporal', 'condicion_corporal', Number(req.params.id), { antes: anterior.rows[0], despues: null }, client);
    return anterior.rows[0];
  });
  if (!registro) return res.status(404).json({ error: 'Registro no encontrado' });
  res.status(204).send();
}));

module.exports = router;
