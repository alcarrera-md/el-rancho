import { useEffect, useState } from 'react';
import { api } from '../api';
import NuevoPlanModal from './NuevoPlanModal.jsx';
import ItemPlanModal from './ItemPlanModal.jsx';
import AsignarPlanModal from './AsignarPlanModal.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { tienePermiso } from '../authorization/permissions.js';
import { FeedbackOperacion } from './EstadosUI.jsx';

const TIPO_LABEL = { vacuna: 'Vacuna', tratamiento: 'Tratamiento', desparasitacion: 'Desparasitación' };

export default function PlanesSanitarios({ integrado = false }) {
  const { usuario } = useAuth();
  const puedeCrearPlan = tienePermiso(usuario?.rol, 'planes_sanitarios', 'crear');
  const puedeEditarPlan = tienePermiso(usuario?.rol, 'planes_sanitarios', 'editar');
  const puedeAsignarPlan = tienePermiso(usuario?.rol, 'planes_sanitarios', 'asignar');
  const [planes, setPlanes] = useState(null);
  const [planSeleccionado, setPlanSeleccionado] = useState(null);
  const [error, setError] = useState(null);
  const [mostrarNuevoPlan, setMostrarNuevoPlan] = useState(false);
  const [editandoPlan, setEditandoPlan] = useState(null);
  const [mostrarNuevoItem, setMostrarNuevoItem] = useState(false);
  const [editandoItem, setEditandoItem] = useState(null);
  const [asignando, setAsignando] = useState(null);
  const [mensaje, setMensaje] = useState(null);

  function cargarPlanes() {
    api.listarPlanesSanitarios().then(setPlanes).catch((err) => setError(err.message));
  }
  useEffect(cargarPlanes, []);

  function abrirPlan(id) {
    api.obtenerPlanSanitario(id).then(setPlanSeleccionado).catch((err) => setError(err.message));
  }

  function recargarPlanSeleccionado() {
    if (planSeleccionado) abrirPlan(planSeleccionado.id);
    cargarPlanes();
  }

  return (
    <div>
      <div className={integrado ? 'guided-section-heading' : 'page-header'}>
        <div>
          {integrado ? <h2>Planes sanitarios</h2> : <h1>Planes sanitarios</h1>}
          <div className={integrado ? undefined : 'subtitle'}>Protocolos por edad: el sistema avisa cuándo le corresponde una acción a cada animal.</div>
        </div>
        {puedeCrearPlan && <button className="btn btn-primary" onClick={() => setMostrarNuevoPlan(true)}>+ Nuevo plan</button>}
      </div>

      {error && <div className="error-banner">{error}</div>}
      <FeedbackOperacion mensaje={mensaje} />

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20 }}>
        <div className="card" style={{ padding: '10px 0' }}>
          {!planes ? (
            <div className="empty-state">Cargando...</div>
          ) : planes.length === 0 ? (
            <div className="empty-state" style={{ padding: 20 }}>
              <h3 style={{ fontSize: '0.95rem' }}>Sin planes todavía</h3>
            </div>
          ) : (
            planes.map((p) => (
              <button
                key={p.id}
                onClick={() => abrirPlan(p.id)}
                className={`nav-item`}
                style={{
                  width: '100%', textAlign: 'left', color: 'var(--ink)', borderRadius: 0,
                  background: planSeleccionado?.id === p.id ? 'var(--paper)' : 'transparent',
                  borderLeft: planSeleccionado?.id === p.id ? '3px solid var(--pasture)' : '3px solid transparent',
                }}
              >
                <div style={{ fontWeight: 600 }}>{p.nombre}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--ink-soft)' }}>{p.total_items} evento(s){!p.activo ? ' — inactivo' : ''}</div>
              </button>
            ))
          )}
        </div>

        <div>
          {!planSeleccionado ? (
            <div className="card empty-state">
              <h3>Selecciona un plan de la izquierda</h3>
              <p>O crea uno nuevo para empezar a definir su protocolo.</p>
            </div>
          ) : (
            <div className="card" style={{ padding: '20px 24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                <div>
                  <h2 style={{ fontSize: '1.2rem', marginBottom: 4 }}>{planSeleccionado.nombre}</h2>
                  {planSeleccionado.descripcion && <div style={{ color: 'var(--ink-soft)', fontSize: '0.88rem' }}>{planSeleccionado.descripcion}</div>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {puedeEditarPlan && <button className="btn btn-ghost" onClick={() => setEditandoPlan(planSeleccionado)}>Editar plan</button>}
                  {puedeAsignarPlan && <button className="btn btn-primary" onClick={() => setAsignando(planSeleccionado)}>Asignar a animales</button>}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '18px 0 10px' }}>
                <div className="section-title" style={{ marginBottom: 0 }}>Eventos del protocolo</div>
                {puedeEditarPlan && <button className="btn btn-ghost" onClick={() => setMostrarNuevoItem(true)}>+ Agregar evento</button>}
              </div>

              {planSeleccionado.items.length === 0 ? (
                <div className="empty-state" style={{ padding: 20 }}>
                  <h3 style={{ fontSize: '0.95rem' }}>Este plan todavía no tiene eventos</h3>
                </div>
              ) : (
                <table className="animal-table">
                  <thead><tr><th>Días de nacido</th><th>Evento</th><th>Tipo</th><th>Insumo</th><th></th></tr></thead>
                  <tbody>
                    {planSeleccionado.items.map((it) => (
                      <tr key={it.id}>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{it.edad_dias}</td>
                        <td>{it.nombre_evento}</td>
                        <td>{TIPO_LABEL[it.tipo] || it.tipo}</td>
                        <td>{it.insumo_nombre || '—'}</td>
                        <td>
                          {puedeEditarPlan && (
                          <button className="btn btn-ghost" style={{ padding: '3px 10px', fontSize: '0.8rem' }} onClick={() => setEditandoItem(it)}>
                            Editar
                          </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>

      {mostrarNuevoPlan && puedeCrearPlan && (
        <NuevoPlanModal onCerrar={() => setMostrarNuevoPlan(false)} onGuardado={() => { setMostrarNuevoPlan(false); cargarPlanes(); setMensaje('Plan sanitario creado correctamente.'); }} />
      )}
      {editandoPlan && puedeEditarPlan && (
        <NuevoPlanModal plan={editandoPlan} onCerrar={() => setEditandoPlan(null)} onGuardado={() => { setEditandoPlan(null); recargarPlanSeleccionado(); setMensaje('Plan sanitario actualizado.'); }} />
      )}
      {mostrarNuevoItem && planSeleccionado && puedeEditarPlan && (
        <ItemPlanModal planId={planSeleccionado.id} onCerrar={() => setMostrarNuevoItem(false)} onGuardado={() => { setMostrarNuevoItem(false); recargarPlanSeleccionado(); setMensaje('Actividad sanitaria guardada.'); }} />
      )}
      {editandoItem && puedeEditarPlan && (
        <ItemPlanModal planId={planSeleccionado.id} item={editandoItem} onCerrar={() => setEditandoItem(null)} onGuardado={() => { setEditandoItem(null); recargarPlanSeleccionado(); setMensaje('Actividad sanitaria actualizada.'); }} />
      )}
      {asignando && puedeAsignarPlan && (
        <AsignarPlanModal
          plan={asignando}
          onCerrar={() => setAsignando(null)}
          onListo={() => { setAsignando(null); setMensaje('Plan asignado correctamente.'); }}
        />
      )}
    </div>
  );
}
