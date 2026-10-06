export const SEVERIDADES_ALERTA = Object.freeze({
  critica: { label: 'Crítica', orden: 0 },
  advertencia: { label: 'Advertencia', orden: 1 },
  info: { label: 'Información', orden: 2 },
});

export const CATEGORIAS_ALERTA = Object.freeze([
  { id: 'sanidad', label: 'Sanidad', descripcion: 'Animales, vacunas y planes sanitarios.' },
  { id: 'reproduccion', label: 'Reproducción', descripcion: 'Partos próximos o pendientes de confirmar.' },
  { id: 'inventario', label: 'Inventario', descripcion: 'Existencias que pueden afectar el trabajo diario.' },
  { id: 'corrales', label: 'Corrales', descripcion: 'Ocupación, salud y pesajes por corral.' },
  { id: 'trabajo', label: 'Tareas', descripcion: 'Trabajo operativo todavía pendiente.' },
  { id: 'hato', label: 'Hato', descripcion: 'Indicadores generales que conviene vigilar.' },
]);

function fechaLocal(fecha) {
  if (!fecha) return null;
  const valor = String(fecha).slice(0, 10);
  const [anio, mes, dia] = valor.split('-').map(Number);
  return new Date(anio, mes - 1, dia);
}

export function formatearFechaAlerta(fecha) {
  const valor = fechaLocal(fecha);
  return valor ? valor.toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' }) : 'Sin fecha';
}

export function describirFechaAlerta(fecha, referencia = new Date()) {
  const hoy = new Date(referencia); hoy.setHours(0, 0, 0, 0);
  const valor = fechaLocal(fecha);
  if (!valor) return 'sin fecha registrada';
  const dias = Math.round((valor - hoy) / 86400000);
  if (dias === 0) return 'hoy';
  if (dias === 1) return 'mañana';
  if (dias === -1) return 'ayer';
  if (dias < 0) return `hace ${-dias} días`;
  if (dias <= 30) return `dentro de ${dias} días`;
  return `el ${formatearFechaAlerta(fecha)}`;
}

function accionAnimal(id, etiqueta = 'Ver animal') {
  return id ? { tipo: 'animal', id, etiqueta } : null;
}

function accionVista(vista, etiqueta, contexto) {
  return { tipo: 'vista', vista, etiqueta, contexto };
}

export function construirAlertas(datos, referencia = new Date()) {
  const {
    vacunas = [], stock = [], hato = {}, partos = [], enfermos = [],
    observacion = [], corrales = [], resumen = {},
  } = datos || {};
  const hoy = new Date(referencia); hoy.setHours(0, 0, 0, 0);
  const alertas = [];

  vacunas.forEach((vacuna) => {
    const fechaDosis = fechaLocal(vacuna.proxima_dosis);
    const vencida = Boolean(fechaDosis && fechaDosis < hoy);
    alertas.push({
      id: `vacuna-${vacuna.id}`,
      categoria: 'sanidad', severidad: vencida ? 'critica' : 'advertencia',
      tipo: vencida ? 'Vacuna vencida' : 'Vacuna próxima',
      entidad: `Animal ${vacuna.arete_id}`,
      titulo: vencida ? `Aplicar ${vacuna.tipo} pendiente` : `Preparar ${vacuna.tipo}`,
      contexto: vencida
        ? `La siguiente dosis venció ${describirFechaAlerta(vacuna.proxima_dosis, hoy)}.`
        : `La siguiente dosis está programada ${describirFechaAlerta(vacuna.proxima_dosis, hoy)}.`,
      accion: accionAnimal(vacuna.animal_id),
    });
  });

  partos.forEach((parto) => {
    const fechaParto = fechaLocal(parto.fecha_parto_estimada);
    const vencido = Boolean(fechaParto && fechaParto < hoy);
    alertas.push({
      id: `parto-${parto.id || parto.madre_id}-${parto.fecha_parto_estimada}`,
      categoria: 'reproduccion', severidad: vencido ? 'critica' : 'advertencia',
      tipo: vencido ? 'Parto por confirmar' : 'Parto próximo',
      entidad: `Animal ${parto.madre_arete}`,
      titulo: vencido ? 'Verificar y registrar el parto' : 'Preparar seguimiento del parto',
      contexto: `Fecha estimada: ${describirFechaAlerta(parto.fecha_parto_estimada, hoy)}.`,
      accion: accionAnimal(parto.madre_id),
    });
  });

  enfermos.forEach((animal) => alertas.push({
    id: `enfermo-${animal.id}`, categoria: 'sanidad', severidad: 'critica',
    tipo: 'Estado de salud', entidad: `Animal ${animal.arete_id}`,
    titulo: 'Requiere revisión veterinaria',
    contexto: animal.nombre_alias ? `${animal.nombre_alias} figura con estado de salud enfermo.` : 'El animal figura con estado de salud enfermo.',
    accion: accionAnimal(animal.id, 'Ver animal'),
  }));

  observacion.forEach((animal) => alertas.push({
    id: `observacion-${animal.id}`, categoria: 'sanidad', severidad: 'advertencia',
    tipo: 'Seguimiento de salud', entidad: `Animal ${animal.arete_id}`,
    titulo: 'Dar seguimiento a la observación',
    contexto: animal.nombre_alias ? `${animal.nombre_alias} está marcado para revisión.` : 'El animal está marcado para revisión.',
    accion: accionAnimal(animal.id, 'Ver animal'),
  }));

  stock.forEach((insumo) => {
    const agotado = Number(insumo.stock_actual) === 0;
    alertas.push({
      id: `stock-${insumo.id}`, categoria: 'inventario', severidad: agotado ? 'critica' : 'advertencia',
      tipo: agotado ? 'Insumo agotado' : 'Stock bajo', entidad: insumo.nombre,
      titulo: agotado ? 'Reponer existencias' : 'Revisar próxima compra',
      contexto: `${insumo.stock_actual} de ${insumo.stock_minimo} ${insumo.unidad_medida} disponibles respecto al mínimo.`,
      accion: accionVista('insumos', 'Ver inventario', { insumo: insumo.id }),
    });
  });

  corrales.forEach((corral) => {
    const capacidad = Number(corral.capacidad_maxima);
    const ocupacion = Number(corral.ocupacion_actual);
    const porcentaje = capacidad > 0 ? (ocupacion / capacidad) * 100 : 0;
    if (porcentaje >= 90) alertas.push({
      id: `corral-capacidad-${corral.id}`, categoria: 'corrales', severidad: 'advertencia',
      tipo: 'Capacidad de corral', entidad: corral.nombre,
      titulo: 'Revisar espacio disponible', contexto: `${ocupacion} de ${capacidad} lugares ocupados.`,
      accion: accionVista('corrales', 'Ver corral', { corral: corral.id }),
    });
    if (Number(corral.enfermos) > 0) alertas.push({
      id: `corral-salud-${corral.id}`, categoria: 'corrales', severidad: 'critica',
      tipo: 'Salud en corral', entidad: corral.nombre,
      titulo: 'Revisar animales enfermos', contexto: `${corral.enfermos} animal(es) enfermo(s) en este corral.`,
      accion: accionVista('corrales', 'Ver corral', { corral: corral.id }),
    });
  });

  for (const pesaje of hato?.pesajes_atrasados || []) alertas.push({
    id: `pesaje-${pesaje.corral_id}`, categoria: 'corrales', severidad: 'advertencia',
    tipo: 'Pesajes atrasados', entidad: pesaje.corral,
    titulo: 'Programar jornada de pesaje',
    contexto: `${pesaje.atrasados} de ${pesaje.total_corral} animal(es) no tienen un pesaje reciente.`,
    accion: accionVista('pesajes', 'Ver pesajes', { corral: pesaje.corral_id }),
  });

  (hato?.clusters || []).forEach((cluster) => {
    const afectados = cluster.animales.filter((animal) => ['enfermo', 'observacion'].includes(animal.estado_salud));
    alertas.push({
      id: `brote-${cluster.animal_ids.slice().sort((a, b) => a - b).join('-')}`,
      categoria: 'sanidad', severidad: 'critica', tipo: 'Posible brote',
      entidad: cluster.corrales.join(', ') || 'Corrales sin identificar',
      titulo: 'Revisar grupo de contacto',
      contexto: `${afectados.length} animal(es) afectados dentro de un grupo de ${cluster.animales.length}.`,
      accion: accionAnimal(afectados[0]?.id, 'Ver animal afectado'),
      detalle: { tipo: 'cluster', animales: cluster.animales, animalAnclaId: afectados[0]?.id || cluster.animales[0]?.id },
    });
  });

  if (hato?.mortalidad) {
    const { mes_actual: actual, mes_anterior: anterior } = hato.mortalidad;
    const subio = anterior > 0 && actual > anterior;
    alertas.push({
      id: 'mortalidad-mensual', categoria: 'hato', severidad: subio ? 'advertencia' : 'info',
      tipo: 'Mortalidad mensual', entidad: 'Hato completo',
      titulo: subio ? 'Revisar el aumento de mortalidad' : 'Mortalidad sin aumento',
      contexto: `${actual} este mes y ${anterior} el mes anterior${actual === anterior ? '; sin cambio.' : actual < anterior ? '; disminuyó.' : '; aumentó.'}`,
      accion: null,
    });
  }

  if (Number(resumen.plan_sanitario_pendiente) > 0) alertas.push({
    id: 'plan-sanitario-pendiente', categoria: 'sanidad', severidad: 'advertencia',
    tipo: 'Plan sanitario', entidad: 'Hato', titulo: 'Revisar actividades sanitarias',
    contexto: `${resumen.plan_sanitario_pendiente} actividad(es) están pendientes o vencidas.`,
    accion: accionVista('planes-sanitarios', 'Ver plan sanitario'),
  });
  if (Number(resumen.tareas_pendientes) > 0) alertas.push({
    id: 'tareas-pendientes', categoria: 'trabajo', severidad: 'info',
    tipo: 'Trabajo pendiente', entidad: 'Equipo del rancho', titulo: 'Revisar tareas asignadas',
    contexto: `${resumen.tareas_pendientes} tarea(s) continúan pendientes.`,
    accion: accionVista('tareas', 'Abrir tareas'),
  });

  return alertas.sort((a, b) => (
    SEVERIDADES_ALERTA[a.severidad].orden - SEVERIDADES_ALERTA[b.severidad].orden
    || a.categoria.localeCompare(b.categoria)
    || a.id.localeCompare(b.id)
  ));
}

export function resumirAlertas(alertas) {
  return alertas.reduce((resumen, alerta) => {
    resumen.total += 1;
    resumen[alerta.severidad] += 1;
    resumen.categorias[alerta.categoria] = (resumen.categorias[alerta.categoria] || 0) + 1;
    return resumen;
  }, { total: 0, critica: 0, advertencia: 0, info: 0, categorias: {} });
}

export function obtenerAtencionInmediata(alertas, limite = 4) {
  return alertas.filter((alerta) => alerta.severidad !== 'info').slice(0, limite);
}
