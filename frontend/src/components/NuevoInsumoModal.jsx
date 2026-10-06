import { useState } from 'react';
import { api } from '../api';

export default function NuevoInsumoModal({ onCerrar, onCreado }) {
  const [form, setForm] = useState({ nombre: '', tipo: 'alimento', unidad_medida: 'kg', stock_actual: '', stock_minimo: '', fecha_caducidad: '' });
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
      await api.crearInsumo({ ...form, fecha_caducidad: form.fecha_caducidad || null });
      onCreado();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Registrar insumo</h3>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={guardar}>
          <div className="field">
            <label>Nombre *</label>
            <input className="input" autoFocus value={form.nombre} onChange={(e) => actualizar('nombre', e.target.value)} placeholder="Concentrado engorde" />
          </div>
          <div className="field">
            <label>Tipo</label>
            <select value={form.tipo} onChange={(e) => actualizar('tipo', e.target.value)}>
              <option value="alimento">Alimento</option>
              <option value="vacuna">Vacuna</option>
              <option value="medicamento">Medicamento</option>
              <option value="otro">Otro</option>
            </select>
          </div>
          <div className="field">
            <label>Unidad de medida</label>
            <input className="input" value={form.unidad_medida} onChange={(e) => actualizar('unidad_medida', e.target.value)} placeholder="kg, litros, dosis..." />
          </div>
          <div className="field">
            <label>Stock inicial</label>
            <input className="input" type="number" step="0.1" value={form.stock_actual} onChange={(e) => actualizar('stock_actual', e.target.value)} />
          </div>
          <div className="field">
            <label>Stock mínimo (para alertas)</label>
            <input className="input" type="number" step="0.1" value={form.stock_minimo} onChange={(e) => actualizar('stock_minimo', e.target.value)} />
          </div>
          <div className="field">
            <label>Fecha de caducidad (opcional)</label>
            <input className="input" type="date" value={form.fecha_caducidad} onChange={(e) => actualizar('fecha_caducidad', e.target.value)} />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={guardando}>
              {guardando ? 'Guardando...' : 'Registrar insumo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
