import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext.jsx';
import { tienePermiso } from '../authorization/permissions.js';
import CostoReproductivoOpcional, { costoParaApi } from './CostoReproductivoOpcional.jsx';

export default function RegistrarPartoModal({ cicloId, madreId, onCerrar, onCreado, onNoDisponible }) {
  const { usuario } = useAuth();
  const [animales, setAnimales] = useState([]);
  const [responsables, setResponsables] = useState([]);
  const [form, setForm] = useState({
    fecha_parto_real: new Date().toISOString().slice(0, 10), resultado: 'parto', cria_id: '', responsable_id: '', incidencia: '', observaciones: '',
  });
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [costo, setCosto] = useState({ categoria: 'veterinario', monto: '', descripcion: '' });
  const puedeRegistrarCosto = tienePermiso(usuario?.rol, 'costos_reproductivos', 'crear');

  useEffect(() => {
    api.listarAnimales({ estado: 'vivo' }).then((data) => setAnimales(data.filter((a) => a.estado === 'vivo' && a.id !== madreId))).catch(() => {});
    api.listarResponsablesReproduccion().then(setResponsables).catch(() => {});
  }, [madreId]);

  function actualizar(campo, valor) {
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  const etiquetaResultado = form.resultado === 'parto' ? 'parto' : form.resultado === 'aborto' ? 'aborto' : 'pérdida';

  async function guardar(e) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      await api.registrarPartoV2(cicloId, {
        fecha_real: form.fecha_parto_real,
        resultado: form.resultado,
        incidencia: form.incidencia || undefined,
        observaciones: form.observaciones || undefined,
        responsable_id: form.responsable_id || undefined,
        crias: form.resultado === 'parto' && form.cria_id ? [{ cria_id: form.cria_id, estado_nacimiento: 'vivo' }] : [],
        costo: puedeRegistrarCosto ? costoParaApi(costo) : undefined,
      });
      onCreado();
    } catch (err) {
      if (err.code === 'ANIMAL_REPRODUCTIVO_NO_DISPONIBLE') return onNoDisponible?.(err);
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Registrar parto o incidencia</h3>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={guardar}>
          <fieldset className="repro-choice-group"><legend>¿Qué ocurrió?</legend><div>{[['parto', 'Parto'], ['perdida', 'Pérdida'], ['aborto', 'Aborto']].map(([valor, etiqueta]) => <button type="button" key={valor} className={form.resultado === valor ? 'is-selected' : ''} onClick={() => actualizar('resultado', valor)}>{etiqueta}</button>)}</div></fieldset>
          <div className="field">
            <label>Fecha del {etiquetaResultado}</label>
            <input className="input" type="date" value={form.fecha_parto_real} onChange={(e) => actualizar('fecha_parto_real', e.target.value)} />
          </div>
          {form.resultado === 'parto' && (
            <div className="field">
              <label>Cría (si ya la registraste como animal, enlázala aquí)</label>
              <select value={form.cria_id} onChange={(e) => actualizar('cria_id', e.target.value)}>
                <option value="">Aún no registrada / enlazar después</option>
                {animales.map((a) => (
                  <option key={a.id} value={a.id}>{a.arete_id}{a.nombre_alias ? ` — ${a.nombre_alias}` : ''}</option>
                ))}
              </select>
            </div>
          )}
          <div className="field"><label>Incidencia (opcional)</label><input className="input" value={form.incidencia} onChange={(e) => actualizar('incidencia', e.target.value)} /></div>
          <div className="field"><label>Responsable (opcional)</label><select value={form.responsable_id} onChange={(e) => actualizar('responsable_id', e.target.value)}><option value="">Sin especificar</option>{responsables.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}</select></div>
          <div className="field"><label>Observaciones (opcional)</label><textarea value={form.observaciones} onChange={(e) => actualizar('observaciones', e.target.value)} /></div>
          {puedeRegistrarCosto && <CostoReproductivoOpcional etapa="parto" valor={costo} onChange={setCosto} />}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={guardando}>
              {guardando ? 'Guardando...' : `Registrar ${etiquetaResultado}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
