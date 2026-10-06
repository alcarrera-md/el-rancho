const express = require('express');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { registrarBitacora } = require('../bitacora');
const { validar } = require('../middleware/validar');
const validaciones = require('../validation/compras');

const router = express.Router();

// Historial de compras de animales — filtrable por proveedor y rango de fechas
router.get('/', asyncHandler(async (req, res) => {
  const { tercero_id, desde, hasta } = req.query;
  const { rows } = await db.query(`
    SELECT ca.*, a.arete_id, a.nombre_alias, a.estado AS animal_estado, a.estado_salud, t.nombre AS proveedor
    FROM compra_animal ca
    JOIN animal a ON a.id = ca.animal_id
    JOIN tercero t ON t.id = ca.tercero_id
    WHERE ($1::int IS NULL OR ca.tercero_id = $1)
      AND ($2::date IS NULL OR ca.fecha >= $2)
      AND ($3::date IS NULL OR ca.fecha <= $3)
    ORDER BY ca.fecha DESC
  `, [tercero_id || null, desde || null, hasta || null]);
  res.json(rows);
}));

// Registrar la compra de un animal ya existente en el sistema (caso raro:
// corregir un registro, o vincular retroactivamente) — solo Administrador
router.post('/', validar({ body: validaciones.compraAnimal }), asyncHandler(async (req, res) => {
  const { animal_id, tercero_id, fecha, precio, identificacion_previa } = req.body;
  if (!animal_id || !tercero_id) {
    return res.status(400).json({ error: 'animal_id y tercero_id son obligatorios' });
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO compra_animal (animal_id, tercero_id, fecha, precio, identificacion_previa)
       VALUES ($1,$2, COALESCE($3, CURRENT_DATE), $4, $5) RETURNING *`,
      [animal_id, tercero_id, fecha, precio || null, identificacion_previa || null]
    );
    await registrarBitacora(req.usuario, 'comprar_animal', 'compra_animal', rows[0].id, {
      despues: rows[0], contexto: { animal_id, tercero_id },
    }, client);
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// Caso normal: comprar un animal NUEVO — se da de alta el animal y se
// registra su compra en un solo paso, ya enlazados. Es el flujo correcto
// para "compré una vaca que no tenía", a diferencia de POST / de arriba.
router.post('/nuevo', validar({ body: validaciones.compraAnimalNuevo }), asyncHandler(async (req, res) => {
  const {
    arete_id, sexo, nombre_alias, fecha_nacimiento, raza_id, peso_nacimiento_kg, corral_id,
    tercero_id, fecha, precio, identificacion_previa,
  } = req.body;

  if (!arete_id || !sexo) return res.status(400).json({ error: 'arete_id y sexo son obligatorios' });
  if (!tercero_id) return res.status(400).json({ error: 'tercero_id (proveedor) es obligatorio' });

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const animalRes = await client.query(
      `INSERT INTO animal (arete_id, sexo, nombre_alias, fecha_nacimiento, raza_id, peso_nacimiento_kg, corral_actual_id, origen)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'compra') RETURNING *`,
      [arete_id, sexo, nombre_alias || null, fecha_nacimiento || null, raza_id || null, peso_nacimiento_kg || null, corral_id || null]
    );
    const animal = animalRes.rows[0];

    const compraRes = await client.query(
      `INSERT INTO compra_animal (animal_id, tercero_id, fecha, precio, identificacion_previa)
       VALUES ($1,$2, COALESCE($3, CURRENT_DATE), $4, $5) RETURNING *`,
      [animal.id, tercero_id, fecha || null, precio || null, identificacion_previa || null]
    );

    await registrarBitacora(req.usuario, 'comprar_animal_nuevo', 'animal', animal.id, {
      despues: { animal, compra: compraRes.rows[0] },
      contexto: { tercero_id },
    }, client);
    await client.query('COMMIT');
    res.status(201).json({ animal, compra: compraRes.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

module.exports = router;
