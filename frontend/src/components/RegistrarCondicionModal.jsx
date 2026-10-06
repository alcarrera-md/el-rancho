import { useId, useRef, useState } from 'react';
import { api } from '../api';
import { AUTH_OFFLINE, useAuth } from '../auth/AuthContext.jsx';
import { crearGuardiaEnvio, fechaLocalISO } from '../fieldActions.js';
import { capturarConSoporteOffline, metadataOperacion, TIPO_OPERACION } from '../offline/colaOperaciones.js';
import { CONECTIVIDAD_OFFLINE, obtenerEstadoConectividad } from '../offline/connectivity.js';
import { useProteccionFormulario } from '../useProteccionFormulario.js';
import ModalAccesible from './ModalAccesible.jsx';
import { FeedbackOperacion } from './EstadosUI.jsx';

const ETIQUETAS = { 1: 'Muy delgada', 2: 'Delgada', 3: 'Ideal', 4: 'Gorda', 5: 'Muy gorda' };

export default function RegistrarCondicionModal({ animalId, animal, registro, onCerrar, onCreado }) {
  const editando = Boolean(registro);
  const { usuario, estadoAutenticacion } = useAuth();
  const sinConexion = estadoAutenticacion === AUTH_OFFLINE || obtenerEstadoConectividad() === CONECTIVIDAD_OFFLINE;
  const [form, setForm] = useState({
    fecha: registro?.fecha ? String(registro.fecha).slice(0, 10) : fechaLocalISO(),
    puntuacion: registro?.puntuacion || 3,
    observacion: registro?.observacion || '',
  });
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [sucio, setSucio] = useState(false);
  const guardia = useRef(crearGuardiaEnvio());
  const formularioId = useId();
  useProteccionFormulario(sucio && !guardando && !eliminando);

  function actualizar(campo, valor) {
    setSucio(true);
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  async function guardar(e) {
    e.preventDefault();
    setError(null);
    if (editando && sinConexion) {
      setError('Editar una condición corporal requiere conexión.');
      return;
    }
    const resultado = await guardia.current.ejecutar(async () => {
      setGuardando(true);
      try {
        if (editando) return await api.actualizarCondicion(registro.id, form);
        // El responsable no se envía: el servidor lo toma de la sesión.
        const payload = { animal_id: Number(animalId), fecha: form.fecha, puntuacion: Number(form.puntuacion), observacion: form.observacion || null };
        return await capturarConSoporteOffline({
          usuario, sinConexion, tipo: TIPO_OPERACION.CONDICION_CORPORAL, entidadId: animalId, payload,
          contextoPublico: { entidad: `${animal?.arete_id ? `Animal ${animal.arete_id}` : 'Animal seleccionado'} · condición ${payload.puntuacion}/5` },
          ejecutarOnline: (operacion) => api.registrarCondicion(payload, metadataOperacion(operacion, false)),
        });
      } finally {
        setGuardando(false);
      }
    }).catch((err) => {
      setError(err.message);
      return null;
    });
    if (resultado?.ejecutado) onCreado(resultado.valor);
  }

  async function eliminar() {
    if (!window.confirm('¿Eliminar este registro de condición corporal?')) return;
    setEliminando(true);
    setError(null);
    try {
      await api.eliminarCondicion(registro.id);
      onCreado();
    } catch (err) {
      setError(err.message);
      setEliminando(false);
    }
  }

  return (
    <ModalAccesible titulo={editando ? 'Editar condición corporal' : 'Registrar condición corporal'} onCerrar={onCerrar} sucio={sucio} ocupado={guardando || eliminando} className="modal-corto">
      {animal && <div className="animal-context"><strong>{animal.arete_id}</strong><span>{animal.nombre_alias || 'Sin alias'} · {animal.corral_actual || 'Sin corral'}</span></div>}
      <FeedbackOperacion tipo="error" mensaje={error} />
      {sinConexion && !editando && <p className="offline-action-help" role="note">Sin conexión: se guardará en este dispositivo y se enviará al recuperar Internet.</p>}
      <form onSubmit={guardar}>
        <fieldset className="field condicion-escala">
          <legend>Puntuación (escala 1 a 5) <span className="required-mark">Obligatorio</span></legend>
          <div className="condicion-opciones">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={n === Number(form.puntuacion)}
                onClick={() => actualizar('puntuacion', n)}
                className={n === Number(form.puntuacion) ? 'btn btn-primary' : 'btn btn-ghost'}
              >
                <strong>{n}</strong>
                <span>{ETIQUETAS[n]}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <div className="field">
          <label htmlFor={`${formularioId}-fecha`}>Fecha <span className="required-mark">Obligatorio</span></label>
          <input id={`${formularioId}-fecha`} className="input" type="date" required max={fechaLocalISO()} value={form.fecha} onChange={(e) => actualizar('fecha', e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${formularioId}-observacion`}>Observación</label>
          <textarea id={`${formularioId}-observacion`} rows={2} value={form.observacion} onChange={(e) => actualizar('observacion', e.target.value)} />
        </div>
        <div className="modal-actions" style={{ justifyContent: editando ? 'space-between' : 'flex-end' }}>
          {editando && (
            <button type="button" className="btn btn-ghost" style={{ color: 'var(--rust)' }} onClick={eliminar} disabled={eliminando || sinConexion}>
              {eliminando ? 'Eliminando...' : 'Eliminar'}
            </button>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="btn btn-ghost" data-modal-cerrar onClick={onCerrar} disabled={guardando || eliminando}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={guardando || eliminando}>
              {guardando ? 'Guardando...' : editando ? 'Guardar cambios' : sinConexion ? 'Guardar para sincronizar' : 'Registrar'}
            </button>
          </div>
        </div>
      </form>
    </ModalAccesible>
  );
}
