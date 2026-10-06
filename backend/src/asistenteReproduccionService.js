const { cargarCiclo } = require('./reproduccionService');
const { obtenerResumenAnalitico, obtenerDetalleMetrica, listarSementales } = require('./reproduccionAnaliticaService');
const { ahoraAnclado, normalizarPeriodoFrecuente } = require('./periodos');
const { resolverAnimal, resolverCorral } = require('./asistenteEntidades');

function normalizarPeriodo(datos, ahora = new Date()) {
  const rango = normalizarPeriodoFrecuente(datos.periodo, ahora, datos);
  // La capa analítica solo conoce estas claves; el resto se envía como rango
  // explícito calculado por periodos.js para no interpretar dos veces.
  if (['mes_actual', 'anio_actual', 'ultimos_30_dias'].includes(rango.periodo)) {
    return { periodo: rango.periodo, desde: undefined, hasta: undefined };
  }
  return { periodo: 'personalizado', desde: rango.desde, hasta: rango.hasta };
}

async function normalizarFiltros(client, datos, ahora) {
  const filtros = { ...normalizarPeriodo(datos, ahora) };
  if (datos.corral) filtros.corral_id = (await resolverCorral(client, datos.corral)).id;
  if (datos.toro) filtros.toro_id = (await resolverAnimal(client, datos.toro, { sexo: 'macho' })).id;
  if (datos.animal) filtros.animal_id = (await resolverAnimal(client, datos.animal, { sexo: 'hembra' })).id;
  if (datos.estado_reproductivo) filtros.estado_reproductivo = datos.estado_reproductivo;
  if (datos.tipo_servicio) filtros.tipo_servicio = datos.tipo_servicio;
  return filtros;
}

function seleccionarMetricas(resumen, claves) {
  return {
    as_of: resumen.as_of,
    filters: resumen.filters,
    metrics: Object.fromEntries(claves.map((clave) => {
      const { items, ...metrica } = resumen.metrics[clave];
      return [clave, metrica];
    })),
    attribution: resumen.attribution,
    completeness: resumen.completeness,
    warnings: resumen.warnings,
  };
}

const METRICAS_AGRUPABLES = ['prenadas', 'vacias', 'pendientes', 'revision', 'proximos_partos', 'partos', 'servicios', 'perdidas'];

function agruparPorCorral(resumen, claves) {
  const grupos = new Map();
  for (const clave of claves.filter((item) => METRICAS_AGRUPABLES.includes(item))) {
    for (const item of resumen.metrics[clave].items || []) {
      const corral = item.corral || 'Sin corral';
      if (!grupos.has(corral)) grupos.set(corral, { corral });
      const fila = grupos.get(corral);
      fila[clave] = (fila[clave] || 0) + 1;
    }
  }
  return [...grupos.values()].sort((a, b) => a.corral.localeCompare(b.corral, 'es'));
}

async function consultarResumen(client, args, opciones = {}) {
  const filtros = await normalizarFiltros(client, args, opciones.ahora);
  const resumen = await obtenerResumenAnalitico(client, filtros, { ahora: ahoraAnclado(opciones.ahora) });
  const resultado = seleccionarMetricas(resumen, args.metricas);
  if (args.agrupar_por === 'corral') {
    resultado.por_corral = agruparPorCorral(resumen, args.metricas);
    resultado.warnings = [...(resultado.warnings || []), 'La agrupación usa el corral actual de cada vaca; las tasas no se reparten por corral.'];
  }
  return resultado;
}

async function consultarDetalle(client, args, opciones = {}) {
  const filtros = await normalizarFiltros(client, args, opciones.ahora);
  return obtenerDetalleMetrica(client, filtros, args.metrica, args.pagina, args.limite, { ahora: ahoraAnclado(opciones.ahora) });
}

async function consultarAnimal(client, args) {
  const animal = await resolverAnimal(client, args.identificador, { sexo: 'hembra' });
  const { rows } = await client.query(`
    SELECT cr.*,a.arete_id AS hembra_arete,a.nombre_alias AS hembra_nombre
    FROM ciclo_reproductivo cr JOIN animal a ON a.id=cr.hembra_id
    WHERE cr.hembra_id=$1 ORDER BY cr.fecha_inicio DESC,cr.id DESC LIMIT 10`, [animal.id]);
  // Solo el ciclo vigente se carga completo; el historial se resume para no
  // hacer N+1 consultas ni enviar al modelo diez ciclos detallados.
  const vigente = rows.find((ciclo) => !ciclo.fecha_cierre) || rows[0] || null;
  const cicloActual = vigente ? await cargarCiclo(client, vigente) : null;
  const ciclos = rows.map((ciclo) => ({
    id: ciclo.id, fecha_inicio: ciclo.fecha_inicio, fecha_cierre: ciclo.fecha_cierre, resultado_final: ciclo.resultado_final,
  }));
  const legado = (await client.query(`
    SELECT er.id,er.tipo_monta,er.fecha_monta,er.fecha_parto_estimada,er.fecha_parto_real,er.resultado,
           p.arete_id AS toro_arete
    FROM evento_reproductivo er
    LEFT JOIN animal p ON p.id=er.padre_id
    LEFT JOIN ciclo_reproductivo cr ON cr.legado_evento_id=er.id
    WHERE er.madre_id=$1 AND cr.id IS NULL ORDER BY er.fecha_monta DESC LIMIT 10`, [animal.id])).rows;
  return {
    animal,
    ciclo_actual: cicloActual,
    ciclos,
    legado_no_clasificado: legado,
    completeness: { complete: rows.length < 10 && legado.length < 10, warnings: rows.length >= 10 || legado.length >= 10 ? ['Se muestran los 10 registros más recientes.'] : [] },
  };
}

async function consultarSemental(client, args, opciones = {}) {
  const toro = await resolverAnimal(client, args.identificador, { sexo: 'macho' });
  const filtros = { ...normalizarPeriodo(args, opciones.ahora), toro_id: toro.id };
  const resultado = await listarSementales(client, filtros, { ahora: ahoraAnclado(opciones.ahora) });
  return { ...resultado, toro, item: resultado.items[0] || null };
}

module.exports = {
  normalizarPeriodo,
  resolverAnimal,
  resolverCorral,
  normalizarFiltros,
  consultarResumen,
  consultarDetalle,
  consultarAnimal,
  consultarSemental,
};
