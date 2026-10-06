import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { AUTH_OFFLINE, useAuth } from '../auth/AuthContext.jsx';
import { ROLES, tienePermiso } from '../authorization/permissions.js';
import { fechaLocalISO } from '../fieldActions.js';
import {
  agruparMisTareas, ejecutarCargaEnEfecto, esTareaVencida, ESTADOS_TAREA,
  etiquetaDe, normalizarTarea, PRIORIDADES_TAREA, resumirTareas, textoCantidadSugerida, TIPOS_TAREA,
} from '../tareas.js';
import NuevaTareaModal from './NuevaTareaModal.jsx';
import { PresentacionPantalla } from './PresentacionGuiada.jsx';
import { EstadoCarga, EstadoError, EstadoVacio, FeedbackOperacion } from './EstadosUI.jsx';
import { accionesContextualesTarea } from '../navigationContext.js';
import { useAlertas } from '../context/AlertasContext.jsx';
import IndicadorDatosLocales from './IndicadorDatosLocales.jsx';
import { CONECTIVIDAD_OFFLINE, esFalloDeConectividad, obtenerEstadoConectividad } from '../offline/connectivity.js';
import { ALMACEN_TAREAS, leerColeccionLocal } from '../offline/campoDB.js';
import {
  capturarConSoporteOffline, metadataOperacion, obtenerEstadoCola, suscribirColaOffline, TIPO_OPERACION,
} from '../offline/colaOperaciones.js';

function formatearFecha(fecha) {
  if (!fecha) return 'Sin fecha límite';
  return new Date(`${fecha.slice(0, 10)}T12:00:00`).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' });
}

function TarjetaTarea({ tarea: original, hoy, destacada = false, puedeAdministrar, puedeCompletar, sinConexion, procesando, onCompletar, onEditar, onCancelar, onEliminar, onNavegar }) {
  const tarea = normalizarTarea(original);
  const accionesContexto = accionesContextualesTarea(tarea);
  const cantidadSugerida = textoCantidadSugerida(tarea);
  const vencida = esTareaVencida(tarea, hoy);
  const terminada = ['completada', 'cancelada'].includes(tarea.estado);
  return (
    <details id={destacada ? 'tarea-contexto' : undefined} open={destacada || undefined} className={`task-card prioridad-${tarea.prioridad} ${terminada ? 'task-finished' : ''}`}>
      <summary>
        <div className="task-card-main">
          <div className="task-card-kicker">
            <span className={`task-status estado-${tarea.estado}`}>{etiquetaDe(ESTADOS_TAREA, tarea.estado)}</span>
            <span className={`task-priority prioridad-${tarea.prioridad}`}>{etiquetaDe(PRIORIDADES_TAREA, tarea.prioridad)}</span>
            {vencida && <span className="task-overdue">Vencida</span>}
            {tarea._offline_pendiente && <span className="task-status estado-en_progreso">{tarea._offline_estado === 'error' ? 'Finalización con error' : tarea._offline_estado === 'bloqueada' ? 'Finalización en espera de revisión' : 'Finalización pendiente de sincronizar'}</span>}
          </div>
          <h3>{tarea.titulo}</h3>
          <p>{etiquetaDe(TIPOS_TAREA, tarea.tipo)} · {tarea.corrales_texto || tarea.animal_arete || 'Sin ubicación específica'}</p>
        </div>
        <div className="task-card-date"><span>Fecha límite</span><strong>{formatearFecha(tarea.fecha_limite)}</strong></div>
      </summary>
      <div className="task-card-detail">
        <p>{tarea.descripcion}</p>
        <dl>
          <div><dt>Responsable</dt><dd>{tarea.responsable}</dd></div>
          <div><dt>Corrales</dt><dd>{tarea.corrales_texto || 'Sin corral'}{tarea.animal_arete ? ` · Animal ${tarea.animal_arete}${tarea.animal_alias ? ` (${tarea.animal_alias})` : ''}` : ''}</dd></div>
          {tarea.insumo && <div><dt>Insumo</dt><dd>{tarea.insumo}</dd></div>}
          {cantidadSugerida && <div><dt>Cantidad sugerida</dt><dd>{cantidadSugerida}</dd></div>}
          <div><dt>Asignada por</dt><dd>{tarea.creador || 'No registrado'}</dd></div>
          {tarea.completado_en && <div><dt>Completada</dt><dd>{new Date(tarea.completado_en).toLocaleString('es-MX')}</dd></div>}
        </dl>
        {accionesContexto.length > 0 && <div className="task-context-actions" aria-label="Abrir contexto de la tarea">{accionesContexto.map((accion) => <button type="button" key={accion.id} className="btn btn-ghost" onClick={() => onNavegar(accion.ruta)}>{accion.etiqueta}</button>)}</div>}
        <div className="task-card-actions">
          {puedeCompletar && tarea.estado !== 'cancelada' && !tarea._offline_pendiente && (tarea.estado !== 'completada' || (puedeAdministrar && !sinConexion)) && (
            <button className="btn btn-primary" disabled={procesando} onClick={() => onCompletar(tarea)}>
              {procesando ? 'Guardando…' : tarea.estado === 'completada' ? 'Reabrir tarea' : sinConexion ? 'Guardar como completada' : 'Marcar como completada'}
            </button>
          )}
          {puedeAdministrar && <button className="btn btn-ghost" disabled={sinConexion} onClick={() => onEditar(tarea)}>Editar o reasignar</button>}
          {puedeAdministrar && !terminada && <button className="btn btn-ghost" disabled={sinConexion} onClick={() => onCancelar(tarea)}>Cancelar tarea</button>}
          {puedeAdministrar && <button className="btn btn-ghost task-delete" disabled={sinConexion} onClick={() => onEliminar(tarea)}>Eliminar</button>}
        </div>
        {sinConexion && puedeCompletar && !tarea._offline_pendiente && tarea.estado !== 'completada' && tarea.estado !== 'cancelada' && <p className="offline-action-help" role="note">Puedes guardar la finalización ahora; se comprobará la versión y asignación al sincronizar.</p>}
        {sinConexion && puedeAdministrar && <p className="offline-action-help" role="note">Editar, reasignar, cancelar o eliminar requiere conexión.</p>}
      </div>
    </details>
  );
}

function SeccionTareas({ titulo, descripcion, tareas, vacio, tareaContextoId, ...acciones }) {
  return (
    <section className="task-section" aria-labelledby={`tareas-${titulo.replace(/\s+/g, '-').toLowerCase()}`}>
      <div className="guided-section-heading"><div><h2 id={`tareas-${titulo.replace(/\s+/g, '-').toLowerCase()}`}>{titulo}</h2>{descripcion && <p>{descripcion}</p>}</div></div>
      {tareas.length === 0 ? <EstadoVacio titulo={vacio} compacto /> : <div className="task-list">{tareas.map((tarea) => <TarjetaTarea key={tarea.id} tarea={tarea} destacada={String(tarea.id) === tareaContextoId} {...acciones} procesando={acciones.procesando.has(tarea.id)} />)}</div>}
    </section>
  );
}

export default function TareasList() {
  const { usuario, estadoAutenticacion } = useAuth();
  const sinConexion = estadoAutenticacion === AUTH_OFFLINE || obtenerEstadoConectividad() === CONECTIVIDAD_OFFLINE;
  const navigate = useNavigate();
  const [parametros] = useSearchParams();
  const tareaContextoId = parametros.get('tarea');
  const { refrescar: refrescarBadges, registrarCambioTarea } = useAlertas() || {};
  const esAdmin = usuario?.rol === ROLES.ADMINISTRADOR;
  const esTrabajoPropio = [ROLES.TRABAJADOR, ROLES.VETERINARIO].includes(usuario?.rol);
  const puedeAsignar = tienePermiso(usuario?.rol, 'asignaciones', 'crear');
  const puedeAdministrar = tienePermiso(usuario?.rol, 'asignaciones', 'editar');
  const puedeCompletar = tienePermiso(usuario?.rol, 'asignaciones', 'completar');
  const hoy = fechaLocalISO();

  const [tareas, setTareas] = useState(null);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null);
  const [procesando, setProcesando] = useState(() => new Set());
  const procesandoRef = useRef(new Set());
  const [confirmacion, setConfirmacion] = useState('');
  const [filtros, setFiltros] = useState({ responsable: '', corral: '', estado: '', tipo: '', prioridad: '' });
  const filtrosActivos = Object.values(filtros).filter(Boolean).length;
  const [fuenteLocal, setFuenteLocal] = useState(false);
  const [sincronizadoEn, setSincronizadoEn] = useState(null);
  const [operacionesLocal, setOperacionesLocal] = useState([]);

  async function cargarCola() {
    if (!usuario?.id) return;
    const estadoCola = await obtenerEstadoCola(usuario.id).catch(() => null);
    if (estadoCola) setOperacionesLocal(estadoCola.operaciones);
  }

  async function cargar() {
    setError(null);
    if (sinConexion && usuario?.id) {
      const local = await leerColeccionLocal(ALMACEN_TAREAS, usuario.id).catch(() => null);
      if (local) {
        setTareas(local.datos);
        setSincronizadoEn(local.sincronizado_en);
        setFuenteLocal(true);
        return;
      }
      setTareas([]);
      setFuenteLocal(true);
      setError('No hay una copia local de Tareas. Conéctate a Internet para sincronizarla.');
      return;
    }
    try {
      const data = await api.listarTareas();
      setTareas(data);
      setFuenteLocal(false);
    } catch (err) {
      // La lista siempre cae al snapshot local ante un fallo real de red.
      // La finalización se guarda aparte en la cola v2 y se superpone en
      // la tarjeta; nunca se altera el snapshot base antes del servidor.
      if (esFalloDeConectividad(err) && usuario?.id) {
        const local = await leerColeccionLocal(ALMACEN_TAREAS, usuario.id).catch(() => null);
        if (local) {
          setTareas(local.datos);
          setSincronizadoEn(local.sincronizado_en);
          setFuenteLocal(true);
          return;
        }
      }
      setError(err.message);
    }
  }
  useEffect(() => ejecutarCargaEnEfecto(cargar), [sinConexion, usuario?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    void cargarCola();
    return suscribirColaOffline(usuario?.id, () => { void cargarCola(); });
  }, [usuario?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const tareasConCola = useMemo(() => {
    // Toda finalización local sin confirmar (pendiente, enviándose, en espera
    // o con error) se muestra aparte; la tarea conserva su estado del servidor.
    const pendientes = new Map(operacionesLocal
      .filter((op) => op.tipo === TIPO_OPERACION.COMPLETAR_TAREA && ['pendiente', 'sincronizando', 'bloqueada', 'error'].includes(op.estado))
      .map((op) => [Number(op.entidad_id), op.estado]));
    return (tareas || []).map((tarea) => ({ ...tarea, _offline_pendiente: pendientes.has(Number(tarea.id)), _offline_estado: pendientes.get(Number(tarea.id)) || null }));
  }, [tareas, operacionesLocal]);
  const normalizadas = useMemo(() => tareasConCola.map(normalizarTarea), [tareasConCola]);
  useEffect(() => {
    if (!tareaContextoId || !normalizadas.length || typeof window === 'undefined') return undefined;
    const frame = window.requestAnimationFrame(() => document.getElementById('tarea-contexto')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    return () => window.cancelAnimationFrame(frame);
  }, [tareaContextoId, normalizadas.length]);
  const resumen = useMemo(() => resumirTareas(normalizadas, hoy), [normalizadas, hoy]);
  const grupos = useMemo(() => agruparMisTareas(normalizadas, hoy), [normalizadas, hoy]);
  const responsables = useMemo(() => [...new Map(normalizadas.map((tarea) => [tarea.trabajador_id, tarea.responsable])).entries()], [normalizadas]);
  const corrales = useMemo(() => [...new Map(normalizadas.flatMap((tarea) => tarea.corrales.map((corral) => [corral.id, corral.nombre]))).entries()], [normalizadas]);
  const filtradas = normalizadas.filter((tarea) => (
    (!filtros.responsable || String(tarea.trabajador_id) === filtros.responsable)
    && (!filtros.corral || tarea.corral_ids.some((id) => String(id) === filtros.corral))
    && (!filtros.estado || tarea.estado === filtros.estado)
    && (!filtros.tipo || tarea.tipo === filtros.tipo)
    && (!filtros.prioridad || tarea.prioridad === filtros.prioridad)
  ));

  async function alternarCompletada(tarea) {
    if (procesandoRef.current.has(tarea.id)) return;
    procesandoRef.current.add(tarea.id);
    setProcesando((actual) => new Set(actual).add(tarea.id));
    setError(null);
    try {
      const nuevoEstado = tarea.estado === 'completada' ? 'pendiente' : 'completada';
      let resultado;
      if (tarea.estado === 'completada') {
        resultado = await api.completarTarea(tarea.id, false, tarea.version);
      } else {
        const payload = { completada: true, expected_version: tarea.version };
        resultado = await capturarConSoporteOffline({
          usuario, sinConexion, tipo: TIPO_OPERACION.COMPLETAR_TAREA, entidadId: tarea.id, payload,
          contextoPublico: { entidad: tarea.titulo || 'Tarea asignada' },
          ejecutarOnline: (operacion) => api.completarTarea(tarea.id, true, tarea.version, metadataOperacion(operacion, false)),
        });
      }
      if (!resultado?.offline_pending) registrarCambioTarea?.(tarea.estado, nuevoEstado);
      setConfirmacion(resultado?.offline_pending
        ? 'Finalización guardada en este dispositivo. Se validará al recuperar conexión.'
        : tarea.estado === 'completada' ? 'La tarea volvió a quedar pendiente.' : 'Tarea completada correctamente.');
      await Promise.all([cargar(), cargarCola()]);
      if (!resultado?.offline_pending) void refrescarBadges?.();
    } catch (err) {
      setError(err.message);
    } finally {
      procesandoRef.current.delete(tarea.id);
      setProcesando((actual) => { const siguiente = new Set(actual); siguiente.delete(tarea.id); return siguiente; });
    }
  }

  async function cancelar(tarea) {
    if (!window.confirm(`¿Cancelar la tarea “${tarea.titulo}”?`)) return;
    try {
      await api.editarTarea(tarea.id, { estado: 'cancelada' });
      registrarCambioTarea?.(tarea.estado, 'cancelada');
      setConfirmacion('Tarea cancelada. Se conserva en el historial.');
      await cargar();
      void refrescarBadges?.();
    } catch (err) { setError(err.message); }
  }

  async function eliminar(tarea) {
    if (!window.confirm(`¿Eliminar definitivamente la tarea “${tarea.titulo}”?`)) return;
    try {
      await api.eliminarTarea(tarea.id);
      registrarCambioTarea?.(tarea.estado, null);
      setConfirmacion('Tarea eliminada.');
      await cargar();
      void refrescarBadges?.();
    } catch (err) { setError(err.message); }
  }

  const acciones = { hoy, puedeAdministrar, puedeCompletar, sinConexion: sinConexion || fuenteLocal, procesando, onCompletar: alternarCompletada, onEditar: setModal, onCancelar: cancelar, onEliminar: eliminar, onNavegar: navigate };

  return (
    <div>
      <PresentacionPantalla
        etiqueta="Trabajo del equipo"
        titulo={esTrabajoPropio ? 'Mi trabajo pendiente' : 'Trabajo pendiente del equipo'}
        descripcion={esTrabajoPropio ? 'Consulta qué trabajo tienes asignado y registra cuando lo termines.' : 'Asigna, organiza y da seguimiento al trabajo operativo del rancho.'}
        accion={puedeAsignar ? <button className="btn btn-primary" onClick={() => setModal('nueva')} disabled={sinConexion} title={sinConexion ? 'Conéctate para asignar tareas.' : undefined}>+ Asignar tarea</button> : null}
      />

      <section className="task-attention" aria-labelledby="tareas-atencion">
        <div className="guided-section-heading"><span className="guided-step">Atención</span><div><h2 id="tareas-atencion">{esTrabajoPropio ? 'Lo que necesita tu atención' : 'Estado del trabajo'}</h2><p>Resumen calculado con las tareas visibles para tu cuenta.</p></div></div>
        <div className="task-stats">
          <div><strong>{resumen.hoy}</strong><span>Para hoy</span></div>
          <div className={resumen.vencidas ? 'alerta' : ''}><strong>{resumen.vencidas}</strong><span>Vencidas</span></div>
          <div><strong>{resumen.pendientes}</strong><span>Pendientes</span></div>
          <div><strong>{resumen.completadas}</strong><span>Completadas</span></div>
        </div>
      </section>

      {fuenteLocal && <IndicadorDatosLocales sincronizadoEn={sincronizadoEn} />}
      {error && <EstadoError mensaje={error} onReintentar={cargar} />}
      <FeedbackOperacion mensaje={confirmacion} />

      {tareas === null ? <EstadoCarga mensaje="Cargando tareas…" /> : (
        <>
          {esAdmin && (
            <section className="task-filters" aria-labelledby="tareas-filtros">
              <div className="task-filters-header"><div><h2 id="tareas-filtros">Filtrar tareas</h2><p>Encuentra rápidamente el trabajo que necesitas revisar.</p></div><div className="task-filter-summary">{filtrosActivos > 0 && <span>{filtrosActivos} {filtrosActivos === 1 ? 'filtro activo' : 'filtros activos'}</span>}<button type="button" className="btn btn-ghost" onClick={() => setFiltros({ responsable: '', corral: '', estado: '', tipo: '', prioridad: '' })} disabled={!filtrosActivos}>Limpiar filtros</button></div></div>
              <div className="task-filter-grid">
                <label>Responsable<select value={filtros.responsable} onChange={(e) => setFiltros((f) => ({ ...f, responsable: e.target.value }))}><option value="">Todos</option>{responsables.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}</select></label>
                <label>Corral<select value={filtros.corral} onChange={(e) => setFiltros((f) => ({ ...f, corral: e.target.value }))}><option value="">Todos</option>{corrales.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}</select></label>
                <label>Estado<select value={filtros.estado} onChange={(e) => setFiltros((f) => ({ ...f, estado: e.target.value }))}><option value="">Todos</option>{ESTADOS_TAREA.map((opcion) => <option key={opcion.value} value={opcion.value}>{opcion.label}</option>)}</select></label>
                <label>Actividad<select value={filtros.tipo} onChange={(e) => setFiltros((f) => ({ ...f, tipo: e.target.value }))}><option value="">Todas</option>{TIPOS_TAREA.map((opcion) => <option key={opcion.value} value={opcion.value}>{opcion.label}</option>)}</select></label>
                <label>Prioridad<select value={filtros.prioridad} onChange={(e) => setFiltros((f) => ({ ...f, prioridad: e.target.value }))}><option value="">Todas</option>{PRIORIDADES_TAREA.map((opcion) => <option key={opcion.value} value={opcion.value}>{opcion.label}</option>)}</select></label>
              </div>
            </section>
          )}

          {esTrabajoPropio ? (
            <>
              <SeccionTareas titulo="Mis tareas de hoy" descripcion="Incluye lo programado para hoy y cualquier pendiente vencido." tareas={grupos.hoy} vacio="No tienes tareas para hoy" tareaContextoId={tareaContextoId} {...acciones} />
              <SeccionTareas titulo="Próximas tareas" tareas={grupos.proximas} vacio="No tienes próximas tareas" tareaContextoId={tareaContextoId} {...acciones} />
              <SeccionTareas titulo="Completadas" tareas={grupos.completadas} vacio="Todavía no hay tareas completadas" tareaContextoId={tareaContextoId} {...acciones} />
            </>
          ) : (
            <SeccionTareas titulo="Detalle de tareas" descripcion={usuario?.rol === ROLES.AUDITOR ? 'Consulta de solo lectura.' : 'Abre una tarea para consultar o administrar sus datos.'} tareas={filtradas} vacio="No hay tareas que coincidan con los filtros" tareaContextoId={tareaContextoId} {...acciones} />
          )}
        </>
      )}

      {modal && puedeAdministrar && !sinConexion && (
        <NuevaTareaModal
          tarea={modal === 'nueva' ? null : modal}
          onCerrar={() => setModal(null)}
          onCreado={(mensaje) => { setModal(null); setConfirmacion(mensaje); cargar(); refrescarBadges?.(); }}
        />
      )}
    </div>
  );
}
