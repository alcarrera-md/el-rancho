import { useState } from 'react';
import { api } from '../api';

export default function EditarInsumoModal({ insumo, onCerrar, onGuardado }) {
  const [form, setForm] = useState({
    nombre: insumo.nombre,
    unidad_medida: insumo.unidad_medida,
    stock_minimo: insumo.stock_minimo,
    fecha_caducidad: insumo.fecha_caducidad ? insumo.fecha_caducidad.slice(0, 10) : '',
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
      await api.editarInsumo(insumo.id, { ...form, fecha_caducidad: form.fecha_caducidad || null });
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
        <h3>Editar insumo</h3>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={guardar}>
          <div className="field">
            <label>Nombre</label>
            <input className="input" value={form.nombre} onChange={(e) => actualizar('nombre', e.target.value)} />
          </div>
          <div className="field">
            <label>Unidad de medida</label>
            <input className="input" value={form.unidad_medida} onChange={(e) => actualizar('unidad_medida', e.target.value)} />
          </div>
          <div className="field">
            <label>Stock mínimo (para alertas)</label>
            <input className="input" type="number" step="0.1" value={form.stock_minimo} onChange={(e) => actualizar('stock_minimo', e.target.value)} />
          </div>
          <div className="field">
            <label>Fecha de caducidad</label>
            <input className="input" type="date" value={form.fecha_caducidad} onChange={(e) => actualizar('fecha_caducidad', e.target.value)} />
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>
            El stock actual no se edita aquí — cambia solo al registrar compras o consumos.
          </p>
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
