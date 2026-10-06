const express = require('express');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { registrarBitacora } = require('../bitacora');
const { validar } = require('../middleware/validar');
const validaciones = require('../validation/ventas');
const { crearError } = require('../errors');

const router = express.Router();

// Registrar venta de un animal (CU8): venta + baja de inventario en una transacción
router.post('/', validar({ body: validaciones.venta }), asyncHandler(async (req, res) => {
  const { animal_id, tercero_id, fecha, precio, factura_folio } = req.body;
  if (!animal_id || !tercero_id || precio === undefined) {
    return res.status(400).json({ error: 'animal_id, tercero_id y precio son obligatorios' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const animal = await client.query(
      'SELECT id, estado, fecha_baja, razon_baja FROM animal WHERE id = $1 FOR UPDATE',
      [animal_id]
    );
    if (!animal.rows.length) {
      throw crearError('ANIMAL_NO_ENCONTRADO', 'No se encontró el animal solicitado.', 404);
    }
    if (animal.rows[0].estado === 'vendido') {
      throw crearError('ANIMAL_YA_VENDIDO', 'El animal ya fue vendido.', 409);
    }
    if (animal.rows[0].estado !== 'vivo') {
      throw crearError('ANIMAL_NO_DISPONIBLE_PARA_VENTA', 'El animal no está disponible para venta.', 409);
    }

    const venta = await client.query(
      `INSERT INTO venta (animal_id, tercero_id, fecha, precio, factura_folio)
       VALUES ($1,$2, COALESCE($3, CURRENT_DATE), $4, $5) RETURNING *`,
      [animal_id, tercero_id, fecha, precio, factura_folio]
    );
    const animalActualizado = await client.query(
      `UPDATE animal
       SET estado = 'vendido', fecha_baja = COALESCE($1, CURRENT_DATE), razon_baja = NULL
       WHERE id = $2 RETURNING id, estado, fecha_baja, razon_baja`,
      [fecha, animal_id]
    );
    await registrarBitacora(req.usuario, 'registrar_venta', 'venta', venta.rows[0].id, {
      antes: { animal: animal.rows[0] },
      despues: { venta: venta.rows[0], animal: animalActualizado.rows[0] },
      contexto: { tercero_id },
    }, client);
    await client.query('COMMIT');
    res.status(201).json(venta.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// Registrar la venta de VARIOS animales en un solo trato: un comprador, una
// fecha, un precio total que se reparte entre los animales (o precios
// individuales si se especifican). Cada animal sigue teniendo su propia
// fila en "venta" (para historial y reportes), pero todas enlazadas al lote.
router.post('/lote', validar({ body: validaciones.ventaLote }), asyncHandler(async (req, res) => {
  const { animal_ids, tercero_id, fecha, precio_total, factura_folio, precios_individuales } = req.body;
  if (!Array.isArray(animal_ids) || animal_ids.length === 0 || !tercero_id || precio_total === undefined) {
    return res.status(400).json({ error: 'animal_ids (lista), tercero_id y precio_total son obligatorios' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Todos los lotes bloquean animales en el mismo orden para reducir
    // interbloqueos y validan el conjunto completo antes de crear la cabecera.
    const idsOrdenados = [...animal_ids].sort((a, b) => a - b);
    const animales = await client.query(
      `SELECT id, estado
       FROM animal
       WHERE id = ANY($1::int[])
       ORDER BY id
       FOR UPDATE`,
      [idsOrdenados]
    );
    if (animales.rows.length !== idsOrdenados.length) {
      const encontrados = new Set(animales.rows.map((animal) => Number(animal.id)));
      const faltantes = idsOrdenados.filter((id) => !encontrados.has(Number(id)));
      throw crearError('ANIMAL_NO_ENCONTRADO', 'No se encontró uno de los animales solicitados.', 404, {
        details: faltantes.map((id) => ({ field: 'animal_ids', animal_id: id, message: 'Animal no encontrado.' })),
      });
    }
    const noDisponible = animales.rows.find((animal) => animal.estado !== 'vivo');
    if (noDisponible) {
      const vendido = noDisponible.estado === 'vendido';
      throw crearError(
        vendido ? 'ANIMAL_YA_VENDIDO' : 'ANIMAL_NO_DISPONIBLE_PARA_VENTA',
        vendido ? 'Uno de los animales ya fue vendido.' : 'Uno de los animales no está disponible para venta.',
        409,
        { details: [{ animal_id: noDisponible.id, estado: noDisponible.estado }] }
      );
    }

    const lote = await client.query(
      `INSERT INTO venta_lote (tercero_id, fecha, precio_total, factura_folio)
       VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4) RETURNING *`,
      [tercero_id, fecha, precio_total, factura_folio || null]
    );

    // Si no se dan precios por animal, se reparte el total entre todos en partes iguales
    const precioParejo = Number((precio_total / animal_ids.length).toFixed(2));

    const ventas = [];
    for (const animal_id of animal_ids) {
      const precioAnimal = precios_individuales?.[animal_id] ?? precioParejo;
      const venta = await client.query(
        `INSERT INTO venta (animal_id, tercero_id, fecha, precio, factura_folio, venta_lote_id)
         VALUES ($1,$2, COALESCE($3, CURRENT_DATE), $4, $5, $6) RETURNING *`,
        [animal_id, tercero_id, fecha, precioAnimal, factura_folio || null, lote.rows[0].id]
      );
      await client.query(
        `UPDATE animal
         SET estado = 'vendido', fecha_baja = COALESCE($1, CURRENT_DATE), razon_baja = NULL
         WHERE id = $2`,
        [fecha, animal_id]
      );
      ventas.push(venta.rows[0]);
    }

    await registrarBitacora(req.usuario, 'registrar_venta_lote', 'venta_lote', lote.rows[0].id, {
      antes: { animales: animales.rows },
      despues: { lote: lote.rows[0], ventas },
      contexto: { animal_ids: idsOrdenados, tercero_id },
    }, client);
    await client.query('COMMIT');
    res.status(201).json({ lote: lote.rows[0], ventas });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// Historial de ventas por lote
router.get('/lotes', asyncHandler(async (req, res) => {
  const { rows } = await db.query(`
    SELECT vl.*, t.nombre AS comprador, COUNT(v.id) AS total_animales
    FROM venta_lote vl
    JOIN tercero t ON t.id = vl.tercero_id
    LEFT JOIN venta v ON v.venta_lote_id = vl.id
    GROUP BY vl.id, t.nombre
    ORDER BY vl.fecha DESC
  `);
  res.json(rows);
}));

// Reporte de ingresos por ventas — se puede filtrar por rango de fechas y/o comprador
router.get('/reporte', asyncHandler(async (req, res) => {
  const { desde, hasta, tercero_id } = req.query;
  const { rows } = await db.query(
    `SELECT v.fecha, v.precio, a.arete_id, a.nombre_alias, t.nombre AS comprador, t.id AS tercero_id
     FROM venta v
     JOIN animal a ON a.id = v.animal_id
     JOIN tercero t ON t.id = v.tercero_id
     WHERE ($1::date IS NULL OR v.fecha >= $1)
       AND ($2::date IS NULL OR v.fecha <= $2)
       AND ($3::int IS NULL OR v.tercero_id = $3)
     ORDER BY v.fecha`,
    [desde || null, hasta || null, tercero_id || null]
  );
  const total = rows.reduce((sum, r) => sum + Number(r.precio), 0);
  res.json({ ventas: rows, total_ingresos: total, total_animales: rows.length });
}));

module.exports = router;
