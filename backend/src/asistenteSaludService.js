// P9.2 — consultas de solo lectura del asistente para salud, peso, condición
// corporal, alertas y calendario. Todo cálculo se hace aquí, en SQL
// parametrizado y con límites; el modelo solo recibe el resultado.
// Fechas: la "fecha de hoy" es la del rancho (periodos.js, America/Mexico_City),
// igual que el resto de las tools del asistente.

const { fechaISOEnZona, normalizarPeriodoFrecuente } = require('./periodos');
const { resolverAnimal } = require('./asistenteEntidades');
const { obtenerConfiguracion } = require('./configuracion');
const { obtenerEventosCalendario } = require('./calendarioService');
const { obtenerResumenAlertas, obtenerAlertasHato } = require('./alertasService');
const { CONDICION_DELGADA_MAX, CONDICION_SOBREPESO_MIN, clasificarCondicion } = require('./reglasCondicionCorporal');

const MAX_DIAS_CALENDARIO = 62;

function hoyRancho(opciones) {
  return fechaISOEnZona(opciones.ahora || new Date());
}

function animalPublico(fila) {
  return { id: fila.id, arete_id: fila.arete_id, nombre_alias: fila.nombre_alias || null, estado: fila.estado, sexo: fila.sexo };
}

function redondear(valor, decimales = 2) {
  if (valor == null) return null;
  const factor = 10 ** decimales;
  return Math.round(Number(valor) * factor) / factor;
}

function errorArgumento(mensaje) {
  const error = new Error(mensaje);
  error.code = 'TOOL_ARGUMENTOS_INVALIDOS';
  error.detalles = [{ campo: 'periodo', mensaje }];
  return error;
}

// ---------------------------------------------------------------------------
// Salud: estado clínico registrado, eventos sanitarios y próximas dosis.

const CRITERIO_REVISION = 'Animales vivos con estado de salud "enfermo" u "observación" registrado en su ficha (mismo criterio que la pantalla Alertas). El asistente describe registros; no diagnostica.';

// Ventanas de próximas dosis. "vencidas" = la fecha de próxima dosis ya pasó
// (mismo criterio que Alertas); las ventanas futuras empiezan hoy, de modo que
// una dosis nunca aparece a la vez como próxima y como vencida.
function rangoDosis(ventana, hoy, config) {
  if (ventana === 'vencidas') return { desde: null, hasta: null, antesDe: hoy };
  if (ventana === 'pronto') {
    const dias = Number(config.dias_alerta_vacuna) || 30;
    return { desde: hoy, hasta: sumarDias(hoy, dias), dias };
  }
  const rango = normalizarPeriodoFrecuente(ventana, new Date(`${hoy}T12:00:00Z`));
  return { desde: rango.desde < hoy ? hoy : rango.desde, hasta: rango.hasta };
}

function sumarDias(fecha, dias) {
  const valor = new Date(`${fecha}T00:00:00Z`);
  valor.setUTCDate(valor.getUTCDate() + dias);
  return valor.toISOString().slice(0, 10);
}

async function consultarSalud(db, args, opciones = {}) {
  const hoy = hoyRancho(opciones);
  const animal = args.animal ? await resolverAnimal(db, args.animal) : null;

  if (args.enfoque === 'revision') {
    const [conteo, items] = await Promise.all([
      db.query(`SELECT COUNT(*) FILTER (WHERE estado_salud='enfermo')::int enfermos,
          COUNT(*) FILTER (WHERE estado_salud='observacion')::int en_observacion
        FROM animal WHERE estado='vivo' AND estado_salud IN ('enfermo','observacion')`),
      db.query(`SELECT a.id,a.arete_id,a.nombre_alias,a.estado_salud,a.salud_fecha_inicio::text salud_fecha_inicio,
          LEFT(a.salud_diagnostico,160) salud_registro,c.nombre corral
        FROM animal a LEFT JOIN corral c ON c.id=a.corral_actual_id
        WHERE a.estado='vivo' AND a.estado_salud IN ('enfermo','observacion')
        ORDER BY (a.estado_salud='enfermo') DESC,a.salud_fecha_inicio NULLS LAST,a.arete_id LIMIT $1`, [args.limite]),
    ]);
    const { enfermos = 0, en_observacion: observacion = 0 } = conteo.rows[0] || {};
    return { enfoque: 'revision', fecha_corte: hoy, criterio: CRITERIO_REVISION, total: enfermos + observacion, enfermos, en_observacion: observacion, mostrados: items.rows.length, items: items.rows };
  }

  if (args.enfoque === 'dosis') {
    const config = await obtenerConfiguracion();
    const ventana = args.ventana || 'pronto';
    const rango = rangoDosis(ventana, hoy, config);
    const valores = [];
    const condiciones = ["a.estado='vivo'", 'es.proxima_dosis IS NOT NULL'];
    const agregar = (sql, valor) => { valores.push(valor); condiciones.push(sql.replaceAll('?', `$${valores.length}`)); };
    if (rango.antesDe) agregar('es.proxima_dosis < ?::date', rango.antesDe);
    else { agregar('es.proxima_dosis >= ?::date', rango.desde); agregar('es.proxima_dosis <= ?::date', rango.hasta); }
    if (args.tipo) agregar('es.tipo=?', args.tipo);
    if (animal) agregar('es.animal_id=?', animal.id);
    const where = condiciones.join(' AND ');
    const desde = 'FROM evento_salud es JOIN animal a ON a.id=es.animal_id LEFT JOIN insumo i ON i.id=es.insumo_id';
    const [conteo, items] = await Promise.all([
      db.query(`SELECT COUNT(*)::int total,COUNT(DISTINCT es.animal_id)::int animales ${desde} WHERE ${where}`, valores),
      db.query(`SELECT es.id,es.tipo,es.enfermedad,i.nombre producto,es.fecha::text fecha_evento,es.proxima_dosis::text proxima_dosis,
          (es.proxima_dosis - $${valores.length + 1}::date)::int dias,a.id animal_id,a.arete_id,a.nombre_alias
        ${desde} WHERE ${where} ORDER BY es.proxima_dosis,a.arete_id,es.id LIMIT $${valores.length + 2}`, [...valores, hoy, args.limite]),
    ]);
    return {
      enfoque: 'dosis',
      ventana,
      fecha_corte: hoy,
      rango: rango.antesDe ? { antes_de: hoy } : { desde: rango.desde, hasta: rango.hasta },
      criterio: rango.antesDe
        ? 'Dosis vencida = la fecha de próxima dosis registrada ya pasó (mismo criterio que Alertas). Solo animales vivos. No se refiere a la caducidad del producto en inventario.'
        : `Próxima dosis = fecha de próxima dosis registrada en un evento sanitario, desde hoy${rango.dias ? ` hasta ${rango.dias} días (umbral configurado de alertas)` : ''}. Solo animales vivos.`,
      ...(args.tipo ? { tipo: args.tipo } : {}),
      ...(animal ? { animal: animalPublico(animal) } : {}),
      total: conteo.rows[0]?.total ?? 0,
      animales: conteo.rows[0]?.animales ?? 0,
      mostrados: items.rows.length,
      items: items.rows,
    };
  }

  // Eventos sanitarios registrados (histórico). Incluye animales dados de
  // baja: el historial se conserva y la ficha indica su estado.
  const valores = [];
  const condiciones = ['TRUE'];
  const agregar = (sql, valor) => { valores.push(valor); condiciones.push(sql.replaceAll('?', `$${valores.length}`)); };
  if (animal) agregar('es.animal_id=?', animal.id);
  if (args.tipo) agregar('es.tipo=?', args.tipo);
  let rango = null;
  if (args.periodo) {
    rango = normalizarPeriodoFrecuente(args.periodo, opciones.ahora, args);
    agregar('es.fecha >= ?::date', rango.desde);
    agregar('es.fecha <= ?::date', rango.hasta);
  }
  const where = condiciones.join(' AND ');
  const desde = 'FROM evento_salud es JOIN animal a ON a.id=es.animal_id LEFT JOIN insumo i ON i.id=es.insumo_id';
  const [conteo, porTipo, items] = await Promise.all([
    db.query(`SELECT COUNT(*)::int total,COUNT(DISTINCT es.animal_id)::int animales ${desde} WHERE ${where}`, valores),
    db.query(`SELECT es.tipo,COUNT(*)::int total ${desde} WHERE ${where} GROUP BY es.tipo ORDER BY total DESC,es.tipo`, valores),
    db.query(`SELECT es.id,es.tipo,es.enfermedad,LEFT(es.descripcion,160) descripcion,i.nombre producto,es.fecha::text fecha,
        es.proxima_dosis::text proxima_dosis,a.id animal_id,a.arete_id,a.nombre_alias,a.estado animal_estado
      ${desde} WHERE ${where} ORDER BY es.fecha DESC,es.id DESC LIMIT $${valores.length + 1}`, [...valores, args.limite]),
  ]);
  return {
    enfoque: 'eventos',
    criterio: 'Eventos sanitarios registrados (vacuna, tratamiento, diagnóstico, desparasitación) tal como se capturaron.',
    ...(args.tipo ? { tipo: args.tipo } : {}),
    ...(rango ? { rango } : {}),
    ...(animal ? { animal: animalPublico(animal) } : {}),
    total: conteo.rows[0]?.total ?? 0,
    animales: conteo.rows[0]?.animales ?? 0,
    por_tipo: porTipo.rows,
    mostrados: items.rows.length,
    items: items.rows,
  };
}

// ---------------------------------------------------------------------------
// Peso. diferencia = peso más reciente − peso anterior comparable, donde
// "anterior comparable" es el pesaje inmediatamente previo por (fecha, id).
// En un periodo: último pesaje del periodo − primer pesaje del periodo, y solo
// si hay al menos dos pesajes dentro del periodo.

const DEFINICION_PESO = 'diferencia = peso más reciente − pesaje anterior (orden por fecha y captura). Ganancia diaria = diferencia ÷ días entre ambos pesajes, la misma fórmula de Pesajes.';
const DEFINICION_PESO_PERIODO = 'diferencia = último pesaje del periodo − primer pesaje del periodo; solo animales vivos con al menos dos pesajes dentro del periodo.';

async function consultarPeso(db, args, opciones = {}) {
  if (args.animal) {
    const animal = await resolverAnimal(db, args.animal);
    const { rows } = await db.query('SELECT fecha::text fecha,peso_kg FROM pesaje WHERE animal_id=$1 ORDER BY fecha DESC,id DESC LIMIT $2', [animal.id, args.limite]);
    const [ultimo, anterior] = rows;
    const base = { alcance: 'animal', definicion: DEFINICION_PESO, animal: animalPublico(animal), total_pesajes_mostrados: rows.length, historial: rows };
    if (!ultimo) return { ...base, estado: 'sin_pesajes' };
    if (!anterior) return { ...base, estado: 'un_pesaje', ultimo };
    const dias = Math.round((Date.parse(ultimo.fecha) - Date.parse(anterior.fecha)) / 86400000);
    const diferencia = redondear(Number(ultimo.peso_kg) - Number(anterior.peso_kg));
    return {
      ...base,
      estado: 'con_comparacion',
      ultimo,
      anterior,
      diferencia_kg: diferencia,
      diferencia_absoluta_kg: Math.abs(diferencia),
      dias_entre_pesajes: dias,
      ganancia_diaria_kg: dias > 0 ? redondear(diferencia / dias) : null,
    };
  }

  const rango = args.periodo ? normalizarPeriodoFrecuente(args.periodo, opciones.ahora, args) : null;
  const valores = [];
  let filtroFecha = '';
  if (rango) { valores.push(rango.desde, rango.hasta); filtroFecha = 'AND p.fecha BETWEEN $1::date AND $2::date'; }
  // Una sola consulta con funciones de ventana: sin N+1.
  const comparados = `WITH p AS (
      SELECT p.animal_id,p.fecha,p.peso_kg,
        ROW_NUMBER() OVER (PARTITION BY p.animal_id ORDER BY p.fecha DESC,p.id DESC) rn_desc,
        ROW_NUMBER() OVER (PARTITION BY p.animal_id ORDER BY p.fecha ASC,p.id ASC) rn_asc,
        COUNT(*) OVER (PARTITION BY p.animal_id) n
      FROM pesaje p JOIN animal a ON a.id=p.animal_id AND a.estado='vivo'
      WHERE TRUE ${filtroFecha}
    ), c AS (
      SELECT animal_id,
        MAX(peso_kg) FILTER (WHERE rn_desc=1) peso_final,
        MAX(fecha) FILTER (WHERE rn_desc=1) fecha_final,
        MAX(peso_kg) FILTER (WHERE ${rango ? 'rn_asc=1' : 'rn_desc=2'}) peso_inicial,
        MAX(fecha) FILTER (WHERE ${rango ? 'rn_asc=1' : 'rn_desc=2'}) fecha_inicial
      FROM p WHERE n>=2 GROUP BY animal_id
    )`;
  const orden = args.direccion === 'subida' ? 'diferencia DESC' : 'diferencia ASC';
  const filtroDireccion = args.direccion === 'subida' ? 'peso_final>peso_inicial' : args.direccion === 'bajada' ? 'peso_final<peso_inicial' : 'TRUE';
  const [conteo, items, vivos] = await Promise.all([
    db.query(`${comparados} SELECT COUNT(*)::int comparados,
        COUNT(*) FILTER (WHERE peso_final<peso_inicial)::int bajaron,
        COUNT(*) FILTER (WHERE peso_final>peso_inicial)::int subieron,
        COUNT(*) FILTER (WHERE peso_final=peso_inicial)::int sin_cambio FROM c`, valores),
    db.query(`${comparados} SELECT a.id animal_id,a.arete_id,a.nombre_alias,co.nombre corral,
        c.peso_inicial,c.fecha_inicial::text fecha_inicial,c.peso_final,c.fecha_final::text fecha_final,
        ROUND(c.peso_final-c.peso_inicial,2) diferencia
      FROM c JOIN animal a ON a.id=c.animal_id LEFT JOIN corral co ON co.id=a.corral_actual_id
      WHERE ${filtroDireccion} ORDER BY ${orden},a.arete_id LIMIT $${valores.length + 1}`, [...valores, args.limite]),
    db.query("SELECT COUNT(*)::int total FROM animal WHERE estado='vivo'"),
  ]);
  const resumen = conteo.rows[0] || { comparados: 0, bajaron: 0, subieron: 0, sin_cambio: 0 };
  return {
    alcance: 'hato',
    definicion: rango ? DEFINICION_PESO_PERIODO : `${DEFINICION_PESO} Por animal se comparan sus dos pesajes más recientes.`,
    ...(rango ? { rango } : {}),
    ...(args.direccion ? { direccion: args.direccion } : {}),
    resumen: { ...resumen, animales_vivos: vivos.rows[0]?.total ?? 0, sin_comparacion: Math.max(0, (vivos.rows[0]?.total ?? 0) - resumen.comparados) },
    mostrados: items.rows.length,
    items: items.rows,
  };
}

// ---------------------------------------------------------------------------
// Condición corporal (escala 1-5). "delgada" y "sobrepeso" usan la regla que
// ya aplicaba la ficha del animal (reglasCondicionCorporal.js).

const CRITERIO_CONDICION = `Escala 1-5. Delgada ≤ ${CONDICION_DELGADA_MAX} y sobrepeso ≥ ${CONDICION_SOBREPESO_MIN}, la misma regla de la ficha del animal. El cambio compara la medición más reciente con la anterior.`;

async function consultarCondicionCorporal(db, args, opciones = {}) {
  if (args.animal) {
    const animal = await resolverAnimal(db, args.animal);
    const { rows } = await db.query('SELECT fecha::text fecha,puntuacion,LEFT(observacion,160) observacion FROM condicion_corporal WHERE animal_id=$1 ORDER BY fecha DESC,id DESC LIMIT $2', [animal.id, args.limite]);
    const [ultima, anterior] = rows;
    return {
      alcance: 'animal',
      criterio: CRITERIO_CONDICION,
      animal: animalPublico(animal),
      estado: !ultima ? 'sin_registros' : !anterior ? 'una_medicion' : 'con_comparacion',
      ...(ultima ? { ultima, clasificacion: clasificarCondicion(ultima.puntuacion) } : {}),
      ...(anterior ? { anterior, cambio: Number(ultima.puntuacion) - Number(anterior.puntuacion) } : {}),
      historial: rows,
    };
  }

  const ultimas = `WITH m AS (
      SELECT x.animal_id,x.fecha,x.puntuacion,ROW_NUMBER() OVER (PARTITION BY x.animal_id ORDER BY x.fecha DESC,x.id DESC) rn
      FROM condicion_corporal x JOIN animal a ON a.id=x.animal_id AND a.estado='vivo'
    ), u AS (
      SELECT animal_id,MAX(puntuacion) FILTER (WHERE rn=1) ultima,MAX(fecha) FILTER (WHERE rn=1) fecha,
        MAX(puntuacion) FILTER (WHERE rn=2) anterior,MAX(fecha) FILTER (WHERE rn=2) fecha_anterior
      FROM m WHERE rn<=2 GROUP BY animal_id
    )`;
  const valores = [];
  let filtro = 'TRUE';
  if (args.puntuacion != null) { valores.push(args.puntuacion); filtro = `u.ultima=$${valores.length}`; }
  else if (args.filtro === 'delgada') { valores.push(CONDICION_DELGADA_MAX); filtro = `u.ultima<=$${valores.length}`; }
  else if (args.filtro === 'sobrepeso') { valores.push(CONDICION_SOBREPESO_MIN); filtro = `u.ultima>=$${valores.length}`; }
  else if (args.filtro === 'bajo_puntuacion') filtro = 'u.anterior IS NOT NULL AND u.ultima<u.anterior';
  else if (args.filtro === 'subio_puntuacion') filtro = 'u.anterior IS NOT NULL AND u.ultima>u.anterior';
  const [conteo, items] = await Promise.all([
    db.query(`${ultimas} SELECT COUNT(*)::int con_registro,COUNT(*) FILTER (WHERE ${filtro})::int coinciden FROM u`, valores),
    db.query(`${ultimas} SELECT a.id animal_id,a.arete_id,a.nombre_alias,c.nombre corral,u.ultima,u.fecha::text fecha,u.anterior,u.fecha_anterior::text fecha_anterior
      FROM u JOIN animal a ON a.id=u.animal_id LEFT JOIN corral c ON c.id=a.corral_actual_id
      WHERE ${filtro} ORDER BY u.ultima ${args.filtro === 'sobrepeso' ? 'DESC' : 'ASC'},u.fecha DESC,a.arete_id LIMIT $${valores.length + 1}`, [...valores, args.limite]),
  ]);
  return {
    alcance: 'hato',
    criterio: CRITERIO_CONDICION,
    ...(args.filtro ? { filtro: args.filtro } : {}),
    ...(args.puntuacion != null ? { puntuacion: args.puntuacion } : {}),
    animales_con_registro: conteo.rows[0]?.con_registro ?? 0,
    total: conteo.rows[0]?.coinciden ?? 0,
    mostrados: items.rows.length,
    items: items.rows,
  };
}

// ---------------------------------------------------------------------------
// Alertas. Mismas fuentes que la pantalla Alertas y la severidad que esa
// pantalla ya asigna a cada tipo (frontend/src/alertas.js). No se inventan
// severidades: una prueba verifica que esta tabla coincida con la del frontend.
const SEVERIDAD_ALERTA = Object.freeze({
  'Vacuna vencida': 'critica',
  'Vacuna próxima': 'advertencia',
  'Parto próximo': 'advertencia',
  'Estado de salud': 'critica',
  'Seguimiento de salud': 'advertencia',
  'Insumo agotado': 'critica',
  'Stock bajo': 'advertencia',
  'Capacidad de corral': 'advertencia',
  'Salud en corral': 'critica',
  'Pesajes atrasados': 'advertencia',
  'Posible brote': 'critica',
  'Plan sanitario': 'advertencia',
  'Trabajo pendiente': 'info',
});
const CATEGORIA_ALERTA = Object.freeze({
  'Vacuna vencida': 'sanidad', 'Vacuna próxima': 'sanidad', 'Estado de salud': 'sanidad', 'Seguimiento de salud': 'sanidad',
  'Posible brote': 'sanidad', 'Plan sanitario': 'sanidad', 'Parto próximo': 'reproduccion', 'Insumo agotado': 'inventario',
  'Stock bajo': 'inventario', 'Capacidad de corral': 'corrales', 'Salud en corral': 'corrales', 'Pesajes atrasados': 'corrales',
  'Trabajo pendiente': 'trabajo',
});
// Alertas que señalan a un animal concreto.
const ALERTAS_DE_ANIMAL = new Set(['Vacuna vencida', 'Vacuna próxima', 'Parto próximo', 'Estado de salud', 'Seguimiento de salud', 'Posible brote']);

async function consultarAlertas(db, args, opciones = {}) {
  const hoy = hoyRancho(opciones);
  const config = await obtenerConfiguracion();
  const dias = Number(config.dias_alerta_vacuna) || 30;
  const [resumen, hato, dosis, salud, stock, corrales] = await Promise.all([
    obtenerResumenAlertas(db, { config, usuario: opciones.usuario, hoy }),
    obtenerAlertasHato(db, config),
    db.query(`SELECT COUNT(*) FILTER (WHERE es.proxima_dosis < $1::date)::int vencidas,
        COUNT(*) FILTER (WHERE es.proxima_dosis BETWEEN $1::date AND $1::date + $2::int)::int proximas
      FROM evento_salud es JOIN animal a ON a.id=es.animal_id AND a.estado='vivo'
      WHERE es.proxima_dosis IS NOT NULL`, [hoy, dias]),
    db.query(`SELECT COUNT(*) FILTER (WHERE estado_salud='enfermo')::int enfermos,COUNT(*) FILTER (WHERE estado_salud='observacion')::int observacion
      FROM animal WHERE estado='vivo'`),
    db.query('SELECT COUNT(*) FILTER (WHERE stock_actual<=0)::int agotados,COUNT(*) FILTER (WHERE stock_actual>0 AND stock_actual<=stock_minimo)::int bajos FROM insumo WHERE stock_actual<=stock_minimo'),
    db.query(`SELECT (COUNT(*) FILTER (WHERE enfermos>0))::int con_enfermos FROM (
        SELECT c.id,COUNT(a.id) FILTER (WHERE a.estado_salud='enfermo') enfermos
        FROM corral c LEFT JOIN animal a ON a.corral_actual_id=c.id AND a.estado='vivo' GROUP BY c.id) x`),
  ]);
  const d = dosis.rows[0] || {};
  const s = salud.rows[0] || {};
  const st = stock.rows[0] || {};
  // obtenerAlertasHato ya filtra por el mínimo de afectados configurado.
  const brotes = hato.clusters || [];
  const conteos = [
    ['Vacuna vencida', d.vencidas, `Próximas dosis cuya fecha ya pasó (animales vivos).`],
    ['Vacuna próxima', d.proximas, `Próximas dosis entre hoy y ${dias} días (animales vivos).`],
    ['Estado de salud', s.enfermos, 'Animales vivos con estado de salud enfermo.'],
    ['Seguimiento de salud', s.observacion, 'Animales vivos en observación.'],
    ['Posible brote', brotes.length, `Grupos de contacto con al menos ${config.min_afectados_cluster_brote} animales afectados en ${config.dias_ventana_brote_ia} días.`],
    ['Plan sanitario', resumen.plan_sanitario_pendiente, 'Actividades de plan sanitario pendientes o vencidas.'],
    ['Parto próximo', resumen.partos_proximos, `Partos estimados entre hoy y ${config.dias_alerta_parto} días.`],
    ['Insumo agotado', st.agotados, 'Insumos sin existencias.'],
    ['Stock bajo', st.bajos, 'Insumos en o por debajo del mínimo.'],
    ['Capacidad de corral', resumen.corrales_casi_llenos, `Corrales con ${config.pct_corral_casi_lleno} % de ocupación o más.`],
    ['Salud en corral', corrales.rows[0]?.con_enfermos, 'Corrales con al menos un animal enfermo.'],
    ['Pesajes atrasados', (hato.pesajes_atrasados || []).length, `Corrales con animales sin pesaje en ${config.dias_sin_pesaje_alerta} días.`],
    ['Trabajo pendiente', resumen.tareas_pendientes, 'Tareas pendientes o en progreso visibles para tu rol.'],
  ];
  const todas = conteos
    .map(([tipo, total, detalle]) => ({ tipo, categoria: CATEGORIA_ALERTA[tipo], severidad: SEVERIDAD_ALERTA[tipo], total: Number(total) || 0, detalle, de_animal: ALERTAS_DE_ANIMAL.has(tipo) }))
    .filter((alerta) => alerta.total > 0);
  const filtradas = todas.filter((alerta) => (!args.severidad || alerta.severidad === args.severidad)
    && (!args.categoria || (args.categoria === 'animales' ? alerta.de_animal : alerta.categoria === args.categoria)));
  const orden = { critica: 0, advertencia: 1, info: 2 };
  filtradas.sort((a, b) => orden[a.severidad] - orden[b.severidad] || b.total - a.total);
  const mortalidad = hato.mortalidad;
  return {
    fecha_corte: hoy,
    criterio: 'Alertas vigentes según los registros actuales (no hay alertas fechadas por día). Severidad y categorías tal como las asigna la pantalla Alertas.',
    ...(args.severidad ? { severidad: args.severidad } : {}),
    ...(args.categoria ? { categoria: args.categoria } : {}),
    total_tipos: filtradas.length,
    por_severidad: Object.fromEntries(['critica', 'advertencia', 'info'].map((clave) => [clave, filtradas.filter((a) => a.severidad === clave).length])),
    alertas: filtradas.slice(0, args.limite),
    ...(mortalidad && !args.categoria && !args.severidad ? { mortalidad } : {}),
  };
}

// ---------------------------------------------------------------------------
// Calendario (mismo servicio que la pantalla Calendario).
const ETIQUETA_CALENDARIO = { vacuna: 'Próxima dosis', parto: 'Parto estimado', tarea: 'Tarea', plan_sanitario: 'Plan sanitario' };

async function consultarCalendario(db, args, opciones = {}) {
  const rango = normalizarPeriodoFrecuente(args.periodo, opciones.ahora, args);
  const dias = Math.round((Date.parse(rango.hasta) - Date.parse(rango.desde)) / 86400000);
  if (!(dias >= 0) || dias > MAX_DIAS_CALENDARIO) throw errorArgumento(`El rango del calendario debe ser de 0 a ${MAX_DIAS_CALENDARIO} días.`);
  const eventos = await obtenerEventosCalendario(db, { desde: rango.desde, hasta: rango.hasta, usuario: opciones.usuario });
  const filtrados = eventos
    .filter((evento) => !args.tipo || evento.tipo === args.tipo)
    .map((evento) => ({ ...evento, fecha: fechaISOEnZona(evento.fecha instanceof Date ? evento.fecha : String(evento.fecha)) }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.tipo.localeCompare(b.tipo));
  const porTipo = Object.fromEntries(Object.keys(ETIQUETA_CALENDARIO).map((tipo) => [tipo, filtrados.filter((e) => e.tipo === tipo).length]));
  return {
    rango,
    criterio: 'El calendario reúne próximas dosis, partos estimados, tareas (no canceladas; propias para Veterinario y Trabajador) y actividades de plan sanitario sin aplicar, igual que la pantalla Calendario.',
    ...(args.tipo ? { tipo: args.tipo } : {}),
    total: filtrados.length,
    por_tipo: porTipo,
    mostrados: Math.min(filtrados.length, args.limite),
    items: filtrados.slice(0, args.limite).map((evento) => ({
      fecha: evento.fecha, tipo: evento.tipo, etiqueta: ETIQUETA_CALENDARIO[evento.tipo], titulo: evento.titulo,
      ...(evento.animal_id ? { animal_id: evento.animal_id, arete_id: evento.arete_id, nombre_alias: evento.nombre_alias || null } : {}),
      ...(evento.tipo === 'tarea' ? { trabajador: evento.trabajador, completada: Boolean(evento.completada) } : {}),
    })),
  };
}

module.exports = {
  SEVERIDAD_ALERTA,
  CATEGORIA_ALERTA,
  consultarSalud,
  consultarPeso,
  consultarCondicionCorporal,
  consultarAlertas,
  consultarCalendario,
};
