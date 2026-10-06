import { useEffect, useState } from 'react';
import { api } from '../api';

const TIPOS = [
  { value: 'vacuna', label: 'Vacuna' },
  { value: 'tratamiento', label: 'Tratamiento' },
  { value: 'desparasitacion', label: 'Desparasitación' },
];

export default function ItemPlanModal({ planId, item, onCerrar, onGuardado }) {
  const editando = Boolean(item);
  const [insumos, setInsumos] = useState([]);
  const [form, setForm] = useState({
    nombre_evento: item?.nombre_evento || '',
    tipo: item?.tipo || 'vacuna',
    insumo_id: item?.insumo_id || '',
    edad_dias: item?.edad_dias ?? '',
    descripcion: item?.descripcion || '',
  });
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [eliminando, setEliminando] = useState(false);

  useEffect(() => {
    api.listarInsumos().then((data) => setInsumos(data.filter((i) => i.tipo === 'vacuna' || i.tipo === 'medicamento'))).catch(() => {});
  }, []);

  function actualizar(campo, valor) {
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  async function guardar(e) {
    e.preventDefault();
    if (!form.nombre_evento.trim() || form.edad_dias === '') {
      setError('El nombre del evento y la edad en días son obligatorios.');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const payload = { ...form, insumo_id: form.insumo_id || null };
      if (editando) {
        await api.editarItemPlan(item.id, payload);
      } else {
        await api.agregarItemPlan(planId, payload);
      }
      onGuardado();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar() {
    if (!window.confirm('¿Eliminar este evento del plan? Los animales que ya lo tengan asignado dejarán de verlo.')) return;
    setEliminando(true);
    try {
      await api.eliminarItemPlan(item.id);
      onGuardado();
    } catch (err) {
      setError(err.message);
      setEliminando(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{editando ? 'Editar evento del plan' : 'Agregar evento al plan'}</h3>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={guardar}>
          <div className="field">
            <label>Nombre del evento *</label>
            <input className="input" autoFocus value={form.nombre_evento} onChange={(e) => actualizar('nombre_evento', e.target.value)} placeholder="Ej. Vacuna Triple" />
          </div>
          <div className="field">
            <label>Tipo</label>
            <select value={form.tipo} onChange={(e) => actualizar('tipo', e.target.value)}>
              {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Vacuna/medicamento (opcional)</label>
            <select value={form.insumo_id} onChange={(e) => actualizar('insumo_id', e.target.value)}>
              <option value="">Ninguno / no aplica</option>
              {insumos.map((i) => <option key={i.id} value={i.id}>{i.nombre}</option>)}
            </select>
          </div>
          <div className="field">
            <label>¿A los cuántos días de nacido? *</label>
            <input className="input" type="number" min="0" value={form.edad_dias} onChange={(e) => actualizar('edad_dias', e.target.value)} placeholder="Ej. 90" />
          </div>
          <div className="field">
            <label>Notas (opcional)</label>
            <textarea rows={2} value={form.descripcion} onChange={(e) => actualizar('descripcion', e.target.value)} />
          </div>
          <div className="modal-actions" style={{ justifyContent: editando ? 'space-between' : 'flex-end' }}>
            {editando && (
              <button type="button" className="btn btn-ghost" style={{ color: 'var(--rust)' }} onClick={eliminar} disabled={eliminando}>
                {eliminando ? 'Eliminando...' : 'Eliminar'}
              </button>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={guardando}>
                {guardando ? 'Guardando...' : editando ? 'Guardar cambios' : 'Agregar'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
