const express = require('express');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { registrarBitacora } = require('../bitacora');
const { enTransaccion } = require('../transaction');

const router = express.Router();

// Historial completo de producción de un animal (para graficar)
router.get('/animal/:animal_id', asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    'SELECT id, fecha, turno, litros, observacion FROM produccion_leche WHERE animal_id = $1 ORDER BY fecha, turno',
    [req.params.animal_id]
  );
  res.json(rows);
}));

// Resumen por periodos: hoy, semana actual, semana anterior, mes actual
router.get('/animal/:animal_id/resumen', asyncHandler(async (req, res) => {
  const { rows } = await db.query(`
    SELECT
      COALESCE(SUM(litros) FILTER (WHERE fecha = CURRENT_DATE), 0) AS litros_hoy,
      COALESCE(SUM(litros) FILTER (WHERE fecha >= date_trunc('week', CURRENT_DATE)), 0) AS litros_semana_actual,
      COALESCE(SUM(litros) FILTER (
        WHERE fecha >= date_trunc('week', CURRENT_DATE) - INTERVAL '7 days'
          AND fecha < date_trunc('week', CURRENT_DATE)
      ), 0) AS litros_semana_anterior,
      COALESCE(SUM(litros) FILTER (WHERE fecha >= date_trunc('month', CURRENT_DATE)), 0) AS litros_mes_actual,
      MAX(fecha) AS ultimo_registro
    FROM produccion_leche WHERE animal_id = $1
  `, [req.params.animal_id]);
  res.json(rows[0]);
}));

// Registrar un ordeño — solo animales hembra
router.post('/', asyncHandler(async (req, res) => {
  const { animal_id, fecha, turno, litros, observacion } = req.body;
  if (!animal_id || litros === undefined) {
    return res.status(400).json({ error: 'animal_id y litros son obligatorios' });
  }

  const animal = await db.query('SELECT sexo FROM animal WHERE id = $1', [animal_id]);
  if (!animal.rows.length) return res.status(404).json({ error: 'Animal no encontrado' });
  if (animal.rows[0].sexo !== 'hembra') {
    return res.status(400).json({ error: 'Solo se puede registrar producción de leche en animales hembra.' });
  }

  try {
    const registro = await enTransaccion(async (client) => {
      const { rows } = await client.query(
      `INSERT INTO produccion_leche (animal_id, fecha, turno, litros, trabajador_id, observacion)
       VALUES ($1, COALESCE($2, CURRENT_DATE), COALESCE($3, 'unico'), $4, $5, $6) RETURNING *`,
      [animal_id, fecha, turno, litros, req.body.trabajador_id || null, observacion || null]
      );
      await registrarBitacora(req.usuario, 'registrar_produccion_leche', 'produccion_leche', rows[0].id, { despues: rows[0] }, client);
      return rows[0];
    });
    res.status(201).json(registro);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un registro de ese turno para esa fecha en este animal.' });
    }
    throw err;
  }
}));

// Corregir un registro de ordeño
router.patch('/:id', asyncHandler(async (req, res) => {
  const { fecha, turno, litros, observacion } = req.body;
  const registro = await enTransaccion(async (client) => {
    const anterior = await client.query('SELECT * FROM produccion_leche WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!anterior.rows.length) return null;
    const { rows } = await client.query(
      `UPDATE produccion_leche SET
         fecha = COALESCE($1, fecha), turno = COALESCE($2, turno), litros = COALESCE($3, litros), observacion = $4
       WHERE id = $5 RETURNING *`,
      [fecha || null, turno || null, litros !== undefined ? litros : null, observacion, req.params.id]
    );
    await registrarBitacora(req.usuario, 'editar_produccion_leche', 'produccion_leche', rows[0].id, { antes: anterior.rows[0], despues: rows[0] }, client);
    return rows[0];
  });
  if (!registro) return res.status(404).json({ error: 'Registro no encontrado' });
  res.json(registro);
}));

// Eliminar un registro de ordeño
router.delete('/:id', asyncHandler(async (req, res) => {
  const registro = await enTransaccion(async (client) => {
    const anterior = await client.query('SELECT * FROM produccion_leche WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!anterior.rows.length) return null;
    await client.query('DELETE FROM produccion_leche WHERE id = $1', [req.params.id]);
    await registrarBitacora(req.usuario, 'eliminar_produccion_leche', 'produccion_leche', Number(req.params.id), { antes: anterior.rows[0], despues: null }, client);
    return anterior.rows[0];
  });
  if (!registro) return res.status(404).json({ error: 'Registro no encontrado' });
  res.status(204).send();
}));

module.exports = router;
