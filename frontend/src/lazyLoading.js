export const TIPO_ERROR_CARGA = Object.freeze({
  RED: 'red',
  CHUNK_OBSOLETO: 'chunk_obsoleto',
  SERVIDOR_DESARROLLO: 'servidor_desarrollo',
  IMPORTACION: 'importacion',
  MODULO: 'modulo',
  API: 'api',
});

const PATRONES_IMPORT_DINAMICO = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /chunkloaderror/i,
  /loading chunk [\w-]+ failed/i,
  /unable to preload css/i,
  /failed to load module script/i,
  /non-javascript mime type/i,
  /module.*blocked.*mime type/i,
  /expected a javascript-or-wasm module script/i,
];

const PATRONES_DESARROLLO = [
  /outdated optimize dep/i,
  /vite.*(?:hmr|reload|transform)/i,
  /504.*outdated/i,
];

const PATRONES_RECURSO_OBSOLETO = [
  /non-javascript mime type/i,
  /module.*blocked.*mime type/i,
  /expected a javascript-or-wasm module script/i,
];

export function extraerUrlImportacion(error) {
  const texto = error?.message || '';
  return texto.match(/https?:\/\/[^\s)]+/i)?.[0]
    || texto.match(/(?:\/|\.\/)[^\s)]+\.(?:js|jsx|css)(?:\?[^\s)]*)?/i)?.[0]
    || null;
}

async function diagnosticarRecurso(url) {
  if (!url || typeof window === 'undefined' || typeof fetch !== 'function') return {};
  const destino = new URL(url, window.location.href);
  if (destino.origin !== window.location.origin) return { url: destino.href };
  try {
    const respuesta = await fetch(destino.href, { method: 'HEAD', cache: 'no-store' });
    return { url: destino.href, status: respuesta.status };
  } catch {
    return { url: destino.href };
  }
}

export async function cargarModuloDiferido(modulo, cargar, diagnosticar = diagnosticarRecurso) {
  try {
    return await cargar();
  } catch (causa) {
    const error = causa instanceof Error ? causa : new Error(String(causa || 'Error de importación'));
    const url = extraerUrlImportacion(error);
    const recurso = await diagnosticar(url);
    error.cargaDiferida = {
      modulo,
      url: recurso.url || url,
      status: Number.isInteger(recurso.status) ? recurso.status : null,
      entorno: typeof import.meta.env !== 'undefined' && import.meta.env.DEV ? 'desarrollo' : 'produccion',
    };
    throw error;
  }
}

export function esErrorImportDinamico(error) {
  const texto = `${error?.name || ''} ${error?.message || ''}`;
  return PATRONES_IMPORT_DINAMICO.some((patron) => patron.test(texto));
}

export function clasificarErrorCarga(error, { online = typeof navigator === 'undefined' ? true : navigator.onLine } = {}) {
  if (Number.isInteger(error?.status) || ['API_ERROR', 'INVALID_RESPONSE'].includes(error?.code)) return TIPO_ERROR_CARGA.API;
  if (esErrorImportDinamico(error)) {
    if (online === false) return TIPO_ERROR_CARGA.RED;
    const texto = `${error?.name || ''} ${error?.message || ''}`;
    const diagnostico = error?.cargaDiferida || {};
    if ([404, 410].includes(diagnostico.status) || PATRONES_RECURSO_OBSOLETO.some((patron) => patron.test(texto))) {
      return TIPO_ERROR_CARGA.CHUNK_OBSOLETO;
    }
    if (diagnostico.entorno === 'desarrollo' && (
      (diagnostico.status >= 500 && diagnostico.status < 600)
      || PATRONES_DESARROLLO.some((patron) => patron.test(texto))
    )) return TIPO_ERROR_CARGA.SERVIDOR_DESARROLLO;
    return TIPO_ERROR_CARGA.IMPORTACION;
  }
  return TIPO_ERROR_CARGA.MODULO;
}

export function presentacionErrorCarga(tipo) {
  const presentaciones = {
    [TIPO_ERROR_CARGA.RED]: {
      titulo: 'No se pudo descargar la sección.',
      mensaje: 'La conexión está interrumpida. Cuando vuelva, intenta cargar esta sección de nuevo.',
      textoReintentar: 'Reintentar sección',
    },
    [TIPO_ERROR_CARGA.CHUNK_OBSOLETO]: {
      titulo: 'Esta sección pertenece a otra versión de la aplicación.',
      mensaje: 'El archivo solicitado ya no existe en el servidor. Reintenta la sección; si continúa, actualiza la aplicación para usar la versión vigente.',
      textoReintentar: 'Reintentar sección',
      permiteActualizar: true,
    },
    [TIPO_ERROR_CARGA.SERVIDOR_DESARROLLO]: {
      titulo: 'Vite no pudo preparar esta sección.',
      mensaje: 'La recompilación o HMR encontró un error. Revisa la terminal de Vite, corrige el módulo y vuelve a intentarlo.',
      textoReintentar: 'Reintentar sección',
      permiteActualizar: true,
    },
    [TIPO_ERROR_CARGA.IMPORTACION]: {
      titulo: 'No se pudo descargar esta sección.',
      mensaje: 'La conexión general está activa, pero el archivo del módulo no terminó de cargarse. Reintenta la sección.',
      textoReintentar: 'Reintentar sección',
      permiteActualizar: true,
    },
    [TIPO_ERROR_CARGA.API]: {
      titulo: 'No se pudo obtener la información de esta sección.',
      mensaje: 'La pantalla abrió, pero el servidor no pudo completar la solicitud. Intenta nuevamente.',
      textoReintentar: 'Reintentar sección',
    },
    [TIPO_ERROR_CARGA.MODULO]: {
      titulo: 'Esta sección encontró un problema al iniciar.',
      mensaje: 'La sección se descargó, pero ocurrió un error dentro de ella. El detalle original quedó registrado para diagnóstico.',
      textoReintentar: 'Intentar de nuevo',
    },
  };
  return presentaciones[tipo] || presentaciones[TIPO_ERROR_CARGA.MODULO];
}

export function resumenDiagnosticoCarga(error, tipo = clasificarErrorCarga(error), { modulo, referencia } = {}) {
  const diagnostico = error?.cargaDiferida || {};
  return [
    tipo,
    diagnostico.modulo || modulo ? `módulo ${diagnostico.modulo || modulo}` : null,
    Number.isInteger(diagnostico.status) ? `HTTP ${diagnostico.status}` : null,
    referencia ? `referencia ${referencia}` : null,
  ].filter(Boolean).join(' · ');
}

// Cada llamada crea tipos React.lazy nuevos. Esto es esencial porque React
// conserva el resultado —incluido un rechazo— dentro del tipo lazy anterior.
export function crearMapaDiferido(crearLazy, cargadores) {
  return Object.fromEntries(Object.entries(cargadores).map(([clave, cargar]) => [clave, crearLazy(cargar)]));
}
