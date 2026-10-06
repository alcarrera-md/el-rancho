export const TAREAS_MOVIMIENTOS = Object.freeze([
  {
    id: 'individual',
    titulo: 'Mover un animal',
    descripcion: 'Busca el animal y elige su nuevo corral.',
  },
  {
    id: 'varios',
    titulo: 'Mover varios animales',
    descripcion: 'Requiere un traslado por lote seguro para evitar movimientos parciales.',
    noDisponible: true,
  },
  {
    id: 'historial',
    titulo: 'Consultar movimientos anteriores',
    descripcion: 'Revisa cuándo y entre qué corrales se movió cada animal.',
  },
]);

export const TAREAS_LOTE = Object.freeze([
  { id: 'pesaje', titulo: 'Registrar pesajes', descripcion: 'Anota el peso de varios animales en una sola jornada.', permiso: ['pesajes', 'crear'] },
  { id: 'salud', titulo: 'Registrar salud', descripcion: 'Aplica el mismo registro sanitario a los animales elegidos.', permiso: ['salud', 'crear'] },
  { id: 'alimentacion', titulo: 'Registrar alimentación', descripcion: 'Registra el mismo alimento y cantidad para varios animales.', permiso: ['alimentacion', 'crear'] },
  { id: 'venta', titulo: 'Registrar una venta', descripcion: 'Vende varios animales dentro del mismo trato comercial.', permiso: ['ventas', 'crear'] },
]);

export function construirAtencionAnimal({ animal, recomendaciones = [], pendientesPlan = 0 }) {
  const avisos = [];
  if (animal?.estado !== 'vivo') {
    const etiqueta = animal?.estado === 'vendido' ? 'vendido' : animal?.estado === 'sacrificado' ? 'sacrificado' : 'muerto';
    avisos.push(`Este animal figura como ${etiqueta}.`);
  } else if (animal?.estado_salud === 'enfermo') {
    avisos.push('Su estado de salud figura como enfermo.');
  } else if (animal?.estado_salud === 'observacion') {
    avisos.push('Está marcado para revisión.');
  }
  if (pendientesPlan > 0) avisos.push(`${pendientesPlan} actividad sanitaria pendiente${pendientesPlan === 1 ? '' : 's'}.`);
  if (recomendaciones.length > 0) avisos.push(`${recomendaciones.length} recomendación${recomendaciones.length === 1 ? '' : 'es'} disponible${recomendaciones.length === 1 ? '' : 's'} en el expediente.`);

  return {
    tono: avisos.length > 0 ? 'atencion' : 'estable',
    titulo: avisos.length > 0 ? 'Necesita atención' : 'Sin pendientes destacados',
    avisos: avisos.length > 0 ? avisos : ['No hay alertas registradas con la información disponible.'],
  };
}
