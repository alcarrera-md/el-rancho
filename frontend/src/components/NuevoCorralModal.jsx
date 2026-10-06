import { useState } from 'react';
import { api } from '../api';

export default function NuevoCorralModal({ onCerrar, onCreado }) {
  const [form, setForm] = useState({ nombre: '', descripcion: '', ubicacion: '', capacidad_maxima: '' });
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  function actualizar(campo, valor) {
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  async function guardar(e) {
    e.preventDefault();
    if (!form.nombre || !form.capacidad_maxima) {
      setError('El nombre y la capacidad máxima son obligatorios.');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const corral = await api.crearCorral({
        ...form,
        capacidad_maxima: Number(form.capacidad_maxima),
      });
      onCreado(corral);
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Registrar corral</h3>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={guardar}>
          <div className="field">
            <label>Nombre *</label>
            <input className="input" value={form.nombre} onChange={(e) => actualizar('nombre', e.target.value)} placeholder="Corral Engorde 2" />
          </div>
          <div className="field">
            <label>Capacidad máxima (número de animales) *</label>
            <input className="input" type="number" min="1" value={form.capacidad_maxima} onChange={(e) => actualizar('capacidad_maxima', e.target.value)} />
          </div>
          <div className="field">
            <label>Ubicación</label>
            <input className="input" value={form.ubicacion} onChange={(e) => actualizar('ubicacion', e.target.value)} placeholder="Potrero norte" />
          </div>
          <div className="field">
            <label>Descripción</label>
            <textarea rows={2} value={form.descripcion} onChange={(e) => actualizar('descripcion', e.target.value)} />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={guardando}>
              {guardando ? 'Guardando...' : 'Registrar corral'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
