import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext.jsx';
import { IconoLupa } from './Iconos.jsx';
import { tienePermiso } from '../authorization/permissions.js';
import { EstadoCarga, EstadoError, EstadoVacio, FeedbackOperacion } from './EstadosUI.jsx';
import { EncabezadoDetalle, PresentacionPantalla } from './PresentacionGuiada.jsx';

const ETIQUETAS_ACCION = {
  crear_animal: 'Alta de animal',
  importar_animales: 'Importación masiva de animales',
  editar_animal: 'Edición de animal',
  dar_baja_animal: 'Baja de animal',
  cambiar_estado_salud: 'Cambio de estado de salud',
  cambiar_categoria: 'Cambio de categoría',
  editar_animal_ia: 'Edición de animal (vía asistente IA)',
  editar_trabajador_ia: 'Edición de trabajador (vía asistente IA)',
  editar_usuario_ia: 'Edición de usuario (vía asistente IA)',
  crear_tarea: 'Asignación de tarea',
  editar_tarea: 'Edición o reasignación de tarea',
  completar_tarea: 'Tarea completada',
  reabrir_tarea: 'Tarea reabierta',
  eliminar_tarea: 'Eliminación de tarea',
  bloqueo_cuenta: 'Bloqueo de cuenta por intentos fallidos',
  desbloquear_usuario: 'Desbloqueo de cuenta',
  login: 'Inicio de sesión',
  comprar_insumo: 'Compra de insumo',
  crear_corral: 'Alta de corral',
  editar_corral: 'Edición de corral',
  comprar_animal: 'Registro de compra de animal',
  comprar_animal_nuevo: 'Alta de animal por compra',
  registrar_gasto: 'Registro de gasto',
  editar_configuracion: 'Edición de configuración',
  editar_modulos: 'Edición de módulos activos',
  registrar_venta: 'Registro de venta',
  registrar_venta_lote: 'Registro de venta por lote',
  crear_usuario: 'Alta de usuario',
  editar_usuario: 'Edición de usuario',
  envio_corte_diario: 'Envío del corte diario por correo',
  agregar_destinatario_corte: 'Alta de destinatario extra del corte diario',
  quitar_destinatario_corte: 'Baja de destinatario extra del corte diario',
};
const OPCIONES_ACCION = Object.entries(ETIQUETAS_ACCION).sort((a, b) => a[1].localeCompare(b[1], 'es'));

// Fecha calendario LOCAL de un timestamp — no usar .slice(0,10) sobre un
// ISO string directo, porque eso da la fecha en UTC y puede caer en el
// día equivocado según la zona horaria.
function fechaLocal(fechaISO) {
  const d = new Date(fechaISO);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function formatearHora(fecha) {
  return new Date(fecha).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}
function formatearFechaLarga(fechaISO) {
  return new Date(`${fechaISO}T12:00:00`).toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function agruparPorDia(eventos) {
  const grupos = new Map();
  for (const e of eventos) {
    const dia = fechaLocal(e.fecha);
    if (!grupos.has(dia)) grupos.set(dia, []);
    grupos.get(dia).push(e);
  }
  return [...grupos.entries()]; // ya viene en orden porque el backend ordena por fecha DESC
}

function detalleSeguro(detalle) {
  if (!detalle) return null;
  try {
    return JSON.stringify(detalle, null, 2);
  } catch {
    return 'El detalle no puede mostrarse en formato estructurado.';
  }
}

export default function BitacoraList() {
  const { usuario } = useAuth();
  const puedeLeer = tienePermiso(usuario?.rol, 'bitacora', 'leer');
  const puedeEnviarCorte = tienePermiso(usuario?.rol, 'bitacora', 'enviar_corte');
  const [eventos, setEventos] = useState(null);
  const [cortes, setCortes] = useState({}); // { 'YYYY-MM-DD': {enviado_en, enviado_por, ...} }
  const [usuariosDisponibles, setUsuariosDisponibles] = useState([]);
  const [error, setError] = useState(null);
  const [enviandoFecha, setEnviandoFecha] = useState(null);
  const [confirmacion, setConfirmacion] = useState('');
  const [diasAbiertos, setDiasAbiertos] = useState({});

  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [usuarioId, setUsuarioId] = useState('');
  const [accion, setAccion] = useState('');
  const [q, setQ] = useState('');

  // Se cargan una sola vez: no dependen de los filtros de abajo.
  useEffect(() => {
    if (!puedeLeer) return;
    api.cortesDiarios().then((rows) => setCortes(Object.fromEntries(rows.map((r) => [r.fecha.slice(0, 10), r])))).catch(() => {});
    api.usuariosBitacora().then(setUsuariosDisponibles).catch(() => {});
  }, [puedeLeer]);

  function parametrosActuales() {
    const params = {};
    if (desde) params.desde = desde;
    if (hasta) params.hasta = hasta;
    if (usuarioId) params.usuario_id = usuarioId;
    if (accion) params.accion = accion;
    if (q) params.q = q;

    return params;
  }

  function cargarEventos() {
    setError(null);
    return api.listarBitacora(parametrosActuales()).then(setEventos).catch((err) => setError(err.message));
  }

  // Filtros combinados: todos se mandan juntos al backend, con un pequeño debounce.
  useEffect(() => {
    const t = setTimeout(cargarEventos, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta, usuarioId, accion, q]);

  async function enviarCorte(fecha) {
    setEnviandoFecha(fecha);
    setError(null);
    try {
      const corte = await api.enviarCorteDiario(fecha);
      setCortes((c) => ({ ...c, [fecha]: corte }));
      setConfirmacion(`Corte del ${formatearFechaLarga(fecha)} enviado correctamente.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviandoFecha(null);
    }
  }

  const grupos = eventos ? agruparPorDia(eventos) : [];
  const hayFiltrosActivos = desde || hasta || usuarioId || accion || q;
  const usuariosEnResultado = eventos ? new Set(eventos.map((evento) => evento.usuario).filter(Boolean)).size : null;

  return (
    <div>
      <PresentacionPantalla
        etiqueta="Trazabilidad"
        titulo="Qué ha ocurrido en el sistema"
        descripcion="Consulta quién realizó cada cambio, cuándo ocurrió y qué información quedó registrada para su revisión."
      />

      <div className="resumen-grid">
        <div className="card resumen-item"><div className="valor">{eventos?.length ?? '—'}</div><div className="etiqueta">Eventos visibles</div></div>
        <div className="card resumen-item"><div className="valor">{eventos ? grupos.length : '—'}</div><div className="etiqueta">Días con actividad</div></div>
        <div className="card resumen-item"><div className="valor">{usuariosEnResultado ?? '—'}</div><div className="etiqueta">Usuarios en el resultado</div></div>
      </div>

      <details className="module-toolbar-details">
        <summary>Buscar y filtrar eventos{hayFiltrosActivos ? ' · filtros activos' : ''}</summary>
      <div className="toolbar">
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="bitacora-desde">Desde</label>
          <input id="bitacora-desde" className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="bitacora-hasta">Hasta</label>
          <input id="bitacora-hasta" className="input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="bitacora-usuario">Usuario</label>
          <select id="bitacora-usuario" value={usuarioId} onChange={(e) => setUsuarioId(e.target.value)} style={{ maxWidth: 200 }}>
            <option value="">Todos los usuarios</option>
            {usuariosDisponibles.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="bitacora-accion">Tipo de acción</label>
          <select id="bitacora-accion" value={accion} onChange={(e) => setAccion(e.target.value)} style={{ maxWidth: 220 }}>
            <option value="">Todas las acciones</option>
            {OPCIONES_ACCION.map(([clave, etiqueta]) => <option key={clave} value={clave}>{etiqueta}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="bitacora-buscar">Buscar en el detalle</label>
          <div style={{ position: 'relative' }}>
            <IconoLupa width={15} height={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-soft)', pointerEvents: 'none' }} />
            <input
              id="bitacora-buscar"
              className="input"
              style={{ paddingLeft: 32, maxWidth: 220 }}
              placeholder="ej. arete, precio, estado..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
      </div>
      </details>

      {error && <EstadoError mensaje={error} onReintentar={cargarEventos} />}
      <FeedbackOperacion mensaje={confirmacion} />

      <EncabezadoDetalle titulo="Actividad por día" descripcion="Abre únicamente el día que deseas investigar. El día más reciente aparece desplegado." paso="Detalle" />

      {!eventos ? (
        <div className="card"><EstadoCarga mensaje="Cargando eventos de auditoría…" /></div>
      ) : eventos.length === 0 ? (
        <div className="card"><EstadoVacio titulo={hayFiltrosActivos ? 'Ningún evento coincide con estos filtros' : 'Todavía no hay eventos registrados'} descripcion={hayFiltrosActivos ? 'Ajusta el periodo, usuario, acción o texto de búsqueda.' : 'Las operaciones auditadas aparecerán aquí.'} /></div>
      ) : (
        grupos.map(([fecha, eventosDelDia], indice) => {
          const corte = cortes[fecha];
          return (
            <details
              key={fecha}
              className="audit-day"
              open={Object.hasOwn(diasAbiertos, fecha) ? diasAbiertos[fecha] : indice === 0}
              onToggle={(evento) => {
                const abierto = evento.currentTarget.open;
                setDiasAbiertos((actual) => (actual[fecha] === abierto ? actual : { ...actual, [fecha]: abierto }));
              }}
            >
              <summary>
                <strong>{formatearFechaLarga(fecha)}</strong>
                <span>{eventosDelDia.length} evento(s) · {corte ? 'Corte enviado' : 'Sin corte enviado'}</span>
              </summary>
              <div className="audit-day-content">
                {corte ? (
                  <div className="audit-day-actions"><span style={{ fontSize: '0.82rem', color: 'var(--pasture-dark)', fontWeight: 600 }}>
                    ✓ Corte enviado a las {formatearHora(corte.enviado_en)}{corte.enviado_por ? ` (por ${corte.enviado_por})` : ''}
                  </span></div>
                ) : puedeEnviarCorte && <div className="audit-day-actions">
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                      disabled={enviandoFecha === fecha}
                      onClick={() => enviarCorte(fecha)}
                    >
                      {enviandoFecha === fecha ? 'Enviando...' : 'Enviar corte ahora'}
                    </button>
                </div>}
                <table className="animal-table responsive-cards">
                  <thead><tr><th>Hora</th><th>Usuario</th><th>Acción</th><th>Detalle</th></tr></thead>
                  <tbody>
                    {eventosDelDia.map((e) => (
                      <tr key={e.id}>
                        <td data-label="Hora" style={{ whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{formatearHora(e.fecha)}</td>
                        <td data-label="Usuario">{e.usuario || '—'}</td>
                        <td data-label="Acción">{ETIQUETAS_ACCION[e.accion] || e.accion}</td>
                        <td data-label="Detalle" style={{ fontSize: '0.82rem', color: 'var(--ink-soft)' }}>
                          {e.detalle ? <details className="audit-detail"><summary>Ver cambios registrados</summary><pre>{detalleSeguro(e.detalle)}</pre></details> : 'Sin detalle adicional'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          );
        })
      )}
    </div>
  );
}
