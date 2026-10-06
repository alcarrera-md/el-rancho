import { useState } from 'react';
import { api } from '../api';

const CATEGORIAS = [
  { value: 'cria', label: 'Cría' },
  { value: 'destete', label: 'Destete' },
  { value: 'engorde', label: 'Engorde' },
  { value: 'vientre', label: 'Vientre (hembra reproductora)' },
  { value: 'reproductor', label: 'Reproductor (macho)' },
  { value: 'descarte', label: 'Descarte' },
];

export default function CambiarCategoriaModal({ animal, onCerrar, onGuardado }) {
  const [categoria, setCategoria] = useState(animal.categoria || 'cria');
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar(e) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      await api.cambiarCategoria(animal.id, { categoria, motivo: motivo || null });
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
        <h3>Cambiar categoría / etapa</h3>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={guardar}>
          <div className="field">
            <label>Nueva categoría</label>
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              {CATEGORIAS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Motivo (opcional)</label>
            <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej. alcanzó peso de destete" />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={guardando}>
              {guardando ? 'Guardando...' : 'Guardar cambio'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
