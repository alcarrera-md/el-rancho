const express = require('express');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { validar } = require('../middleware/validar');
const { paramsId } = require('../validation/comun');
const validaciones = require('../validation/alimentacion');
const { normalizarError } = require('../middleware/errorHandler');
const { crearError } = require('../errors');
const { registrarBitacora } = require('../bitacora');
const { ejecutarIdempotente, responderIdempotente } = require('../idempotency');

const router = express.Router();

// Registrar suministro de alimento a un animal o corral (CU2)
// El trigger de BD valida y descuenta el stock automáticamente.
router.post('/', validar({ body: validaciones.alimentacion }), asyncHandler(async (req, res) => {
  const {
    animal_id, corral_id, corral_contexto_id, insumo_id, fecha, cantidad, trabajador_id,
    unidad_medida, expected_version, stock_observado,
  } = req.body;
  if (!insumo_id || !cantidad || (!animal_id && !corral_id)) {
    return res.status(400).json({ error: 'insumo_id, cantidad y (animal_id o corral_id) son obligatorios' });
  }

  const ejecucion = await ejecutarIdempotente(req, {
    tipo: 'alimentacion.crear',
    entidad: 'alimentacion',
    payload: req.body,
    httpStatus: 201,
  }, async (client, contexto) => {
    if (contexto.offline) {
      if (animal_id && corral_id) {
        throw crearError('ALIMENTACION_DESTINO_AMBIGUO', 'Selecciona un animal o un corral, no ambos.', 400);
      }
      if (expected_version === undefined || stock_observado === undefined || !unidad_medida) {
        throw crearError(
          'OFFLINE_STOCK_CONTEXT_REQUIRED',
          'La captura offline necesita la versión, unidad y stock sincronizados del alimento.',
          400
        );
      }
    }

    const insumo = await client.query(
      `SELECT id, nombre, tipo, unidad_medida, stock_actual, fecha_caducidad, activo, version,
              (fecha_caducidad IS NOT NULL AND fecha_caducidad < CURRENT_DATE) AS caducado
       FROM insumo
       WHERE id = $1
       FOR UPDATE`,
      [insumo_id]
    );
    if (!insumo.rows.length) {
      throw crearError('INSUMO_NO_ENCONTRADO', 'No se encontró el insumo solicitado.', 404);
    }
    const insumoActual = insumo.rows[0];

    if (contexto.offline && !insumoActual.activo) {
      throw crearError('INSUMO_INACTIVO', 'El alimento ya no está activo.', 409);
    }

    if (contexto.offline && String(insumoActual.unidad_medida) !== String(unidad_medida)) {
      throw crearError('INSUMO_UNIDAD_CAMBIO', 'La unidad del alimento cambió desde la última sincronización.', 409, {
        details: [{ field: 'unidad_medida', message: 'Vuelve a capturar con la unidad actual.', observada: unidad_medida, actual: insumoActual.unidad_medida }],
      });
    }
    // Decisión D1 (P8.3): que el stock haya cambiado desde la captura no es
    // conflicto por sí mismo. Con la fila bloqueada (FOR UPDATE) se aplica si
    // todavía alcanza; si no, STOCK_INSUFICIENTE. La versión y el stock
    // observados se conservan solo como contexto de auditoría.
    if (contexto.offline && insumoActual.caducado) {
      throw crearError('INSUMO_CADUCADO', 'No se puede utilizar un alimento caducado.', 409, {
        details: [{ field: 'insumo_id', message: 'Selecciona un alimento vigente.', fecha_caducidad: insumoActual.fecha_caducidad }],
      });
    }
    if (Number(insumoActual.stock_actual) < Number(cantidad)) {
      throw crearError('STOCK_INSUFICIENTE', 'No hay stock suficiente para realizar la operación.', 409, {
        details: [{
          field: 'cantidad',
          message: 'La cantidad supera la existencia actual.',
          insumo: insumoActual.nombre,
          requerido: Number(cantidad),
          disponible: Number(insumoActual.stock_actual),
          observado: contexto.offline ? Number(stock_observado) : undefined,
          actual: Number(insumoActual.stock_actual),
          unidad_medida: insumoActual.unidad_medida,
        }],
      });
    }

    if (contexto.offline && animal_id) {
      const animal = await client.query('SELECT id, estado, corral_actual_id FROM animal WHERE id = $1 FOR UPDATE', [animal_id]);
      if (!animal.rows.length) throw crearError('ANIMAL_NO_ENCONTRADO', 'No se encontró el animal solicitado.', 404);
      if (animal.rows[0].estado !== 'vivo') {
        throw crearError('ANIMAL_INACTIVO', 'El animal ya no está activo.', 409);
      }
      if (corral_contexto_id !== undefined && Number(animal.rows[0].corral_actual_id) !== Number(corral_contexto_id)) {
        throw crearError('ANIMAL_CORRAL_CAMBIO', 'El animal cambió de corral desde la última sincronización.', 409, {
          details: [{ field: 'corral_contexto_id', message: 'Vuelve a capturar usando la ubicación actual.', observado: Number(corral_contexto_id), actual: animal.rows[0].corral_actual_id }],
        });
      }
    }
    if (contexto.offline && corral_id) {
      const corral = await client.query('SELECT id FROM corral WHERE id = $1 FOR KEY SHARE', [corral_id]);
      if (!corral.rows.length) throw crearError('CORRAL_NO_ENCONTRADO', 'No se encontró el corral solicitado.', 404);
    }

    const { rows } = await client.query(
      `INSERT INTO alimentacion (animal_id, corral_id, insumo_id, fecha, cantidad, trabajador_id)
       VALUES ($1,$2,$3, COALESCE($4, CURRENT_DATE), $5, $6) RETURNING *`,
      [animal_id, corral_id, insumo_id, fecha, cantidad, trabajador_id]
    );
    const stockDespues = await client.query(
      'SELECT id, nombre, unidad_medida, stock_actual, version FROM insumo WHERE id = $1',
      [insumo_id]
    );
    await registrarBitacora(req.usuario, 'registrar_alimentacion', 'alimentacion', rows[0].id, {
      antes: { insumo: insumoActual },
      despues: { alimentacion: rows[0], insumo: stockDespues.rows[0] },
      contexto: contexto.offline ? {
        origen: 'offline',
        stock_observado: Number(stock_observado),
        version_observada: Number(expected_version),
      } : undefined,
    }, client);
    return rows[0];
  });

  return responderIdempotente(res, ejecucion);
}));

// Registrar la misma alimentación (mismo insumo y cantidad) para varios animales.
// Cada uno se descuenta del stock por separado; si el stock se agota a la mitad
// del lote, los animales restantes quedan como error (no se detiene todo el lote).
router.post('/lote', validar({ body: validaciones.alimentacionLote }), asyncHandler(async (req, res) => {
  const { animal_ids, insumo_id, cantidad, fecha } = req.body;
  if (!Array.isArray(animal_ids) || animal_ids.length === 0 || !insumo_id || !cantidad) {
    return res.status(400).json({ error: 'animal_ids (lista), insumo_id y cantidad son obligatorios' });
  }

  const creados = [];
  const errores = [];
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const insumo = await client.query(
      'SELECT id, stock_actual FROM insumo WHERE id = $1 FOR UPDATE',
      [insumo_id]
    );
    if (!insumo.rows.length) {
      throw crearError('INSUMO_NO_ENCONTRADO', 'No se encontró el insumo solicitado.', 404);
    }

    let disponible = Number(insumo.rows[0].stock_actual);
    for (let indice = 0; indice < animal_ids.length; indice += 1) {
      const animal_id = animal_ids[indice];
      if (disponible < Number(cantidad)) {
        errores.push({
          animal_id,
          code: 'STOCK_INSUFICIENTE',
          error: 'No hay stock suficiente para realizar la operación.',
        });
        continue;
      }

      const savepoint = `alimentacion_lote_${indice}`;
      await client.query(`SAVEPOINT ${savepoint}`);
      try {
        const { rows } = await client.query(
          `INSERT INTO alimentacion (animal_id, insumo_id, fecha, cantidad)
           VALUES ($1,$2, COALESCE($3, CURRENT_DATE), $4) RETURNING *`,
          [animal_id, insumo_id, fecha || null, cantidad]
        );
        await registrarBitacora(req.usuario, 'registrar_alimentacion_lote', 'alimentacion', rows[0].id, {
          despues: rows[0],
          contexto: { indice, total_lote: animal_ids.length },
        }, client);
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
        creados.push(rows[0]);
        disponible -= Number(cantidad);
      } catch (err) {
        await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
        const errorPublico = normalizarError(err);
        errores.push({ animal_id, code: errorPublico.code, error: errorPublico.message });
      }
    }

    await client.query('COMMIT');
    res.status(201).json({
      atomic: false,
      consumo_total_requerido: Number(cantidad) * animal_ids.length,
      consumo_total_aplicado: Number(cantidad) * creados.length,
      creados,
      errores,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// Lista global de alimentación (todos los animales/corrales) para el módulo
// de Alimentación — filtrable por animal/corral/insumo/rango de fechas.
// Antes solo se leía por animal vía /animales/:id/historial; ruta nueva y
// aditiva, no toca los INSERT/PATCH/DELETE de arriba.
router.get('/', asyncHandler(async (req, res) => {
  const { animal_id, corral_id, insumo_id, desde, hasta } = req.query;
  const condiciones = [];
  const valores = [];

  if (animal_id) {
    valores.push(animal_id);
    condiciones.push(`al.animal_id = $${valores.length}`);
  }
  if (corral_id) {
    valores.push(corral_id);
    condiciones.push(`al.corral_id = $${valores.length}`);
  }
  if (insumo_id) {
    valores.push(insumo_id);
    condiciones.push(`al.insumo_id = $${valores.length}`);
  }
  if (desde) {
    valores.push(desde);
    condiciones.push(`al.fecha >= $${valores.length}`);
  }
  if (hasta) {
    valores.push(hasta);
    condiciones.push(`al.fecha <= $${valores.length}`);
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  const { rows } = await db.query(
    `SELECT al.*, i.nombre AS insumo, i.unidad_medida,
            a.arete_id, a.nombre_alias,
            COALESCE(c.nombre, ca.nombre) AS corral_nombre
     FROM alimentacion al
     JOIN insumo i ON i.id = al.insumo_id
     LEFT JOIN animal a ON a.id = al.animal_id
     LEFT JOIN corral c ON c.id = al.corral_id
     LEFT JOIN corral ca ON ca.id = a.corral_actual_id
     ${where}
     ORDER BY al.fecha DESC
     LIMIT 300`,
    valores
  );
  res.json(rows);
}));

// Insumos con stock bajo (alimenta el módulo de alertas)
router.get('/stock-bajo', asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    'SELECT * FROM insumo WHERE stock_actual <= stock_minimo ORDER BY nombre'
  );
  res.json(rows);
}));

// Corregir un registro de alimentación (ajusta el stock: devuelve lo viejo, descuenta lo nuevo)
router.patch('/:id', validar({ params: paramsId, body: validaciones.editarAlimentacion }), asyncHandler(async (req, res) => {
  const { fecha, cantidad, insumo_id } = req.body;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const actual = await client.query('SELECT * FROM alimentacion WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!actual.rows.length) {
      throw crearError('ALIMENTACION_NO_ENCONTRADA', 'No se encontró el registro de alimentación.', 404);
    }
    const registro = actual.rows[0];
    const nuevoInsumoId = insumo_id || registro.insumo_id;
    const nuevaCantidad = cantidad !== undefined ? Number(cantidad) : Number(registro.cantidad);
    const insumoIds = [...new Set([Number(registro.insumo_id), Number(nuevoInsumoId)])].sort((a, b) => a - b);
    const insumos = await client.query(
      `SELECT id, stock_actual
       FROM insumo
       WHERE id = ANY($1::int[])
       ORDER BY id
       FOR UPDATE`,
      [insumoIds]
    );
    if (insumos.rows.length !== insumoIds.length) {
      throw crearError('INSUMO_NO_ENCONTRADO', 'No se encontró el insumo solicitado.', 404);
    }
    const stockPorId = new Map(insumos.rows.map((row) => [Number(row.id), Number(row.stock_actual)]));

    if (Number(registro.insumo_id) === Number(nuevoInsumoId)) {
      const diferencia = nuevaCantidad - Number(registro.cantidad);
      if (diferencia > stockPorId.get(Number(nuevoInsumoId))) {
        throw crearError('STOCK_INSUFICIENTE', 'No hay stock suficiente para realizar la operación.', 409);
      }
      if (diferencia !== 0) {
        await client.query(
          'UPDATE insumo SET stock_actual = stock_actual - $1 WHERE id = $2',
          [diferencia, nuevoInsumoId]
        );
      }
    } else {
      if (nuevaCantidad > stockPorId.get(Number(nuevoInsumoId))) {
        throw crearError('STOCK_INSUFICIENTE', 'No hay stock suficiente para realizar la operación.', 409);
      }
      await client.query(
        'UPDATE insumo SET stock_actual = stock_actual + $1 WHERE id = $2',
        [registro.cantidad, registro.insumo_id]
      );
      await client.query(
        'UPDATE insumo SET stock_actual = stock_actual - $1 WHERE id = $2',
        [nuevaCantidad, nuevoInsumoId]
      );
    }

    const actualizado = await client.query(
      `UPDATE alimentacion SET fecha = COALESCE($1, fecha), cantidad = $2, insumo_id = $3 WHERE id = $4 RETURNING *`,
      [fecha || null, nuevaCantidad, nuevoInsumoId, req.params.id]
    );
    const stocksDespues = await client.query(
      'SELECT id, stock_actual FROM insumo WHERE id = ANY($1::int[]) ORDER BY id',
      [insumoIds]
    );
    await registrarBitacora(req.usuario, 'editar_alimentacion', 'alimentacion', actualizado.rows[0].id, {
      antes: { alimentacion: registro, insumos: insumos.rows },
      despues: { alimentacion: actualizado.rows[0], insumos: stocksDespues.rows },
    }, client);
    await client.query('COMMIT');
    res.json(actualizado.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// Eliminar un registro de alimentación (devuelve la cantidad al inventario)
router.delete('/:id', validar({ params: paramsId }), asyncHandler(async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const actual = await client.query('SELECT * FROM alimentacion WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!actual.rows.length) {
      throw crearError('ALIMENTACION_NO_ENCONTRADA', 'No se encontró el registro de alimentación.', 404);
    }
    const insumo = await client.query(
      'SELECT id FROM insumo WHERE id = $1 FOR UPDATE',
      [actual.rows[0].insumo_id]
    );
    if (!insumo.rows.length) {
      throw crearError('INSUMO_NO_ENCONTRADO', 'No se encontró el insumo relacionado.', 404);
    }
    await client.query('DELETE FROM alimentacion WHERE id = $1', [req.params.id]);
    await client.query(
      'UPDATE insumo SET stock_actual = stock_actual + $1 WHERE id = $2',
      [actual.rows[0].cantidad, actual.rows[0].insumo_id]
    );
    const stockDespues = await client.query(
      'SELECT id, stock_actual FROM insumo WHERE id = $1',
      [actual.rows[0].insumo_id]
    );
    await registrarBitacora(req.usuario, 'eliminar_alimentacion', 'alimentacion', actual.rows[0].id, {
      antes: actual.rows[0],
      despues: { eliminado: true, insumo: stockDespues.rows[0] },
    }, client);
    await client.query('COMMIT');
    res.status(204).send();
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

module.exports = router;
