import { useEffect, useState } from 'react';
import { api } from '../api';

export default function AsignarPlanAnimalModal({ animalId, onCerrar, onListo }) {
  const [planes, setPlanes] = useState([]);
  const [planId, setPlanId] = useState('');
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    api.listarPlanesSanitarios().then((data) => setPlanes(data.filter((p) => p.activo))).catch(() => {});
  }, []);

  async function guardar(e) {
    e.preventDefault();
    if (!planId) {
      setError('Selecciona un plan.');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      await api.asignarPlanSanitario(planId, [animalId]);
      onListo();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Asignar plan sanitario</h3>
        {error && <div className="error-banner">{error}</div>}
        {planes.length === 0 && (
          <div className="error-banner" style={{ background: 'var(--wheat-soft)', color: '#6b4f10', borderColor: 'var(--wheat)' }}>
            Todavía no hay planes sanitarios creados. Ve a "Planes sanitarios" en el menú para crear uno.
          </div>
        )}
        <form onSubmit={guardar}>
          <div className="field">
            <label>Plan</label>
            <select value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">Selecciona un plan</option>
              {planes.map((p) => <option key={p.id} value={p.id}>{p.nombre} ({p.total_items} eventos)</option>)}
            </select>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={guardando}>
              {guardando ? 'Asignando...' : 'Asignar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
