const LIMITE_HECHOS = 10001;

function fechaISO(valor) {
  if (!valor) return null;
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return String(valor).slice(0, 10);
}

function sumarDias(fecha, dias) {
  const base = new Date(`${fechaISO(fecha)}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + Number(dias));
  return fechaISO(base);
}

function inicioMes(fecha) { return `${fecha.slice(0, 7)}-01`; }
function finMes(fecha) {
  const [anio, mes] = fecha.split('-').map(Number);
  return fechaISO(new Date(Date.UTC(anio, mes, 0)));
}

function resolverPeriodo(filtros = {}, ahora = new Date()) {
  const asOf = fechaISO(ahora);
  const periodo = filtros.periodo || 'anio_actual';
  if (periodo === 'personalizado') return { clave: periodo, desde: filtros.desde, hasta: filtros.hasta, as_of: asOf };
  if (periodo === 'mes_actual') return { clave: periodo, desde: inicioMes(asOf), hasta: finMes(asOf), as_of: asOf };
  if (periodo === 'ultimos_30_dias') return { clave: periodo, desde: sumarDias(asOf, -29), hasta: asOf, as_of: asOf };
  return { clave: 'anio_actual', desde: `${asOf.slice(0, 4)}-01-01`, hasta: `${asOf.slice(0, 4)}-12-31`, as_of: asOf };
}

function enPeriodo(fecha, periodo) {
  const valor = fechaISO(fecha);
  return Boolean(valor && valor >= periodo.desde && valor <= periodo.hasta);
}

function porcentaje(numerador, denominador) {
  return denominador ? Number(((numerador / denominador) * 100).toFixed(1)) : null;
}

function identidad(ciclo, extra = {}) {
  return {
    animal_id: ciclo.hembra_id,
    arete: ciclo.arete_id,
    animal: ciclo.nombre_alias,
    corral: ciclo.corral,
    ciclo_id: ciclo.id,
    ...extra,
  };
}

function metricaConteo(clave, etiqueta, items, periodo, opciones = {}) {
  return {
    clave,
    etiqueta,
    estado: 'calculable',
    valor: items.length,
    unidad: 'animales',
    numerador: items.length,
    denominador: opciones.denominador ?? null,
    periodo,
    excluidos: opciones.excluidos || 0,
    completitud: opciones.completitud || { porcentaje: 100, incluidos: items.length, total: items.length },
    advertencias: opciones.advertencias || [],
    items,
  };
}

function metricaTasa(clave, etiqueta, numerador, denominador, items, periodo, opciones = {}) {
  const calculable = denominador > 0;
  return {
    clave,
    etiqueta,
    estado: calculable ? 'calculable' : 'datos_insuficientes',
    valor: calculable ? porcentaje(numerador, denominador) : null,
    unidad: 'porcentaje',
    numerador,
    denominador,
    periodo,
    excluidos: opciones.excluidos || 0,
    completitud: opciones.completitud || { porcentaje: 100, incluidos: denominador, total: denominador },
    advertencias: calculable ? (opciones.advertencias || []) : ['No hay diagnósticos definitivos suficientes en el periodo.'],
    items,
  };
}

async function cargarHechos(client, filtros) {
  const params = [
    filtros.corral_id || null,
    filtros.toro_id || null,
    filtros.animal_id || null,
    filtros.tipo_servicio || null,
  ];
  const ciclos = (await client.query(`
    SELECT cr.*, a.arete_id, a.nombre_alias, a.estado AS animal_estado, a.sexo,
           a.categoria, a.corral_actual_id, c.nombre AS corral
    FROM ciclo_reproductivo cr
    JOIN animal a ON a.id=cr.hembra_id
    LEFT JOIN corral c ON c.id=a.corral_actual_id
    WHERE ($1::int IS NULL OR a.corral_actual_id=$1)
      AND ($2::int IS NULL OR EXISTS (
        SELECT 1 FROM servicio_reproductivo sx WHERE sx.ciclo_id=cr.id AND sx.macho_id=$2
      ))
      AND ($3::int IS NULL OR a.id=$3)
      AND ($4::text IS NULL OR EXISTS (
        SELECT 1 FROM servicio_reproductivo st WHERE st.ciclo_id=cr.id AND st.tipo=$4
      ))
    ORDER BY cr.fecha_inicio DESC, cr.id DESC
    LIMIT ${LIMITE_HECHOS}
  `, params)).rows;
  if (!ciclos.length) return { ciclos: [], servicios: [], diagnosticos: [], partos: [], crias: [], truncado: false };
  const ids = ciclos.map((fila) => fila.id);
  const [servicios, diagnosticos, partos, crias] = await Promise.all([
    client.query(`SELECT sr.*, m.arete_id AS macho_arete, m.nombre_alias AS macho_nombre, m.estado AS macho_estado
      FROM servicio_reproductivo sr LEFT JOIN animal m ON m.id=sr.macho_id
      WHERE sr.ciclo_id=ANY($1::int[]) ORDER BY sr.fecha,sr.id LIMIT ${LIMITE_HECHOS}`, [ids]),
    client.query(`SELECT * FROM diagnostico_gestacion
      WHERE ciclo_id=ANY($1::int[]) ORDER BY fecha,id LIMIT ${LIMITE_HECHOS}`, [ids]),
    client.query(`SELECT * FROM parto_reproductivo
      WHERE ciclo_id=ANY($1::int[]) ORDER BY fecha_real,id LIMIT ${LIMITE_HECHOS}`, [ids]),
    client.query(`SELECT pc.*, pr.ciclo_id FROM parto_cria pc JOIN parto_reproductivo pr ON pr.id=pc.parto_id
      WHERE pr.ciclo_id=ANY($1::int[]) ORDER BY pc.id LIMIT ${LIMITE_HECHOS}`, [ids]),
  ]);
  return {
    ciclos,
    servicios: servicios.rows,
    diagnosticos: diagnosticos.rows,
    partos: partos.rows,
    crias: crias.rows,
    truncado: [ciclos, servicios.rows, diagnosticos.rows, partos.rows, crias.rows].some((lista) => lista.length >= LIMITE_HECHOS),
  };
}

function indexar(hechos) {
  const servicios = new Map();
  const diagnosticos = new Map();
  const diagnosticosPorServicio = new Map();
  const partos = new Map();
  const crias = new Map();
  const servicioPorId = new Map();
  for (const servicio of hechos.servicios) {
    servicioPorId.set(servicio.id, servicio);
    if (!servicios.has(servicio.ciclo_id)) servicios.set(servicio.ciclo_id, []);
    servicios.get(servicio.ciclo_id).push(servicio);
  }
  for (const diagnostico of hechos.diagnosticos) {
    if (!diagnosticos.has(diagnostico.ciclo_id)) diagnosticos.set(diagnostico.ciclo_id, []);
    diagnosticos.get(diagnostico.ciclo_id).push(diagnostico);
    if (diagnostico.servicio_id) {
      if (!diagnosticosPorServicio.has(diagnostico.servicio_id)) diagnosticosPorServicio.set(diagnostico.servicio_id, []);
      diagnosticosPorServicio.get(diagnostico.servicio_id).push(diagnostico);
    }
  }
  for (const parto of hechos.partos) partos.set(parto.ciclo_id, parto);
  for (const cria of hechos.crias) crias.set(cria.ciclo_id, (crias.get(cria.ciclo_id) || 0) + 1);
  return { servicios, diagnosticos, diagnosticosPorServicio, partos, crias, servicioPorId };
}

function ultimo(lista = []) { return lista.at(-1) || null; }
function ultimoDefinitivo(lista = []) { return [...lista].reverse().find((d) => ['prenada', 'vacia'].includes(d.resultado)) || null; }

function estadoCiclo(ciclo, hechos, configuracion, periodo) {
  if (ciclo.fecha_cierre) return ciclo.resultado_final || 'cerrado_otro';
  const diagnosticos = hechos.diagnosticos.get(ciclo.id) || [];
  const diagnostico = ultimo(diagnosticos);
  if (diagnostico?.resultado === 'dudoso') return 'requiere_revision';
  if (diagnostico?.resultado === 'vacia') return 'vacia';
  if (diagnostico?.resultado === 'prenada') {
    const servicio = hechos.servicioPorId.get(diagnostico.servicio_id);
    const estimada = servicio && (fechaISO(servicio.fecha_parto_estimada_ajustada) || sumarDias(servicio.fecha, configuracion.dias_gestacion));
    return estimada && estimada >= periodo.as_of && estimada <= periodo.hasta ? 'proxima_parto' : 'prenada';
  }
  const servicio = ultimo(hechos.servicios.get(ciclo.id) || []);
  return servicio && sumarDias(servicio.fecha, configuracion.dias_espera) <= periodo.as_of ? 'pendiente_diagnostico' : 'servida';
}

function prepararCiclos(hechosCrudos, hechos, configuracion, periodo, filtros) {
  const ultimoPorAnimal = new Map();
  for (const ciclo of hechosCrudos.ciclos) if (!ultimoPorAnimal.has(ciclo.hembra_id)) ultimoPorAnimal.set(ciclo.hembra_id, ciclo);
  for (const ciclo of hechosCrudos.ciclos) ciclo.estado_reproductivo = estadoCiclo(ciclo, hechos, configuracion, periodo);
  let ciclos = hechosCrudos.ciclos;
  if (filtros.estado_reproductivo) {
    const animales = new Set([...ultimoPorAnimal.values()].filter((c) => c.estado_reproductivo === filtros.estado_reproductivo).map((c) => c.hembra_id));
    ciclos = ciclos.filter((c) => animales.has(c.hembra_id));
  }
  const idsIncluidos = new Set(ciclos.map((c) => c.id));
  return { ciclos, actuales: [...ultimoPorAnimal.values()].filter((c) => idsIncluidos.has(c.id)) };
}

function calcularMetricas(hechosCrudos, filtros, periodo, configuracion) {
  const hechos = indexar(hechosCrudos);
  const { ciclos, actuales } = prepararCiclos(hechosCrudos, hechos, configuracion, periodo, filtros);
  const ids = new Set(ciclos.map((c) => c.id));
  const cicloPorId = new Map(ciclos.map((c) => [c.id, c]));
  const servicioCoincide = (servicio) => Boolean(servicio
    && (!filtros.toro_id || servicio.macho_id === filtros.toro_id)
    && (!filtros.tipo_servicio || servicio.tipo === filtros.tipo_servicio));
  const actualesOperables = actuales.filter((c) => c.animal_estado === 'vivo' && c.sexo === 'hembra');
  const porEstado = (estado) => actualesOperables.filter((c) => c.estado_reproductivo === estado).map((c) => identidad(c, { estado_reproductivo: estado }));

  const prenadas = porEstado('prenada').concat(porEstado('proxima_parto'));
  const vacias = porEstado('vacia');
  const pendientes = porEstado('pendiente_diagnostico');
  const revision = porEstado('requiere_revision');
  const proximos = [];
  for (const ciclo of actualesOperables) {
    if (ciclo.fecha_cierre) continue;
    const diagnostico = ultimo(hechos.diagnosticos.get(ciclo.id) || []);
    if (diagnostico?.resultado !== 'prenada') continue;
    const servicio = hechos.servicioPorId.get(diagnostico.servicio_id);
    if (!servicio) continue;
    const estimada = fechaISO(servicio.fecha_parto_estimada_ajustada) || sumarDias(servicio.fecha, configuracion.dias_gestacion);
    if (enPeriodo(estimada, periodo)) proximos.push(identidad(ciclo, { fecha: estimada, servicio_id: servicio.id }));
  }

  const partosPeriodo = hechosCrudos.partos.filter((p) => ids.has(p.ciclo_id) && p.resultado === 'parto' && enPeriodo(p.fecha_real, periodo));
  const partosItems = partosPeriodo.map((p) => {
    const ciclo = cicloPorId.get(p.ciclo_id);
    return identidad(ciclo, { fecha: fechaISO(p.fecha_real), parto_id: p.id, crias: hechos.crias.get(ciclo.id) || 0 });
  });
  const totalCrias = partosItems.reduce((suma, item) => suma + item.crias, 0);

  const definitivos = ciclos.map((ciclo) => ({ ciclo, diagnostico: ultimoDefinitivo(hechos.diagnosticos.get(ciclo.id) || []) }))
    .filter(({ diagnostico }) => diagnostico && enPeriodo(diagnostico.fecha, periodo)
      && ((!filtros.toro_id && !filtros.tipo_servicio) || servicioCoincide(hechos.servicioPorId.get(diagnostico.servicio_id))));
  const positivos = definitivos.filter(({ diagnostico }) => diagnostico.resultado === 'prenada');
  const tasaItems = positivos.map(({ ciclo, diagnostico }) => identidad(ciclo, { fecha: fechaISO(diagnostico.fecha), diagnostico_id: diagnostico.id }));
  const dudososPeriodo = hechosCrudos.diagnosticos.filter((d) => ids.has(d.ciclo_id) && d.resultado === 'dudoso' && enPeriodo(d.fecha, periodo)).length;

  const concepciones = [];
  for (const { ciclo, diagnostico } of positivos) {
    const vinculado = hechos.servicioPorId.get(diagnostico.servicio_id);
    if (!vinculado || vinculado.ciclo_id !== ciclo.id) continue;
    const cantidad = (hechos.servicios.get(ciclo.id) || []).filter((s) => fechaISO(s.fecha) <= fechaISO(diagnostico.fecha)).length;
    concepciones.push(identidad(ciclo, { fecha: fechaISO(diagnostico.fecha), servicio_id: vinculado.id, servicios: cantidad }));
  }
  const promedioServicios = concepciones.length
    ? Number((concepciones.reduce((s, item) => s + item.servicios, 0) / concepciones.length).toFixed(2)) : null;

  const nacimientosPorAnimal = new Map();
  for (const parto of hechosCrudos.partos.filter((p) => p.resultado === 'parto' && ids.has(p.ciclo_id))) {
    const ciclo = ciclos.find((c) => c.id === parto.ciclo_id);
    if (!nacimientosPorAnimal.has(ciclo.hembra_id)) nacimientosPorAnimal.set(ciclo.hembra_id, { ciclo, fechas: [] });
    nacimientosPorAnimal.get(ciclo.hembra_id).fechas.push(fechaISO(parto.fecha_real));
  }
  const intervalos = [];
  let animalesConUnParto = 0;
  for (const { ciclo, fechas } of nacimientosPorAnimal.values()) {
    fechas.sort();
    if (fechas.length < 2) { animalesConUnParto += 1; continue; }
    for (let i = 1; i < fechas.length; i += 1) {
      if (!enPeriodo(fechas[i], periodo)) continue;
      const dias = Math.round((new Date(`${fechas[i]}T00:00:00Z`) - new Date(`${fechas[i - 1]}T00:00:00Z`)) / 86400000);
      intervalos.push(identidad(ciclo, { fecha: fechas[i], fecha_anterior: fechas[i - 1], dias }));
    }
  }
  const promedioIntervalo = intervalos.length ? Math.round(intervalos.reduce((s, i) => s + i.dias, 0) / intervalos.length) : null;

  const perdidasPeriodo = hechosCrudos.partos.filter((p) => ids.has(p.ciclo_id) && ['aborto', 'perdida'].includes(p.resultado) && enPeriodo(p.fecha_real, periodo));
  const perdidasItems = perdidasPeriodo.map((p) => {
    const ciclo = cicloPorId.get(p.ciclo_id);
    return identidad(ciclo, { fecha: fechaISO(p.fecha_real), tipo: p.resultado, parto_id: p.id });
  });
  const abortos = perdidasItems.filter((p) => p.tipo === 'aborto');
  const perdidas = perdidasItems.filter((p) => p.tipo === 'perdida');
  const perdidasAtribuibles = perdidasPeriodo.filter((p) => (hechos.diagnosticos.get(p.ciclo_id) || [])
    .some((d) => d.resultado === 'prenada' && fechaISO(d.fecha) <= fechaISO(p.fecha_real)));
  const otrosCierres = ciclos.filter((c) => c.resultado_final === 'cerrado_otro' && enPeriodo(c.fecha_cierre, periodo))
    .map((c) => identidad(c, { fecha: fechaISO(c.fecha_cierre), tipo: 'cerrado_otro' }));

  const serviciosPeriodo = hechosCrudos.servicios.filter((s) => ids.has(s.ciclo_id) && enPeriodo(s.fecha, periodo) && servicioCoincide(s));
  const serviciosConToro = serviciosPeriodo.filter((s) => s.macho_id);
  const gestacionesConToro = positivos.filter(({ diagnostico }) => hechos.servicioPorId.get(diagnostico.servicio_id)?.macho_id);
  const advertenciasGlobales = [];
  if (hechosCrudos.truncado) advertenciasGlobales.push('El volumen excede el límite de seguridad; ajusta los filtros para obtener cifras completas.');
  if (filtros.corral_id) advertenciasGlobales.push('El filtro de corral usa el corral actual del animal; el modelo no registra el corral histórico del servicio.');
  const serviciosItems = serviciosPeriodo.map((servicio) => {
    const ciclo = cicloPorId.get(servicio.ciclo_id);
    return identidad(ciclo, {
      fecha: fechaISO(servicio.fecha), servicio_id: servicio.id, tipo_servicio: servicio.tipo,
      toro_id: servicio.macho_id, toro_arete: servicio.macho_arete,
    });
  });

  const metricas = {
    prenadas: metricaConteo('prenadas', 'Preñadas confirmadas', prenadas, periodo),
    vacias: metricaConteo('vacias', 'Vacías', vacias, periodo),
    pendientes: metricaConteo('pendientes', 'Pendientes de diagnóstico', pendientes, periodo),
    revision: metricaConteo('revision', 'Requieren revisión', revision, periodo),
    servicios: { ...metricaConteo('servicios', 'Servicios registrados', serviciosItems, periodo), unidad: 'servicios' },
    proximos_partos: metricaConteo('proximos_partos', 'Partos estimados en el periodo', proximos, periodo),
    partos: {
      ...metricaConteo('partos', 'Partos reales', partosItems, periodo),
      unidad: 'partos',
      crias: totalCrias,
    },
    tasa_prenez: metricaTasa('tasa_prenez', 'Tasa de preñez', positivos.length, definitivos.length, tasaItems, periodo, {
      excluidos: dudososPeriodo,
      advertencias: dudososPeriodo ? [`${dudososPeriodo} diagnóstico(s) dudoso(s) no forman parte del denominador.`] : [],
    }),
    servicios_por_concepcion: {
      clave: 'servicios_por_concepcion', etiqueta: 'Servicios por concepción',
      estado: concepciones.length ? 'calculable' : 'datos_insuficientes', valor: promedioServicios, unidad: 'servicios',
      numerador: concepciones.reduce((s, item) => s + item.servicios, 0), denominador: concepciones.length,
      periodo, excluidos: positivos.length - concepciones.length,
      completitud: { porcentaje: porcentaje(concepciones.length, positivos.length), incluidos: concepciones.length, total: positivos.length },
      advertencias: concepciones.length ? [] : ['No hay gestaciones con un servicio de concepción identificable.'], items: concepciones,
    },
    intervalo_partos: {
      clave: 'intervalo_partos', etiqueta: 'Intervalo entre partos',
      estado: intervalos.length ? 'calculable' : 'datos_insuficientes', valor: promedioIntervalo, unidad: 'días',
      numerador: intervalos.reduce((s, item) => s + item.dias, 0), denominador: intervalos.length,
      periodo, excluidos: animalesConUnParto,
      completitud: { porcentaje: porcentaje(intervalos.length, intervalos.length + animalesConUnParto), incluidos: intervalos.length, total: intervalos.length + animalesConUnParto },
      advertencias: intervalos.length ? [] : ['Se necesitan al menos dos partos válidos de una misma hembra.'], items: intervalos,
    },
    perdidas: {
      ...metricaConteo('perdidas', 'Pérdidas reproductivas', perdidasItems, periodo, { denominador: positivos.length }),
      unidad: 'eventos', abortos: abortos.length, perdidas: perdidas.length, otros_cierres: otrosCierres.length,
      proporcion_gestaciones_confirmadas: porcentaje(perdidasAtribuibles.length, positivos.length),
      perdidas_atribuibles: perdidasAtribuibles.length,
      advertencias: positivos.length
        ? (perdidasAtribuibles.length < perdidasItems.length ? ['Hay pérdidas históricas sin diagnóstico positivo atribuible; cuentan como eventos, no en la proporción.'] : [])
        : ['No se calcula proporción porque no hay gestaciones confirmadas en el periodo.'],
    },
  };
  return {
    as_of: periodo.as_of,
    filters: { ...filtros, periodo: periodo.clave, desde: periodo.desde, hasta: periodo.hasta },
    total: actualesOperables.length,
    metrics: metricas,
    attribution: {
      servicios_con_toro: { numerador: serviciosConToro.length, denominador: serviciosPeriodo.length, porcentaje: porcentaje(serviciosConToro.length, serviciosPeriodo.length), sin_atribuir: serviciosPeriodo.length - serviciosConToro.length },
      gestaciones_con_servicio_y_toro: { numerador: gestacionesConToro.length, denominador: positivos.length, porcentaje: porcentaje(gestacionesConToro.length, positivos.length), sin_atribuir: positivos.length - gestacionesConToro.length },
    },
    has_more: hechosCrudos.truncado,
    completeness: { complete: !hechosCrudos.truncado, warnings: advertenciasGlobales },
    warnings: advertenciasGlobales,
  };
}

async function configuracionAnalitica(client) {
  const { rows } = await client.query(`SELECT clave,valor FROM configuracion
    WHERE clave IN ('dias_gestacion_bovina','dias_espera_diagnostico_gestacion')`);
  const mapa = Object.fromEntries(rows.map((r) => [r.clave, Number(r.valor)]));
  return { dias_gestacion: mapa.dias_gestacion_bovina || 283, dias_espera: mapa.dias_espera_diagnostico_gestacion || 35 };
}

async function obtenerResumenAnalitico(client, filtros, opciones = {}) {
  const periodo = resolverPeriodo(filtros, opciones.ahora || new Date());
  const [hechos, configuracion] = await Promise.all([cargarHechos(client, filtros), configuracionAnalitica(client)]);
  return calcularMetricas(hechos, filtros, periodo, configuracion);
}

function paginar(items, pagina, limite) {
  const inicio = (pagina - 1) * limite;
  return { items: items.slice(inicio, inicio + limite), has_more: inicio + limite < items.length };
}

async function obtenerDetalleMetrica(client, filtros, metrica, pagina = 1, limite = 50, opciones = {}) {
  const resumen = await obtenerResumenAnalitico(client, filtros, opciones);
  const dato = resumen.metrics[metrica];
  if (!dato) return null;
  const lista = paginar(dato.items || [], pagina, limite);
  return {
    as_of: resumen.as_of, filters: resumen.filters, metric: { ...dato, items: undefined },
    total: dato.items?.length || 0, items: lista.items, has_more: lista.has_more,
    completeness: dato.completitud, warnings: dato.advertencias,
  };
}

function construirSementales(hechosCrudos, periodo) {
  const hechos = indexar(hechosCrudos);
  const ciclos = new Map(hechosCrudos.ciclos.map((c) => [c.id, c]));
  const perfiles = new Map();
  const asegurar = (servicio) => {
    if (!servicio.macho_id) return null;
    if (!perfiles.has(servicio.macho_id)) perfiles.set(servicio.macho_id, {
      id: servicio.macho_id, arete: servicio.macho_arete, nombre: servicio.macho_nombre, estado: servicio.macho_estado,
      servicios: 0, vacas: new Set(), positivos: 0, negativos: 0, dudosos: 0,
      partos: new Set(), crias: 0, servicios_con_diagnostico: 0, servicios_sin_resultado: 0, historial: [],
    });
    return perfiles.get(servicio.macho_id);
  };
  const serviciosPeriodo = hechosCrudos.servicios.filter((s) => enPeriodo(s.fecha, periodo));
  for (const servicio of serviciosPeriodo) {
    const perfil = asegurar(servicio);
    if (!perfil) continue;
    const ciclo = ciclos.get(servicio.ciclo_id);
    perfil.servicios += 1; perfil.vacas.add(ciclo.hembra_id);
    const diagnosticos = (hechos.diagnosticosPorServicio.get(servicio.id) || []).filter((d) => enPeriodo(d.fecha, periodo));
    if (diagnosticos.length) perfil.servicios_con_diagnostico += 1;
    else perfil.servicios_sin_resultado += 1;
    for (const d of diagnosticos) {
      if (d.resultado === 'prenada') perfil.positivos += 1;
      else if (d.resultado === 'vacia') perfil.negativos += 1;
      else perfil.dudosos += 1;
    }
    const parto = hechos.partos.get(servicio.ciclo_id);
    const positivo = diagnosticos.some((d) => d.resultado === 'prenada');
    let partoAgregado = false;
    if (parto?.resultado === 'parto' && positivo && enPeriodo(parto.fecha_real, periodo) && !perfil.partos.has(parto.id)) {
      perfil.partos.add(parto.id); perfil.crias += hechos.crias.get(servicio.ciclo_id) || 0; partoAgregado = true;
    }
    perfil.historial.push({ fecha: fechaISO(servicio.fecha), ciclo_id: servicio.ciclo_id, animal_id: ciclo.hembra_id, arete_vaca: ciclo.arete_id, evento: 'servicio', tipo: servicio.tipo });
    for (const d of diagnosticos) perfil.historial.push({ fecha: fechaISO(d.fecha), ciclo_id: servicio.ciclo_id, animal_id: ciclo.hembra_id, arete_vaca: ciclo.arete_id, evento: 'diagnostico', resultado: d.resultado });
    if (partoAgregado) perfil.historial.push({ fecha: fechaISO(parto.fecha_real), ciclo_id: servicio.ciclo_id, animal_id: ciclo.hembra_id, arete_vaca: ciclo.arete_id, evento: 'parto', resultado: parto.resultado });
  }
  return [...perfiles.values()].map((p) => ({
    id: p.id, arete: p.arete, nombre: p.nombre, estado: p.estado, servicios: p.servicios, vacas_distintas: p.vacas.size,
    diagnosticos_positivos: p.positivos, diagnosticos_negativos: p.negativos, diagnosticos_dudosos: p.dudosos,
    partos: p.partos.size, crias: p.crias, servicios_sin_resultado: p.servicios_sin_resultado,
    porcentaje_prenez: porcentaje(p.positivos, p.positivos + p.negativos),
    completitud: { porcentaje: porcentaje(p.servicios_con_diagnostico, p.servicios), con_diagnostico: p.servicios_con_diagnostico, servicios: p.servicios },
    historial: p.historial.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))),
  })).sort((a, b) => String(a.arete).localeCompare(String(b.arete)));
}

async function listarSementales(client, filtros, opciones = {}) {
  const periodo = resolverPeriodo(filtros, opciones.ahora || new Date());
  const hechos = await cargarHechos(client, filtros);
  let items = construirSementales(hechos, periodo);
  if (filtros.toro_id) items = items.filter((item) => item.id === filtros.toro_id);
  return {
    as_of: periodo.as_of, filters: { ...filtros, periodo: periodo.clave, desde: periodo.desde, hasta: periodo.hasta },
    total: items.length, items, has_more: hechos.truncado,
    completeness: { complete: !hechos.truncado },
    warnings: hechos.truncado ? ['Ajusta los filtros para completar el perfil de sementales.'] : [],
  };
}

module.exports = {
  resolverPeriodo,
  obtenerResumenAnalitico,
  obtenerDetalleMetrica,
  listarSementales,
};
