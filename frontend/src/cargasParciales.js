function errorRespuestaInvalida(solicitud) {
  const error = new Error(`La respuesta de ${solicitud.etiqueta} tiene un formato inesperado.`);
  error.code = 'RESPUESTA_INVALIDA';
  error.status = 200;
  error.ruta = solicitud.ruta;
  error.metodo = solicitud.metodo || 'GET';
  return error;
}

export function describirFalloSolicitud(solicitud, error) {
  return {
    clave: solicitud.clave,
    etiqueta: solicitud.etiqueta,
    ruta: error?.ruta || solicitud.ruta,
    metodo: error?.metodo || solicitud.metodo || 'GET',
    status: Number.isInteger(error?.status) ? error.status : null,
    codigo: error?.code || null,
    mensaje: error?.message || 'Error desconocido',
  };
}

export async function resolverCargaParcial(solicitudes, { contexto, rol } = {}) {
  const resultados = await Promise.allSettled(solicitudes.map(({ promesa }) => promesa));
  const fallos = [];

  resultados.forEach((resultado, indice) => {
    const solicitud = solicitudes[indice];
    if (resultado.status === 'fulfilled' && (!solicitud.validar || solicitud.validar(resultado.value))) {
      solicitud.aplicar(resultado.value);
      return;
    }

    const error = resultado.status === 'rejected' ? resultado.reason : errorRespuestaInvalida(solicitud);
    fallos.push(describirFalloSolicitud(solicitud, error));
    if (Object.hasOwn(solicitud, 'valorInicial')) solicitud.aplicar(solicitud.valorInicial);
  });

  if (fallos.length) {
    console.error('[frontend-partial-load]', {
      contexto,
      rol,
      rutaPantalla: typeof window === 'undefined' ? null : window.location.pathname,
      fallos,
      fecha: new Date().toISOString(),
    });
  }

  return { fallos, total: solicitudes.length };
}

export function mensajeCargaParcial({ fallos, total }) {
  if (!fallos.length) return null;
  const detalle = fallos.map((fallo) => {
    const estado = fallo.status === null ? fallo.codigo || 'sin respuesta' : `HTTP ${fallo.status}`;
    return `${fallo.etiqueta} (${fallo.metodo} ${fallo.ruta}, ${estado})`;
  }).join('; ');
  return fallos.length === total
    ? `No se pudo cargar la información. Fallaron: ${detalle}.`
    : `Parte de la información no pudo cargarse. Fallaron: ${detalle}.`;
}

export const respuestaEsArreglo = Array.isArray;
export const respuestaEsObjeto = (valor) => Boolean(valor && typeof valor === 'object' && !Array.isArray(valor));
