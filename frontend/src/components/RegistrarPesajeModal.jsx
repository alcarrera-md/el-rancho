import { useId, useRef, useState } from 'react';
import { api } from '../api';
import { crearGuardiaEnvio, fechaLocalISO } from '../fieldActions.js';
import { useProteccionFormulario } from '../useProteccionFormulario.js';
import ModalAccesible from './ModalAccesible.jsx';
import { FeedbackOperacion } from './EstadosUI.jsx';
import { AUTH_OFFLINE, useAuth } from '../auth/AuthContext.jsx';
import { CONECTIVIDAD_OFFLINE, obtenerEstadoConectividad } from '../offline/connectivity.js';
import { capturarConSoporteOffline, metadataOperacion, TIPO_OPERACION } from '../offline/colaOperaciones.js';

export default function RegistrarPesajeModal({ animalId, animal, registro, onCerrar, onCreado }) {
  const { usuario, estadoAutenticacion } = useAuth();
  const sinConexion = estadoAutenticacion === AUTH_OFFLINE || obtenerEstadoConectividad() === CONECTIVIDAD_OFFLINE;
  const editando = Boolean(registro);
  const [form, setForm] = useState({
    fecha: registro?.fecha ? registro.fecha.slice(0, 10) : fechaLocalISO(),
    peso_kg: registro?.peso_kg ?? '',
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
    if (!form.peso_kg) {
      setError('El peso es obligatorio.');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const payload = { animal_id: animalId, ...form };
      const resultado = await guardia.current.ejecutar(() => editando
        ? api.actualizarPesaje(registro.id, form)
        : capturarConSoporteOffline({
          usuario, sinConexion, tipo: TIPO_OPERACION.PESAJE, entidadId: animalId, payload,
          contextoPublico: { entidad: animal?.arete_id ? `Animal ${animal.arete_id}` : 'Animal seleccionado' },
          ejecutarOnline: (operacion) => api.registrarPesaje(payload, metadataOperacion(operacion, false)),
        }));
      if (resultado.ejecutado) onCreado(resultado.valor);
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar() {
    if (!window.confirm('¿Eliminar este pesaje? Esta acción no se puede deshacer.')) return;
    setEliminando(true);
    setError(null);
    try {
      await api.eliminarPesaje(registro.id);
      onCreado();
    } catch (err) {
      setError(err.message);
      setEliminando(false);
    }
  }

  return (
    <ModalAccesible titulo={editando ? 'Editar pesaje' : 'Registrar pesaje'} onCerrar={onCerrar} sucio={sucio} ocupado={guardando || eliminando}>
        {animal && <div className="animal-context"><strong>{animal.arete_id}</strong><span>{animal.nombre_alias || 'Sin alias'} · {animal.corral_actual || 'Sin corral'}</span></div>}
        <FeedbackOperacion tipo="error" mensaje={error} />
        <form onSubmit={guardar}>
          <div className="field">
            <label htmlFor={`${formularioId}-fecha`}>Fecha <span className="required-mark">Obligatorio</span></label>
            <input id={`${formularioId}-fecha`} className="input" type="date" max={fechaLocalISO()} value={form.fecha} onChange={(e) => actualizar('fecha', e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor={`${formularioId}-peso`}>Peso (kg) <span className="required-mark">Obligatorio</span></label>
            <input id={`${formularioId}-peso`} className="input" type="number" inputMode="decimal" min="0.1" step="0.1" data-autofocus value={form.peso_kg} onChange={(e) => actualizar('peso_kg', e.target.value)} required aria-invalid={Boolean(error && !form.peso_kg)} />
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
                {guardando ? 'Guardando...' : editando ? 'Guardar cambios' : sinConexion ? 'Guardar para sincronizar' : 'Registrar pesaje'}
              </button>
            </div>
          </div>
        </form>
    </ModalAccesible>
  );
}
