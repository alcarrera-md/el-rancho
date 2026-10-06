const express = require('express');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { validar } = require('../middleware/validar');
const validaciones = require('../validation/reproduccion');
const { registrarBitacora } = require('../bitacora');
const { enTransaccion } = require('../transaction');
const { tienePermiso } = require('../authorization/policy');
const { autorizacion } = require('../errors');
const { crearCosto } = require('../costosReproductivosService');
const { crearServicio, registrarDiagnostico, registrarParto, cargarCiclo, cargarHatoOperable } = require('../reproduccionService');
const { analizarLote, aplicarLote } = require('../reproduccionLotes');
const {
  obtenerResumenAnalitico,
  obtenerDetalleMetrica,
  listarSementales,
} = require('../reproduccionAnaliticaService');

const router = express.Router();

async function crearServicioAuditado(req, datos) {
  return enTransaccion(async (client) => {
    const { costo, ...datosServicio } = datos;
    if (costo && !tienePermiso(req.usuario.rol, 'costos_reproductivos', 'crear')) throw autorizacion('Tu rol no tiene permiso para registrar costos reproductivos.');
    const resultado = await crearServicio(client, datosServicio);
    await registrarBitacora(req.usuario, 'registrar_servicio_reproductivo', 'servicio_reproductivo', resultado.servicio.id, {
      despues: resultado.servicio, contexto: { ciclo_id: resultado.ciclo.id },
    }, client);
    if (costo) {
      resultado.costo = await crearCosto(client, { ...costo, fecha: resultado.servicio.fecha, procedencia: 'captura_manual', servicio_id: resultado.servicio.id }, req.usuario.id);
      await registrarBitacora(req.usuario, 'registrar_costo_reproductivo', 'costo_reproductivo', resultado.costo.id, { despues: resultado.costo, contexto: { ciclo_id: resultado.ciclo.id, evento: 'servicio' } }, client);
    }
    return resultado;
  });
}

router.post('/servicios', validar({ body: validaciones.servicio }), asyncHandler(async (req, res) => {
  res.status(201).json(await crearServicioAuditado(req, req.body));
}));

// Compatibilidad temporal del formulario anterior: escribe en v2.
router.post('/', validar({ body: validaciones.servicioLegacy }), asyncHandler(async (req, res) => {
  const resultado = await crearServicioAuditado(req, req.body);
  res.status(201).json({ ...resultado.servicio, ciclo_id: resultado.ciclo.id });
}));

router.post('/ciclos/:id/diagnosticos', validar({ params: validaciones.paramsId, body: validaciones.diagnostico }), asyncHandler(async (req, res) => {
  const diagnostico = await enTransaccion(async (client) => {
    const { costo, ...datosDiagnostico } = req.body;
    if (costo && !tienePermiso(req.usuario.rol, 'costos_reproductivos', 'crear')) throw autorizacion('Tu rol no tiene permiso para registrar costos reproductivos.');
    const creado = await registrarDiagnostico(client, req.params.id, datosDiagnostico);
    await registrarBitacora(req.usuario, 'registrar_diagnostico_gestacion', 'diagnostico_gestacion', creado.id, { despues: creado, contexto: { ciclo_id: req.params.id } }, client);
    if (costo) {
      creado.costo = await crearCosto(client, { ...costo, fecha: creado.fecha, procedencia: 'captura_manual', diagnostico_id: creado.id }, req.usuario.id);
      await registrarBitacora(req.usuario, 'registrar_costo_reproductivo', 'costo_reproductivo', creado.costo.id, { despues: creado.costo, contexto: { ciclo_id: req.params.id, evento: 'diagnostico' } }, client);
    }
    return creado;
  });
  res.status(201).json(diagnostico);
}));

router.post('/ciclos/:id/partos', validar({ params: validaciones.paramsId, body: validaciones.parto }), asyncHandler(async (req, res) => {
  const resultado = await enTransaccion(async (client) => {
    const { costo, ...datosParto } = req.body;
    if (costo && !tienePermiso(req.usuario.rol, 'costos_reproductivos', 'crear')) throw autorizacion('Tu rol no tiene permiso para registrar costos reproductivos.');
    const creado = await registrarParto(client, req.params.id, datosParto);
    await registrarBitacora(req.usuario, 'registrar_parto_reproductivo', 'parto_reproductivo', creado.parto.id, { despues: creado, contexto: { ciclo_id: req.params.id } }, client);
    if (costo) {
      creado.costo = await crearCosto(client, { ...costo, fecha: creado.parto.fecha_real, procedencia: 'captura_manual', parto_id: creado.parto.id }, req.usuario.id);
      await registrarBitacora(req.usuario, 'registrar_costo_reproductivo', 'costo_reproductivo', creado.costo.id, { despues: creado.costo, contexto: { ciclo_id: req.params.id, evento: 'parto' } }, client);
    }
    return creado;
  });
  res.status(201).json(resultado);
}));

router.get('/responsables', asyncHandler(async (req, res) => {
  const { rows } = await db.query('SELECT id,nombre FROM trabajador WHERE activo=true ORDER BY nombre');
  res.json(rows);
}));

router.get('/hato-operable', asyncHandler(async (req, res) => {
  res.json(await cargarHatoOperable(db));
}));

router.get('/analitica/resumen', validar({ query: validaciones.queryAnalitica }), asyncHandler(async (req, res) => {
  res.json(await obtenerResumenAnalitico(db, req.query));
}));

router.get('/analitica/drill-down', validar({ query: validaciones.queryDetalleAnalitica }), asyncHandler(async (req, res) => {
  const { metrica, pagina, limite, ...filtros } = req.query;
  res.json(await obtenerDetalleMetrica(db, filtros, metrica, pagina, limite));
}));

router.get('/analitica/sementales', validar({ query: validaciones.queryAnalitica }), asyncHandler(async (req, res) => {
  res.json(await listarSementales(db, req.query));
}));

router.get('/analitica/sementales/:id', validar({ params: validaciones.paramsId, query: validaciones.queryAnalitica }), asyncHandler(async (req, res) => {
  const respuesta = await listarSementales(db, { ...req.query, toro_id: req.params.id });
  res.json({ ...respuesta, item: respuesta.items[0] || null });
}));

router.post('/lotes/validar', validar({ body: validaciones.lote }), asyncHandler(async (req, res) => {
  res.json(await analizarLote(db, req.body));
}));

router.post('/lotes/confirmar', validar({ body: validaciones.lote }), asyncHandler(async (req, res) => {
  const resultado = await enTransaccion(async (client) => {
    const aplicado = await aplicarLote(client, { ...req.body, usuario_id: req.usuario.id });
    if (!aplicado.repetido) {
      for (const fila of aplicado.resultados) {
        if (fila.servicio) await registrarBitacora(req.usuario, 'registrar_servicio_reproductivo', 'servicio_reproductivo', fila.servicio.id, { despues: fila.servicio, contexto: { ciclo_id: fila.ciclo_id, lote: true } }, client);
        if (fila.diagnostico) await registrarBitacora(req.usuario, 'registrar_diagnostico_gestacion', 'diagnostico_gestacion', fila.diagnostico.id, { despues: fila.diagnostico, contexto: { ciclo_id: fila.ciclo_id, lote: true } }, client);
        if (fila.parto) await registrarBitacora(req.usuario, 'registrar_parto_reproductivo', 'parto_reproductivo', fila.parto.parto.id, { despues: fila.parto, contexto: { ciclo_id: fila.ciclo_id, lote: true } }, client);
      }
      await registrarBitacora(req.usuario, req.body.modo === 'importacion' ? 'importar_reproduccion' : 'captura_masiva_reproduccion',
        req.body.modo === 'importacion' ? 'reproduccion_import_batch' : 'reproduccion_lote', null,
        { despues: { import_batch_id: req.body.import_batch_id, total: aplicado.total, tipo_lote: req.body.tipo_lote } }, client);
    }
    return aplicado;
  });
  res.status(resultado.repetido ? 200 : 201).json(resultado);
}));

router.get('/exportacion', validar({ query: validaciones.queryExportacion }), asyncHandler(async (req, res) => {
  const { tipo, arete = null, desde = null, hasta = null, ciclo_id: cicloId = null } = req.query;
  const params = [arete || null, desde || null, hasta || null, cicloId || null];
  const filtro = (aliasFecha) => `($1::text IS NULL OR a.arete_id=$1) AND ($2::date IS NULL OR ${aliasFecha}>=$2)
    AND ($3::date IS NULL OR ${aliasFecha}<=$3) AND ($4::int IS NULL OR cr.id=$4)`;
  const respuesta = { filtros: req.query, ciclos: [], servicios: [], diagnosticos: [], partos: [] };
  if (tipo === 'todos' || tipo === 'ciclos') {
    respuesta.ciclos = (await db.query(`SELECT a.arete_id AS arete_vaca,a.nombre_alias AS vaca,cr.fecha_inicio,cr.fecha_cierre,
      cr.resultado_final,cr.observaciones FROM ciclo_reproductivo cr JOIN animal a ON a.id=cr.hembra_id
      WHERE ${filtro('cr.fecha_inicio')} ORDER BY cr.fecha_inicio,a.arete_id`, params)).rows;
  }
  if (tipo === 'todos' || tipo === 'servicios') {
    respuesta.servicios = (await db.query(`SELECT a.arete_id AS arete_vaca,a.nombre_alias AS vaca,sr.fecha,
      CASE sr.tipo WHEN 'natural' THEN 'Natural' WHEN 'inseminacion_artificial' THEN 'Inseminación artificial' ELSE COALESCE(sr.tipo_otro,'Otro') END AS tipo,
      m.arete_id AS arete_toro,t.nombre AS responsable,sr.observaciones
      FROM servicio_reproductivo sr JOIN ciclo_reproductivo cr ON cr.id=sr.ciclo_id JOIN animal a ON a.id=cr.hembra_id
      LEFT JOIN animal m ON m.id=sr.macho_id LEFT JOIN trabajador t ON t.id=sr.responsable_id
      WHERE ${filtro('sr.fecha')} ORDER BY sr.fecha,a.arete_id`, params)).rows;
  }
  if (tipo === 'todos' || tipo === 'diagnosticos') {
    respuesta.diagnosticos = (await db.query(`SELECT a.arete_id AS arete_vaca,a.nombre_alias AS vaca,dg.fecha,
      CASE dg.metodo WHEN 'palpacion' THEN 'Palpación' WHEN 'ecografia' THEN 'Ultrasonido' ELSE COALESCE(dg.metodo_otro,'Otro') END AS metodo,
      CASE dg.resultado WHEN 'prenada' THEN 'Preñada' WHEN 'vacia' THEN 'Vacía' ELSE 'Dudosa' END AS resultado,
      t.nombre AS responsable,dg.observaciones,dg.fecha_siguiente_revision
      FROM diagnostico_gestacion dg JOIN ciclo_reproductivo cr ON cr.id=dg.ciclo_id JOIN animal a ON a.id=cr.hembra_id
      LEFT JOIN trabajador t ON t.id=dg.responsable_id WHERE ${filtro('dg.fecha')} ORDER BY dg.fecha,a.arete_id`, params)).rows;
  }
  if (tipo === 'todos' || tipo === 'partos') {
    respuesta.partos = (await db.query(`SELECT a.arete_id AS arete_vaca,a.nombre_alias AS vaca,pr.fecha_real AS fecha,
      CASE pr.resultado WHEN 'parto' THEN 'Parto' WHEN 'aborto' THEN 'Aborto' ELSE 'Pérdida' END AS resultado,
      t.nombre AS responsable,pr.incidencia,pr.observaciones
      FROM parto_reproductivo pr JOIN ciclo_reproductivo cr ON cr.id=pr.ciclo_id JOIN animal a ON a.id=cr.hembra_id
      LEFT JOIN trabajador t ON t.id=pr.responsable_id WHERE ${filtro('pr.fecha_real')} ORDER BY pr.fecha_real,a.arete_id`, params)).rows;
  }
  res.json(respuesta);
}));

router.get('/animales/:id/ciclo-actual', validar({ params: validaciones.paramsId }), asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT cr.*, a.arete_id AS hembra_arete, a.nombre_alias AS hembra_nombre
     FROM ciclo_reproductivo cr JOIN animal a ON a.id=cr.hembra_id
     WHERE cr.hembra_id=$1
     ORDER BY (cr.fecha_cierre IS NULL) DESC, cr.fecha_inicio DESC, cr.id DESC
     LIMIT 1`, [req.params.id]
  );
  if (!rows.length) return res.json({ ciclo: null, estado_actual: { codigo: 'disponible', etiqueta: 'Disponible' } });
  return res.json(await cargarCiclo(db, rows[0]));
}));

router.get('/animales/:id/historial', validar({ params: validaciones.paramsId }), asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT cr.*, a.arete_id AS hembra_arete, a.nombre_alias AS hembra_nombre
     FROM ciclo_reproductivo cr JOIN animal a ON a.id=cr.hembra_id
     WHERE cr.hembra_id=$1 ORDER BY cr.fecha_inicio DESC, cr.id DESC`, [req.params.id]
  );
  const ciclos = [];
  for (const ciclo of rows) {
    const completo = await cargarCiclo(db, ciclo);
    const servicio = completo.servicios.at(-1);
    const diagnostico = completo.diagnosticos.at(-1);
    ciclos.push({
      ...completo,
      madre_id: completo.hembra_id,
      fecha_monta: servicio?.fecha || completo.fecha_inicio,
      tipo_monta: servicio?.tipo,
      padre_id: servicio?.macho_id,
      padre_arete: servicio?.macho_arete,
      fecha_parto_estimada: completo.estado_actual?.fecha_parto_estimada || servicio?.fecha_parto_estimada_ajustada || null,
      resultado: completo.resultado_final || diagnostico?.resultado || (completo.estado_actual?.codigo === 'pendiente_diagnostico' ? 'pendiente' : 'servida'),
    });
  }
  const legado = await db.query(
    `SELECT er.* FROM evento_reproductivo er LEFT JOIN ciclo_reproductivo cr ON cr.legado_evento_id=er.id
     WHERE er.madre_id=$1 AND cr.id IS NULL ORDER BY er.fecha_monta DESC`, [req.params.id]
  );
  res.json({ ciclos, legado_no_clasificado: legado.rows });
}));

router.get('/pendientes-diagnostico', asyncHandler(async (req, res) => {
  const { rows } = await db.query(`
    WITH ultimo_servicio AS (
      SELECT DISTINCT ON (ciclo_id) * FROM servicio_reproductivo ORDER BY ciclo_id, fecha DESC, id DESC
    ), ultimo_diagnostico AS (
      SELECT DISTINCT ON (ciclo_id) * FROM diagnostico_gestacion ORDER BY ciclo_id, fecha DESC, id DESC
    ), espera AS (
      SELECT COALESCE((SELECT valor::int FROM configuracion WHERE clave='dias_espera_diagnostico_gestacion'),35) dias
    )
    SELECT cr.id AS ciclo_id, cr.hembra_id, a.arete_id AS hembra_arete, a.nombre_alias AS hembra_nombre,
           c.nombre AS hembra_corral, us.fecha AS fecha_servicio,
           (us.fecha + espera.dias)::date AS fecha_diagnostico_sugerida
    FROM ciclo_reproductivo cr JOIN ultimo_servicio us ON us.ciclo_id=cr.id
    LEFT JOIN ultimo_diagnostico ud ON ud.ciclo_id=cr.id
    JOIN animal a ON a.id=cr.hembra_id LEFT JOIN corral c ON c.id=a.corral_actual_id CROSS JOIN espera
    WHERE cr.fecha_cierre IS NULL AND ud.id IS NULL AND CURRENT_DATE >= us.fecha + espera.dias
      AND a.estado='vivo' AND a.sexo='hembra'
    ORDER BY fecha_diagnostico_sugerida, a.arete_id`);
  res.json(rows);
}));

router.get('/gestantes', asyncHandler(async (req, res) => {
  const { rows } = await db.query(`
    WITH ultimo_diagnostico AS (
      SELECT DISTINCT ON (ciclo_id) * FROM diagnostico_gestacion ORDER BY ciclo_id, fecha DESC, id DESC
    ), config AS (
      SELECT COALESCE((SELECT valor::int FROM configuracion WHERE clave='dias_gestacion_bovina'),283) dias
    )
    SELECT cr.id AS id, cr.id AS ciclo_id, cr.hembra_id AS madre_id, a.arete_id AS madre_arete,
           a.nombre_alias AS madre_nombre, c.nombre AS madre_corral,
           ud.fecha AS fecha_diagnostico, ud.metodo, ud.servicio_id,
           COALESCE(sr.fecha_parto_estimada_ajustada, sr.fecha + config.dias) AS fecha_parto_estimada,
           CASE WHEN sr.fecha_parto_estimada_ajustada IS NULL THEN 'calculada' ELSE 'manual' END AS procedencia_fecha_parto_estimada,
           sr.fecha AS fecha_monta, sr.tipo AS tipo_monta, sr.macho_id AS padre_id, m.arete_id AS padre_arete,
           'prenada' AS resultado
    FROM ciclo_reproductivo cr
    JOIN ultimo_diagnostico ud ON ud.ciclo_id=cr.id AND ud.resultado='prenada'
    JOIN servicio_reproductivo sr ON sr.id=ud.servicio_id
    JOIN animal a ON a.id=cr.hembra_id LEFT JOIN corral c ON c.id=a.corral_actual_id
    LEFT JOIN animal m ON m.id=sr.macho_id CROSS JOIN config
    WHERE cr.fecha_cierre IS NULL AND a.estado='vivo' ORDER BY fecha_parto_estimada`);
  res.json(rows);
}));

router.get('/partos-proximos', validar({ query: validaciones.queryDias }), asyncHandler(async (req, res) => {
  const incluirVencidos = req.query.incluirVencidos === 'true';
  const { rows } = await db.query(`
    WITH ultimo_diagnostico AS (
      SELECT DISTINCT ON (ciclo_id) * FROM diagnostico_gestacion ORDER BY ciclo_id, fecha DESC, id DESC
    ), config AS (
      SELECT COALESCE((SELECT valor::int FROM configuracion WHERE clave='dias_gestacion_bovina'),283) dias
    ), confirmadas AS (
      SELECT cr.id AS id, cr.id AS ciclo_id, cr.hembra_id AS madre_id, a.arete_id AS madre_arete,
             a.nombre_alias AS madre_nombre, c.nombre AS madre_corral,
             COALESCE(sr.fecha_parto_estimada_ajustada, sr.fecha + config.dias) AS fecha_parto_estimada,
             CASE WHEN sr.fecha_parto_estimada_ajustada IS NULL THEN 'calculada' ELSE 'manual' END AS procedencia_fecha_parto_estimada
      FROM ciclo_reproductivo cr
      JOIN ultimo_diagnostico ud ON ud.ciclo_id=cr.id AND ud.resultado='prenada'
      JOIN servicio_reproductivo sr ON sr.id=ud.servicio_id
      JOIN animal a ON a.id=cr.hembra_id LEFT JOIN corral c ON c.id=a.corral_actual_id CROSS JOIN config
      WHERE cr.fecha_cierre IS NULL AND a.estado='vivo'
    ) SELECT * FROM confirmadas
      WHERE fecha_parto_estimada <= CURRENT_DATE + $1::int
        ${incluirVencidos ? '' : 'AND fecha_parto_estimada >= CURRENT_DATE'}
      ORDER BY fecha_parto_estimada`, [req.query.dias]);
  res.json(rows);
}));

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await db.query(`
    SELECT cr.*, a.arete_id AS madre_arete, a.nombre_alias AS madre_nombre, c.nombre AS madre_corral
    FROM ciclo_reproductivo cr JOIN animal a ON a.id=cr.hembra_id
    LEFT JOIN corral c ON c.id=a.corral_actual_id ORDER BY cr.fecha_inicio DESC LIMIT 300`);
  const ciclos = [];
  for (const ciclo of rows) ciclos.push(await cargarCiclo(db, ciclo));
  res.json(ciclos);
}));

module.exports = router;
