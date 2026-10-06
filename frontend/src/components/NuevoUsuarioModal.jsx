import { useEffect, useState } from 'react';
import { api } from '../api';
import CampoPassword from './CampoPassword.jsx';
import { generarPasswordSegura } from '../credenciales.js';
import { PASSWORD_MAX, PASSWORD_MIN } from '../passwordSecurity.js';
import FortalezaPassword from './FortalezaPassword.jsx';

export default function NuevoUsuarioModal({ onCerrar, onCreado, trabajadorInicial = null }) {
  const [roles, setRoles] = useState([]);
  const [trabajadores, setTrabajadores] = useState([]);
  const [form, setForm] = useState({ nombre: trabajadorInicial?.nombre || '', email: '', password: '', rol_id: '', trabajador_id: trabajadorInicial?.id || '' });
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    api.listarRoles().then(setRoles).catch(() => {});
    api.listarTrabajadores().then((data) => setTrabajadores(data.filter((t) => !t.email))).catch(() => {});
  }, []);

  function actualizar(campo, valor) {
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  async function guardar(e) {
    e.preventDefault();
    if (!form.nombre || !form.email || !form.password || !form.rol_id) {
      setError('Nombre, correo, contraseña y rol son obligatorios.');
      return;
    }
    if (form.password.length < PASSWORD_MIN || form.password.length > PASSWORD_MAX) {
      setError(`La contraseña debe tener entre ${PASSWORD_MIN} y ${PASSWORD_MAX} caracteres.`);
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const usuario = await api.crearUsuario({ ...form, trabajador_id: form.trabajador_id || null });
      onCreado(usuario);
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Registrar usuario</h3>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={guardar}>
          <div className="field">
            <label>Nombre *</label>
            <input className="input" autoFocus value={form.nombre} onChange={(e) => actualizar('nombre', e.target.value)} />
          </div>
          <div className="field">
            <label>Correo *</label>
            <input className="input" type="email" value={form.email} onChange={(e) => actualizar('email', e.target.value)} />
          </div>
          <CampoPassword label="Contraseña" required value={form.password} onChange={(e) => actualizar('password', e.target.value)} minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} ayuda="Será la contraseña de inicio de sesión. Compártela por un medio seguro." />
          <FortalezaPassword password={form.password} />
          <button type="button" className="btn btn-ghost generate-password" onClick={() => actualizar('password', generarPasswordSegura())}>Generar contraseña segura</button>
          <div className="field">
            <label>Rol *</label>
            <select value={form.rol_id} onChange={(e) => actualizar('rol_id', e.target.value)}>
              <option value="">Selecciona un rol</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Enlazar con un trabajador existente (opcional)</label>
            <select value={form.trabajador_id} onChange={(e) => actualizar('trabajador_id', e.target.value)} disabled={Boolean(trabajadorInicial)}>
              <option value="">Ninguno</option>
              {trabajadores.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={guardando}>
              {guardando ? 'Guardando...' : 'Registrar usuario'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
