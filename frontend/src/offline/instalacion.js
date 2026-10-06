// Identificador de instalación (dispositivo), no de cuenta: mismo
// concepto que X-Client-Installation-Id descrito en
// docs/MODO_OFFLINE.md para la cola offline. Vive en
// localStorage (no en IndexedDB) porque identifica AL DISPOSITIVO, no a
// ningún usuario — sobrevive logins/logouts de distintas cuentas en el
// mismo equipo, a propósito.
import { generarUUID } from './uuid.js';

const CLAVE_INSTALACION = 'el_rancho_instalacion_id';

export function obtenerInstalacionId() {
  let id = localStorage.getItem(CLAVE_INSTALACION);
  if (!id) {
    id = generarUUID();
    localStorage.setItem(CLAVE_INSTALACION, id);
  }
  return id;
}
