import { useId, useRef, useState } from 'react';
import { api } from '../api';
import { crearGuardiaEnvio, fechaLocalISO } from '../fieldActions.js';
import { useProteccionFormulario } from '../useProteccionFormulario.js';
import ModalAccesible from './ModalAccesible.jsx';
import { FeedbackOperacion } from './EstadosUI.jsx';

export default function RegistrarLecheModal({ animalId, animal, registro, onCerrar, onCreado }) {
  const editando = Boolean(registro);
  const [form, setForm] = useState({
    fecha: registro?.fecha ? registro.fecha.slice(0, 10) : fechaLocalISO(),
    turno: registro?.turno || 'unico',
    litros: registro?.litros ?? '',
    observacion: registro?.observacion || '',
  });
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const guardia = useRef(crearGuardiaEnvio());
  const formularioId = useId();
  const [sucio, setSucio] = useState(false);
  useProteccionFormulario(sucio && !guardando && !eliminando);

  function actualizar(campo, valor) {
    setSucio(true);
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  async function guardar(e) {
    e.preventDefault();
    if (form.litros === '') {
      setError('Los litros son obligatorios.');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const resultado = await guardia.current.ejecutar(() => editando
        ? api.actualizarLeche(registro.id, form)
        : api.registrarLeche({ animal_id: animalId, ...form }));
      if (resultado.ejecutado) onCreado();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar() {
    if (!window.confirm('¿Eliminar este registro de ordeño?')) return;
    setEliminando(true);
    setError(null);
    try {
      await api.eliminarLeche(registro.id);
      onCreado();
    } catch (err) {
      setError(err.message);
      setEliminando(false);
    }
  }

  return (
    <ModalAccesible titulo={editando ? 'Editar ordeño' : 'Registrar producción de leche'} onCerrar={onCerrar} sucio={sucio} ocupado={guardando || eliminando}>
        {animal && <div className="animal-context"><strong>{animal.arete_id}</strong><span>{animal.nombre_alias || 'Sin alias'} · {animal.corral_actual || 'Sin corral'}</span></div>}
        <FeedbackOperacion tipo="error" mensaje={error} />
        <form onSubmit={guardar}>
          <div className="field">
            <label htmlFor={`${formularioId}-fecha`}>Fecha <span className="required-mark">Obligatorio</span></label>
            <input id={`${formularioId}-fecha`} className="input" type="date" max={fechaLocalISO()} value={form.fecha} onChange={(e) => actualizar('fecha', e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor={`${formularioId}-turno`}>Turno</label>
            <select id={`${formularioId}-turno`} value={form.turno} onChange={(e) => actualizar('turno', e.target.value)}>
              <option value="unico">Único (día completo)</option>
              <option value="manana">Mañana</option>
              <option value="tarde">Tarde</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${formularioId}-litros`}>Litros <span className="required-mark">Obligatorio</span></label>
            <input id={`${formularioId}-litros`} className="input" type="number" inputMode="decimal" min="0" step="0.1" data-autofocus value={form.litros} onChange={(e) => actualizar('litros', e.target.value)} required aria-invalid={Boolean(error && form.litros === '')} />
          </div>
          <div className="field">
            <label htmlFor={`${formularioId}-observacion`}>Observación</label>
            <textarea id={`${formularioId}-observacion`} rows={2} value={form.observacion} onChange={(e) => actualizar('observacion', e.target.value)} />
          </div>
          <div className="modal-actions" style={{ justifyContent: editando ? 'space-between' : 'flex-end' }}>
            {editando && (
              <button type="button" className="btn btn-ghost" style={{ color: 'var(--rust)' }} onClick={eliminar} disabled={eliminando}>
                {eliminando ? 'Eliminando...' : 'Eliminar'}
              </button>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="btn btn-ghost" data-modal-cerrar onClick={onCerrar}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={guardando || eliminando}>
                {guardando ? 'Guardando...' : editando ? 'Guardar cambios' : 'Registrar'}
              </button>
            </div>
          </div>
        </form>
    </ModalAccesible>
  );
}
