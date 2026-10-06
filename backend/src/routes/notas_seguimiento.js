const express = require('express');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { tienePermiso } = require('../authorization/policy');
const { registrarBitacora } = require('../bitacora');
const { ejecutarIdempotente, responderIdempotente } = require('../idempotency');
const { fechaEfectivaEvento, verificarEventoSobreAnimalActivo } = require('../eventoAnimalActivo');

const router = express.Router();

router.get('/animal/:animal_id', asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT n.id, n.tag, n.contenido, n.fecha, n.usuario_id, u.nombre AS usuario
     FROM nota_seguimiento n LEFT JOIN usuario u ON u.id = n.usuario_id
     WHERE n.animal_id = $1 ORDER BY n.fecha DESC`,
    [req.params.animal_id]
  );
  res.json(rows);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { animal_id, tag, contenido } = req.body;
  if (!animal_id || !contenido) {
    return res.status(400).json({ error: 'animal_id y contenido son obligatorios' });
  }
  const ejecucion = await ejecutarIdempotente(req, {
    tipo: 'nota_seguimiento.crear', entidad: 'nota_seguimiento', payload: { body: req.body }, httpStatus: 201,
  }, async (client, contexto) => {
    // Una nota offline conserva el momento en que se escribió en campo (nunca
    // posterior al servidor), no el de la sincronización.
    const capturadaEn = contexto.offline && contexto.fechaLocal && contexto.fechaLocal < new Date() ? contexto.fechaLocal : null;
    if (contexto.offline) await verificarEventoSobreAnimalActivo(client, animal_id, fechaEfectivaEvento(null, contexto));
    const { rows } = await client.query(
      `INSERT INTO nota_seguimiento (animal_id, usuario_id, tag, contenido, fecha)
       VALUES ($1,$2,$3,$4, COALESCE($5::timestamptz AT TIME ZONE current_setting('TimeZone'), now())) RETURNING *`,
      [animal_id, req.usuario.id, tag || null, contenido, capturadaEn]
    );
    await registrarBitacora(req.usuario, 'crear_nota_seguimiento', 'nota_seguimiento', rows[0].id, {
      despues: rows[0], contexto: { animal_id },
    }, client);
    return rows[0];
  });
  return responderIdempotente(res, ejecucion);
}));

// Solo el autor de la nota o un Administrador pueden borrarla
router.delete('/:id', asyncHandler(async (req, res) => {
  const nota = await db.query('SELECT usuario_id FROM nota_seguimiento WHERE id = $1', [req.params.id]);
  if (!nota.rows.length) return res.status(404).json({ error: 'Nota no encontrada' });
  if (!tienePermiso(req.usuario.rol, 'notas_seguimiento', 'eliminar_cualquiera')
      && nota.rows[0].usuario_id !== req.usuario.id) {
    return res.status(403).json({ error: 'Solo puedes borrar tus propias notas.' });
  }
  await db.query('DELETE FROM nota_seguimiento WHERE id = $1', [req.params.id]);
  res.status(204).send();
}));

module.exports = router;
