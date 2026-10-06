// Política de sesión offline (P8.3.1, decisión 2026-09-24).
//
// Se separan dos permisos distintos:
//   - USAR los datos locales (consultar el snapshot y capturar en la cola):
//     hasta 72 h desde la ÚLTIMA VALIDACIÓN ONLINE exitosa con el servidor,
//     aunque el JWT haya vencido mientras el equipo estaba sin Internet.
//   - SINCRONIZAR: siempre exige que el servidor acepte la sesión
//     (/api/auth/me). Un JWT vencido, un usuario desactivado o un rol cambiado
//     se resuelven en el servidor al reconectar; la cola se conserva y se envía
//     tras volver a iniciar sesión con la misma cuenta.
// La ventana nunca se extiende por seguir offline: su punto de partida solo
// cambia con una validación online real. No se guardan contraseñas ni se
// fabrican tokens en el cliente.
export const VENTANA_OFFLINE_MS = 72 * 60 * 60 * 1000;

/** Hasta cuándo pueden usarse los datos locales: última validación online + 72 h. */
export function calcularExpiracionVentanaOffline(ultimaValidacionOnlineISO) {
  return new Date(new Date(ultimaValidacionOnlineISO).getTime() + VENTANA_OFFLINE_MS).toISOString();
}

export function ventanaOfflineVigente(ventanaExpiraEnISO, ahora = new Date()) {
  if (!ventanaExpiraEnISO) return false;
  const limite = new Date(ventanaExpiraEnISO).getTime();
  return Number.isFinite(limite) && ahora.getTime() < limite;
}

/** El JWT local todavía no vence (solo informativo: el servidor decide al sincronizar). */
export function jwtLocalVigente(expiraJwtISO, ahora = new Date()) {
  return ventanaOfflineVigente(expiraJwtISO, ahora);
}

/**
 * Qué hacer cuando /api/auth/me no confirmó la sesión. Regla principal: solo
 * un 401/403 REAL del servidor invalida la sesión. Un fallo de red (servidor
 * inalcanzable) nunca cierra la sesión ni manda a login si el dispositivo ya
 * tiene una sesión local vigente del mismo usuario.
 *   'sesion_invalida' → el servidor rechazó la sesión: login (la cola se conserva)
 *   'error_servidor'  → el servidor respondió con error: no se disfraza de offline
 *   'offline'         → entrar en modo sin conexión con el último snapshot
 *   'vencida'         → pasaron más de 72 h sin validación online
 *   'sin_datos'       → nunca se preparó este dispositivo: pedir conexión
 */
export function decidirSinServidor({ status = null, esFalloRed = false, sesionLocal = null, usuarioIdLocal = null, ahora = new Date() } = {}) {
  if (status === 401 || status === 403) return 'sesion_invalida';
  if (!esFalloRed) return 'error_servidor';
  if (!usuarioIdLocal || !sesionLocal) return 'sin_datos';
  return puedeArrancarOffline({ snapshot: sesionLocal, usuarioIdLocal, ahora }) ? 'offline' : 'vencida';
}

/**
 * Decide si corresponde entrar en modo sin conexión: exige un snapshot del
 * MISMO usuario que el token guardado (nunca el de otra cuenta), creado por
 * una validación online, y que la ventana de 72 h siga vigente. No valida
 * nada contra el servidor: este camino solo se usa cuando no hay conexión.
 */
export function puedeArrancarOffline({ snapshot, usuarioIdLocal, ahora = new Date() } = {}) {
  if (!snapshot || !usuarioIdLocal) return false;
  if (String(snapshot.usuario_id) !== String(usuarioIdLocal)) return false;
  if (!snapshot.ultima_validacion_online) return false;
  return ventanaOfflineVigente(snapshot.ventana_offline_expira_en, ahora);
}
