const ESTADOS_GESTANTES = new Set(['prenada', 'proxima_parto']);

export const ESTADO_REPRODUCTIVO_LABEL = Object.freeze({
  disponible: 'Disponible', servida: 'Servida', pendiente_diagnostico: 'Pendiente de diagnóstico',
  requiere_revision: 'Requiere revisión', prenada: 'Preñada', proxima_parto: 'Próxima a parto',
  vacia: 'Vacía', parida: 'Parida', perdida_aborto: 'Pérdida/aborto', cerrado: 'Ciclo cerrado',
});

export const ACCION_REPRODUCTIVA = Object.freeze({
  servicio: { id: 'servicio', etiqueta: 'Registrar servicio' },
  diagnostico: { id: 'diagnostico', etiqueta: 'Registrar diagnóstico' },
  revision: { id: 'diagnostico', etiqueta: 'Registrar revisión' },
  parto: { id: 'parto', etiqueta: 'Registrar parto o incidencia' },
  seguimiento: { id: 'seguimiento', etiqueta: 'Ver seguimiento' },
});

export function accionParaEstado(codigo) {
  if (codigo === 'servida' || codigo === 'pendiente_diagnostico') return ACCION_REPRODUCTIVA.diagnostico;
  if (codigo === 'requiere_revision') return ACCION_REPRODUCTIVA.revision;
  if (ESTADOS_GESTANTES.has(codigo)) return ACCION_REPRODUCTIVA.parto;
  if (codigo === 'disponible' || codigo === 'vacia') return ACCION_REPRODUCTIVA.servicio;
  return ACCION_REPRODUCTIVA.seguimiento;
}

function fechaSimple(valor) {
  if (!valor) return null;
  return String(valor).slice(0, 10);
}

function ultimo(arreglo = []) {
  return arreglo.at(-1) || null;
}

export function esAnimalReproductivoOperable(animal = {}) {
  return animal.estado === 'vivo'
    && animal.sexo === 'hembra'
    && ['vientre', 'reproductor'].includes(animal.categoria);
}

function ultimaAccion(ciclo, servicio, diagnostico) {
  if (ciclo?.parto) return { etiqueta: ciclo.parto.resultado === 'parto' ? 'Parto registrado' : ciclo.parto.resultado === 'aborto' ? 'Aborto registrado' : 'Pérdida registrada', fecha: fechaSimple(ciclo.parto.fecha_real) };
  if (diagnostico) return { etiqueta: diagnostico.resultado === 'prenada' ? 'Palpación positiva' : diagnostico.resultado === 'vacia' ? 'Diagnóstico: vacía' : 'Resultado dudoso', fecha: fechaSimple(diagnostico.fecha) };
  if (servicio) return { etiqueta: servicio.tipo === 'natural' ? 'Servicio natural' : servicio.tipo === 'inseminacion_artificial' ? 'Inseminación' : servicio.tipo_otro || 'Servicio', fecha: fechaSimple(servicio.fecha) };
  return { etiqueta: 'Sin acciones registradas', fecha: null };
}

export function construirEstadoHato(reproductoras = [], ciclos = []) {
  const cicloActualPorAnimal = new Map();
  for (const ciclo of ciclos) {
    const clave = String(ciclo.hembra_id);
    if (!cicloActualPorAnimal.has(clave)) cicloActualPorAnimal.set(clave, ciclo);
  }
  const animales = new Map(reproductoras.map((animal) => [String(animal.id), animal]));
  return [...animales.values()].map((animal) => {
    const ciclo = cicloActualPorAnimal.get(String(animal.id)) || null;
    const codigo = ciclo?.estado_actual?.codigo || 'disponible';
    const servicio = ultimo(ciclo?.servicios);
    const diagnostico = ultimo(ciclo?.diagnosticos);
    const accion = accionParaEstado(codigo);
    return {
      animal, ciclo, codigo, accion,
      etiqueta: ESTADO_REPRODUCTIVO_LABEL[codigo] || ciclo?.estado_actual?.etiqueta || 'Disponible',
      corral: animal.corral_actual || animal.corral_nombre || ciclo?.madre_corral || ciclo?.hembra_corral || 'Sin corral',
      fechaReferencia: fechaSimple(ciclo?.estado_actual?.fecha_parto_estimada || diagnostico?.fecha_siguiente_revision || ciclo?.estado_actual?.fecha_diagnostico_sugerida || servicio?.fecha || ciclo?.fecha_inicio),
      servicio, diagnostico,
      ultimaAccion: ultimaAccion(ciclo, servicio, diagnostico),
    };
  });
}

export function construirHatoOperable(registros = []) {
  const seguros = registros.filter((registro) => esAnimalReproductivoOperable(registro?.animal));
  return construirEstadoHato(seguros.map((registro) => registro.animal), seguros.map((registro) => registro.ciclo).filter(Boolean));
}

export function construirAtencionReproductiva(filas = [], hoy = new Date().toISOString().slice(0, 10)) {
  return filas.flatMap((fila) => {
    const sugerida = fechaSimple(fila.ciclo?.estado_actual?.fecha_diagnostico_sugerida);
    const estimada = fechaSimple(fila.ciclo?.estado_actual?.fecha_parto_estimada);
    const revision = fechaSimple(fila.diagnostico?.fecha_siguiente_revision);
    let item = null;
    if (fila.codigo === 'pendiente_diagnostico') item = { prioridad: sugerida && sugerida < hoy ? 1 : 2, motivo: sugerida && sugerida < hoy ? 'Diagnóstico vencido' : 'Diagnóstico pendiente', fecha: sugerida, detalle: `Servicio: ${fechaSimple(fila.servicio?.fecha) || 'sin fecha'}` };
    else if (fila.codigo === 'servida') item = { prioridad: 3, motivo: 'Diagnóstico pendiente', fecha: sugerida, detalle: `Servicio: ${fechaSimple(fila.servicio?.fecha) || 'sin fecha'}` };
    else if (fila.codigo === 'requiere_revision') item = { prioridad: revision && revision < hoy ? 1 : 2, motivo: revision && revision < hoy ? 'Revisión vencida' : 'Resultado dudoso', fecha: revision || fechaSimple(fila.diagnostico?.fecha), detalle: revision ? 'Próxima revisión' : 'Definir nueva revisión' };
    else if (fila.codigo === 'proxima_parto') item = { prioridad: estimada && estimada < hoy ? 1 : 2, motivo: estimada && estimada < hoy ? 'Parto estimado vencido' : 'Parto próximo', fecha: estimada, detalle: 'Fecha estimada' };
    else if (fila.codigo === 'perdida_aborto') item = { prioridad: 2, motivo: 'Seguimiento después de pérdida', fecha: fechaSimple(fila.ciclo?.fecha_cierre), detalle: 'Revisar recuperación y próximo manejo' };
    else if (fila.codigo === 'vacia') item = { prioridad: 4, motivo: 'Vaca vacía', fecha: fechaSimple(fila.ciclo?.fecha_cierre), detalle: 'Lista para decidir un nuevo servicio' };
    return item ? [{ ...fila, ...item }] : [];
  }).sort((a, b) => a.prioridad - b.prioridad || String(a.fecha || '').localeCompare(String(b.fecha || '')));
}

export function coincideFiltroReproductivo(fila, filtros = {}, hoy = new Date()) {
  if (filtros.estado && filtros.estado !== 'todos') {
    const coincide = filtros.estado === 'prenada' ? ESTADOS_GESTANTES.has(fila.codigo) : fila.codigo === filtros.estado;
    if (!coincide) return false;
  }
  if (filtros.corral && filtros.corral !== 'todos' && fila.corral !== filtros.corral) return false;
  if (filtros.toro && filtros.toro !== 'todos' && String(fila.servicio?.macho_id || 'sin-toro') !== filtros.toro) return false;
  if (filtros.accion && filtros.accion !== 'todos' && fila.accion.id !== filtros.accion) return false;
  if (filtros.periodo && filtros.periodo !== 'todos') {
    if (!fila.ciclo) return false;
    const fecha = new Date(`${fechaSimple(fila.ciclo.fecha_inicio)}T00:00:00`);
    const limite = new Date(hoy);
    if (filtros.periodo === '30') limite.setDate(limite.getDate() - 30);
    else if (filtros.periodo === '90') limite.setDate(limite.getDate() - 90);
    else if (filtros.periodo === 'anio') limite.setMonth(0, 1);
    if (fecha < limite) return false;
  }
  return true;
}

export function metricasEstadoHato(filas = []) {
  return {
    prenada: filas.filter((fila) => ESTADOS_GESTANTES.has(fila.codigo)),
    pendiente_diagnostico: filas.filter((fila) => ['servida', 'pendiente_diagnostico'].includes(fila.codigo)),
    requiere_revision: filas.filter((fila) => fila.codigo === 'requiere_revision'),
    proxima_parto: filas.filter((fila) => fila.codigo === 'proxima_parto'),
    vacia: filas.filter((fila) => fila.codigo === 'vacia'),
  };
}

export function etiquetaCiclo(ciclo) {
  const inicio = Number(fechaSimple(ciclo?.fecha_inicio)?.slice(0, 4));
  const cierre = Number(fechaSimple(ciclo?.fecha_cierre)?.slice(0, 4));
  if (!inicio) return 'Ciclo sin fecha';
  return `Ciclo ${inicio}${cierre && cierre !== inicio ? `–${cierre}` : ciclo?.fecha_cierre ? '' : `–${inicio + 1}`}`;
}
