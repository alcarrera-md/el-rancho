const { fechaISOEnZona, normalizarPeriodoFrecuente } = require('./periodos');
const { resolverAnimal, resolverCorral, resolverTrabajador, resolverInsumo } = require('./asistenteEntidades');
const { tienePermiso } = require('./authorization/policy');
const { obtenerConfiguracion } = require('./configuracion');

// "Vacas y toros" en lenguaje del ganadero = animales adultos. Las crías y
// destetes se reportan aparte para que la cifra nunca oculte animales.
const CATEGORIAS_ADULTAS = ['engorde', 'vientre', 'reproductor', 'descarte'];
const CATEGORIAS_CRIA = ['cria', 'destete'];
const ROLES_TAREAS_PROPIAS = ['Veterinario', 'Trabajador'];

function fechaISO(valor) { return fechaISOEnZona(valor); }

function errorReferencia(codigo, mensaje) {
  const error = new Error(mensaje);
  error.code = codigo;
  return error;
}

function periodo(args, ahora, campo = 'fecha', inicio = 1) {
  const rango = normalizarPeriodoFrecuente(args.periodo, ahora, args);
  if (rango.desde && rango.hasta) return { sql: `${campo} BETWEEN $${inicio}::date AND $${inicio + 1}::date`, valores: [rango.desde, rango.hasta], periodo: rango };
  return { sql: 'TRUE', valores: [], periodo: rango };
}

function constructor() {
  const valores = [];
  const condiciones = [];
  return {
    valores,
    condiciones,
    agregar(sql, valor) { valores.push(valor); condiciones.push(sql.replaceAll('?', `$${valores.length}`)); },
    where() { return condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : ''; },
  };
}

async function resolverRaza(db, referencia) {
  const { rows } = await db.query('SELECT id,nombre FROM raza WHERE LOWER(nombre)=LOWER($1) LIMIT 2', [String(referencia).trim()]);
  if (!rows.length) throw errorReferencia('RAZA_NO_ENCONTRADA', `No encontré la raza “${referencia}”.`);
  return rows[0];
}

const EXPRESION_GRUPO = {
  sexo: 'a.sexo',
  categoria: "COALESCE(a.categoria,'sin categoría')",
  raza: "COALESCE(r.nombre,'Sin raza')",
  corral: "COALESCE(c.nombre,'Sin corral')",
  estado_salud: 'a.estado_salud',
};

async function consultarAnimales(db, args, opciones = {}) {
  const q = constructor();
  if (args.estado) q.agregar('a.estado=?', args.estado);
  else if (!args.incluir_inactivos) q.condiciones.push("a.estado='vivo'");
  if (args.sexo) q.agregar('a.sexo=?', args.sexo);
  if (args.categoria) q.agregar('a.categoria=?', args.categoria);
  if (args.etapa) q.agregar('a.categoria=ANY(?::text[])', args.etapa === 'adulto' ? CATEGORIAS_ADULTAS : CATEGORIAS_CRIA);
  if (args.estado_salud) q.agregar('a.estado_salud=?', args.estado_salud);
  const referencias = {};
  if (args.raza) { referencias.raza = await resolverRaza(db, args.raza); q.agregar('a.raza_id=?', referencias.raza.id); }
  if (args.corral) { referencias.corral = await resolverCorral(db, args.corral); q.agregar('a.corral_actual_id=?', referencias.corral.id); }
  // Bajas por periodo (P9.2.1): las rutas de muerte/sacrificio y venta siempre
  // guardan fecha_baja (o la fecha del día); se filtra por esa fecha efectiva.
  let rango = null;
  let sinFecha = 0;
  if (args.periodo) {
    rango = normalizarPeriodoFrecuente(args.periodo, opciones.ahora, args);
    const base = q.where();
    sinFecha = (await db.query(`SELECT COUNT(*)::int total FROM animal a ${base ? `${base} AND` : 'WHERE'} a.fecha_baja IS NULL`, q.valores)).rows[0]?.total ?? 0;
    q.agregar('a.fecha_baja>=?::date', rango.desde);
    q.agregar('a.fecha_baja<=?::date', rango.hasta);
  }
  const desde = 'FROM animal a LEFT JOIN raza r ON r.id=a.raza_id LEFT JOIN corral c ON c.id=a.corral_actual_id';
  const where = q.where();
  const [resumen, grupos, items] = await Promise.all([
    db.query(`SELECT COUNT(*)::int total,
        COUNT(*) FILTER (WHERE a.sexo='hembra')::int hembras,
        COUNT(*) FILTER (WHERE a.sexo='macho')::int machos,
        COUNT(*) FILTER (WHERE a.sexo='hembra' AND a.categoria=ANY($${q.valores.length + 1}::text[]))::int hembras_adultas,
        COUNT(*) FILTER (WHERE a.sexo='macho' AND a.categoria=ANY($${q.valores.length + 1}::text[]))::int machos_adultos,
        COUNT(*) FILTER (WHERE a.categoria=ANY($${q.valores.length + 2}::text[]))::int crias_y_destetes,
        COUNT(*) FILTER (WHERE a.categoria IS NULL)::int sin_categoria
      ${desde} ${where}`, [...q.valores, CATEGORIAS_ADULTAS, CATEGORIAS_CRIA]),
    args.agrupar_por
      ? db.query(`SELECT ${EXPRESION_GRUPO[args.agrupar_por]} grupo,COUNT(*)::int total ${desde} ${where} GROUP BY 1 ORDER BY total DESC,grupo LIMIT 50`, q.valores)
      : Promise.resolve({ rows: [] }),
    args.modo === 'lista'
      ? db.query(`SELECT a.id,a.arete_id,a.nombre_alias,a.sexo,a.categoria,a.estado,a.estado_salud,a.fecha_baja::text fecha_baja,r.nombre raza,c.id corral_id,c.nombre corral ${desde} ${where} ORDER BY ${rango ? 'a.fecha_baja DESC,' : ''}a.arete_id LIMIT $${q.valores.length + 1}`, [...q.valores, args.limite])
      : Promise.resolve({ rows: [] }),
  ]);
  const fila = resumen.rows[0] || {};
  return {
    definicion: 'Animales según estado, sexo, categoría, raza, corral y estado clínico almacenados. Adultos = categorías engorde, vientre, reproductor o descarte; crías = cría o destete.',
    filtros: { ...args, ...(referencias.corral ? { corral: referencias.corral.nombre } : {}), ...(referencias.raza ? { raza: referencias.raza.nombre } : {}) },
    ...(rango ? { rango, criterio_fecha: 'Fecha efectiva de baja registrada (muerte, sacrificio o venta).', ...(sinFecha ? { sin_fecha_baja: sinFecha } : {}) } : {}),
    resumen: fila,
    ...(args.agrupar_por ? { agrupado_por: args.agrupar_por, grupos: grupos.rows } : {}),
    items: items.rows,
    ...(args.modo === 'lista' ? { mostrados: items.rows.length, truncado: items.rows.length < Number(fila.total) } : {}),
  };
}

async function consultarCorrales(db, args) {
  const valores = [];
  let filtro = 'c.activo=true';
  if (args.corral) { valores.push((await resolverCorral(db, args.corral)).id); filtro += ' AND c.id=$1'; }
  const filas = (await db.query(`SELECT c.id,c.nombre,c.capacidad_maxima,COUNT(a.id)::int ocupacion,(c.capacidad_maxima-COUNT(a.id))::int espacio_disponible,ROUND(CASE WHEN c.capacidad_maxima>0 THEN COUNT(a.id)*100.0/c.capacidad_maxima ELSE 0 END,1) porcentaje_ocupacion FROM corral c LEFT JOIN animal a ON a.corral_actual_id=c.id AND a.estado='vivo' WHERE ${filtro} GROUP BY c.id,c.nombre,c.capacidad_maxima ORDER BY porcentaje_ocupacion DESC,c.nombre`, valores)).rows;
  const filtradas = args.ocupacion_minima == null ? filas : filas.filter((fila) => Number(fila.porcentaje_ocupacion) >= args.ocupacion_minima);
  return {
    definicion_mas_lleno: 'Mayor porcentaje de ocupación (ocupación/capacidad), no mayor cantidad absoluta.',
    filtros: { ocupacion_minima: args.ocupacion_minima ?? null },
    total_corrales: filtradas.length,
    corrales: filtradas,
    mas_lleno: filtradas[0] || null,
  };
}

async function consultarInventario(db, args, opciones = {}) {
  const q = constructor();
  if (!args.incluir_inactivos) q.condiciones.push('activo=true');
  if (args.tipo) q.agregar('tipo=?', args.tipo);
  if (args.estado === 'bajo') q.condiciones.push('stock_actual<=stock_minimo');
  if (args.estado === 'agotado') q.condiciones.push('stock_actual<=0');
  if (args.estado === 'por_caducar') q.agregar("fecha_caducidad BETWEEN ?::date AND ?::date + interval '30 days'", fechaISO(opciones.ahora || new Date()));
  let insumo = null;
  if (args.insumo) { insumo = await resolverInsumo(db, args.insumo); q.agregar('id=?', insumo.id); }
  const where = q.where();
  const [items, totales, duplicados] = await Promise.all([
    db.query(`SELECT id,nombre,tipo,unidad_medida,stock_actual,stock_minimo,fecha_caducidad,activo,CASE WHEN stock_actual<=0 THEN 'agotado' WHEN stock_actual<=stock_minimo THEN 'bajo' ELSE 'suficiente' END estado_stock FROM insumo ${where} ORDER BY CASE WHEN stock_actual<=0 THEN 0 WHEN stock_actual<=stock_minimo THEN 1 ELSE 2 END,tipo,nombre LIMIT $${q.valores.length + 1}`, [...q.valores, args.limite]),
    // Solo se suman productos del mismo tipo y la misma unidad declarada.
    db.query(`SELECT tipo,LOWER(TRIM(unidad_medida)) unidad,COUNT(*)::int productos,SUM(stock_actual) stock_total FROM insumo ${where} GROUP BY 1,2 ORDER BY 1,2`, q.valores),
    db.query(`SELECT string_agg(nombre || ' (' || unidad_medida || ')', ', ' ORDER BY nombre) productos FROM insumo ${where} GROUP BY LOWER(TRIM(nombre)) HAVING COUNT(*)>1`, q.valores),
  ]);
  const totalProductos = totales.rows.reduce((suma, fila) => suma + Number(fila.productos || 0), 0);
  // El catálogo solo tiene unidad_medida (no presentación ni factor). Una
  // unidad que empieza con cifra se muestra literal y se reporta, sin convertir.
  const inconsistencias = [
    ...totales.rows.filter((fila) => /^\d/.test(fila.unidad || '')).map((fila) => `La unidad registrada «${fila.unidad}» (${fila.tipo}) incluye una cantidad; parece una presentación y no se convirtió ni se sumó con otras unidades.`),
    ...(duplicados?.rows || []).map((fila) => `Posible producto duplicado en el catálogo: ${fila.productos}.`),
  ];
  return {
    ...(insumo ? { insumo: { id: insumo.id, nombre: insumo.nombre } } : {}),
    regla_unidades: 'Los stocks se presentan por producto y unidad; nunca se suman unidades incompatibles.',
    ...(inconsistencias.length ? { inconsistencias } : {}),
    totales_por_unidad: totales.rows,
    items: items.rows,
    total_productos: totalProductos || items.rows.length,
    mostrados: items.rows.length,
  };
}

async function consultarTareas(db, args, opciones = {}) {
  const hoy = fechaISO(opciones.ahora || new Date());
  const valores = [hoy]; const condiciones = [];
  const agregar = (sql, valor) => { valores.push(valor); condiciones.push(sql.replaceAll('?', `$${valores.length}`)); };
  if (ROLES_TAREAS_PROPIAS.includes(opciones.usuario?.rol)) agregar('t.usuario_id=?', opciones.usuario.id);
  if (args.estado === 'pendiente') condiciones.push("a.estado IN ('pendiente','en_progreso')");
  else if (args.estado === 'completada') condiciones.push("a.estado='completada'");
  else if (args.estado === 'vencida') condiciones.push("a.estado IN ('pendiente','en_progreso') AND a.fecha < $1::date");
  // Un nombre inexistente o ambiguo se informa; antes devolvía "0 tareas".
  let trabajador = null;
  if (args.trabajador) { trabajador = await resolverTrabajador(db, args.trabajador); agregar('t.id=?', trabajador.id); }
  let animal = null;
  if (args.animal) { animal = await resolverAnimal(db, args.animal); agregar('an.id=?', animal.id); }
  if (args.estado_salud_animal) agregar("an.estado='vivo' AND an.estado_salud=?", args.estado_salud_animal);
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  const desde = 'FROM asignacion_tarea a JOIN trabajador t ON t.id=a.trabajador_id LEFT JOIN animal an ON an.id=a.animal_id LEFT JOIN corral c ON c.id=a.corral_id';
  const [conteo, items] = await Promise.all([
    db.query(`SELECT COUNT(*)::int total,COUNT(*) FILTER (WHERE a.estado IN ('pendiente','en_progreso') AND a.fecha<$1::date)::int vencidas ${desde} ${where}`, valores),
    db.query(`SELECT a.id,a.descripcion,a.estado,a.fecha fecha_limite,t.id trabajador_id,t.nombre trabajador,an.id animal_id,an.arete_id animal_arete,an.nombre_alias animal_nombre,an.estado_salud animal_estado_salud,c.nombre corral,(a.estado IN ('pendiente','en_progreso') AND a.fecha<$1::date) vencida ${desde} ${where} ORDER BY vencida DESC,a.fecha LIMIT ${args.limite}`, valores),
  ]);
  const total = conteo.rows[0]?.total ?? items.rows.length;
  return {
    fecha_corte: hoy,
    definicion_vencida: 'Pendiente o en progreso con fecha límite anterior a la fecha actual del backend.',
    ...(args.estado_salud_animal ? { nota: 'Solo cuenta tareas asignadas directamente a un animal; las tareas por corral no se atribuyen a animales.' } : {}),
    ...(animal ? { animal: { id: animal.id, arete_id: animal.arete_id, nombre_alias: animal.nombre_alias } } : {}),
    ...(trabajador ? { trabajador: { id: trabajador.id, nombre: trabajador.nombre } } : {}),
    total,
    vencidas: conteo.rows[0]?.vencidas ?? null,
    mostradas: items.rows.length,
    items: items.rows,
  };
}

async function consultarMovimientos(db, args, opciones = {}) {
  const rango = periodo(args, opciones.ahora, 'm.fecha'); const valores = [...rango.valores]; const condiciones = [rango.sql];
  let animal = null;
  if (args.animal) { animal = await resolverAnimal(db, args.animal); valores.push(animal.id); condiciones.push(`a.id=$${valores.length}`); }
  if (args.corral_destino) { valores.push((await resolverCorral(db, args.corral_destino)).id); condiciones.push(`m.corral_destino=$${valores.length}`); }
  const where = condiciones.join(' AND ');
  const desde = 'FROM movimiento_corral m JOIN animal a ON a.id=m.animal_id LEFT JOIN corral co ON co.id=m.corral_origen JOIN corral cd ON cd.id=m.corral_destino';
  const [conteo, items] = await Promise.all([
    db.query(`SELECT COUNT(*)::int total,COUNT(DISTINCT m.animal_id)::int animales ${desde} WHERE ${where}`, valores),
    db.query(`SELECT m.id,m.fecha,m.motivo,a.id animal_id,a.arete_id,a.nombre_alias,co.nombre origen,cd.nombre destino ${desde} WHERE ${where} ORDER BY m.fecha DESC,m.id DESC LIMIT ${args.limite}`, valores),
  ]);
  return {
    periodo: args.periodo,
    rango: rango.periodo,
    total: conteo.rows[0]?.total ?? items.rows.length,
    animales_distintos: conteo.rows[0]?.animales ?? null,
    mostrados: items.rows.length,
    items: items.rows,
  };
}

const METRICAS_FINANCIERAS = Object.freeze({
  ventas: { tabla: 'venta', columna: 'precio', etiqueta: 'Ventas de animales', unidad: 'MXN' },
  compras_animales: { tabla: 'compra_animal', columna: 'precio', etiqueta: 'Compras de animales', unidad: 'MXN' },
  compras_insumos: { tabla: 'compra_insumo', columna: 'costo_total', etiqueta: 'Compras de insumos', unidad: 'MXN' },
  gastos: { tabla: 'gasto_general', columna: 'monto', etiqueta: 'Gastos generales', unidad: 'MXN' },
  leche: { tabla: 'produccion_leche', columna: 'litros', etiqueta: 'Producción de leche', unidad: 'litros' },
});

async function sumar(db, { tabla, columna }, rango, extra = '') {
  const fila = (await db.query(`SELECT COUNT(*)::int cantidad,COALESCE(SUM(${columna}),0) total FROM ${tabla} WHERE ${rango.sql}${extra}`, rango.valores)).rows[0];
  return { cantidad: fila.cantidad, total: fila.total };
}

// Egresos = flujo de salidas registradas en el periodo, igual que la pantalla
// Finanzas: compras de insumos + compras de animales + gastos generales
// (+ costos reproductivos directos solo si el rol puede leerlos). No es utilidad
// ni rentabilidad: no resta ingresos ni prorratea costos por animal.
async function tablaDisponible(db, tabla) {
  const { rows } = await db.query('SELECT to_regclass($1) IS NOT NULL disponible', [`public.${tabla}`]);
  return Boolean(rows[0]?.disponible);
}

async function consultarEgresos(db, rango, usuario) {
  const permisoReproductivos = tienePermiso(usuario?.rol, 'costos_reproductivos', 'leer');
  // Una base sin la migración 0011 no tiene costo_reproductivo: se informa la
  // exclusión en lugar de fallar toda la consulta o sumar un cero silencioso.
  const moduloReproductivo = permisoReproductivos ? await tablaDisponible(db, 'costo_reproductivo') : false;
  const incluirReproductivos = permisoReproductivos && moduloReproductivo;
  const componentes = [
    ['compras_insumos', METRICAS_FINANCIERAS.compras_insumos],
    ['compras_animales', METRICAS_FINANCIERAS.compras_animales],
    ['gastos', METRICAS_FINANCIERAS.gastos],
    ...(incluirReproductivos ? [['costos_reproductivos', { tabla: 'costo_reproductivo', columna: 'monto', etiqueta: 'Costos reproductivos directos', extra: ' AND gasto_general_id IS NULL AND compra_insumo_id IS NULL' }]] : []),
  ];
  const resultados = await Promise.all(componentes.map(([, def]) => sumar(db, def, rango, def.extra || '')));
  const desglose = componentes.map(([clave, def], i) => ({ concepto: clave, etiqueta: def.etiqueta, total: resultados[i].total, registros: resultados[i].cantidad }));
  const total = desglose.reduce((suma, item) => suma + Number(item.total || 0), 0);
  return {
    formula: incluirReproductivos
      ? 'compras de insumos + compras de animales + gastos generales + costos reproductivos directos'
      : 'compras de insumos + compras de animales + gastos generales',
    desglose,
    total: total.toFixed(2),
    cantidad: desglose.reduce((suma, item) => suma + Number(item.registros || 0), 0),
    ...(incluirReproductivos ? {} : {
      exclusiones: [permisoReproductivos
        ? 'No incluye costos reproductivos directos: el módulo no está instalado en esta base de datos (migración 0011 pendiente).'
        : 'No incluye costos reproductivos directos: tu rol no tiene permiso para consultarlos.'],
    }),
  };
}

async function consultarFinanzas(db, args, opciones = {}) {
  const rango = periodo(args, opciones.ahora);
  const base = { metrica: args.metrica, periodo: rango.periodo.periodo, rango: rango.periodo, tipo_cifra: 'flujo registrado en el periodo (no es utilidad ni rentabilidad)' };
  if (args.metrica === 'egresos') {
    return { ...base, etiqueta: 'Egresos registrados', unidad: 'MXN', ...(await consultarEgresos(db, rango, opciones.usuario)) };
  }
  const definicion = METRICAS_FINANCIERAS[args.metrica];
  const fila = await sumar(db, definicion, rango);
  return { ...base, etiqueta: definicion.etiqueta, cantidad: fila.cantidad, total: fila.total, unidad: definicion.unidad };
}

// Ficha consultiva (P9.2): todo lo relevante de un animal en una sola ronda de
// consultas independientes en paralelo, para que el modelo no encadene tools.
// Cada sección respeta policy.js; una sección no autorizada se declara en
// no_autorizado en lugar de devolverse vacía.
async function consultarFichaAnimal(db, args, opciones = {}) {
  const referencia = await resolverAnimal(db, args.identificador);
  const hoy = fechaISO(opciones.ahora || new Date());
  const rol = opciones.usuario?.rol;
  const puede = (recurso) => tienePermiso(rol, recurso, 'leer');
  const noAutorizado = ['salud', 'pesajes', 'condicion_corporal', 'asignaciones', 'reproduccion'].filter((recurso) => !puede(recurso));
  const valoresTareas = [referencia.id, hoy];
  let filtroTareas = '';
  if (ROLES_TAREAS_PROPIAS.includes(rol)) { valoresTareas.push(opciones.usuario.id); filtroTareas = ' AND t.usuario_id=$3'; }
  const vacio = Promise.resolve({ rows: [] });
  const esHembra = referencia.sexo === 'hembra';
  const [animal, pesajes, condicion, salud, dosis, vencidas, tareas, movimiento, reproduccion] = await Promise.all([
    db.query(`SELECT a.id,a.arete_id,a.nombre_alias,a.sexo,a.categoria,a.estado,a.estado_salud,a.salud_fecha_inicio::text salud_fecha_inicio,a.fecha_nacimiento::text fecha_nacimiento,a.fecha_baja::text fecha_baja,r.nombre raza,c.nombre corral
      FROM animal a LEFT JOIN raza r ON r.id=a.raza_id LEFT JOIN corral c ON c.id=a.corral_actual_id WHERE a.id=$1`, [referencia.id]),
    puede('pesajes') ? db.query('SELECT fecha::text fecha,peso_kg FROM pesaje WHERE animal_id=$1 ORDER BY fecha DESC,id DESC LIMIT 2', [referencia.id]) : vacio,
    puede('condicion_corporal') ? db.query('SELECT fecha::text fecha,puntuacion FROM condicion_corporal WHERE animal_id=$1 ORDER BY fecha DESC,id DESC LIMIT 2', [referencia.id]) : vacio,
    puede('salud') ? db.query('SELECT tipo,enfermedad,fecha::text fecha FROM evento_salud WHERE animal_id=$1 ORDER BY fecha DESC,id DESC LIMIT 3', [referencia.id]) : vacio,
    puede('salud') ? db.query('SELECT tipo,enfermedad,proxima_dosis::text fecha FROM evento_salud WHERE animal_id=$1 AND proxima_dosis>=$2::date ORDER BY proxima_dosis,id LIMIT 3', [referencia.id, hoy]) : vacio,
    puede('salud') ? db.query('SELECT COUNT(*)::int total FROM evento_salud WHERE animal_id=$1 AND proxima_dosis<$2::date', [referencia.id, hoy]) : vacio,
    puede('asignaciones') ? db.query(`SELECT COUNT(*) FILTER (WHERE at.estado IN ('pendiente','en_progreso'))::int pendientes,
        COUNT(*) FILTER (WHERE at.estado IN ('pendiente','en_progreso') AND at.fecha<$2::date)::int vencidas
      FROM asignacion_tarea at JOIN trabajador t ON t.id=at.trabajador_id WHERE at.animal_id=$1${filtroTareas}`, valoresTareas) : vacio,
    db.query(`SELECT m.fecha::text fecha,co.nombre origen,cd.nombre destino FROM movimiento_corral m LEFT JOIN corral co ON co.id=m.corral_origen JOIN corral cd ON cd.id=m.corral_destino
      WHERE m.animal_id=$1 ORDER BY m.fecha DESC,m.id DESC LIMIT 1`, [referencia.id]),
    // Mismo criterio de gestación que Alertas y Calendario: último diagnóstico
    // del ciclo abierto y parto estimado del servicio diagnosticado.
    esHembra && puede('reproduccion') ? db.query(`WITH ciclo AS (
        SELECT cr.id FROM ciclo_reproductivo cr WHERE cr.hembra_id=$1 AND cr.fecha_cierre IS NULL ORDER BY cr.fecha_inicio DESC,cr.id DESC LIMIT 1
      ), diag AS (
        SELECT dg.resultado,dg.fecha,dg.servicio_id FROM diagnostico_gestacion dg JOIN ciclo ON ciclo.id=dg.ciclo_id ORDER BY dg.fecha DESC,dg.id DESC LIMIT 1
      ), serv AS (
        SELECT sr.fecha FROM servicio_reproductivo sr JOIN ciclo ON ciclo.id=sr.ciclo_id ORDER BY sr.fecha DESC,sr.id DESC LIMIT 1
      )
      SELECT (SELECT id FROM ciclo) ciclo_id,(SELECT fecha::text FROM serv) ultimo_servicio,(SELECT resultado FROM diag) ultimo_diagnostico,
        (SELECT fecha::text FROM diag) fecha_diagnostico,
        (SELECT COALESCE(sr.fecha_parto_estimada_ajustada, sr.fecha + COALESCE((SELECT valor::int FROM configuracion WHERE clave='dias_gestacion_bovina'),283))::text
           FROM diag JOIN servicio_reproductivo sr ON sr.id=diag.servicio_id WHERE diag.resultado='prenada') parto_estimado`, [referencia.id]) : vacio,
  ]);
  const repro = reproduccion.rows[0];
  const resumenRepro = !repro ? null
    : !repro.ciclo_id ? { ...repro, resumen: 'sin ciclo reproductivo abierto' }
      : { ...repro, resumen: repro.ultimo_diagnostico === 'prenada'
        ? `preñada (diagnóstico ${repro.fecha_diagnostico}${repro.parto_estimado ? `, parto estimado ${repro.parto_estimado}` : ''})`
        : repro.ultimo_diagnostico ? `último diagnóstico ${repro.ultimo_diagnostico} (${repro.fecha_diagnostico})`
          : repro.ultimo_servicio ? `servida el ${repro.ultimo_servicio}, pendiente de diagnóstico` : 'ciclo abierto sin servicio registrado' };
  return {
    animal: animal.rows[0],
    ultimos_pesajes: pesajes.rows,
    condicion_corporal: condicion.rows,
    ultimos_eventos_salud: salud.rows,
    proximas_dosis: dosis.rows,
    proxima_dosis: dosis.rows[0]?.fecha || null,
    dosis_vencidas: vencidas.rows[0]?.total ?? 0,
    ...(puede('asignaciones') ? { tareas: tareas.rows[0] || { pendientes: 0, vencidas: 0 } } : {}),
    ultimo_movimiento: movimiento.rows[0] || null,
    ...(resumenRepro ? { reproduccion: resumenRepro } : {}),
    ...(noAutorizado.length ? { no_autorizado: noAutorizado } : {}),
    nota: esHembra ? 'Para el historial reproductivo completo usa consultar_vaca_reproductiva.' : undefined,
  };
}

// La atención de animales vive en asistenteCompuestoService.js (P9.3).

// Trabajadores (P9.2.1). policy.js solo permite leerlos al Administrador; la
// tool declara ese mismo permiso. No se exponen teléfonos ni usuarios.
async function consultarTrabajadores(db, args) {
  const filtro = args.estado === 'activos' ? 'WHERE activo=true' : args.estado === 'inactivos' ? 'WHERE activo=false' : '';
  const [conteo, items] = await Promise.all([
    db.query('SELECT COUNT(*)::int total,COUNT(*) FILTER (WHERE activo)::int activos,COUNT(*) FILTER (WHERE NOT activo)::int inactivos FROM trabajador'),
    db.query(`SELECT id,nombre,activo FROM trabajador ${filtro} ORDER BY activo DESC,nombre LIMIT $1`, [args.limite]),
  ]);
  const resumen = conteo.rows[0] || { total: 0, activos: 0, inactivos: 0 };
  const total = args.estado === 'activos' ? resumen.activos : args.estado === 'inactivos' ? resumen.inactivos : resumen.total;
  return { ...(args.estado ? { estado: args.estado } : {}), resumen, total, mostrados: items.rows.length, items: items.rows.map(({ id, ...fila }) => fila) };
}

module.exports = {
  consultarTrabajadores,
  CATEGORIAS_ADULTAS, CATEGORIAS_CRIA,
  consultarAnimales, consultarCorrales, consultarInventario, consultarTareas, consultarMovimientos, consultarFinanzas,
  consultarFichaAnimal,
};
