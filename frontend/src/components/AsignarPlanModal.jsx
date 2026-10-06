import { useEffect, useState } from 'react';
import { api } from '../api';

export default function AsignarPlanModal({ plan, onCerrar, onListo }) {
  const [corrales, setCorrales] = useState([]);
  const [corralId, setCorralId] = useState('');
  const [animales, setAnimales] = useState([]);
  const [seleccionados, setSeleccionados] = useState({});
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    api.listarCorrales().then(setCorrales).catch(() => {});
  }, []);

  useEffect(() => {
    const params = { estado: 'vivo' };
    if (corralId) params.corral_id = corralId;
    api.listarAnimales(params).then((data) => {
      setAnimales(data);
      setSeleccionados({});
    }).catch((err) => setError(err.message));
  }, [corralId]);

  function alternar(id) {
    setSeleccionados((s) => ({ ...s, [id]: !s[id] }));
  }

  async function guardar() {
    const ids = animales.filter((a) => seleccionados[a.id]).map((a) => a.id);
    if (ids.length === 0) {
      setError('Selecciona al menos un animal.');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      await api.asignarPlanSanitario(plan.id, ids);
      onListo();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <h3>Asignar "{plan.nombre}" a animales</h3>
        {error && <div className="error-banner">{error}</div>}
        <div className="field">
          <label>Filtrar por corral (opcional)</label>
          <select value={corralId} onChange={(e) => setCorralId(e.target.value)}>
            <option value="">Todos los animales vivos</option>
            {corrales.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>
        <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
          <table className="animal-table">
            <tbody>
              {animales.map((a) => (
                <tr key={a.id} className="clickable" onClick={() => alternar(a.id)}>
                  <td style={{ width: 30 }}>
                    <input type="checkbox" checked={!!seleccionados[a.id]} onChange={() => alternar(a.id)} onClick={(e) => e.stopPropagation()} />
                  </td>
                  <td><span className="tag-badge">{a.arete_id}</span></td>
                  <td>{a.nombre_alias || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={guardar} disabled={guardando}>
            {guardando ? 'Asignando...' : 'Asignar plan'}
          </button>
        </div>
      </div>
    </div>
  );
}
