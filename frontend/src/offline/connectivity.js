// Detección de conectividad real (Offline v1 Fase B, §7). No confiamos
// solo en navigator.onLine (indica "hay una interfaz de red", no "el
// backend responde") — lo combinamos con una comprobación ligera contra
// GET /api/health (montada sin autenticación, ver backend/src/app.js).
//
// Mismo patrón modular que src/pwa.js del resto del proyecto (estado de
// módulo + eventos de window + funciones exportadas), en vez de un
// Context de React — evita un provider más y es igual de fácil de
// suscribir desde AuthContext, App.jsx o un componente de UI.
const RUTA_HEALTH = '/api/health';
const TIMEOUT_COMPROBACION_MS = 4000;
const RETRASOS_REINTENTO_MS = [5_000, 15_000, 45_000, 60_000];

export const CONECTIVIDAD_ONLINE = 'online';
export const CONECTIVIDAD_OFFLINE = 'offline';
export const CONECTIVIDAD_COMPROBANDO = 'checking';

let estadoActual = typeof navigator !== 'undefined' && navigator.onLine === false
  ? CONECTIVIDAD_OFFLINE
  : CONECTIVIDAD_COMPROBANDO;
const listeners = new Set();
let temporizadorReintento = null;
let intentoReintento = 0;
let inicializado = false;

function notificar(nuevoEstado) {
  if (nuevoEstado === estadoActual) return;
  estadoActual = nuevoEstado;
  if (nuevoEstado === CONECTIVIDAD_ONLINE) intentoReintento = 0;
  listeners.forEach((listener) => listener(estadoActual));
  gestionarReintento();
}

export function obtenerEstadoConectividad() {
  return estadoActual;
}

export function esFalloDeConectividad(error) {
  return Boolean(error && !error.status && ['OFFLINE', 'NETWORK_ERROR', 'AbortError'].includes(error.code || error.name));
}

// Las peticiones operativas notifican aquí un fallo de transporte. Esto
// evita esperar al siguiente health check y permite que la misma captura
// que falló caiga inmediatamente al snapshot local.
export function reportarFalloDeConectividad() {
  notificar(CONECTIVIDAD_OFFLINE);
}

/** Comprobación puntual (no dispara sola un temporizador). Usar con cuidado: no llamar en loops ajustados. */
export async function comprobarConectividadReal() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    notificar(CONECTIVIDAD_OFFLINE);
    return CONECTIVIDAD_OFFLINE;
  }
  let temporizador = null;
  try {
    const controlador = typeof AbortController !== 'undefined' ? new AbortController() : null;
    temporizador = controlador ? setTimeout(() => controlador.abort(), TIMEOUT_COMPROBACION_MS) : null;
    const respuesta = await fetch(RUTA_HEALTH, { cache: 'no-store', signal: controlador?.signal });
    const estado = respuesta.ok ? CONECTIVIDAD_ONLINE : CONECTIVIDAD_OFFLINE;
    notificar(estado);
    return estado;
  } catch {
    notificar(CONECTIVIDAD_OFFLINE);
    return CONECTIVIDAD_OFFLINE;
  } finally {
    if (temporizador) clearTimeout(temporizador);
  }
}

function gestionarReintento() {
  if (estadoActual === CONECTIVIDAD_ONLINE) {
    if (temporizadorReintento) clearTimeout(temporizadorReintento);
    temporizadorReintento = null;
    return;
  }
  if (!inicializado || temporizadorReintento) return;
  const retraso = RETRASOS_REINTENTO_MS[Math.min(intentoReintento, RETRASOS_REINTENTO_MS.length - 1)];
  temporizadorReintento = setTimeout(async () => {
    temporizadorReintento = null;
    intentoReintento += 1;
    await comprobarConectividadReal();
    gestionarReintento();
  }, retraso);
}

/** Suscribe un listener(estado) a cambios de conectividad; devuelve función para desuscribirse. */
export function suscribirConectividad(listener) {
  listeners.add(listener);
  if (!inicializado && typeof window !== 'undefined') {
    inicializado = true;
    window.addEventListener('offline', () => notificar(CONECTIVIDAD_OFFLINE));
    window.addEventListener('online', () => {
      notificar(CONECTIVIDAD_COMPROBANDO);
      void comprobarConectividadReal();
    });
    void comprobarConectividadReal();
  }
  gestionarReintento();
  return () => {
    listeners.delete(listener);
  };
}

// Solo para pruebas: reinicia el módulo entre tests.
export function _reiniciarConectividadParaPruebas() {
  if (temporizadorReintento) clearTimeout(temporizadorReintento);
  temporizadorReintento = null;
  intentoReintento = 0;
  inicializado = false;
  listeners.clear();
  estadoActual = CONECTIVIDAD_COMPROBANDO;
}
