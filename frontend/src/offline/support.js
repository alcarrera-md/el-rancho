export const SOPORTE_OFFLINE = Object.freeze({
  FULL: 'offline-full',
  PARTIAL: 'offline-partial',
  ONLINE_ONLY: 'online-only',
});

const POR_VISTA = Object.freeze({
  inicio: SOPORTE_OFFLINE.FULL,
  sincronizacion: SOPORTE_OFFLINE.FULL,
  animales: SOPORTE_OFFLINE.PARTIAL,
  corrales: SOPORTE_OFFLINE.PARTIAL,
  tareas: SOPORTE_OFFLINE.PARTIAL,
  seguimiento: SOPORTE_OFFLINE.PARTIAL,
  pesajes: SOPORTE_OFFLINE.PARTIAL,
  alimentacion: SOPORTE_OFFLINE.PARTIAL,
  movimientos: SOPORTE_OFFLINE.PARTIAL,
});

export function soporteOfflineVista(vista) {
  return POR_VISTA[vista] || SOPORTE_OFFLINE.ONLINE_ONLY;
}

export function vistaDisponibleOffline(vista) {
  return soporteOfflineVista(vista) !== SOPORTE_OFFLINE.ONLINE_ONLY;
}
