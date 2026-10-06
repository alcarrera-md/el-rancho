import { useId, useRef, useState } from 'react';
import { api } from '../api';
import { crearGuardiaEnvio, fechaLocalISO } from '../fieldActions.js';
import { useProteccionFormulario } from '../useProteccionFormulario.js';
import ModalAccesible from './ModalAccesible.jsx';
import { FeedbackOperacion } from './EstadosUI.jsx';
import { AUTH_OFFLINE, useAuth } from '../auth/AuthContext.jsx';
import { CONECTIVIDAD_OFFLINE, obtenerEstadoConectividad } from '../offline/connectivity.js';
import { capturarConSoporteOffline, metadataOperacion, TIPO_OPERACION } from '../offline/colaOperaciones.js';

const hoy = fechaLocalISO();

export default function CambiarEstadoSaludModal({ animal, soloObservacion = false, onCerrar, onGuardado }) {
  const { usuario, estadoAutenticacion } = useAuth();
  const sinConexion = estadoAutenticacion === AUTH_OFFLINE || obtenerEstadoConectividad() === CONECTIVIDAD_OFFLINE;
  const [form, setForm] = useState({
    estado_salud: soloObservacion ? 'observacion' : (animal.estado_salud || 'sano'),
    salud_fecha_inicio: animal.salud_fecha_inicio ? animal.salud_fecha_inicio.slice(0, 10) : hoy,
    salud_diagnostico: animal.salud_diagnostico || '',
    salud_tratamiento: animal.salud_tratamiento || '',
  });
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const guardia = useRef(crearGuardiaEnvio());
  const formularioId = useId();
  const [sucio, setSucio] = useState(false);
  useProteccionFormulario(sucio && !guardando);

  function actualizar(campo, valor) {
    setSucio(true);
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  async function guardar(e) {
    e.preventDefault();
    setError(null);
    const resultado = await guardia.current.ejecutar(async () => {
      setGuardando(true);
      try {
        const payload = soloObservacion ? { estado_salud: 'observacion' } : form;
        if (soloObservacion) {
          return await capturarConSoporteOffline({
            usuario, sinConexion, tipo: TIPO_OPERACION.OBSERVACION, entidadId: animal.id, payload,
            contextoPublico: { entidad: animal?.arete_id ? `Animal ${animal.arete_id}` : 'Animal seleccionado' },
            ejecutarOnline: (operacion) => api.cambiarEstadoSalud(animal.id, payload, metadataOperacion(operacion, false)),
          });
        }
        return await api.cambiarEstadoSalud(animal.id, payload);
      } finally {
        setGuardando(false);
      }
    }).catch((err) => {
      setError(err.message);
      return null;
    });
    if (resultado?.ejecutado) onGuardado(resultado.valor);
  }

  return (
    <ModalAccesible titulo={soloObservacion ? 'Reportar animal para revisión' : 'Cambiar estado de salud'} onCerrar={onCerrar} sucio={sucio} ocupado={guardando} className="modal-corto">
        <div className="animal-context"><strong>{animal.arete_id}</strong><span>{animal.nombre_alias || 'Sin alias'} · {animal.corral_actual || 'Sin corral'}</span></div>
        <FeedbackOperacion tipo="error" mensaje={error} />
        <form onSubmit={guardar}>
          {soloObservacion ? (
            <p>El animal quedará marcado “En observación” para que un Veterinario o Administrador realice la evaluación clínica.</p>
          ) : <div className="field">
            <label htmlFor={`${formularioId}-estado`}>Estado</label>
            <select id={`${formularioId}-estado`} data-autofocus value={form.estado_salud} onChange={(e) => actualizar('estado_salud', e.target.value)}>
              <option value="sano">Sano</option>
              <option value="observacion">En observación</option>
              <option value="enfermo">Enfermo</option>
            </select>
          </div>}

          {!soloObservacion && form.estado_salud === 'enfermo' && (
            <>
              <div className="field">
                <label htmlFor={`${formularioId}-fecha`}>¿Desde cuándo (aproximado)?</label>
                <input id={`${formularioId}-fecha`} className="input" type="date" max={hoy} value={form.salud_fecha_inicio} onChange={(e) => actualizar('salud_fecha_inicio', e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor={`${formularioId}-diagnostico`}>Diagnóstico</label>
                <textarea id={`${formularioId}-diagnostico`} rows={2} value={form.salud_diagnostico} onChange={(e) => actualizar('salud_diagnostico', e.target.value)} placeholder="¿Qué tiene?" />
              </div>
              <div className="field">
                <label htmlFor={`${formularioId}-tratamiento`}>Tratamiento</label>
                <textarea id={`${formularioId}-tratamiento`} rows={2} value={form.salud_tratamiento} onChange={(e) => actualizar('salud_tratamiento', e.target.value)} placeholder="¿Qué se le está haciendo?" />
              </div>
            </>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" data-modal-cerrar onClick={onCerrar}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={guardando}>
              {guardando ? 'Guardando...' : (soloObservacion ? (sinConexion ? 'Guardar para sincronizar' : 'Reportar para revisión') : 'Guardar cambios')}
            </button>
          </div>
        </form>
    </ModalAccesible>
  );
}
