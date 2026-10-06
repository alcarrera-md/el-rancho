import { useState } from 'react';
import { api } from '../api';

export default function NuevoTerceroModal({ onCerrar, onCreado }) {
  const [form, setForm] = useState({ nombre: '', tipo: 'proveedor', contacto: '', rfc_nif: '' });
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
      const tercero = await api.crearTercero(form);
      onCreado(tercero);
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Registrar proveedor/comprador</h3>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={guardar}>
          <div className="field">
            <label>Nombre *</label>
            <input className="input" autoFocus value={form.nombre} onChange={(e) => actualizar('nombre', e.target.value)} />
          </div>
          <div className="field">
            <label>Tipo</label>
            <select value={form.tipo} onChange={(e) => actualizar('tipo', e.target.value)}>
              <option value="proveedor">Proveedor</option>
              <option value="comprador">Comprador</option>
              <option value="ambos">Ambos</option>
            </select>
          </div>
          <div className="field">
            <label>Contacto</label>
            <input className="input" value={form.contacto} onChange={(e) => actualizar('contacto', e.target.value)} placeholder="Teléfono o correo" />
          </div>
          <div className="field">
            <label>RFC / NIF (opcional)</label>
            <input className="input" value={form.rfc_nif} onChange={(e) => actualizar('rfc_nif', e.target.value)} />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={guardando}>
              {guardando ? 'Guardando...' : 'Registrar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
