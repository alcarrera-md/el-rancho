import { clasificarErrorCarga } from './lazyLoading.js';

export function crearReferenciaRuntime(fecha = new Date(), aleatorio = Math.random()) {
  const tiempo = fecha.getTime().toString(36).toUpperCase();
  const sufijo = Math.floor(aleatorio * 0xFFFFFF).toString(36).padStart(5, '0').toUpperCase();
  return `RT-${tiempo}-${sufijo}`;
}

export function crearRegistroErrorModulo({
  error,
  componentStack,
  modulo,
  ruta,
  desarrollo = false,
  referencia = crearReferenciaRuntime(),
  fecha = new Date(),
}) {
  const registro = {
    referencia,
    tipo: clasificarErrorCarga(error),
    modulo: error?.cargaDiferida?.modulo || modulo || 'desconocido',
    ruta: ruta || 'desconocida',
    fecha: fecha.toISOString(),
  };

  if (!desarrollo) return registro;
  return {
    ...registro,
    original: {
      nombre: error?.name || 'Error',
      mensaje: error?.message || String(error),
      stack: error?.stack || null,
    },
    componentStack: componentStack || null,
  };
}
