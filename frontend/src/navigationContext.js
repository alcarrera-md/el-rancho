const CLAVES_ID = new Set(['animal', 'corral', 'insumo']);

export const SECCIONES_SEGUIMIENTO = Object.freeze([
  'info', 'salud', 'vacunaciones', 'tratamientos', 'pesajes', 'reproduccion',
  'alimentacion', 'movimientos', 'historial', 'genealogia', 'notas',
]);

export function leerIdContexto(parametros, clave) {
  if (!CLAVES_ID.has(clave)) return null;
  const params = typeof parametros === 'string' ? new URLSearchParams(parametros) : parametros;
  const valor = params?.get(clave);
  return /^\d+$/.test(valor || '') && Number(valor) > 0 ? String(Number(valor)) : null;
}

export function crearRutaContextual(ruta, contexto = {}) {
  const params = new URLSearchParams();
  Object.entries(contexto).forEach(([clave, valor]) => {
    if (valor === undefined || valor === null || valor === '') return;
    if (CLAVES_ID.has(clave)) {
      const normalizado = leerIdContexto(new URLSearchParams([[clave, String(valor)]]), clave);
      if (normalizado) params.set(clave, normalizado);
      return;
    }
    params.set(clave, String(valor));
  });
  const query = params.toString();
  return query ? `${ruta}?${query}` : ruta;
}

export function actualizarContexto(parametros, cambios = {}) {
  const siguientes = new URLSearchParams(parametros);
  Object.entries(cambios).forEach(([clave, valor]) => {
    if (valor === undefined || valor === null || valor === '') siguientes.delete(clave);
    else siguientes.set(clave, String(valor));
  });
  return siguientes;
}

export function seccionSeguimientoParaTarea(tipo) {
  return ({
    revision_salud: 'salud', vacunacion_tratamiento: 'salud', alimentacion: 'alimentacion',
    pesaje: 'pesajes', movimiento: 'movimientos',
  })[tipo] || 'info';
}

export function accionesContextualesTarea(tarea = {}) {
  const acciones = [];
  if (tarea.animal_id) acciones.push({
    id: 'animal', etiqueta: 'Ver animal',
    ruta: crearRutaContextual(`/animales/${tarea.animal_id}/seguimiento`, { seccion: seccionSeguimientoParaTarea(tarea.tipo) }),
  });
  if (tarea.corral_id) acciones.push({ id: 'corral', etiqueta: 'Ver corral', ruta: crearRutaContextual('/corrales', { corral: tarea.corral_id }) });
  if (tarea.insumo_id) acciones.push({ id: 'insumo', etiqueta: 'Ver insumo', ruta: crearRutaContextual('/insumos', { insumo: tarea.insumo_id }) });
  return acciones;
}

export function seccionSeguimientoValida(valor) {
  return SECCIONES_SEGUIMIENTO.includes(valor) ? valor : 'info';
}
