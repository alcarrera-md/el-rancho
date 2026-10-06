import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { api, getToken, setToken, clearToken } from '../api';
import { notificarLogoutAlServiceWorker } from '../pwa.js';
import { aplicarPreferenciasApariencia, obtenerPreferenciasApariencia } from '../theme.js';
import { decodificarJWT } from '../offline/jwt.js';
import { sincronizarBootstrap } from '../offline/bootstrapSync.js';
import { decidirSinServidor } from '../offline/sessionWindow.js';
import { leerSesionLocal, leerSyncMetadataLocal, limpiarDatosUsuarioLocal, limpiarSnapshotUsuarioLocal } from '../offline/campoDB.js';
import { CONECTIVIDAD_OFFLINE, CONECTIVIDAD_ONLINE, esFalloDeConectividad, suscribirConectividad } from '../offline/connectivity.js';
import { obtenerEstadoCola, sincronizarOperacionesPendientes } from '../offline/colaOperaciones.js';

const AuthContext = createContext(null);

// Modo sin conexión (Offline v1 Fase B §5): distingue explícitamente una
// sesión validada por el servidor de una sesión reconstruida solo a
// partir del snapshot local. Nunca se finge que MODO_ONLINE fue
// confirmado por el servidor cuando en realidad venimos de MODO_OFFLINE.
export const AUTH_ONLINE = 'authenticated_online';
export const AUTH_OFFLINE = 'authenticated_offline';
export const AUTH_OFFLINE_EXPIRADA = 'offline_session_expired';
export const AUTH_SIN_SESION = 'unauthenticated';

export const MENSAJE_SIN_DATOS_OFFLINE = 'Este dispositivo todavía no tiene datos para trabajar sin conexión. Conéctate para iniciar sesión.';
export const MENSAJE_VENTANA_OFFLINE_VENCIDA = 'Pasaron más de 72 horas desde tu última conexión con El Rancho. Conéctate e inicia sesión para seguir; tus capturas pendientes se conservan.';

function usuarioDesdeSnapshot(usuarioId, snapshot) {
  return {
    id: usuarioId,
    nombre: snapshot.nombre,
    email: snapshot.email,
    rol: snapshot.rol,
    trabajador_id: snapshot.trabajador?.id ?? null,
    trabajador_nombre: snapshot.trabajador?.nombre ?? null,
    sesion_version: snapshot.sesion_version,
  };
}

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [avisoAuth, setAvisoAuth] = useState(null);
  const [estadoAutenticacion, setEstadoAutenticacion] = useState(AUTH_SIN_SESION);
  const [metadatosSync, setMetadatosSync] = useState(null);
  // Resultado de preparar el modo sin conexión tras una validación online.
  // Un fallo aquí antes pasaba en silencio y dejaba al usuario sin offline.
  const [preparacionOffline, setPreparacionOffline] = useState(null);
  const usuarioRef = useRef(usuario);
  const estadoAutenticacionRef = useRef(estadoAutenticacion);
  usuarioRef.current = usuario;
  estadoAutenticacionRef.current = estadoAutenticacion;

  function limpiarEstadoEnMemoria(estado = AUTH_SIN_SESION) {
    setUsuario(null);
    setEstadoAutenticacion(estado);
    setMetadatosSync(null);
  }

  async function limpiarEstadoLocal(usuarioId, estado = AUTH_SIN_SESION, { preservarOperaciones = false } = {}) {
    if (usuarioId) {
      try {
        if (preservarOperaciones) await limpiarSnapshotUsuarioLocal(usuarioId);
        else await limpiarDatosUsuarioLocal(usuarioId);
      } catch (error) { console.warn('[offline-logout]', error); }
    }
    limpiarEstadoEnMemoria(estado);
  }

  async function cerrarSesionCompleta(usuarioId, { preservarOperaciones = false } = {}) {
    clearToken();
    notificarLogoutAlServiceWorker();
    // Un logout explícito elimina físicamente los datos locales de este
    // usuario. Cuando el servidor invalida la sesión, se retira el
    // snapshot legible pero se conserva la cola particionada para que el
    // mismo usuario pueda recuperarla al volver a autenticarse.
    await limpiarEstadoLocal(usuarioId, AUTH_SIN_SESION, { preservarOperaciones });
  }

  // Cerrar sesión (decisión P8.3.1): se borran la sesión local y el snapshot
  // legible, pero las capturas pendientes y conflictos de ESTA cuenta se
  // conservan en su partición y se envían cuando la misma cuenta vuelva a
  // entrar. Otra cuenta nunca las ve. Descartarlas requiere hacerlo desde
  // Sincronización. IndexedDB no está cifrada: es una separación por usuario.
  async function cerrarSesion({ forzar = false } = {}) {
    const usuarioId = usuarioRef.current?.id;
    let total = 0;
    if (usuarioId) {
      const cola = await obtenerEstadoCola(usuarioId).catch(() => null);
      total = (cola?.operaciones?.length || 0) + (cola?.conflictos?.length || 0);
      if (!forzar && total && !window.confirm(`Tienes ${total} ${total === 1 ? 'captura sin sincronizar' : 'capturas sin sincronizar'}. Se conservarán en este dispositivo y se enviarán cuando vuelvas a iniciar sesión con esta misma cuenta. ¿Cerrar sesión?`)) {
        return false;
      }
    }
    await cerrarSesionCompleta(usuarioId, { preservarOperaciones: total > 0 });
    setAvisoAuth(total ? 'Tus capturas pendientes quedaron guardadas en este dispositivo. Inicia sesión con la misma cuenta para enviarlas.' : null);
    return true;
  }

  async function entrarModoOffline(usuarioIdLocal, sesionLocal) {
    setUsuario(usuarioDesdeSnapshot(usuarioIdLocal, sesionLocal));
    setEstadoAutenticacion(AUTH_OFFLINE);
    setMetadatosSync(await leerSyncMetadataLocal(usuarioIdLocal).catch(() => null));
  }

  async function sincronizarSnapshot(usuarioValidado) {
    try {
      await sincronizarBootstrap(usuarioValidado);
      setMetadatosSync(await leerSyncMetadataLocal(usuarioValidado.id) || null);
      setPreparacionOffline({ ok: true, fecha: new Date().toISOString() });
    } catch (error) {
      console.warn('[offline-bootstrap-sync]', error);
      setPreparacionOffline({ ok: false, mensaje: error?.message || 'No se pudo preparar el modo sin conexión.', fecha: new Date().toISOString() });
    }
  }

  async function sincronizarCampo(usuarioValidado) {
    try {
      await sincronizarOperacionesPendientes(usuarioValidado);
    } catch (error) {
      // Un fallo local de IndexedDB no invalida una sesión que el
      // servidor acaba de confirmar. La cola conserva lo que alcanzó a
      // guardar y el panel permite volver a intentarlo.
      console.warn('[offline-queue-sync]', error);
    }
    await sincronizarSnapshot(usuarioValidado);
  }

  async function refrescarSesion({ actualizarSnapshot = true } = {}) {
    const tokenActual = getToken();
    const claimsLocales = decodificarJWT(tokenActual);
    if (!tokenActual) {
      limpiarEstadoEnMemoria();
      return null;
    }
    try {
      const data = await api.perfilActual();
      setUsuario(data.usuario);
      setEstadoAutenticacion(AUTH_ONLINE);
      setAvisoAuth(null);
      aplicarPreferenciasApariencia(obtenerPreferenciasApariencia(data.usuario.id), data.usuario.id);
      if (actualizarSnapshot) await sincronizarCampo(data.usuario);
      return data.usuario;
    } catch (error) {
      // La regla completa vive en decidirSinServidor (sessionWindow.js):
      // solo un 401/403 real invalida la sesión; un fallo de red con sesión
      // local vigente entra al modo sin conexión en lugar de ir a login.
      const usuarioIdLocal = claimsLocales?.id ?? null;
      const esFalloRed = esFalloDeConectividad(error);
      const sesionLocal = esFalloRed && usuarioIdLocal ? await leerSesionLocal(usuarioIdLocal).catch(() => null) : null;
      const decision = decidirSinServidor({ status: error.status ?? null, esFalloRed, sesionLocal, usuarioIdLocal });
      if (decision === 'sesion_invalida') {
        // El servidor rechazó la sesión (vencida, desactivada, rol o versión
        // cambiados): se retira el snapshot legible y se CONSERVA la cola
        // para enviarla tras volver a iniciar sesión con la misma cuenta.
        await limpiarEstadoLocal(usuarioIdLocal || usuarioRef.current?.id, AUTH_SIN_SESION, { preservarOperaciones: true });
        throw error;
      }
      if (decision === 'error_servidor') {
        // El servidor respondió con error: no se disfraza como falta de red.
        if (!usuarioRef.current) {
          limpiarEstadoEnMemoria();
          setAvisoAuth('No se pudo validar la sesión con el servidor. Inténtalo nuevamente.');
        }
        throw error;
      }
      if (decision === 'offline') {
        await entrarModoOffline(usuarioIdLocal, sesionLocal);
        return null;
      }
      if (decision === 'vencida') {
        limpiarEstadoEnMemoria(AUTH_OFFLINE_EXPIRADA);
        setAvisoAuth(MENSAJE_VENTANA_OFFLINE_VENCIDA);
        throw error;
      }
      limpiarEstadoEnMemoria();
      setAvisoAuth(MENSAJE_SIN_DATOS_OFFLINE);
      throw error;
    }
  }

  useEffect(() => {
    const cerrarPorServidor = () => {
      const usuarioId = usuarioRef.current?.id;
      void cerrarSesionCompleta(usuarioId, { preservarOperaciones: true }).then(() => {
        setAvisoAuth('Tu sesión terminó. Inicia sesión con la misma cuenta para sincronizar las capturas pendientes.');
      });
    };
    window.addEventListener('auth:logout', cerrarPorServidor);
    const token = getToken();
    if (!token) setCargando(false);
    else refrescarSesion().catch(() => {}).finally(() => setCargando(false));
    return () => window.removeEventListener('auth:logout', cerrarPorServidor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => (
    (() => {
      let huboCorte = false;
      // Al recuperar conectividad, revalida la sesión y procesa la cola
      // tanto si la aplicación arrancó offline como si el corte ocurrió
      // durante una sesión que ya estaba confirmada online.
      return suscribirConectividad((estado) => {
        if (estado !== CONECTIVIDAD_ONLINE) {
          if (estado === CONECTIVIDAD_OFFLINE) huboCorte = true;
          return;
        }
        const veniaDeModoOffline = [AUTH_OFFLINE, AUTH_OFFLINE_EXPIRADA].includes(estadoAutenticacionRef.current);
        if (getToken() && usuarioRef.current && (huboCorte || veniaDeModoOffline)) {
          huboCorte = false;
          refrescarSesion().catch(() => {});
        }
      });
    })()
  ), []); // eslint-disable-line react-hooks/exhaustive-deps

  async function iniciarSesion(email, password) {
    setAvisoAuth(null);
    const data = await api.login(email, password);
    setToken(data.token);
    setUsuario(data.usuario);
    setEstadoAutenticacion(AUTH_ONLINE);
    aplicarPreferenciasApariencia(obtenerPreferenciasApariencia(data.usuario.id), data.usuario.id);
    await sincronizarCampo(data.usuario);
  }

  return (
    <AuthContext.Provider value={{
      usuario, cargando, avisoAuth, estadoAutenticacion, metadatosSync, preparacionOffline,
      iniciarSesion, cerrarSesion, refrescarSesion, sincronizarAhora: refrescarSesion,
    }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
