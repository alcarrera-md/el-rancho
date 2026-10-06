import { useState } from 'react';
import { api } from '../api';

export default function EditarTerceroModal({ tercero, onCerrar, onGuardado }) {
  const [form, setForm] = useState({
    nombre: tercero.nombre,
    contacto: tercero.contacto || '',
    rfc_nif: tercero.rfc_nif || '',
  });
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  function actualizar(campo, valor) {
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  async function guardar(e) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      await api.editarTercero(tercero.id, form);
      onGuardado();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Editar {tercero.tipo === 'proveedor' ? 'proveedor' : 'comprador'}</h3>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={guardar}>
          <div className="field">
            <label>Nombre</label>
            <input className="input" value={form.nombre} onChange={(e) => actualizar('nombre', e.target.value)} />
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
              {guardando ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
