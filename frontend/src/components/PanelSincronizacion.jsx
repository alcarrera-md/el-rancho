import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, CloudOff, RefreshCw, RotateCcw, Trash2, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AUTH_ONLINE, useAuth } from '../auth/AuthContext.jsx';
import {
  descartarOperacion, etiquetaOperacion, obtenerEstadoCola, reintentarOperacion, suscribirColaOffline,
} from '../offline/colaOperaciones.js';
import { CONECTIVIDAD_ONLINE, obtenerEstadoConectividad, suscribirConectividad } from '../offline/connectivity.js';
import { describirConflicto, entidadAmigable, estadoGeneralSincronizacion, rutaParaVolverACapturar } from '../offline/syncUx.js';
import { formatearAntiguedad } from '../offline/formatoTiempo.js';
import ModalAccesible from './ModalAccesible.jsx';
import { EstadoCarga, EstadoVacio, FeedbackOperacion } from './EstadosUI.jsx';

function fecha(valor) {
  return valor ? new Date(valor).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : 'Sin fecha';
}

function FilaPendiente({ operacion, onReintentar, onDescartar }) {
  const error = operacion.ultimo_error;
  const estado = {
    error: 'Necesita reintento',
    sincronizando: 'Sincronizando',
    bloqueada: 'En espera de revisión',
  }[operacion.estado] || 'Guardado en este dispositivo';
  return (
    <li className={`sync-operation-card is-${operacion.estado}`}>
      <div className="sync-operation-icon" aria-hidden="true">{operacion.estado === 'error' ? <AlertTriangle /> : <Clock3 />}</div>
      <div className="sync-operation-copy">
        <span>{estado}</span>
        <strong>{etiquetaOperacion(operacion.tipo)}</strong>
        <p>{entidadAmigable(operacion)} · Capturada {fecha(operacion.fecha_local)}</p>
        {error?.message && <small>{error.message}</small>}
      </div>
      <div className="sync-operation-actions">
        {operacion.estado === 'error' && <button type="button" className="btn btn-ghost" onClick={() => onReintentar(operacion.id)} aria-label={`Reintentar ${etiquetaOperacion(operacion.tipo)}`}><RotateCcw /> Reintentar</button>}
        <button type="button" className="btn btn-ghost" onClick={() => onDescartar(operacion.id, false)} aria-label={`Descartar ${etiquetaOperacion(operacion.tipo)}`}><Trash2 /> Descartar</button>
      </div>
    </li>
  );
}

function TarjetaConflicto({ operacion, abierto, onRevisar, onDescartar, onRecapturar, focoRef }) {
  const detalle = describirConflicto(operacion);
  const ruta = rutaParaVolverACapturar(operacion);
  return (
    <li className="sync-conflict-card">
      <div className="sync-operation-icon" aria-hidden="true"><AlertTriangle /></div>
      <div className="sync-operation-copy">
        <span>Necesita revisión</span>
        <strong>{detalle.intento}</strong>
        <p>{detalle.entidad} · Capturada {fecha(operacion.fecha_local)} · Detectado {fecha(operacion.detectado_en)}</p>
      </div>
      <button type="button" className="btn btn-secondary" onClick={() => onRevisar(operacion.id)} aria-expanded={abierto} aria-controls={`conflicto-${operacion.id}`}>Revisar</button>
      {abierto && (
        <div id={`conflicto-${operacion.id}`} className="sync-conflict-detail" ref={focoRef} tabIndex="-1">
          <dl>
            <div><dt>Qué intentaste hacer</dt><dd>{detalle.intento} en {detalle.entidad.toLowerCase()}.</dd></div>
            <div><dt>Qué cambió</dt><dd>{detalle.cambio}</dd></div>
            <div><dt>Por qué no se aplicó</dt><dd>{detalle.motivo}</dd></div>
            <div><dt>Qué puedes hacer ahora</dt><dd>{detalle.siguiente}</dd></div>
          </dl>
          <div className="sync-operation-actions">
            {ruta && <button type="button" className="btn btn-primary" onClick={() => onRecapturar(operacion)}>Volver a capturar</button>}
            <button type="button" className="btn btn-ghost" onClick={() => onDescartar(operacion.id, true)}><Trash2 /> Descartar captura</button>
          </div>
        </div>
      )}
    </li>
  );
}

export default function PanelSincronizacion({ onCerrar, onSincronizar, sincronizando = false }) {
  const { usuario, estadoAutenticacion, metadatosSync } = useAuth();
  const navigate = useNavigate();
  const [estado, setEstado] = useState(null);
  const [conectividad, setConectividad] = useState(obtenerEstadoConectividad);
  const [mensaje, setMensaje] = useState('');
  const [conflictoAbierto, setConflictoAbierto] = useState(null);
  const focoConflicto = useRef(null);

  async function cargar() {
    if (!usuario?.id) return;
    setEstado(await obtenerEstadoCola(usuario.id));
  }

  useEffect(() => suscribirConectividad(setConectividad), []);
  useEffect(() => {
    void cargar();
    return suscribirColaOffline(usuario?.id, () => { void cargar(); });
  }, [usuario?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (conflictoAbierto) focoConflicto.current?.focus(); }, [conflictoAbierto]);

  async function sincronizar() {
    setMensaje('');
    try {
      await onSincronizar();
      await cargar();
      setMensaje('Sincronización terminada. Los cambios confirmados ya están en El Rancho.');
    } catch (error) {
      setMensaje(error?.status === 401 ? 'Tu sesión terminó. Inicia sesión con la misma cuenta para continuar.' : 'No se pudo completar el envío. Tus capturas siguen guardadas en este dispositivo.');
    }
  }

  async function reintentar(id) {
    await reintentarOperacion(id, usuario.id);
    await cargar();
  }

  async function descartar(id, conflicto) {
    if (!window.confirm('¿Descartar esta captura local? No podrá recuperarse.')) return;
    await descartarOperacion(id, usuario.id, { conflicto });
    if (conflicto) setConflictoAbierto(null);
    await cargar();
  }

  function recapturar(operacion) {
    const ruta = rutaParaVolverACapturar(operacion);
    if (!ruta) return;
    onCerrar();
    navigate(ruta);
  }

  const resumen = estadoGeneralSincronizacion({ conectividad, autenticacion: estadoAutenticacion, estado });
  const ultima = metadatosSync?.ultima_sincronizacion_exitosa || estado?.historial?.[0]?.sincronizada_en;
  const online = conectividad === CONECTIVIDAD_ONLINE && estadoAutenticacion === AUTH_ONLINE;

  return (
    <ModalAccesible titulo="Sincronización de campo" onCerrar={onCerrar} className="sync-panel-modal">
      <button type="button" className="modal-close-button sync-panel-close" data-modal-cerrar onClick={onCerrar} aria-label="Cerrar panel de sincronización"><X aria-hidden="true" /></button>
      <div className={`sync-overview is-${resumen.clave}`} role="status" aria-live="polite">
        <div className="sync-overview-icon" aria-hidden="true">{resumen.clave === 'listo' ? <CheckCircle2 /> : resumen.clave === 'offline' ? <CloudOff /> : resumen.clave === 'sincronizando' ? <RefreshCw className="is-spinning" /> : <AlertTriangle />}</div>
        <div><strong>{resumen.titulo}</strong><span>{resumen.detalle}</span></div>
      </div>
      <div className="sync-summary-grid" aria-label="Resumen de sincronización">
        <div><strong>{estado?.pendientes || 0}</strong><span>Pendientes</span></div>
        <div><strong>{estado?.errores || 0}</strong><span>Con error</span></div>
        <div><strong>{estado?.conflictos?.length || 0}</strong><span>Conflictos</span></div>
        <div><strong>{ultima ? formatearAntiguedad(ultima) : 'Aún no'}</strong><span>Última sincronización</span></div>
      </div>
      <FeedbackOperacion mensaje={mensaje} />

      {!estado ? <EstadoCarga mensaje="Revisando capturas de este dispositivo…" compacto /> : (
        <div className="sync-sections">
          <section aria-labelledby="sync-pendientes">
            <div className="sync-section-heading"><div><h3 id="sync-pendientes">Pendientes y errores</h3><p>Se envían en el orden en que fueron capturados.</p></div></div>
            {estado.operaciones.length ? <ul className="sync-operation-list">{estado.operaciones.map((operacion) => <FilaPendiente key={operacion.id} operacion={operacion} onReintentar={reintentar} onDescartar={descartar} />)}</ul> : <EstadoVacio titulo="No hay capturas pendientes" descripcion="Los cambios guardados ya fueron confirmados o no has capturado nada sin conexión." compacto />}
          </section>

          {estado.conflictos.length > 0 && <section aria-labelledby="sync-conflictos"><div className="sync-section-heading"><div><h3 id="sync-conflictos">Conflictos que necesitan revisión</h3><p>Ningún dato fue sobrescrito automáticamente.</p></div></div><ul className="sync-operation-list">{estado.conflictos.map((operacion) => <TarjetaConflicto key={operacion.id} operacion={operacion} abierto={conflictoAbierto === operacion.id} onRevisar={(id) => setConflictoAbierto((actual) => actual === id ? null : id)} onDescartar={descartar} onRecapturar={recapturar} focoRef={conflictoAbierto === operacion.id ? focoConflicto : null} />)}</ul></section>}

          <section aria-labelledby="sync-historial">
            <div className="sync-section-heading"><div><h3 id="sync-historial">Sincronizados recientemente</h3><p>Comprobantes de los últimos 7 días; no contienen el formulario completo.</p></div></div>
            {estado.historial.length ? <ul className="sync-history-list">{estado.historial.map((registro) => <li key={registro.id}><CheckCircle2 aria-hidden="true" /><div><strong>{etiquetaOperacion(registro.tipo)}</strong><span>{entidadAmigable(registro)} · {fecha(registro.sincronizada_en)}</span></div><small>{registro.resultado?.message || 'Sincronizado con El Rancho'}</small></li>)}</ul> : <EstadoVacio titulo="Aún no hay confirmaciones recientes" descripcion="Aquí aparecerán las capturas después de que El Rancho confirme su recepción." compacto />}
          </section>
        </div>
      )}

      <div className="modal-actions sync-panel-actions">
        <button type="button" className="btn btn-ghost" data-modal-cerrar onClick={onCerrar}>Cerrar</button>
        <button type="button" className="btn btn-primary" onClick={() => { void sincronizar(); }} disabled={!online || sincronizando || !estado?.operaciones?.length}><RefreshCw aria-hidden="true" /> {sincronizando ? 'Sincronizando…' : 'Sincronizar ahora'}</button>
      </div>
      {!online && estado?.operaciones?.length > 0 && <p className="offline-action-help" role="note">{estadoAutenticacion === AUTH_ONLINE ? 'Sin conexión. Tus capturas permanecen guardadas.' : 'Inicia sesión con la misma cuenta para enviar estas capturas.'}</p>}
    </ModalAccesible>
  );
}
