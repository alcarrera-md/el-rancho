import { useEffect, useId, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext.jsx';
import { tienePermiso } from '../authorization/permissions.js';

export default function SelectorRaza({ value, onChange }) {
  const id = useId();
  const { usuario } = useAuth();
  const puedeCrear = tienePermiso(usuario?.rol, 'razas', 'crear');
  const [razas, setRazas] = useState([]);
  const [creando, setCreando] = useState(false);
  const [nueva, setNueva] = useState('');
  const [error, setError] = useState(null);

  function cargar() {
    api.listarRazas().then(setRazas).catch(() => {});
  }
  useEffect(cargar, []);

  async function crear() {
    if (!nueva.trim()) return;
    try {
      const raza = await api.crearRaza(nueva.trim());
      cargar();
      onChange(String(raza.id));
      setCreando(false);
      setNueva('');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="field">
      <label htmlFor={`${id}-raza`}>Raza</label>
      {error && <div className="error-banner" role="alert">{error}</div>}
      {!creando ? (
        <>
          <select id={`${id}-raza`} value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">Sin especificar</option>
            {razas.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
          </select>
          {puedeCrear && (
            <button type="button" className="btn btn-ghost" style={{ marginTop: 8 }} onClick={() => setCreando(true)}>
              + Nueva raza
            </button>
          )}
        </>
      ) : (
        <div style={{ display: 'flex', gap: 8 }}>
          <input id={`${id}-raza`} className="input" aria-label="Nombre de la nueva raza" placeholder="Nombre de la raza" value={nueva} onChange={(e) => setNueva(e.target.value)} />
          <button type="button" className="btn btn-primary" onClick={crear}>Guardar</button>
          <button type="button" className="btn btn-ghost" onClick={() => setCreando(false)}>Cancelar</button>
        </div>
      )}
    </div>
  );
}
