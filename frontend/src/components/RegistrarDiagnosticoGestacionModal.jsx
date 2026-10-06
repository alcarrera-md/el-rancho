import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext.jsx';
import { tienePermiso } from '../authorization/permissions.js';
import CostoReproductivoOpcional, { costoParaApi } from './CostoReproductivoOpcional.jsx';

export default function RegistrarDiagnosticoGestacionModal({ cicloId, servicios = [], onCerrar, onCreado, onNoDisponible }) {
  const { usuario } = useAuth();
  const ultimoServicio = servicios.at(-1);
  const [form, setForm] = useState({
    servicio_id: ultimoServicio?.id || '', fecha: new Date().toISOString().slice(0, 10),
    metodo: 'palpacion', metodo_otro: '', resultado: 'prenada', responsable_id: '', observaciones: '', fecha_siguiente_revision: '',
  });
  const [responsables, setResponsables] = useState([]);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [costo, setCosto] = useState({ categoria: 'palpacion', monto: '', descripcion: '' });
  const puedeRegistrarCosto = tienePermiso(usuario?.rol, 'costos_reproductivos', 'crear');
  const actualizar = (campo, valor) => setForm((actual) => ({ ...actual, [campo]: valor }));
  useEffect(() => { api.listarResponsablesReproduccion().then(setResponsables).catch(() => {}); }, []);

  async function guardar(evento) {
    evento.preventDefault(); setGuardando(true); setError(null);
    try {
      await api.registrarDiagnosticoGestacion(cicloId, {
        servicio_id: form.servicio_id || undefined, fecha: form.fecha, metodo: form.metodo,
        metodo_otro: form.metodo === 'otro' ? form.metodo_otro : undefined,
        resultado: form.resultado, observaciones: form.observaciones || undefined,
        responsable_id: form.responsable_id || undefined,
        fecha_siguiente_revision: form.fecha_siguiente_revision || undefined,
        costo: puedeRegistrarCosto ? costoParaApi(costo) : undefined,
      });
      onCreado();
    } catch (err) {
      if (err.code === 'ANIMAL_REPRODUCTIVO_NO_DISPONIBLE') return onNoDisponible?.(err);
      setError(err.message);
    } finally { setGuardando(false); }
  }

  return <div className="modal-backdrop" onClick={onCerrar}><div className="modal" onClick={(e) => e.stopPropagation()}>
    <h3>Registrar diagnóstico de gestación</h3>
    {error && <div className="error-banner">{error}</div>}
    <form onSubmit={guardar}>
      <fieldset className="repro-choice-group"><legend>Resultado</legend><div>{[['prenada', 'Preñada'], ['vacia', 'Vacía'], ['dudoso', 'Dudosa']].map(([valor, etiqueta]) => <button type="button" key={valor} className={form.resultado === valor ? 'is-selected' : ''} onClick={() => actualizar('resultado', valor)}>{etiqueta}</button>)}</div></fieldset>
      <div className="field"><label>Método</label><select value={form.metodo} onChange={(e) => actualizar('metodo', e.target.value)}><option value="palpacion">Palpación</option><option value="ecografia">Ultrasonido</option><option value="otro">Otro</option></select></div>
      {form.metodo === 'otro' && <div className="field"><label>Otro método</label><input className="input" value={form.metodo_otro} onChange={(e) => actualizar('metodo_otro', e.target.value)} required /></div>}
      <div className="field"><label>Fecha</label><input className="input" type="date" value={form.fecha} onChange={(e) => actualizar('fecha', e.target.value)} required /></div>
      <details className="repro-secondary-fields"><summary>Responsable, observaciones y revisión</summary>
      <div className="field"><label>Servicio relacionado</label><select value={form.servicio_id} onChange={(e) => actualizar('servicio_id', e.target.value)}>{servicios.map((s) => <option key={s.id} value={s.id}>{s.fecha} · {s.tipo === 'natural' ? 'Servicio natural' : s.tipo === 'inseminacion_artificial' ? 'Inseminación artificial' : s.tipo_otro}</option>)}</select></div>
      <div className="field"><label>Responsable (opcional)</label><select value={form.responsable_id} onChange={(e) => actualizar('responsable_id', e.target.value)}><option value="">Sin especificar</option>{responsables.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}</select></div>
      <div className="field"><label>Próxima revisión (opcional)</label><input className="input" type="date" value={form.fecha_siguiente_revision} onChange={(e) => actualizar('fecha_siguiente_revision', e.target.value)} /></div>
      <div className="field"><label>Observaciones</label><textarea value={form.observaciones} onChange={(e) => actualizar('observaciones', e.target.value)} /></div>
      </details>
      {puedeRegistrarCosto && <CostoReproductivoOpcional etapa="diagnostico" valor={costo} onChange={setCosto} />}
      <div className="modal-actions"><button type="button" className="btn btn-ghost" onClick={onCerrar}>Cancelar</button><button className="btn btn-primary" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar diagnóstico'}</button></div>
    </form>
  </div></div>;
}
