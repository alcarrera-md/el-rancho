import { hayFormularioSucio } from './appLifecycle.js';

export const EVENTO_ACTUALIZACION_PWA = 'pwa:actualizacion-disponible';
export const EVENTO_ACTUALIZACION_BLOQUEADA = 'pwa:actualizacion-bloqueada';
export const MENSAJE_OFFLINE = 'Sin conexión. Esta información necesita Internet.';

let registroVigente = null;
let recargaSolicitada = false;

export function esContextoSeguroPwa(ubicacion = window.location) {
  return window.isSecureContext
    || ['localhost', '127.0.0.1', '[::1]'].includes(ubicacion.hostname);
}
function anunciarActualizacion(registro) {
  registroVigente = registro;
  window.dispatchEvent(new CustomEvent(EVENTO_ACTUALIZACION_PWA, { detail: { registro } }));
}

export async function registrarServiceWorker({ produccion = import.meta.env.PROD } = {}) {
  if (!produccion || !('serviceWorker' in navigator) || !esContextoSeguroPwa()) return null;

  const registro = await navigator.serviceWorker.register('/sw.js', {
    scope: '/',
    updateViaCache: 'none',
  });
  registroVigente = registro;

  if (registro.waiting && navigator.serviceWorker.controller) anunciarActualizacion(registro);
  registro.addEventListener('updatefound', () => {
    const instalando = registro.installing;
    if (!instalando) return;
    instalando.addEventListener('statechange', () => {
      if (instalando.state === 'installed' && navigator.serviceWorker.controller) anunciarActualizacion(registro);
    });
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recargaSolicitada) window.location.reload();
  });
  return registro;
}

export function solicitarActualizacionPwa(registro = registroVigente) {
  if (hayFormularioSucio()) {
    window.dispatchEvent(new Event(EVENTO_ACTUALIZACION_BLOQUEADA));
    return false;
  }
  if (registro?.waiting) {
    recargaSolicitada = true;
    registro.waiting.postMessage({ tipo: 'ACTIVAR_VERSION' });
    return true;
  }
  window.location.reload();
  return true;
}

/**
 * ¿Puede esta copia de la app abrirse sin red? Requiere contexto seguro
 * (HTTPS), Service Worker disponible y que ya controle la página. IndexedDB
 * sola no basta: sin Service Worker el navegador no tiene la app guardada.
 */
export function diagnosticoAperturaOffline({
  seguro = typeof window !== 'undefined' && window.isSecureContext,
  soportaSw = typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
  controlada = typeof navigator !== 'undefined' && Boolean(navigator.serviceWorker?.controller),
  instalada = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(display-mode: standalone)').matches),
} = {}) {
  if (!seguro || !soportaSw) {
    return { listo: false, clave: 'sin_https', texto: 'Esta dirección no permite abrir la app sin conexión. Usa el modo "app instalable (HTTPS local)" del launcher.' };
  }
  if (!controlada) return { listo: false, clave: 'sin_cache', texto: 'La app aún no quedó guardada en el dispositivo. Recarga la página una vez con conexión.' };
  return { listo: true, clave: instalada ? 'instalada' : 'lista', texto: instalada ? 'App instalada y lista para abrir sin conexión.' : 'Lista para abrir sin conexión. Instálala desde el menú del navegador para abrirla con su icono.' };
}

export function notificarLogoutAlServiceWorker() {
  navigator.serviceWorker?.controller?.postMessage({ tipo: 'LIMPIAR_CACHES_PRIVADOS' });
}
