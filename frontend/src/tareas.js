// React sólo acepta que un efecto devuelva una función de limpieza o undefined.
// Esta envoltura evita devolver por accidente la promesa del cargador.
export function ejecutarCargaEnEfecto(cargar) {
  void cargar();
}

export const TIPOS_TAREA = Object.freeze([
  { value: 'revision_salud', label: 'Revisión de salud' },
  { value: 'alimentacion', label: 'Alimentación' },
  { value: 'pesaje', label: 'Pesaje' },
  { value: 'movimiento', label: 'Movimiento de corral' },
  { value: 'vacunacion_tratamiento', label: 'Vacunación o tratamiento' },
  { value: 'revision_general', label: 'Revisión general' },
  { value: 'otra', label: 'Otra actividad' },
]);

export const PRIORIDADES_TAREA = Object.freeze([
  { value: 'baja', label: 'Baja' },
  { value: 'media', label: 'Media' },
  { value: 'alta', label: 'Alta' },
  { value: 'urgente', label: 'Urgente' },
]);

export const ESTADOS_TAREA = Object.freeze([
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'en_progreso', label: 'En progreso' },
  { value: 'completada', label: 'Completada' },
  { value: 'cancelada', label: 'Cancelada' },
]);

export function etiquetaDe(opciones, value) {
  return opciones.find((opcion) => opcion.value === value)?.label || value || 'Sin especificar';
}

export function normalizarTarea(tarea) {
  const corrales = Array.isArray(tarea.corrales) && tarea.corrales.length
    ? tarea.corrales
    : (tarea.corral_id ? [{ id: tarea.corral_id, nombre: tarea.corral || `Corral ${tarea.corral_id}` }] : []);
  return {
    ...tarea,
    titulo: tarea.titulo || tarea.descripcion || 'Tarea sin título',
    estado: tarea.estado || (tarea.completada ? 'completada' : 'pendiente'),
    prioridad: tarea.prioridad || 'media',
    tipo: tarea.tipo || 'otra',
    fecha_limite: tarea.fecha_limite || tarea.fecha,
    responsable: tarea.responsable || tarea.trabajador || 'Sin responsable',
    corrales,
    corral_ids: corrales.map((corral) => Number(corral.id)),
    corrales_texto: corrales.map((corral) => corral.nombre).join(', '),
  };
}

export function textoCantidadSugerida(tarea) {
  const normalizada = normalizarTarea(tarea);
  if (normalizada.tipo !== 'alimentacion'
    || normalizada.cantidad === null
    || normalizada.cantidad === undefined
    || normalizada.cantidad === '') return null;
  const unidad = String(normalizada.unidad_medida || '').trim();
  return `${normalizada.cantidad}${unidad ? ` ${unidad}` : ''}`;
}

export function esTareaVencida(tarea, hoy) {
  const normalizada = normalizarTarea(tarea);
  return !['completada', 'cancelada'].includes(normalizada.estado)
    && Boolean(normalizada.fecha_limite)
    && normalizada.fecha_limite.slice(0, 10) < hoy;
}

export function resumirTareas(tareas, hoy) {
  const normalizadas = tareas.map(normalizarTarea);
  return {
    pendientes: normalizadas.filter((tarea) => ['pendiente', 'en_progreso'].includes(tarea.estado)).length,
    vencidas: normalizadas.filter((tarea) => esTareaVencida(tarea, hoy)).length,
    completadas: normalizadas.filter((tarea) => tarea.estado === 'completada').length,
    hoy: normalizadas.filter((tarea) => ['pendiente', 'en_progreso'].includes(tarea.estado) && tarea.fecha_limite?.slice(0, 10) === hoy).length,
  };
}

export function agruparMisTareas(tareas, hoy) {
  const normalizadas = tareas.map(normalizarTarea);
  return {
    hoy: normalizadas.filter((tarea) => !['completada', 'cancelada'].includes(tarea.estado) && tarea.fecha_limite?.slice(0, 10) <= hoy),
    proximas: normalizadas.filter((tarea) => !['completada', 'cancelada'].includes(tarea.estado) && tarea.fecha_limite?.slice(0, 10) > hoy),
    completadas: normalizadas.filter((tarea) => tarea.estado === 'completada'),
  };
}
