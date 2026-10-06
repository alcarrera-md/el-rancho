import { useState } from 'react';
import { api } from '../api';

export default function NuevoPlanModal({ plan, onCerrar, onGuardado }) {
  const editando = Boolean(plan);
  const [nombre, setNombre] = useState(plan?.nombre || '');
  const [descripcion, setDescripcion] = useState(plan?.descripcion || '');
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar(e) {
    e.preventDefault();
    if (!nombre.trim()) {
      setError('El nombre es obligatorio.');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      if (editando) {
        await api.editarPlanSanitario(plan.id, { nombre, descripcion });
      } else {
        await api.crearPlanSanitario({ nombre, descripcion });
      }
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
        <h3>{editando ? 'Editar plan sanitario' : 'Nuevo plan sanitario'}</h3>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={guardar}>
          <div className="field">
            <label>Nombre *</label>
            <input className="input" autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Protocolo de becerros" />
          </div>
          <div className="field">
            <label>Descripción</label>
            <textarea rows={2} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={guardando}>
              {guardando ? 'Guardando...' : editando ? 'Guardar cambios' : 'Crear plan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
