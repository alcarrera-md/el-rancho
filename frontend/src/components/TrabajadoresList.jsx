import { useEffect, useState } from 'react';
import { api } from '../api';
import NuevoTrabajadorModal from './NuevoTrabajadorModal.jsx';
import EditarTrabajadorModal from './EditarTrabajadorModal.jsx';
import NuevoUsuarioModal from './NuevoUsuarioModal.jsx';
import { mostrarExito } from '../feedbackOperacion.js';
import ModuleHeader from './ModuleHeader.jsx';

export default function TrabajadoresList() {
  const [trabajadores, setTrabajadores] = useState([]);
  const [error, setError] = useState(null);
  const [advertencias, setAdvertencias] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [mostrarModal, setMostrarModal] = useState(false);
  const [editando, setEditando] = useState(null);
  const [creandoAcceso, setCreandoAcceso] = useState(null);

  function cargar() {
    setCargando(true);
    return api.listarTrabajadores()
      .then(setTrabajadores)
      .catch((err) => setError(err.message))
      .finally(() => setCargando(false));
  }

  useEffect(() => { cargar(); }, []);

  async function alternarEstado(t) {
    setAdvertencias([]);
    try {
      const resultado = await api.cambiarEstadoTrabajador(t.id, !t.activo);
      if (resultado.advertencias?.length) setAdvertencias(resultado.advertencias);
      await cargar();
      mostrarExito({ titulo: t.activo ? 'Trabajador desactivado' : 'Trabajador reactivado' });
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <ModuleHeader eyebrow="Operación y responsabilidades" title="Equipo del rancho" description="Personal responsable de corrales, animales y atención veterinaria." action={<button className="btn btn-primary" onClick={() => setMostrarModal(true)}>+ Registrar trabajador</button>} />

      {error && <div className="error-banner">No se pudo conectar con el servidor: {error}</div>}
      {advertencias.map((a, i) => (
        <div key={i} className="error-banner" style={{ background: 'var(--wheat-soft)', color: '#6b4f10', borderColor: 'var(--wheat)' }}>
          {a}
        </div>
      ))}

      <div className="card">
        {cargando ? (
          <div className="empty-state">Cargando trabajadores...</div>
        ) : trabajadores.length === 0 ? (
          <div className="empty-state">
            <h3>Todavía no hay trabajadores registrados</h3>
            <p>Registra el primero con el botón de arriba.</p>
          </div>
        ) : (
          <>
          <div className="worker-card-grid mobile-record-list">
            {trabajadores.map((t) => (
              <article key={t.id} className="record-card">
                <div className="record-card-head"><div><h3>{t.nombre}</h3><span>{t.telefono || 'Sin teléfono'}</span></div><span className={`pill ${t.activo ? 'pill-vivo' : 'pill-muerto'}`}>{t.activo ? 'Activo' : 'Inactivo'}</span></div>
                <div className="access-summary">
                  <strong>{t.email ? 'Acceso vinculado' : 'Sin acceso al sistema'}</strong>
                  <span>{t.email ? `${t.email} · ${t.rol} · ${t.usuario_activo ? 'Cuenta activa' : 'Cuenta inactiva'}` : 'Puede trabajar en el rancho sin iniciar sesión.'}</span>
                </div>
                <div className="record-card-actions"><button className="btn btn-ghost" onClick={() => setEditando(t)}>Editar</button>{!t.email && <button className="btn btn-primary" onClick={() => setCreandoAcceso(t)}>Crear acceso</button>}<button className="btn btn-ghost" onClick={() => alternarEstado(t)}>{t.activo ? 'Desactivar' : 'Reactivar'}</button></div>
              </article>
            ))}
          </div>
          <table className="animal-table desktop-record-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Teléfono</th>
                <th>Cuenta de acceso</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {trabajadores.map((t) => (
                <tr key={t.id}>
                  <td>{t.nombre}</td>
                  <td>{t.telefono || '—'}</td>
                  <td>{t.email ? <><strong>Con acceso</strong><br />{t.email} ({t.rol}) · {t.usuario_activo ? 'Activo' : 'Inactivo'}</> : <><span>Sin acceso</span><br /><button className="btn btn-ghost btn-table-action" onClick={() => setCreandoAcceso(t)}>Crear cuenta</button></>}</td>
                  <td><span className={`pill ${t.activo ? 'pill-vivo' : 'pill-muerto'}`}>{t.activo ? 'Activo' : 'Inactivo'}</span></td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: '0.8rem' }} onClick={() => setEditando(t)}>
                      Editar
                    </button>
                    <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: '0.8rem' }} onClick={() => alternarEstado(t)}>
                      {t.activo ? 'Desactivar' : 'Reactivar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </>
        )}
      </div>

      {mostrarModal && (
        <NuevoTrabajadorModal
          onCerrar={() => setMostrarModal(false)}
          onCreado={async () => { setMostrarModal(false); await cargar(); mostrarExito({ titulo: 'Trabajador registrado correctamente' }); }}
        />
      )}
      {editando && (
        <EditarTrabajadorModal
          trabajador={editando}
          onCerrar={() => setEditando(null)}
          onGuardado={async () => { setEditando(null); await cargar(); mostrarExito({ titulo: 'Trabajador actualizado' }); }}
        />
      )}
      {creandoAcceso && (
        <NuevoUsuarioModal trabajadorInicial={creandoAcceso} onCerrar={() => setCreandoAcceso(null)} onCreado={async () => { setCreandoAcceso(null); await cargar(); mostrarExito({ titulo: 'Acceso creado y vinculado' }); }} />
      )}
    </div>
  );
}
