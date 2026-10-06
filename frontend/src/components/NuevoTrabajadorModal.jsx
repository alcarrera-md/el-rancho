import { useState } from 'react';
import { api } from '../api';

export default function NuevoTrabajadorModal({ onCerrar, onCreado }) {
  const [form, setForm] = useState({ nombre: '', telefono: '' });
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  function actualizar(campo, valor) {
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  async function guardar(e) {
    e.preventDefault();
    if (!form.nombre) {
      setError('El nombre es obligatorio.');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const trabajador = await api.crearTrabajador(form);
      onCreado(trabajador);
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Registrar trabajador</h3>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={guardar}>
          <div className="field">
            <label>Nombre *</label>
            <input className="input" autoFocus value={form.nombre} onChange={(e) => actualizar('nombre', e.target.value)} />
          </div>
          <div className="field">
            <label>Teléfono</label>
            <input className="input" value={form.telefono} onChange={(e) => actualizar('telefono', e.target.value)} />
          </div>
          <p style={{ fontSize: '0.82rem', color: 'var(--ink-soft)' }}>
            Todavía no se le puede crear una cuenta de acceso (usuario y contraseña) —
            eso lo agregamos junto con el sistema de login.
          </p>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={guardando}>
              {guardando ? 'Guardando...' : 'Registrar trabajador'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
