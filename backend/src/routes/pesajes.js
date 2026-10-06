const express = require('express');
const { mensajePublicoError } = require('../middleware/errorHandler');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { registrarBitacora } = require('../bitacora');
const { enTransaccion } = require('../transaction');
const { ejecutarIdempotente, responderIdempotente } = require('../idempotency');
const { fechaEfectivaEvento, verificarEventoSobreAnimalActivo } = require('../eventoAnimalActivo');

const router = express.Router();

// Registrar un pesaje (CU6)
router.post('/', asyncHandler(async (req, res) => {
  const { animal_id, fecha, peso_kg, trabajador_id, observacion } = req.body;
  if (!animal_id || peso_kg === undefined) {
    return res.status(400).json({ error: 'animal_id y peso_kg son obligatorios' });
  }
  const ejecucion = await ejecutarIdempotente(req, {
    tipo: 'pesaje.crear', entidad: 'pesaje', payload: { body: req.body }, httpStatus: 201,
  }, async (client, contexto) => {
    if (contexto.offline) await verificarEventoSobreAnimalActivo(client, animal_id, fechaEfectivaEvento(fecha, contexto));
    const { rows } = await client.query(
      `INSERT INTO pesaje (animal_id, fecha, peso_kg, trabajador_id, observacion)
       VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4, $5) RETURNING *`,
      [animal_id, fecha, peso_kg, trabajador_id, observacion]
    );
    await registrarBitacora(req.usuario, 'registrar_pesaje', 'pesaje', rows[0].id, { despues: rows[0] }, client);
    return rows[0];
  });
  return responderIdempotente(res, ejecucion);
}));

// Registrar varios pesajes de una sola vez (misma fecha, peso distinto por animal) —
// pensado para la jornada de pesaje de un corral completo, uno tras otro sin volver al menú.
router.post('/lote', asyncHandler(async (req, res) => {
  const { fecha, registros } = req.body;
  if (!Array.isArray(registros) || registros.length === 0) {
    return res.status(400).json({ error: 'registros (lista de { animal_id, peso_kg }) es obligatorio' });
  }

  const creados = [];
  const errores = [];

  for (const r of registros) {
    if (!r.animal_id || r.peso_kg === undefined || r.peso_kg === '') continue; // se omiten filas vacías, no es un error
    try {
      const pesaje = await enTransaccion(async (client) => {
        const { rows } = await client.query(
          `INSERT INTO pesaje (animal_id, fecha, peso_kg, observacion)
           VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4) RETURNING *`,
          [r.animal_id, fecha || null, r.peso_kg, r.observacion || null]
        );
        await registrarBitacora(req.usuario, 'registrar_pesaje_lote', 'pesaje', rows[0].id, {
          despues: rows[0], contexto: { operacion_lote: true },
        }, client);
        return rows[0];
      });
      creados.push(pesaje);
    } catch (err) {
      errores.push({ animal_id: r.animal_id, error: mensajePublicoError(err) });
    }
  }

  res.status(201).json({ creados, errores });
}));

// Curva de crecimiento de un animal (para graficar en frontend)
router.get('/animal/:animal_id', asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    'SELECT fecha, peso_kg FROM pesaje WHERE animal_id = $1 ORDER BY fecha',
    [req.params.animal_id]
  );
  res.json(rows);
}));

// Peso actual y ganancia diaria de TODO el hato (todos los animales vivos)
// para el módulo de Pesajes — antes solo se podía ver curva por animal.
// Misma fórmula de ganancia diaria que ya usa reportes.js a nivel de todo
// el hato (último peso - primer peso, entre días transcurridos), aquí
// calculada por animal en vez de un solo promedio general.
router.get('/actual', asyncHandler(async (req, res) => {
  const { rows } = await db.query(`
    SELECT a.id AS animal_id, a.arete_id, a.nombre_alias, c.nombre AS corral,
           ultimo.peso_kg AS ultimo_peso, ultimo.fecha AS fecha_ultimo_peso,
           primero.peso_kg AS primer_peso, primero.fecha AS fecha_primer_peso,
           ROUND(
             (ultimo.peso_kg - primero.peso_kg) / NULLIF((ultimo.fecha - primero.fecha), 0),
           2) AS ganancia_diaria_kg
    FROM animal a
    LEFT JOIN corral c ON c.id = a.corral_actual_id
    LEFT JOIN LATERAL (
      SELECT peso_kg, fecha FROM pesaje p WHERE p.animal_id = a.id ORDER BY fecha DESC LIMIT 1
    ) ultimo ON true
    LEFT JOIN LATERAL (
      SELECT peso_kg, fecha FROM pesaje p WHERE p.animal_id = a.id ORDER BY fecha ASC LIMIT 1
    ) primero ON true
    WHERE a.estado = 'vivo'
    ORDER BY a.arete_id
  `);
  res.json(rows);
}));

// Evolución del peso promedio de todo el hato, mes a mes (mismo patrón
// date_trunc/group-by que ya usa reportes.js para ventas/gastos por mes).
router.get('/evolucion', asyncHandler(async (req, res) => {
  const { rows } = await db.query(`
    SELECT to_char(date_trunc('month', fecha), 'YYYY-MM') AS mes, ROUND(AVG(peso_kg), 1) AS peso_promedio
    FROM pesaje
    GROUP BY date_trunc('month', fecha)
    ORDER BY date_trunc('month', fecha)
  `);
  res.json(rows);
}));

// Series de pesajes de varios animales a la vez, para graficarlos juntos
// (comparación entre animales) — ?animal_ids=1,2,3
router.get('/comparar', asyncHandler(async (req, res) => {
  const { animal_ids } = req.query;
  if (!animal_ids) {
    return res.status(400).json({ error: 'animal_ids es obligatorio (lista de ids separada por comas)' });
  }
  const ids = animal_ids.split(',').map(Number).filter((n) => !Number.isNaN(n));
  const [{ rows: animales }, { rows: pesajes }] = await Promise.all([
    db.query('SELECT id AS animal_id, arete_id, nombre_alias FROM animal WHERE id = ANY($1)', [ids]),
    db.query('SELECT animal_id, fecha, peso_kg FROM pesaje WHERE animal_id = ANY($1) ORDER BY fecha', [ids]),
  ]);
  const resultado = animales.map((a) => ({
    ...a,
    pesajes: pesajes.filter((p) => p.animal_id === a.animal_id),
  }));
  res.json(resultado);
}));

// Corregir un pesaje mal capturado
router.patch('/:id', asyncHandler(async (req, res) => {
  const { fecha, peso_kg, observacion } = req.body;
  const pesaje = await enTransaccion(async (client) => {
    const anterior = await client.query('SELECT * FROM pesaje WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!anterior.rows.length) return null;
    const { rows } = await client.query(
      `UPDATE pesaje SET fecha = COALESCE($1, fecha), peso_kg = COALESCE($2, peso_kg), observacion = COALESCE($3, observacion)
       WHERE id = $4 RETURNING *`,
      [fecha || null, peso_kg || null, observacion, req.params.id]
    );
    await registrarBitacora(req.usuario, 'editar_pesaje', 'pesaje', rows[0].id, { antes: anterior.rows[0], despues: rows[0] }, client);
    return rows[0];
  });
  if (!pesaje) return res.status(404).json({ error: 'Pesaje no encontrado' });
  res.json(pesaje);
}));

// Eliminar un pesaje capturado por error
router.delete('/:id', asyncHandler(async (req, res) => {
  const pesaje = await enTransaccion(async (client) => {
    const anterior = await client.query('SELECT * FROM pesaje WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!anterior.rows.length) return null;
    await client.query('DELETE FROM pesaje WHERE id = $1', [req.params.id]);
    await registrarBitacora(req.usuario, 'eliminar_pesaje', 'pesaje', Number(req.params.id), { antes: anterior.rows[0], despues: null }, client);
    return anterior.rows[0];
  });
  if (!pesaje) return res.status(404).json({ error: 'Pesaje no encontrado' });
  res.status(204).send();
}));

module.exports = router;
