import { lazy, Suspense, useEffect, useReducer, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, CloudOff, RefreshCw } from 'lucide-react';
import { AUTH_ONLINE, useAuth } from '../auth/AuthContext.jsx';
import { CONECTIVIDAD_ONLINE, obtenerEstadoConectividad, suscribirConectividad } from '../offline/connectivity.js';
import { obtenerEstadoCola, suscribirColaOffline } from '../offline/colaOperaciones.js';
import { formatearAntiguedad, formatearFechaHora } from '../offline/formatoTiempo.js';
import { leerSesionLocal } from '../offline/campoDB.js';
import { diagnosticoAperturaOffline } from '../pwa.js';
import { estadoGeneralSincronizacion } from '../offline/syncUx.js';
import {
  ESTADO_PANEL_SYNC_INICIAL, ejecutarSincronizacionIndependiente, reducirEstadoPanelSync,
} from '../offline/syncPanelUi.js';
import { EstadoCarga, FeedbackOperacion } from './EstadosUI.jsx';

const PanelSincronizacion = lazy(() => import('./PanelSincronizacion.jsx'));

export default function SincronizacionConfiguracion() {
  const { usuario, estadoAutenticacion, metadatosSync, sincronizarAhora, preparacionOffline } = useAuth();
  const [sesionLocal, setSesionLocal] = useState(null);
  const apertura = diagnosticoAperturaOffline();
  const [conectividad, setConectividad] = useState(obtenerEstadoConectividad);
  const [estadoCola, setEstadoCola] = useState(null);
  const [estadoPanel, despacharPanel] = useReducer(reducirEstadoPanelSync, ESTADO_PANEL_SYNC_INICIAL);
  const [mensaje, setMensaje] = useState('');
  const sincronizacionActiva = useRef(false);

  async function cargarEstado() {
    if (!usuario?.id) return;
    setEstadoCola(await obtenerEstadoCola(usuario.id));
  }

  useEffect(() => suscribirConectividad(setConectividad), []);
  useEffect(() => {
    if (!usuario?.id) return;
    leerSesionLocal(usuario.id).then((sesion) => setSesionLocal(sesion || null)).catch(() => setSesionLocal(null));
  }, [usuario?.id, metadatosSync]);
  useEffect(() => {
    if (!usuario?.id) { setEstadoCola(null); return undefined; }
    void cargarEstado();
    return suscribirColaOffline(usuario.id, () => { void cargarEstado(); });
  }, [usuario?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function sincronizar() {
    if (sincronizacionActiva.current) return;
    sincronizacionActiva.current = true;
    setMensaje('');
    try {
      await ejecutarSincronizacionIndependiente(sincronizarAhora, despacharPanel);
      await cargarEstado();
      setMensaje('Sincronización finalizada. Las capturas confirmadas ya están en El Rancho.');
    } catch (error) {
      setMensaje(error?.status === 401
        ? 'Tu sesión terminó. Inicia sesión con la misma cuenta para continuar.'
        : 'No se pudo completar el envío. Tus capturas siguen guardadas en este dispositivo.');
    } finally {
      sincronizacionActiva.current = false;
    }
  }

  const resumen = estadoGeneralSincronizacion({ conectividad, autenticacion: estadoAutenticacion, estado: estadoCola });
  const ultima = metadatosSync?.ultima_sincronizacion_exitosa || estadoCola?.historial?.[0]?.sincronizada_en;
  // Sincronizar también descarga el snapshot: se permite aunque no haya
  // capturas pendientes, para preparar el trabajo sin conexión.
  const puedeSincronizar = conectividad === CONECTIVIDAD_ONLINE
    && estadoAutenticacion === AUTH_ONLINE
    && !estadoPanel.sincronizando;
  const IconoEstado = resumen.clave === 'listo' ? CheckCircle2 : resumen.clave === 'offline' ? CloudOff : resumen.clave === 'sincronizando' ? RefreshCw : AlertTriangle;

  if (!estadoCola) return <EstadoCarga mensaje="Revisando datos guardados en este dispositivo…" />;

  return (
    <>
      <section className="card sync-settings-card" aria-labelledby="sync-settings-title">
        <div className={`sync-settings-status is-${resumen.clave}`} role="status" aria-live="polite">
          <span className="sync-overview-icon" aria-hidden="true"><IconoEstado className={resumen.clave === 'sincronizando' ? 'is-spinning' : ''} /></span>
          <div><h2 id="sync-settings-title">{resumen.titulo}</h2><p>{resumen.detalle}</p></div>
        </div>
        <dl className="sync-settings-summary">
          <div><dt>Última sincronización</dt><dd>{ultima ? formatearAntiguedad(ultima) : 'Aún no registrada'}</dd></div>
          <div><dt>Pendientes</dt><dd>{estadoCola.pendientes || 0}</dd></div>
          <div><dt>Conflictos</dt><dd>{estadoCola.conflictos?.length || 0}</dd></div>
          <div><dt>Conexión</dt><dd>{conectividad === CONECTIVIDAD_ONLINE ? 'Disponible' : 'Sin conexión'}</dd></div>
          <div><dt>Trabajo sin conexión</dt><dd>{preparacionOffline?.ok === false
            ? `No preparado: ${preparacionOffline.mensaje}`
            : sesionLocal?.ventana_offline_expira_en ? `Disponible hasta ${formatearFechaHora(sesionLocal.ventana_offline_expira_en)}` : 'Sincroniza con conexión para prepararlo'}</dd></div>
          <div><dt>Abrir sin conexión</dt><dd>{apertura.texto}</dd></div>
        </dl>
        <p className="sync-settings-help">Las capturas pendientes permanecen separadas por usuario en este dispositivo hasta que El Rancho confirme su recepción.</p>
        <FeedbackOperacion mensaje={mensaje} />
        <div className="settings-card-actions sync-settings-actions">
          <button type="button" className="btn btn-secondary" onClick={() => despacharPanel({ type: 'abrir' })}>Ver sincronización</button>
          <button type="button" className="btn btn-primary" onClick={() => { void sincronizar(); }} disabled={!puedeSincronizar}>
            <RefreshCw aria-hidden="true" className={estadoPanel.sincronizando ? 'is-spinning' : ''} />
            {estadoPanel.sincronizando ? 'Sincronizando…' : 'Sincronizar ahora'}
          </button>
        </div>
      </section>

      {estadoPanel.abierto && (
        <Suspense fallback={<div className="route-loading route-loading-inline" role="status">Preparando sincronización…</div>}>
          <PanelSincronizacion
            onCerrar={() => despacharPanel({ type: 'cerrar' })}
            onSincronizar={sincronizar}
            sincronizando={estadoPanel.sincronizando}
          />
        </Suspense>
      )}
    </>
  );
}
