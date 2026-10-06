import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EVENTO_FORMULARIOS_SUCIOS, hayFormularioSucio } from '../appLifecycle.js';
import {
  EVENTO_ACTUALIZACION_BLOQUEADA, EVENTO_ACTUALIZACION_PWA, MENSAJE_OFFLINE,
  registrarServiceWorker, solicitarActualizacionPwa,
} from '../pwa.js';
import { useFeedbackOperacion } from '../context/FeedbackOperacionContext.jsx';
import { CONECTIVIDAD_COMPROBANDO, CONECTIVIDAD_OFFLINE, CONECTIVIDAD_ONLINE, obtenerEstadoConectividad, suscribirConectividad } from '../offline/connectivity.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { obtenerEstadoCola, suscribirColaOffline } from '../offline/colaOperaciones.js';
import { resumenEstadoCompacto } from '../offline/syncUx.js';

export default function EstadoPwa() {
  const { mostrarExito, mostrarError } = useFeedbackOperacion();
  const { metadatosSync, usuario, preparacionOffline } = useAuth();
  const [cola, setCola] = useState(null);
  // §7: la conectividad mostrada acá viene del módulo combinado
  // (navigator.onLine + comprobación real contra /api/health), no solo
  // del evento crudo del navegador.
  const [conectividad, setConectividad] = useState(obtenerEstadoConectividad);
  const [registro, setRegistro] = useState(null);
  const [formularioSucio, setFormularioSucio] = useState(hayFormularioSucio);

  useEffect(() => {
    let registroActivo = null;
    let intervaloActualizacion = null;
    let eraOffline = conectividad === CONECTIVIDAD_OFFLINE;
    const cancelarConectividad = suscribirConectividad((estado) => {
      setConectividad(estado);
      if (estado === CONECTIVIDAD_ONLINE && eraOffline) {
        mostrarExito({ titulo: 'Conexión recuperada', mensaje: 'Se está actualizando la información sincronizada.' });
      }
      eraOffline = estado === CONECTIVIDAD_OFFLINE;
    });
    const actualizacion = (evento) => setRegistro(evento.detail?.registro || null);
    const bloqueada = () => mostrarError({ titulo: 'Actualización pendiente', mensaje: 'Guarda o descarta los cambios del formulario antes de actualizar.' });
    const cambioFormulario = () => setFormularioSucio(hayFormularioSucio());
    window.addEventListener(EVENTO_ACTUALIZACION_PWA, actualizacion);
    window.addEventListener(EVENTO_ACTUALIZACION_BLOQUEADA, bloqueada);
    window.addEventListener(EVENTO_FORMULARIOS_SUCIOS, cambioFormulario);
    const revisarVersion = () => {
      if (document.visibilityState === 'visible') registroActivo?.update().catch(() => {});
    };
    registrarServiceWorker().then((registrado) => {
      registroActivo = registrado;
      if (registrado) intervaloActualizacion = window.setInterval(revisarVersion, 60 * 60 * 1000);
    }).catch((error) => console.warn('[pwa-registration]', error));
    document.addEventListener('visibilitychange', revisarVersion);
    return () => {
      cancelarConectividad();
      window.removeEventListener(EVENTO_ACTUALIZACION_PWA, actualizacion);
      window.removeEventListener(EVENTO_ACTUALIZACION_BLOQUEADA, bloqueada);
      window.removeEventListener(EVENTO_FORMULARIOS_SUCIOS, cambioFormulario);
      document.removeEventListener('visibilitychange', revisarVersion);
      if (intervaloActualizacion) window.clearInterval(intervaloActualizacion);
    };
  }, [mostrarError, mostrarExito]);

  // Contadores de la cola común (P8.1): pendientes, en espera y conflictos.
  useEffect(() => {
    if (!usuario?.id) { setCola(null); return undefined; }
    let vigente = true;
    const leer = () => obtenerEstadoCola(usuario.id).then((estado) => { if (vigente) setCola(estado); }).catch(() => {});
    void leer();
    const cancelar = suscribirColaOffline(usuario.id, leer);
    return () => { vigente = false; cancelar(); };
  }, [usuario?.id]);

  const resumen = resumenEstadoCompacto({ conectividad, cola, ultimaSincronizacion: metadatosSync?.ultima_sincronizacion_exitosa, preparacionOffline });

  function actualizar() {
    if (solicitarActualizacionPwa(registro)) setRegistro(null);
  }

  return (
    <div className="pwa-status-region" aria-label="Estado de la aplicación">
      {conectividad === CONECTIVIDAD_OFFLINE && resumen.offline && <div className="pwa-offline-status" role="status" aria-live="polite"><strong>{resumen.offline.titulo}</strong><span>{resumen.offline.detalle || MENSAJE_OFFLINE}</span></div>}
      {conectividad === CONECTIVIDAD_ONLINE && resumen.chip && usuario?.id && <Link to="/configuracion/sincronizacion" className={`pwa-sync-chip is-${resumen.chip.clave}`} role="status">{resumen.chip.texto}</Link>}
      {conectividad === CONECTIVIDAD_COMPROBANDO && <div className="pwa-checking-status" role="status"><span className="sr-only">Comprobando conexión</span></div>}
      {registro && (
        <div className="pwa-update-notice" role="status" aria-live="polite">
          <div><strong>Nueva versión disponible</strong><small>{formularioSucio ? 'Termina el formulario abierto para poder actualizar.' : 'Puedes aplicarla cuando estés listo.'}</small></div>
          <button type="button" className="btn btn-primary" onClick={actualizar} disabled={formularioSucio}>Actualizar aplicación</button>
        </div>
      )}
    </div>
  );
}
