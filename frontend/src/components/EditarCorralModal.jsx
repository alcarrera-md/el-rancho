import { useEffect, useState } from 'react';
import { api } from '../api';

export default function EditarCorralModal({ corral, onCerrar, onGuardado }) {
  const [trabajadores, setTrabajadores] = useState([]);
  const [form, setForm] = useState({
    nombre: corral.nombre,
    descripcion: corral.descripcion || '',
    ubicacion: corral.ubicacion || '',
    capacidad_maxima: corral.capacidad_maxima,
    trabajador_id: corral.trabajador_id || '',
  });
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    api.listarTrabajadores().then((data) => setTrabajadores(data.filter((t) => t.activo))).catch(() => {});
  }, []);

  function actualizar(campo, valor) {
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  async function guardar(e) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      await api.editarCorral(corral.id, { ...form, trabajador_id: form.trabajador_id || null });
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
        <h3>Editar corral</h3>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={guardar}>
          <div className="field">
            <label>Nombre</label>
            <input className="input" value={form.nombre} onChange={(e) => actualizar('nombre', e.target.value)} />
          </div>
          <div className="field">
            <label>Capacidad máxima</label>
            <input className="input" type="number" min="1" value={form.capacidad_maxima} onChange={(e) => actualizar('capacidad_maxima', e.target.value)} />
          </div>
          <div className="field">
            <label>Ubicación</label>
            <input className="input" value={form.ubicacion} onChange={(e) => actualizar('ubicacion', e.target.value)} />
          </div>
          <div className="field">
            <label>Responsable</label>
            <select value={form.trabajador_id} onChange={(e) => actualizar('trabajador_id', e.target.value)}>
              <option value="">Sin asignar</option>
              {trabajadores.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Descripción</label>
            <textarea rows={2} value={form.descripcion} onChange={(e) => actualizar('descripcion', e.target.value)} />
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
