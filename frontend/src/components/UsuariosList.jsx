import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext.jsx';
import NuevoUsuarioModal from './NuevoUsuarioModal.jsx';
import RestablecerPasswordModal from './RestablecerPasswordModal.jsx';
import EditarUsuarioModal from './EditarUsuarioModal.jsx';
import { mostrarExito } from '../feedbackOperacion.js';
import ModuleHeader from './ModuleHeader.jsx';

function formatearFecha(fecha) {
  if (!fecha) return 'Nunca';
  return new Date(fecha).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' });
}

function estaBloqueada(u) {
  return !!u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date();
}

function formatearHora(fecha) {
  return new Date(fecha).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

export default function UsuariosList() {
  const { usuario: yo } = useAuth();
  const [usuarios, setUsuarios] = useState([]);
  const [roles, setRoles] = useState([]);
  const [error, setError] = useState(null);
  const [mostrarModal, setMostrarModal] = useState(false);
  const [resetearId, setResetearId] = useState(null);
  const [editando, setEditando] = useState(null);

  function cargar() {
    return Promise.all([
      api.listarUsuarios().then(setUsuarios),
      api.listarRoles().then(setRoles).catch(() => {}),
    ]).catch((err) => { setError(err.message); throw err; });
  }
  useEffect(() => { cargar().catch(() => {}); }, []);

  async function cambiarRol(u, rol_id) {
    try {
      await api.actualizarUsuario(u.id, { rol_id });
      await cargar();
      mostrarExito({ titulo: 'Rol de usuario actualizado' });
    } catch (err) {
      setError(err.message);
    }
  }

  async function alternarEstado(u) {
    try {
      await api.actualizarUsuario(u.id, { activo: !u.activo });
      await cargar();
      mostrarExito({ titulo: u.activo ? 'Usuario desactivado' : 'Usuario reactivado' });
    } catch (err) {
      setError(err.message);
    }
  }

  async function desbloquear(u) {
    try {
      await api.desbloquearUsuario(u.id);
      await cargar();
      mostrarExito({ titulo: 'Usuario desbloqueado' });
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <ModuleHeader eyebrow="Acceso al sistema" title="Personas con acceso" description="Cuentas autorizadas, sus roles y estado de acceso." action={<button className="btn btn-primary" onClick={() => setMostrarModal(true)}>+ Registrar usuario</button>} />

      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        <div className="user-card-grid mobile-record-list">
          {usuarios.map((u) => (
            <article key={u.id} className="record-card">
              <div className="record-card-head"><div><h3>{u.nombre}{u.id === yo?.id ? ' (tú)' : ''}</h3><span>{u.email}</span></div><span className={`pill ${u.activo ? 'pill-vivo' : 'pill-muerto'}`}>{u.activo ? 'Activo' : 'Inactivo'}</span></div>
              <dl className="record-card-facts"><div><dt>Rol</dt><dd><select aria-label={`Rol de ${u.nombre}`} value={u.rol_id} onChange={(e) => cambiarRol(u, e.target.value)} disabled={u.id === yo?.id}>{roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}</select></dd></div><div><dt>Trabajador</dt><dd>{u.trabajador || 'Sin vínculo'}</dd></div><div><dt>Último acceso</dt><dd>{formatearFecha(u.ultimo_login)}</dd></div></dl>
              {estaBloqueada(u) && <span className="pill pill-muerto">Bloqueada hasta {formatearHora(u.bloqueado_hasta)}</span>}
              <div className="record-card-actions"><button className="btn btn-ghost" onClick={() => setEditando(u)}>Editar datos</button><button className="btn btn-ghost" onClick={() => setResetearId(u.id)}>Resetear contraseña</button>{estaBloqueada(u) && <button className="btn btn-ghost" onClick={() => desbloquear(u)}>Desbloquear</button>}{u.id !== yo?.id && <button className="btn btn-ghost" onClick={() => alternarEstado(u)}>{u.activo ? 'Desactivar' : 'Reactivar'}</button>}</div>
            </article>
          ))}
        </div>
        <table className="animal-table desktop-record-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Correo</th>
              <th>Rol</th>
              <th>Último acceso</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id}>
                <td>{u.nombre}{u.id === yo?.id ? ' (tú)' : ''}{u.trabajador ? <small className="linked-worker">Trabajador: {u.trabajador}</small> : null}</td>
                <td>{u.email}</td>
                <td>
                  <select value={u.rol_id} onChange={(e) => cambiarRol(u, e.target.value)} disabled={u.id === yo?.id}>
                    {roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                  </select>
                </td>
                <td>{formatearFecha(u.ultimo_login)}</td>
                <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span className={`pill ${u.activo ? 'pill-vivo' : 'pill-muerto'}`}>{u.activo ? 'Activo' : 'Inactivo'}</span>
                  {estaBloqueada(u) && (
                    <span className="pill pill-muerto">Bloqueada hasta {formatearHora(u.bloqueado_hasta)}</span>
                  )}
                </td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: '0.8rem' }} onClick={() => setEditando(u)}>Editar</button>
                  <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: '0.8rem' }} onClick={() => setResetearId(u.id)}>
                    Restablecer clave
                  </button>
                  {estaBloqueada(u) && (
                    <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: '0.8rem' }} onClick={() => desbloquear(u)}>
                      Desbloquear
                    </button>
                  )}
                  {u.id !== yo?.id && (
                    <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: '0.8rem' }} onClick={() => alternarEstado(u)}>
                      {u.activo ? 'Desactivar' : 'Reactivar'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {mostrarModal && (
        <NuevoUsuarioModal onCerrar={() => setMostrarModal(false)} onCreado={async () => { setMostrarModal(false); await cargar(); mostrarExito({ titulo: 'Usuario registrado correctamente' }); }} />
      )}
      {resetearId && (
        <RestablecerPasswordModal
          usuarioId={resetearId}
          nombre={usuarios.find((u) => u.id === resetearId)?.nombre}
          onCerrar={() => setResetearId(null)}
          onListo={() => { setResetearId(null); mostrarExito({ titulo: 'Contraseña restablecida' }); }}
        />
      )}
      {editando && <EditarUsuarioModal usuario={editando} onCerrar={() => setEditando(null)} onGuardado={async () => { setEditando(null); await cargar(); mostrarExito({ titulo: 'Datos de usuario actualizados' }); }} />}
    </div>
  );
}
