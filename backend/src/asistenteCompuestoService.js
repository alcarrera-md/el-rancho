// P9.3 — consultas compuestas, atención con prioridades explícitas y resumen
// operativo. El backend cruza, calcula y ordena; el modelo solo redacta.
// Todo cruce se hace en SQL (CTE/EXISTS/ventanas) con parámetros; los únicos
// conjuntos que vienen de Node son los reproductivos, calculados una vez por la
// analítica de P4 (misma definición de "preñada" y "próxima a parto" que el
// resto del sistema) y pasados como arreglo de IDs.

const { fechaISOEnZona, ahoraAnclado } = require('./periodos');
const { tienePermiso } = require('./authorization/policy');
const { obtenerConfiguracion } = require('./configuracion');
const { obtenerResumenAnalitico } = require('./reproduccionAnaliticaService');
const { obtenerEventosCalendario } = require('./calendarioService');
const { resolverCorral } = require('./asistenteEntidades');
const { consultarAlertas } = require('./asistenteSaludService');
const { CONDICION_DELGADA_MAX } = require('./reglasCondicionCorporal');
const { CATEGORIAS_ADULTAS, CATEGORIAS_CRIA } = require('./asistenteGlobalService');

const ROLES_TAREAS_PROPIAS = ['Veterinario', 'Trabajador'];
const TIPOS_TAREA_SANITARIA = ['revision_salud', 'vacunacion_tratamiento'];

// ---------------------------------------------------------------------------
// Política de prioridades (explícita y trazable). Cada
// motivo nace de un hecho registrado y de una regla que ya existía:
//   - severidad de la pantalla Alertas (crítica → alta, advertencia → media),
//   - la prioridad capturada en cada tarea,
//   - la regla de condición corporal de la ficha (≤ 2 delgada).
// La pérdida de peso NO entra: no tiene severidad definida en el sistema.
const PRIORIDADES = Object.freeze({ 1: 'alta', 2: 'media', 3: 'baja' });
const POLITICA_PRIORIDAD = Object.freeze({
  enfermo: { prioridad: 'alta', fuente: 'salud', regla: 'estado de salud "enfermo" (Alertas: crítica)' },
  observacion: { prioridad: 'media', fuente: 'salud', regla: 'estado de salud "en observación" (Alertas: advertencia)' },
  dosis_vencida: { prioridad: 'alta', fuente: 'salud', regla: 'dosis con fecha ya vencida (Alertas: "Vacuna vencida", crítica)' },
  dosis_proxima: { prioridad: 'media', fuente: 'salud', regla: 'dosis programada dentro del umbral de alertas (Alertas: "Vacuna próxima", advertencia)' },
  tarea_vencida: { prioridad: 'según la tarea', fuente: 'tareas', regla: 'tarea vencida: alta si es sanitaria (revisión de salud, vacunación o tratamiento) o su prioridad es alta/urgente; media si su prioridad es media; baja si es baja' },
  tarea_hoy: { prioridad: 'media', fuente: 'tareas', regla: 'tarea pendiente que vence hoy' },
  condicion_baja: { prioridad: 'media', fuente: 'condicion_corporal', regla: `condición corporal ≤ ${CONDICION_DELGADA_MAX} (regla "delgada" de la ficha del animal)` },
  parto_proximo: { prioridad: 'media', fuente: 'reproduccion', regla: 'parto estimado dentro del umbral de alertas (Alertas: "Parto próximo", advertencia)' },
});
const ETIQUETA_MOTIVO = Object.freeze({
  enfermo: 'enfermo', observacion: 'en observación', dosis_vencida: 'dosis vencida', dosis_proxima: 'dosis próxima',
  tarea_vencida: 'tarea vencida', tarea_hoy: 'tarea para hoy', condicion_baja: 'condición corporal baja', parto_proximo: 'parto próximo',
});
// Recurso de policy.js que cada fuente exige.
const PERMISO_FUENTE = Object.freeze({ salud: 'salud', tareas: 'asignaciones', condicion_corporal: 'condicion_corporal', reproduccion: 'reproduccion' });

function hoyDe(opciones) {
  return fechaISOEnZona(opciones.ahora || new Date());
}

function sumarDias(fecha, dias) {
  const valor = new Date(`${fecha}T00:00:00Z`);
  valor.setUTCDate(valor.getUTCDate() + dias);
  return valor.toISOString().slice(0, 10);
}

function parametros() {
  const valores = [];
  return { valores, p(valor) { valores.push(valor); return `$${valores.length}`; } };
}

// PostgreSQL rechaza parámetros enviados que la consulta no usa: los valores
// comunes se agregan la primera vez que alguna parte los necesita.
function perezoso(q, valor) {
  let marcador = null;
  return () => { marcador ||= q.p(valor); return marcador; };
}

function errorPermiso(mensaje) {
  const error = new Error(mensaje);
  error.code = 'TOOL_SIN_PERMISO';
  return error;
}

// Conjuntos reproductivos de la analítica P4: preñadas vigentes y partos
// estimados entre hoy y hoy + días. Una sola ejecución por consulta.
async function conjuntosReproductivos(db, hoy, dias) {
  const resumen = await obtenerResumenAnalitico(db, { periodo: 'personalizado', desde: hoy, hasta: sumarDias(hoy, dias) }, { ahora: ahoraAnclado(new Date(`${hoy}T12:00:00Z`)) });
  const partos = new Map();
  for (const item of resumen.metrics.proximos_partos?.items || []) {
    const fecha = String(item.fecha).slice(0, 10);
    if (!partos.has(item.animal_id) || fecha < partos.get(item.animal_id)) partos.set(item.animal_id, fecha);
  }
  return {
    prenadas: [...new Set((resumen.metrics.prenadas?.items || []).map((item) => item.animal_id))],
    partos,
  };
}

// Filtros del conjunto de animales (sustantivo del ganadero y corral).
async function filtrosAnimal(db, args, q, alias = 'a') {
  const condiciones = [`${alias}.estado='vivo'`];
  const referencias = {};
  if (args.sexo) condiciones.push(`${alias}.sexo=${q.p(args.sexo)}`);
  if (args.etapa) condiciones.push(`${alias}.categoria=ANY(${q.p(args.etapa === 'adulto' ? CATEGORIAS_ADULTAS : CATEGORIAS_CRIA)}::text[])`);
  if (args.corral) {
    referencias.corral = await resolverCorral(db, args.corral);
    condiciones.push(`${alias}.corral_actual_id=${q.p(referencias.corral.id)}`);
  }
  return { condiciones, referencias };
}

// ---------------------------------------------------------------------------
// Atención: un registro por animal con todos sus motivos.
async function obtenerAtencion(db, args, opciones = {}) {
  const hoy = hoyDe(opciones);
  const rol = opciones.usuario?.rol;
  const configuracion = await obtenerConfiguracion();
  const diasDosis = Number(configuracion.dias_alerta_vacuna) || 30;
  const diasParto = Number(configuracion.dias_alerta_parto) || 30;
  const permitidas = Object.fromEntries(Object.entries(PERMISO_FUENTE).map(([fuente, recurso]) => [fuente, tienePermiso(rol, recurso, 'leer')]));
  const reproduccion = permitidas.reproduccion ? (opciones.reproduccion || await conjuntosReproductivos(db, hoy, diasParto)) : null;

  const q = parametros();
  const hoyParam = perezoso(q, hoy);
  const partes = [`SELECT a.id animal_id,a.estado_salud tipo,NULL::text detalle,a.salud_fecha_inicio fecha,
      CASE WHEN a.estado_salud='enfermo' THEN 1 ELSE 2 END prioridad,NULL::text extra
    FROM animal a WHERE a.estado='vivo' AND a.estado_salud IN ('enfermo','observacion')`];
  if (permitidas.salud) {
    partes.push(`SELECT es.animal_id,'dosis_vencida',es.tipo || COALESCE(': ' || es.enfermedad,''),es.proxima_dosis,1,NULL
      FROM evento_salud es JOIN animal a ON a.id=es.animal_id AND a.estado='vivo'
      WHERE es.proxima_dosis < ${hoyParam()}::date`);
    partes.push(`SELECT es.animal_id,'dosis_proxima',es.tipo || COALESCE(': ' || es.enfermedad,''),es.proxima_dosis,2,NULL
      FROM evento_salud es JOIN animal a ON a.id=es.animal_id AND a.estado='vivo'
      WHERE es.proxima_dosis BETWEEN ${hoyParam()}::date AND ${hoyParam()}::date + ${q.p(diasDosis)}::int`);
  }
  if (permitidas.tareas) {
    const usuarioParam = perezoso(q, opciones.usuario?.id);
    const propias = () => (ROLES_TAREAS_PROPIAS.includes(rol) ? ` AND t.usuario_id=${usuarioParam()}` : '');
    const sanitarias = q.p(TIPOS_TAREA_SANITARIA);
    partes.push(`SELECT at.animal_id,'tarea_vencida',COALESCE(at.titulo,at.descripcion),at.fecha,
        CASE WHEN at.tipo=ANY(${sanitarias}::text[]) OR at.prioridad IN ('alta','urgente') THEN 1 WHEN at.prioridad='media' THEN 2 ELSE 3 END,
        CASE WHEN at.tipo=ANY(${sanitarias}::text[]) THEN 'sanitaria' ELSE at.prioridad END
      FROM asignacion_tarea at JOIN trabajador t ON t.id=at.trabajador_id JOIN animal a ON a.id=at.animal_id AND a.estado='vivo'
      WHERE at.estado IN ('pendiente','en_progreso') AND at.fecha < ${hoyParam()}::date${propias()}`);
    partes.push(`SELECT at.animal_id,'tarea_hoy',COALESCE(at.titulo,at.descripcion),at.fecha,2,at.prioridad
      FROM asignacion_tarea at JOIN trabajador t ON t.id=at.trabajador_id JOIN animal a ON a.id=at.animal_id AND a.estado='vivo'
      WHERE at.estado IN ('pendiente','en_progreso') AND at.fecha = ${hoyParam()}::date${propias()}`);
  }
  if (permitidas.condicion_corporal) {
    partes.push(`SELECT u.animal_id,'condicion_baja',u.puntuacion::text,u.fecha,2,NULL FROM (
        SELECT DISTINCT ON (x.animal_id) x.animal_id,x.puntuacion,x.fecha FROM condicion_corporal x
        JOIN animal a ON a.id=x.animal_id AND a.estado='vivo' ORDER BY x.animal_id,x.fecha DESC,x.id DESC
      ) u WHERE u.puntuacion <= ${q.p(CONDICION_DELGADA_MAX)}`);
  }
  if (reproduccion?.partos.size) {
    partes.push(`SELECT x.animal_id,'parto_proximo',NULL,x.fecha,2,NULL
      FROM unnest(${q.p([...reproduccion.partos.keys()])}::int[],${q.p([...reproduccion.partos.values()])}::date[]) AS x(animal_id,fecha)`);
  }

  const { condiciones, referencias } = await filtrosAnimal(db, args, q);
  if (args.motivo) condiciones.push(`EXISTS (SELECT 1 FROM motivos mm WHERE mm.animal_id=a.id AND mm.tipo=${q.p(args.motivo)})`);
  const base = `WITH motivos AS (${partes.join(' UNION ALL ')}),
    filtrados AS (
      SELECT m.*,MIN(m.prioridad) OVER (PARTITION BY m.animal_id) prioridad_animal
      FROM motivos m JOIN animal a ON a.id=m.animal_id WHERE ${condiciones.join(' AND ')}
    ),
    por_animal AS (
      SELECT animal_id,MIN(prioridad) prioridad,MIN(fecha) FILTER (WHERE prioridad=prioridad_animal) fecha_clave,COUNT(*)::int motivos
      FROM filtrados GROUP BY animal_id
    )`;
  const filtroPrioridad = args.prioridad ? `WHERE pa.prioridad=${q.p({ alta: 1, media: 2, baja: 3 }[args.prioridad])}` : '';
  const valores = [...q.valores];
  const [conteos, items] = await Promise.all([
    db.query(`${base} SELECT COUNT(*)::int animales,
        COUNT(*) FILTER (WHERE pa.prioridad=1)::int alta,COUNT(*) FILTER (WHERE pa.prioridad=2)::int media,COUNT(*) FILTER (WHERE pa.prioridad=3)::int baja,
        (SELECT COUNT(DISTINCT animal_id) FROM filtrados WHERE tipo='enfermo')::int enfermos,
        (SELECT COUNT(DISTINCT animal_id) FROM filtrados WHERE tipo='observacion')::int en_observacion,
        (SELECT COUNT(DISTINCT animal_id) FROM filtrados WHERE tipo='dosis_vencida')::int con_dosis_vencida,
        (SELECT COUNT(DISTINCT animal_id) FROM filtrados WHERE tipo='dosis_proxima')::int con_dosis_proxima,
        (SELECT COUNT(DISTINCT animal_id) FROM filtrados WHERE tipo='tarea_vencida')::int con_tarea_vencida,
        (SELECT COUNT(DISTINCT animal_id) FROM filtrados WHERE tipo='tarea_hoy')::int con_tarea_hoy,
        (SELECT COUNT(DISTINCT animal_id) FROM filtrados WHERE tipo='condicion_baja')::int con_condicion_baja,
        (SELECT COUNT(DISTINCT animal_id) FROM filtrados WHERE tipo='parto_proximo')::int con_parto_proximo
      FROM por_animal pa ${filtroPrioridad}`, valores),
    // Orden: prioridad, fecha clave (vencimiento más antiguo primero), arete.
    db.query(`${base} SELECT a.id,a.arete_id,a.nombre_alias,a.sexo,c.nombre corral,pa.prioridad,pa.fecha_clave::text fecha_clave,pa.motivos total_motivos,
        (SELECT json_agg(json_build_object('tipo',f.tipo,'detalle',f.detalle,'fecha',f.fecha::text,'prioridad',f.prioridad,'extra',f.extra) ORDER BY f.prioridad,f.fecha NULLS LAST,f.tipo)
           FROM (SELECT * FROM filtrados f2 WHERE f2.animal_id=a.id ORDER BY f2.prioridad,f2.fecha NULLS LAST LIMIT 6) f) motivos
      FROM por_animal pa JOIN animal a ON a.id=pa.animal_id LEFT JOIN corral c ON c.id=a.corral_actual_id
      ${filtroPrioridad}
      ORDER BY pa.prioridad,pa.fecha_clave NULLS LAST,a.arete_id LIMIT ${q.p(args.limite)}`, q.valores),
  ]);
  const resumen = conteos.rows[0] || {};
  const fuentesExcluidas = Object.entries(permitidas).filter(([, permitido]) => !permitido).map(([fuente]) => fuente);
  return {
    fecha_corte: hoy,
    criterio: 'Animales vivos con al menos un motivo de atención según la política de prioridades de El Rancho. Los motivos no son alertas nuevas ni diagnósticos.',
    politica: Object.fromEntries(Object.entries(POLITICA_PRIORIDAD).map(([clave, valor]) => [clave, `${valor.prioridad}: ${valor.regla}`])),
    ...(args.prioridad ? { prioridad: args.prioridad } : {}),
    ...(args.motivo ? { motivo: args.motivo } : {}),
    filtros: { ...(args.sexo ? { sexo: args.sexo } : {}), ...(args.etapa ? { etapa: args.etapa } : {}), ...(referencias.corral ? { corral: referencias.corral.nombre } : {}) },
    resumen: {
      animales: resumen.animales ?? 0,
      por_prioridad: { alta: resumen.alta ?? 0, media: resumen.media ?? 0, baja: resumen.baja ?? 0 },
      enfermos: resumen.enfermos ?? 0,
      en_observacion: resumen.en_observacion ?? 0,
      con_dosis_vencida: resumen.con_dosis_vencida ?? 0,
      con_dosis_proxima: resumen.con_dosis_proxima ?? 0,
      con_tarea_vencida: resumen.con_tarea_vencida ?? 0,
      con_tarea_hoy: resumen.con_tarea_hoy ?? 0,
      con_condicion_baja: resumen.con_condicion_baja ?? 0,
      con_parto_proximo: resumen.con_parto_proximo ?? 0,
    },
    ...(fuentesExcluidas.length ? { fuentes_excluidas: fuentesExcluidas } : {}),
    mostrados: items.rows.length,
    truncado: items.rows.length < (resumen.animales ?? 0),
    items: items.rows.map((fila) => ({
      ...fila,
      prioridad: PRIORIDADES[fila.prioridad],
      motivos: (fila.motivos || []).map((motivo) => ({ ...motivo, prioridad: PRIORIDADES[motivo.prioridad] })),
    })),
  };
}

// ---------------------------------------------------------------------------
// Cruces de animales: todos los criterios a la vez (AND), cada uno con su
// definición determinista. agrupar_por=corral cuenta por corral actual sin
// atribuir tareas de corral a animales.
const CRITERIOS = Object.freeze({
  enfermo: { recurso: 'animales', etiqueta: 'enfermos' },
  observacion: { recurso: 'animales', etiqueta: 'en observación' },
  problema_salud: { recurso: 'animales', etiqueta: 'enfermos o en observación' },
  tarea_vencida: { recurso: 'asignaciones', etiqueta: 'con tareas vencidas' },
  tarea_pendiente: { recurso: 'asignaciones', etiqueta: 'con tareas pendientes' },
  dosis_vencida: { recurso: 'salud', etiqueta: 'con dosis vencidas' },
  dosis_proxima: { recurso: 'salud', etiqueta: 'con dosis próximas' },
  condicion_baja: { recurso: 'condicion_corporal', etiqueta: `con condición corporal baja (≤ ${CONDICION_DELGADA_MAX})` },
  bajo_peso: { recurso: 'pesajes', etiqueta: 'que bajaron de peso entre sus dos últimos pesajes' },
  prenada: { recurso: 'reproduccion', etiqueta: 'preñadas' },
  proxima_parto: { recurso: 'reproduccion', etiqueta: 'próximas a parto' },
});

async function cruzarAnimales(db, args, opciones = {}) {
  const hoy = hoyDe(opciones);
  const rol = opciones.usuario?.rol;
  const criterios = [...new Set(args.criterios)];
  const sinPermiso = criterios.filter((clave) => !tienePermiso(rol, CRITERIOS[clave].recurso, 'leer'));
  if (sinPermiso.length) throw errorPermiso('Tu rol no tiene permiso para consultar parte de esa información.');
  const configuracion = await obtenerConfiguracion();
  const diasParto = Number(configuracion.dias_alerta_parto) || 30;
  const reproduccion = criterios.some((c) => c === 'prenada' || c === 'proxima_parto') ? await conjuntosReproductivos(db, hoy, diasParto) : null;

  const q = parametros();
  const hoyParam = perezoso(q, hoy);
  const usuarioParam = perezoso(q, opciones.usuario?.id);
  const propias = () => (ROLES_TAREAS_PROPIAS.includes(rol) ? ` AND t.usuario_id=${usuarioParam()}` : '');
  const tareaVisible = (extra) => `SELECT 1 FROM asignacion_tarea at JOIN trabajador t ON t.id=at.trabajador_id WHERE at.animal_id=a.id AND at.estado IN ('pendiente','en_progreso')${extra}${propias()}`;
  const ultimaCondicion = '(SELECT x.puntuacion FROM condicion_corporal x WHERE x.animal_id=a.id ORDER BY x.fecha DESC,x.id DESC LIMIT 1)';
  const pesoReciente = (offset) => `(SELECT p.peso_kg FROM pesaje p WHERE p.animal_id=a.id ORDER BY p.fecha DESC,p.id DESC OFFSET ${offset} LIMIT 1)`;
  const predicado = {
    enfermo: () => "a.estado_salud='enfermo'",
    observacion: () => "a.estado_salud='observacion'",
    problema_salud: () => "a.estado_salud IN ('enfermo','observacion')",
    tarea_vencida: () => `EXISTS (${tareaVisible(` AND at.fecha < ${hoyParam()}::date`)})`,
    tarea_pendiente: () => `EXISTS (${tareaVisible('')})`,
    dosis_vencida: () => `EXISTS (SELECT 1 FROM evento_salud es WHERE es.animal_id=a.id AND es.proxima_dosis < ${hoyParam()}::date)`,
    dosis_proxima: () => `EXISTS (SELECT 1 FROM evento_salud es WHERE es.animal_id=a.id AND es.proxima_dosis BETWEEN ${hoyParam()}::date AND ${hoyParam()}::date + ${q.p(Number(configuracion.dias_alerta_vacuna) || 30)}::int)`,
    condicion_baja: () => `${ultimaCondicion} <= ${q.p(CONDICION_DELGADA_MAX)}`,
    bajo_peso: () => `${pesoReciente(0)} < ${pesoReciente(1)}`,
    prenada: () => `a.id=ANY(${q.p(reproduccion.prenadas)}::int[])`,
    proxima_parto: () => `a.id=ANY(${q.p([...reproduccion.partos.keys()])}::int[])`,
  };
  const { condiciones, referencias } = await filtrosAnimal(db, args, q);
  for (const criterio of criterios) condiciones.push(predicado[criterio]());
  const where = condiciones.join(' AND ');

  // Columnas de evidencia por criterio (solo para las filas devueltas).
  const columnas = [];
  if (criterios.some((c) => c === 'tarea_vencida')) columnas.push(`(SELECT COUNT(*) FROM asignacion_tarea at JOIN trabajador t ON t.id=at.trabajador_id WHERE at.animal_id=a.id AND at.estado IN ('pendiente','en_progreso') AND at.fecha < ${hoyParam()}::date${propias()})::int tareas_vencidas`);
  if (criterios.some((c) => c === 'tarea_pendiente')) columnas.push(`(SELECT COUNT(*) FROM asignacion_tarea at JOIN trabajador t ON t.id=at.trabajador_id WHERE at.animal_id=a.id AND at.estado IN ('pendiente','en_progreso')${propias()})::int tareas_pendientes`);
  if (criterios.includes('dosis_vencida')) columnas.push(`(SELECT COUNT(*) FROM evento_salud es WHERE es.animal_id=a.id AND es.proxima_dosis < ${hoyParam()}::date)::int dosis_vencidas`);
  if (criterios.includes('dosis_proxima')) columnas.push(`(SELECT MIN(es.proxima_dosis) FROM evento_salud es WHERE es.animal_id=a.id AND es.proxima_dosis >= ${hoyParam()}::date)::text proxima_dosis`);
  if (criterios.includes('condicion_baja')) columnas.push(`${ultimaCondicion} condicion_corporal`);
  if (criterios.includes('bajo_peso')) columnas.push(`${pesoReciente(1)} peso_anterior,${pesoReciente(0)} peso_reciente`);

  const desde = 'FROM animal a LEFT JOIN corral c ON c.id=a.corral_actual_id';
  const etiqueta = criterios.map((c) => CRITERIOS[c].etiqueta);
  const base = {
    criterios,
    descripcion: etiqueta,
    filtros: { ...(args.sexo ? { sexo: args.sexo } : {}), ...(args.etapa ? { etapa: args.etapa } : {}), ...(referencias.corral ? { corral: referencias.corral.nombre } : {}) },
    criterio: 'Animales vivos que cumplen todos los criterios a la vez. Tareas: solo las ligadas directamente a un animal y visibles para tu rol. Preñez y partos: misma definición que Reproducción.',
  };

  if (args.agrupar_por === 'corral') {
    const contarTareas = criterios.includes('tarea_vencida') || args.ordenar_por === 'tareas';
    const tareasCol = contarTareas ? `,SUM((SELECT COUNT(*) FROM asignacion_tarea at JOIN trabajador t ON t.id=at.trabajador_id WHERE at.animal_id=a.id AND at.estado IN ('pendiente','en_progreso') AND at.fecha < ${hoyParam()}::date${propias()}))::int tareas_vencidas` : '';
    const orden = args.ordenar_por === 'tareas' && contarTareas ? 'tareas_vencidas DESC NULLS LAST,animales DESC' : 'animales DESC';
    const { rows } = await db.query(`SELECT c.id corral_id,COALESCE(c.nombre,'Sin corral') corral,c.capacidad_maxima,COUNT(*)::int animales${tareasCol},
        (SELECT COUNT(*) FROM animal v WHERE v.estado='vivo' AND v.corral_actual_id IS NOT DISTINCT FROM c.id)::int vivos_en_corral
      ${desde} WHERE ${where} GROUP BY c.id,c.nombre,c.capacidad_maxima ORDER BY ${orden},corral LIMIT 25`, q.valores);
    const total = rows.reduce((suma, fila) => suma + fila.animales, 0);
    const clave = args.ordenar_por === 'tareas' && contarTareas ? 'tareas_vencidas' : 'animales';
    const maximo = rows.length ? rows[0][clave] : 0;
    return {
      ...base,
      agrupado_por: 'corral',
      ...(args.ordenar_por ? { ordenar_por: args.ordenar_por } : {}),
      total_animales: total,
      total_corrales: rows.length,
      corrales: rows,
      mayor: rows.filter((fila) => fila[clave] === maximo && maximo > 0).map((fila) => ({ corral: fila.corral, corral_id: fila.corral_id, valor: fila[clave] })),
    };
  }

  // El conteo no usa el LIMIT: se copia la lista de valores antes de agregarlo.
  const valoresConteo = [...q.valores];
  const [conteo, items] = await Promise.all([
    db.query(`SELECT COUNT(*)::int total,COUNT(*) FILTER (WHERE a.sexo='hembra')::int hembras,COUNT(*) FILTER (WHERE a.sexo='macho')::int machos ${desde} WHERE ${where}`, valoresConteo),
    db.query(`SELECT a.id,a.arete_id,a.nombre_alias,a.sexo,a.estado_salud,c.nombre corral${columnas.length ? `,${columnas.join(',')}` : ''}
      ${desde} WHERE ${where} ORDER BY a.arete_id LIMIT ${q.p(args.limite)}`, q.valores),
  ]);
  const fila = conteo.rows[0] || { total: 0 };
  const partos = reproduccion?.partos;
  return {
    ...base,
    total: fila.total,
    hembras: fila.hembras ?? 0,
    machos: fila.machos ?? 0,
    mostrados: items.rows.length,
    truncado: items.rows.length < fila.total,
    items: items.rows.map((animal) => ({ ...animal, ...(partos?.has(animal.id) ? { parto_estimado: partos.get(animal.id) } : {}) })),
  };
}

// ---------------------------------------------------------------------------
// Resumen operativo del día: cada sección solo si el rol puede leerla.
// No incluye finanzas (P9.4) ni opiniones: solo conteos verificables.
async function obtenerResumenOperativo(db, _args, opciones = {}) {
  const hoy = hoyDe(opciones);
  const rol = opciones.usuario?.rol;
  const puede = (recurso) => tienePermiso(rol, recurso, 'leer');
  const configuracion = await obtenerConfiguracion();
  const diasDosis = Number(configuracion.dias_alerta_vacuna) || 30;
  const diasParto = Number(configuracion.dias_alerta_parto) || 30;
  const propias = ROLES_TAREAS_PROPIAS.includes(rol);
  const vacio = Promise.resolve(null);
  const reproduccion = puede('reproduccion') ? await conjuntosReproductivos(db, hoy, diasParto) : null;
  const [animales, tareas, dosis, alertas, calendario, stock, movimientos, atencion] = await Promise.all([
    puede('animales') ? db.query(`SELECT COUNT(*)::int vivos,COUNT(*) FILTER (WHERE estado_salud='enfermo')::int enfermos,
        COUNT(*) FILTER (WHERE estado_salud='observacion')::int en_observacion FROM animal WHERE estado='vivo'`) : vacio,
    puede('asignaciones') ? db.query(`SELECT COUNT(*) FILTER (WHERE at.fecha < $1::date)::int vencidas,COUNT(*) FILTER (WHERE at.fecha = $1::date)::int hoy
        FROM asignacion_tarea at JOIN trabajador t ON t.id=at.trabajador_id
        WHERE at.estado IN ('pendiente','en_progreso')${propias ? ' AND t.usuario_id=$2' : ''}`, propias ? [hoy, opciones.usuario.id] : [hoy]) : vacio,
    puede('salud') ? db.query(`SELECT COUNT(*) FILTER (WHERE es.proxima_dosis < $1::date)::int vencidas,
        COUNT(*) FILTER (WHERE es.proxima_dosis BETWEEN $1::date AND $1::date + $2::int)::int proximas
        FROM evento_salud es JOIN animal a ON a.id=es.animal_id AND a.estado='vivo' WHERE es.proxima_dosis IS NOT NULL`, [hoy, diasDosis]) : vacio,
    puede('alertas') ? consultarAlertas(db, { limite: 25 }, opciones) : vacio,
    puede('calendario') ? obtenerEventosCalendario(db, { desde: hoy, hasta: hoy, usuario: opciones.usuario }) : vacio,
    puede('insumos') ? db.query('SELECT COUNT(*) FILTER (WHERE stock_actual<=0)::int agotados,COUNT(*)::int en_o_bajo_minimo FROM insumo WHERE stock_actual<=stock_minimo') : vacio,
    puede('corrales') ? db.query("SELECT COUNT(*)::int total FROM movimiento_corral WHERE fecha BETWEEN $1::date - 6 AND $1::date", [hoy]) : vacio,
    puede('alertas') ? obtenerAtencion(db, { limite: 1 }, { ...opciones, reproduccion }) : vacio,
  ]);
  const secciones = {};
  if (animales) secciones.animales = animales.rows[0];
  if (tareas) secciones.tareas = tareas.rows[0];
  if (dosis) secciones.dosis = { ...dosis.rows[0], dias_umbral: diasDosis };
  if (alertas) secciones.alertas = { tipos: alertas.total_tipos, por_severidad: alertas.por_severidad };
  if (calendario) {
    secciones.calendario_hoy = { total: calendario.length, por_tipo: calendario.reduce((acc, evento) => ({ ...acc, [evento.tipo]: (acc[evento.tipo] || 0) + 1 }), {}) };
  }
  if (reproduccion) secciones.reproduccion = { prenadas: reproduccion.prenadas.length, partos_proximos: reproduccion.partos.size, dias_umbral: diasParto };
  if (stock) secciones.inventario = stock.rows[0];
  if (movimientos) secciones.movimientos_7_dias = movimientos.rows[0].total;
  if (atencion) secciones.atencion = { animales: atencion.resumen.animales, por_prioridad: atencion.resumen.por_prioridad };
  const omitidas = ['animales', 'asignaciones', 'salud', 'alertas', 'calendario', 'reproduccion', 'insumos', 'corrales'].filter((recurso) => !puede(recurso));
  return {
    fecha: hoy,
    criterio: 'Resumen de registros actuales de El Rancho, sin finanzas ni valoraciones. Las tareas son las visibles para tu rol.',
    secciones,
    ...(omitidas.length ? { secciones_no_autorizadas: omitidas } : {}),
  };
}

module.exports = {
  POLITICA_PRIORIDAD,
  ETIQUETA_MOTIVO,
  CRITERIOS,
  obtenerAtencion,
  cruzarAnimales,
  obtenerResumenOperativo,
};
