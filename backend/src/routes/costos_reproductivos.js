const express = require('express');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { validar } = require('../middleware/validar');
const validaciones = require('../validation/costosReproductivos');
const { enTransaccion } = require('../transaction');
const { registrarBitacora } = require('../bitacora');
const { noEncontrado } = require('../errors');
const { actualizarCosto, crearCosto, obtenerAnalitica, obtenerEconomiaToro } = require('../costosReproductivosService');

const router = express.Router();

const SELECT_DETALLE = `SELECT cr.*,a.arete_id animal_arete,a.nombre_alias animal_nombre,
  toro.arete_id toro_arete,toro.nombre_alias toro_nombre,t.nombre responsable,p.nombre proveedor,
  i.nombre insumo FROM costo_reproductivo cr
  LEFT JOIN animal a ON a.id=cr.animal_id LEFT JOIN animal toro ON toro.id=cr.toro_id
  LEFT JOIN trabajador t ON t.id=cr.responsable_id LEFT JOIN tercero p ON p.id=cr.proveedor_id
  LEFT JOIN insumo i ON i.id=cr.insumo_id`;

router.get('/analitica/resumen', validar({ query: validaciones.queryAnalitica }), asyncHandler(async (req, res) => {
  res.json(await obtenerAnalitica(db, req.query));
}));

router.get('/sementales/:id', validar({ params: validaciones.paramsId, query: validaciones.queryAnalitica }), asyncHandler(async (req, res) => {
  res.json(await obtenerEconomiaToro(db, req.params.id, req.query));
}));

router.get('/', validar({ query: validaciones.queryLista }), asyncHandler(async (req, res) => {
  const condiciones = [];
  const valores = [];
  for (const [campo, valor] of Object.entries(req.query)) {
    if (valor == null) continue;
    const columna = campo === 'desde' || campo === 'hasta' ? 'fecha' : campo;
    valores.push(valor);
    condiciones.push(`cr.${columna} ${campo === 'desde' ? '>=' : campo === 'hasta' ? '<=' : '='} $${valores.length}`);
  }
  const where = condiciones.length ? ` WHERE ${condiciones.join(' AND ')}` : '';
  const { rows } = await db.query(`${SELECT_DETALLE}${where} ORDER BY cr.fecha DESC,cr.id DESC LIMIT 500`, valores);
  res.json(rows);
}));

router.post('/', validar({ body: validaciones.crear }), asyncHandler(async (req, res) => {
  const costo = await enTransaccion(async (client) => {
    const creado = await crearCosto(client, req.body, req.usuario.id);
    await registrarBitacora(req.usuario, 'registrar_costo_reproductivo', 'costo_reproductivo', creado.id, {
      despues: creado, contexto: { categoria: creado.categoria, monto: creado.monto, ciclo_id: creado.ciclo_id },
    }, client);
    return creado;
  });
  res.status(201).json(costo);
}));

router.patch('/:id', validar({ params: validaciones.paramsId, body: validaciones.editar }), asyncHandler(async (req, res) => {
  const costo = await enTransaccion(async (client) => {
    const cambio = await actualizarCosto(client, req.params.id, req.body);
    await registrarBitacora(req.usuario, 'editar_costo_reproductivo', 'costo_reproductivo', cambio.despues.id, {
      antes: cambio.antes, despues: cambio.despues,
      contexto: { categoria: cambio.despues.categoria, monto: cambio.despues.monto, ciclo_id: cambio.despues.ciclo_id },
    }, client);
    return cambio.despues;
  });
  res.json(costo);
}));

router.delete('/:id', validar({ params: validaciones.paramsId }), asyncHandler(async (req, res) => {
  await enTransaccion(async (client) => {
    const previo = await client.query('SELECT * FROM costo_reproductivo WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!previo.rows.length) throw noEncontrado('COSTO_REPRODUCTIVO_NO_ENCONTRADO', 'No se encontró el costo reproductivo.');
    await registrarBitacora(req.usuario, 'eliminar_costo_reproductivo', 'costo_reproductivo', previo.rows[0].id, {
      antes: previo.rows[0], contexto: { categoria: previo.rows[0].categoria, monto: previo.rows[0].monto, ciclo_id: previo.rows[0].ciclo_id },
    }, client);
    await client.query('DELETE FROM costo_reproductivo WHERE id=$1', [req.params.id]);
  });
  res.status(204).send();
}));

module.exports = router;
