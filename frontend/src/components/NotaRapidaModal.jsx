import { useId, useRef, useState } from 'react';
import { api } from '../api';
import { crearGuardiaEnvio } from '../fieldActions.js';
import { useProteccionFormulario } from '../useProteccionFormulario.js';
import ModalAccesible from './ModalAccesible.jsx';
import { FeedbackOperacion } from './EstadosUI.jsx';
import { AUTH_OFFLINE, useAuth } from '../auth/AuthContext.jsx';
import { CONECTIVIDAD_OFFLINE, obtenerEstadoConectividad } from '../offline/connectivity.js';
import { capturarConSoporteOffline, metadataOperacion, TIPO_OPERACION } from '../offline/colaOperaciones.js';

const TAGS = ['General', 'Salud', 'Comportamiento', 'Alimentación', 'Reproducción'];

export default function NotaRapidaModal({ animal, onCerrar, onCreado }) {
  const { usuario, estadoAutenticacion } = useAuth();
  const sinConexion = estadoAutenticacion === AUTH_OFFLINE || obtenerEstadoConectividad() === CONECTIVIDAD_OFFLINE;
  const [contenido, setContenido] = useState('');
  const [tag, setTag] = useState('General');
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const guardia = useRef(crearGuardiaEnvio());
  const formularioId = useId();
  useProteccionFormulario(!guardando && Boolean(contenido.trim()));

  async function guardar(evento) {
    evento.preventDefault();
    if (!contenido.trim()) { setError('Escribe la nota que deseas guardar.'); return; }
    setGuardando(true);
    setError(null);
    try {
      const payload = { animal_id: animal.id, tag, contenido: contenido.trim() };
      const resultado = await guardia.current.ejecutar(() => capturarConSoporteOffline({
        usuario, sinConexion, tipo: TIPO_OPERACION.NOTA, entidadId: animal.id, payload,
        contextoPublico: { entidad: animal?.arete_id ? `Animal ${animal.arete_id}` : 'Animal seleccionado' },
        ejecutarOnline: (operacion) => api.crearNota(payload, metadataOperacion(operacion, false)),
      }));
      if (resultado.ejecutado) onCreado(resultado.valor);
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <ModalAccesible titulo="Agregar nota" onCerrar={onCerrar} sucio={Boolean(contenido.trim())} ocupado={guardando} className="modal-corto">
        <div className="animal-context"><strong>{animal.arete_id}</strong><span>{animal.nombre_alias || 'Sin alias'} · {animal.corral_actual || 'Sin corral'}</span></div>
        <FeedbackOperacion tipo="error" mensaje={error} />
        <form onSubmit={guardar}>
          <div className="field">
            <label htmlFor={`${formularioId}-tag`}>Tipo de nota</label>
            <select id={`${formularioId}-tag`} value={tag} onChange={(evento) => setTag(evento.target.value)}>{TAGS.map((opcion) => <option key={opcion}>{opcion}</option>)}</select>
          </div>
          <div className="field">
            <label htmlFor={`${formularioId}-contenido`}>Nota <span className="required-mark">Obligatorio</span></label>
            <textarea id={`${formularioId}-contenido`} rows={4} value={contenido} onChange={(evento) => setContenido(evento.target.value)} placeholder="¿Qué debe saber la siguiente persona que revise este animal?" data-autofocus required aria-invalid={Boolean(error && !contenido.trim())} />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" data-modal-cerrar onClick={onCerrar}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={guardando || !contenido.trim()}>{guardando ? 'Guardando...' : sinConexion ? 'Guardar para sincronizar' : 'Guardar nota'}</button>
          </div>
        </form>
    </ModalAccesible>
  );
}
