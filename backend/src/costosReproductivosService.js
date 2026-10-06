const { conflicto, noEncontrado } = require('./errors');

const CAMPOS = [
  'fecha', 'categoria', 'monto', 'procedencia', 'ciclo_id', 'servicio_id', 'diagnostico_id', 'parto_id',
  'animal_id', 'toro_id', 'responsable_id', 'proveedor_id', 'insumo_id', 'compra_insumo_id',
  'gasto_general_id', 'descripcion',
];

async function fila(client, tabla, id, columnas = '*') {
  if (!id) return null;
  const resultado = await client.query(`SELECT ${columnas} FROM ${tabla} WHERE id=$1`, [id]);
  if (!resultado.rows.length) throw noEncontrado('RELACION_COSTO_NO_ENCONTRADA', `No existe la relación indicada en ${tabla}.`);
  return resultado.rows[0];
}

async function normalizarRelaciones(client, datos) {
  const normalizados = { ...datos };
  const eventosRelacionados = [datos.servicio_id, datos.diagnostico_id, datos.parto_id].filter(Boolean);
  if (eventosRelacionados.length > 1) throw conflicto('COSTO_EVENTO_AMBIGUO', 'Relaciona cada costo con un solo servicio, diagnóstico o parto.');
  const ciclo = await fila(client, 'ciclo_reproductivo', datos.ciclo_id, 'id,hembra_id');
  const servicio = await fila(client, 'servicio_reproductivo', datos.servicio_id, 'id,ciclo_id,macho_id,responsable_id');
  const diagnostico = await fila(client, 'diagnostico_gestacion', datos.diagnostico_id, 'id,ciclo_id,servicio_id,responsable_id');
  const parto = await fila(client, 'parto_reproductivo', datos.parto_id, 'id,ciclo_id,responsable_id');

  const ciclos = [ciclo?.id, servicio?.ciclo_id, diagnostico?.ciclo_id, parto?.ciclo_id].filter(Boolean);
  if (new Set(ciclos.map(String)).size > 1) throw conflicto('COSTO_CONTEXTO_INCONSISTENTE', 'Las relaciones del costo pertenecen a ciclos distintos.');
  if (!normalizados.ciclo_id && ciclos[0]) normalizados.ciclo_id = ciclos[0];
  const cicloFinal = ciclo || await fila(client, 'ciclo_reproductivo', normalizados.ciclo_id, 'id,hembra_id');
  if (!normalizados.animal_id && cicloFinal) normalizados.animal_id = cicloFinal.hembra_id;
  if (cicloFinal && normalizados.animal_id && String(cicloFinal.hembra_id) !== String(normalizados.animal_id)) {
    throw conflicto('COSTO_ANIMAL_INCONSISTENTE', 'El animal no corresponde al ciclo relacionado.');
  }
  if (!normalizados.toro_id && servicio?.macho_id) normalizados.toro_id = servicio.macho_id;
  if (servicio?.macho_id && normalizados.toro_id && String(servicio.macho_id) !== String(normalizados.toro_id)) {
    throw conflicto('COSTO_TORO_INCONSISTENTE', 'El toro no corresponde al servicio relacionado.');
  }
  if (!normalizados.responsable_id) normalizados.responsable_id = diagnostico?.responsable_id || parto?.responsable_id || servicio?.responsable_id || null;

  await Promise.all([
    fila(client, 'animal', normalizados.animal_id), fila(client, 'animal', normalizados.toro_id),
    fila(client, 'trabajador', normalizados.responsable_id), fila(client, 'tercero', normalizados.proveedor_id),
    fila(client, 'insumo', normalizados.insumo_id),
  ]);

  if (normalizados.compra_insumo_id) {
    const compra = await fila(client, 'compra_insumo', normalizados.compra_insumo_id, 'id,insumo_id,costo_total');
    if (Number(normalizados.monto) > Number(compra.costo_total || 0)) throw conflicto('COSTO_EXCEDE_FUENTE', 'El importe atribuible excede el total de la compra relacionada.');
    if (normalizados.insumo_id && String(normalizados.insumo_id) !== String(compra.insumo_id)) throw conflicto('COSTO_INSUMO_INCONSISTENTE', 'El insumo no corresponde a la compra relacionada.');
    normalizados.insumo_id = compra.insumo_id;
  }
  if (normalizados.gasto_general_id) {
    const gasto = await fila(client, 'gasto_general', normalizados.gasto_general_id, 'id,monto');
    if (Number(normalizados.monto) > Number(gasto.monto)) throw conflicto('COSTO_EXCEDE_FUENTE', 'El importe atribuible excede el gasto general relacionado.');
  }
  return normalizados;
}

async function crearCosto(client, datos, usuarioId) {
  const valor = await normalizarRelaciones(client, datos);
  const columnas = [...CAMPOS, 'usuario_id'];
  const params = columnas.map((campo) => campo === 'usuario_id' ? usuarioId : (valor[campo] ?? null));
  const placeholders = params.map((_, indice) => `$${indice + 1}`).join(',');
  const { rows } = await client.query(`INSERT INTO costo_reproductivo (${columnas.join(',')}) VALUES (${placeholders}) RETURNING *`, params);
  return rows[0];
}

async function actualizarCosto(client, id, cambios) {
  const previo = await client.query('SELECT * FROM costo_reproductivo WHERE id=$1 FOR UPDATE', [id]);
  if (!previo.rows.length) throw noEncontrado('COSTO_REPRODUCTIVO_NO_ENCONTRADO', 'No se encontró el costo reproductivo.');
  const combinado = await normalizarRelaciones(client, { ...previo.rows[0], ...cambios });
  const asignaciones = CAMPOS.map((campo, indice) => `${campo}=$${indice + 1}`).join(',');
  const params = CAMPOS.map((campo) => combinado[campo] ?? null);
  const { rows } = await client.query(`UPDATE costo_reproductivo SET ${asignaciones} WHERE id=$${params.length + 1} RETURNING *`, [...params, id]);
  return { antes: previo.rows[0], despues: rows[0] };
}

function rangoPeriodo(filtros) {
  if (filtros.periodo === 'personalizado') return { desde: filtros.desde, hasta: filtros.hasta };
  const hoy = new Date();
  const hasta = hoy.toISOString().slice(0, 10);
  if (filtros.periodo === 'mes_actual') return { desde: `${hasta.slice(0, 7)}-01`, hasta };
  if (filtros.periodo === 'ultimos_30_dias') {
    const desde = new Date(hoy); desde.setUTCDate(desde.getUTCDate() - 29);
    return { desde: desde.toISOString().slice(0, 10), hasta };
  }
  return { desde: `${hasta.slice(0, 4)}-01-01`, hasta };
}

async function obtenerAnalitica(client, filtros) {
  const { desde, hasta } = rangoPeriodo(filtros);
  const valores = [desde, hasta, filtros.animal_id || null, filtros.toro_id || null];
  const filtro = `cr.fecha BETWEEN $1 AND $2 AND ($3::int IS NULL OR cr.animal_id=$3) AND ($4::int IS NULL OR cr.toro_id=$4)`;
  const { rows: totales } = await client.query(`SELECT COALESCE(SUM(monto),0)::numeric(14,2) total, COUNT(*)::int registros,
    COUNT(*) FILTER (WHERE gasto_general_id IS NOT NULL OR compra_insumo_id IS NOT NULL)::int ya_en_flujo,
    COUNT(*) FILTER (WHERE ciclo_id IS NULL)::int sin_ciclo FROM costo_reproductivo cr WHERE ${filtro}`, valores);
  const { rows: categorias } = await client.query(`SELECT categoria,COALESCE(SUM(monto),0)::numeric(14,2) total,COUNT(*)::int registros FROM costo_reproductivo cr WHERE ${filtro} GROUP BY categoria ORDER BY total DESC`, valores);
  const { rows: etapas } = await client.query(`SELECT
    COALESCE(SUM(monto) FILTER (WHERE servicio_id IS NOT NULL),0)::numeric(14,2) servicios,
    COUNT(DISTINCT servicio_id) FILTER (WHERE servicio_id IS NOT NULL)::int servicios_con_costo,
    COALESCE(SUM(monto) FILTER (WHERE diagnostico_id IS NOT NULL),0)::numeric(14,2) diagnosticos,
    COUNT(DISTINCT diagnostico_id) FILTER (WHERE diagnostico_id IS NOT NULL)::int diagnosticos_con_costo,
    COALESCE(SUM(monto) FILTER (WHERE parto_id IS NOT NULL),0)::numeric(14,2) partos,
    COALESCE(SUM(monto) FILTER (WHERE parto_id IS NULL AND diagnostico_id IS NULL AND servicio_id IS NULL),0)::numeric(14,2) otros
    FROM costo_reproductivo cr WHERE ${filtro}`, valores);
  const { rows: eventos } = await client.query(`SELECT
    (SELECT COUNT(*)::int FROM servicio_reproductivo sr JOIN ciclo_reproductivo c ON c.id=sr.ciclo_id
      WHERE sr.fecha BETWEEN $1 AND $2 AND ($3::int IS NULL OR c.hembra_id=$3) AND ($4::int IS NULL OR sr.macho_id=$4)) servicios,
    (SELECT COUNT(*)::int FROM diagnostico_gestacion dg JOIN ciclo_reproductivo c ON c.id=dg.ciclo_id
      WHERE dg.fecha BETWEEN $1 AND $2 AND ($3::int IS NULL OR c.hembra_id=$3)
      AND ($4::int IS NULL OR EXISTS(SELECT 1 FROM servicio_reproductivo sr WHERE sr.ciclo_id=c.id AND sr.macho_id=$4))) diagnosticos`, valores);
  const { rows: ciclos } = await client.query(`WITH costos AS (
      SELECT ciclo_id,SUM(monto)::numeric(14,2) monto FROM costo_reproductivo cr WHERE ${filtro} AND ciclo_id IS NOT NULL GROUP BY ciclo_id
    ), evidencia AS (
      SELECT c.id,c.resultado_final,c.fecha_cierre,COALESCE(co.monto,0)::numeric(14,2) monto,
        EXISTS(SELECT 1 FROM diagnostico_gestacion d WHERE d.ciclo_id=c.id AND d.resultado='prenada') confirmada,
        EXISTS(SELECT 1 FROM parto_reproductivo p WHERE p.ciclo_id=c.id AND p.resultado='parto') parto_valido
      FROM ciclo_reproductivo c LEFT JOIN costos co ON co.ciclo_id=c.id
      WHERE c.id IN (SELECT ciclo_id FROM costos)
    ) SELECT
      COALESCE(SUM(monto) FILTER (WHERE fecha_cierre IS NOT NULL AND confirmada),0)::numeric(14,2) costo_preneces,
      COUNT(*) FILTER (WHERE fecha_cierre IS NOT NULL AND confirmada)::int preneces,
      COALESCE(SUM(monto) FILTER (WHERE fecha_cierre IS NOT NULL AND parto_valido),0)::numeric(14,2) costo_partos,
      COUNT(*) FILTER (WHERE fecha_cierre IS NOT NULL AND parto_valido)::int partos,
      COUNT(*) FILTER (WHERE fecha_cierre IS NOT NULL AND NOT confirmada)::int cerrados_sin_prenez,
      COUNT(*) FILTER (WHERE fecha_cierre IS NOT NULL AND NOT parto_valido)::int cerrados_sin_parto,
      COALESCE(SUM(monto) FILTER (WHERE resultado_final IN ('perdida_aborto','vacia')),0)::numeric(14,2) costo_perdidas,
      COUNT(*) FILTER (WHERE resultado_final IN ('perdida_aborto','vacia'))::int ciclos_perdida,
      COUNT(*) FILTER (WHERE fecha_cierre IS NULL)::int ciclos_abiertos_excluidos,
      COUNT(*)::int ciclos_con_costos FROM evidencia`, valores);
  const c = ciclos[0];
  const promedio = (monto, divisor) => divisor ? (Number(monto) / divisor).toFixed(2) : null;
  const inicio = new Date(`${desde}T00:00:00Z`); const fin = new Date(`${hasta}T00:00:00Z`);
  const duracion = Math.round((fin - inicio) / 86400000) + 1;
  const finPrevio = new Date(inicio); finPrevio.setUTCDate(finPrevio.getUTCDate() - 1);
  const inicioPrevio = new Date(finPrevio); inicioPrevio.setUTCDate(inicioPrevio.getUTCDate() - duracion + 1);
  const previos = [inicioPrevio.toISOString().slice(0, 10), finPrevio.toISOString().slice(0, 10), filtros.animal_id || null, filtros.toro_id || null];
  const totalPrevio = (await client.query(`SELECT COALESCE(SUM(monto),0)::numeric(14,2) total FROM costo_reproductivo cr WHERE ${filtro}`, previos)).rows[0].total;
  const { rows: animales } = await client.query(`SELECT cr.animal_id,a.arete_id,a.nombre_alias,COALESCE(SUM(cr.monto),0)::numeric(14,2) total,COUNT(*)::int registros
    FROM costo_reproductivo cr JOIN animal a ON a.id=cr.animal_id WHERE ${filtro}
    GROUP BY cr.animal_id,a.arete_id,a.nombre_alias ORDER BY total DESC LIMIT 100`, valores);
  const { rows: porCiclo } = await client.query(`SELECT cr.ciclo_id,c.resultado_final,c.fecha_cierre,a.id animal_id,a.arete_id,a.nombre_alias,
      COALESCE(SUM(cr.monto),0)::numeric(14,2) total,
      COALESCE(SUM(cr.monto) FILTER (WHERE cr.servicio_id IS NOT NULL),0)::numeric(14,2) servicios,
      COALESCE(SUM(cr.monto) FILTER (WHERE cr.diagnostico_id IS NOT NULL),0)::numeric(14,2) diagnosticos,
      COALESCE(SUM(cr.monto) FILTER (WHERE cr.parto_id IS NOT NULL),0)::numeric(14,2) parto,
      COALESCE(SUM(cr.monto) FILTER (WHERE cr.servicio_id IS NULL AND cr.diagnostico_id IS NULL AND cr.parto_id IS NULL),0)::numeric(14,2) otros
    FROM costo_reproductivo cr JOIN ciclo_reproductivo c ON c.id=cr.ciclo_id JOIN animal a ON a.id=c.hembra_id
    WHERE ${filtro} AND cr.ciclo_id IS NOT NULL
    GROUP BY cr.ciclo_id,c.resultado_final,c.fecha_cierre,a.id,a.arete_id,a.nombre_alias ORDER BY total DESC LIMIT 100`, valores);
  return {
    periodo: { desde, hasta }, total: totales[0].total, registros: totales[0].registros,
    flujo_caja: { ya_contabilizados: totales[0].ya_en_flujo, costos_adicionales: totales[0].registros - totales[0].ya_en_flujo },
    desglose_etapa: etapas[0], categorias,
    costo_por_servicio: { valor: promedio(etapas[0].servicios, etapas[0].servicios_con_costo), numerador: etapas[0].servicios, denominador: etapas[0].servicios_con_costo, total_eventos: eventos[0].servicios, estado: etapas[0].servicios_con_costo ? 'calculado' : 'datos_incompletos' },
    costo_por_diagnostico: { valor: promedio(etapas[0].diagnosticos, etapas[0].diagnosticos_con_costo), numerador: etapas[0].diagnosticos, denominador: etapas[0].diagnosticos_con_costo, total_eventos: eventos[0].diagnosticos, estado: etapas[0].diagnosticos_con_costo ? 'calculado' : 'datos_incompletos' },
    costo_por_prenez: { valor: promedio(c.costo_preneces, c.preneces), numerador: c.costo_preneces, denominador: c.preneces, excluidos_abiertos: c.ciclos_abiertos_excluidos, excluidos_sin_prenez_confirmada: c.cerrados_sin_prenez, estado: c.preneces ? 'calculado' : 'datos_incompletos' },
    costo_por_parto: { valor: promedio(c.costo_partos, c.partos), numerador: c.costo_partos, denominador: c.partos, excluidos_abiertos: c.ciclos_abiertos_excluidos, excluidos_sin_parto_valido: c.cerrados_sin_parto, estado: c.partos ? 'calculado' : 'datos_incompletos' },
    perdidas: { ciclos: c.ciclos_perdida, costo_acumulado: c.costo_perdidas },
    completitud: { ciclos_con_costos: c.ciclos_con_costos, costos_sin_ciclo: totales[0].sin_ciclo, ciclos_abiertos_excluidos: c.ciclos_abiertos_excluidos },
    por_animal: animales,
    por_ciclo: porCiclo,
    comparacion_periodo_anterior: { desde: previos[0], hasta: previos[1], total: totalPrevio, diferencia: (Number(totales[0].total) - Number(totalPrevio)).toFixed(2) },
  };
}

async function obtenerEconomiaToro(client, toroId, filtros) {
  const { desde, hasta } = rangoPeriodo(filtros);
  const { rows } = await client.query(`WITH costos AS (
      SELECT ciclo_id,SUM(monto)::numeric(14,2) costo FROM costo_reproductivo GROUP BY ciclo_id
    ), atribuibles AS (
      SELECT cr.id,cr.resultado_final,COALESCE(costos.costo,0)::numeric(14,2) costo,
        EXISTS(SELECT 1 FROM diagnostico_gestacion d WHERE d.ciclo_id=cr.id AND d.resultado='prenada') confirmada,
        EXISTS(SELECT 1 FROM parto_reproductivo p WHERE p.ciclo_id=cr.id AND p.resultado='parto') parto,
        (SELECT COUNT(DISTINCT todos.macho_id)::int FROM servicio_reproductivo todos WHERE todos.ciclo_id=cr.id AND todos.macho_id IS NOT NULL) toros
      FROM ciclo_reproductivo cr LEFT JOIN costos ON costos.ciclo_id=cr.id
      WHERE EXISTS(SELECT 1 FROM servicio_reproductivo sr WHERE sr.ciclo_id=cr.id AND sr.fecha BETWEEN $1 AND $2 AND sr.macho_id=$3)
    ) SELECT COUNT(*)::int ciclos_muestra,
      COUNT(*) FILTER (WHERE toros=1)::int ciclos_atribuibles,
      COALESCE(SUM(costo) FILTER (WHERE toros=1),0)::numeric(14,2) costo_atribuible,
      COUNT(*) FILTER (WHERE toros=1 AND confirmada)::int concepciones,
      COUNT(*) FILTER (WHERE toros=1 AND parto)::int partos,
      COALESCE(SUM(costo) FILTER (WHERE toros=1 AND confirmada),0)::numeric(14,2) costo_concepciones,
      COALESCE(SUM(costo) FILTER (WHERE toros=1 AND parto),0)::numeric(14,2) costo_partos
      FROM atribuibles`, [desde, hasta, toroId]);
  const d = rows[0];
  return { ...d, costo_por_concepcion: d.concepciones ? (Number(d.costo_concepciones) / d.concepciones).toFixed(2) : null, costo_por_parto: d.partos ? (Number(d.costo_partos) / d.partos).toFixed(2) : null, completitud: { atribuibles: d.ciclos_atribuibles, muestra: d.ciclos_muestra } };
}

module.exports = { actualizarCosto, crearCosto, obtenerAnalitica, obtenerEconomiaToro, rangoPeriodo };
