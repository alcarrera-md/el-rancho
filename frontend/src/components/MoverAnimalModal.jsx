import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../api';
import { crearGuardiaEnvio } from '../fieldActions.js';
import { useProteccionFormulario } from '../useProteccionFormulario.js';
import ModalAccesible from './ModalAccesible.jsx';
import { FeedbackOperacion } from './EstadosUI.jsx';
import { exigirListaModulo } from '../monitoringUx.js';
import { AUTH_OFFLINE, useAuth } from '../auth/AuthContext.jsx';
import { CONECTIVIDAD_OFFLINE, obtenerEstadoConectividad } from '../offline/connectivity.js';
import { ALMACEN_CORRALES, leerColeccionLocal } from '../offline/campoDB.js';
import { capturarConSoporteOffline, metadataOperacion, TIPO_OPERACION } from '../offline/colaOperaciones.js';

export default function MoverAnimalModal({ animal, onCerrar, onCreado }) {
  const { usuario, estadoAutenticacion, sincronizarAhora } = useAuth();
  const sinConexion = estadoAutenticacion === AUTH_OFFLINE || obtenerEstadoConectividad() === CONECTIVIDAD_OFFLINE;
  const [corrales, setCorrales] = useState([]);
  const [corralId, setCorralId] = useState('');
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const guardia = useRef(crearGuardiaEnvio());
  const formularioId = useId();
  const sucio = Boolean(corralId);
  useProteccionFormulario(sucio && !guardando);

  useEffect(() => {
    const carga = sinConexion
      ? leerColeccionLocal(ALMACEN_CORRALES, usuario?.id).then((local) => local?.datos || [])
      : api.listarCorrales();
    carga
      .then((data) => setCorrales(exigirListaModulo(data, sinConexion ? 'IndexedDB/corrales' : '/api/corrales').filter((corral) => String(corral.id) !== String(animal.corral_actual_id))))
      .catch((err) => setError(err.message));
  }, [animal.corral_actual_id, sinConexion, usuario?.id]);

  const corralDestino = corrales.find((corral) => String(corral.id) === String(corralId));

  async function guardar(evento) {
    evento.preventDefault();
    if (!corralId) { setError('Selecciona el corral de destino.'); return; }
    if (sinConexion && (!Number.isInteger(Number(animal.version)) || Number(animal.version) < 1)) {
      setError('Vuelve a conectarte para descargar la versión actual del animal antes de guardar el movimiento.');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const payload = {
        corral_id: Number(corralId),
        corral_origen_id: animal.corral_actual_id ?? null,
        expected_version: Number(animal.version),
        estado_observado: animal.estado,
        destino_ocupacion_observada: Number(corralDestino?.ocupacion_actual || 0),
        destino_capacidad_observada: Number(corralDestino?.capacidad_maxima),
      };
      const resultado = await guardia.current.ejecutar(() => capturarConSoporteOffline({
        usuario,
        sinConexion,
        tipo: TIPO_OPERACION.MOVIMIENTO,
        entidadId: animal.id,
        payload,
        contextoPublico: {
          entidad: `${animal.arete_id} · ${animal.corral_actual || 'Sin corral'} → ${corralDestino?.nombre || 'Destino seleccionado'}`,
        },
        ejecutarOnline: (operacion) => api.trasladarAnimal(animal.id, payload, metadataOperacion(operacion, false)),
      }));
      if (resultado.ejecutado && !resultado.valor?.offline_pending) {
        await sincronizarAhora().catch(() => {});
      }
      if (resultado.ejecutado) onCreado(resultado.valor?.offline_pending ? resultado.valor : resultado.valor?.resultado);
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <ModalAccesible titulo="Mover de corral" onCerrar={onCerrar} sucio={sucio} ocupado={guardando} className="modal-corto">
        <div className="animal-context"><strong>{animal.arete_id}</strong><span>{animal.nombre_alias || 'Sin alias'} · Ubicación sincronizada: {animal.corral_actual || 'Sin corral'}</span></div>
        <FeedbackOperacion tipo="error" mensaje={error} />
        <form onSubmit={guardar}>
          <div className="field">
            <label htmlFor={`${formularioId}-corral`}>Corral de destino <span className="required-mark">Obligatorio</span></label>
            <select id={`${formularioId}-corral`} value={corralId} onChange={(evento) => setCorralId(evento.target.value)} required data-autofocus aria-invalid={Boolean(error && !corralId)}>
              <option value="">Selecciona un corral</option>
              {corrales.map((corral) => {
                const lleno = Number(corral.ocupacion_actual) >= Number(corral.capacidad_maxima);
                const inactivo = corral.activo === false;
                return <option key={corral.id} value={corral.id} disabled={lleno || inactivo}>{corral.nombre} ({corral.ocupacion_actual}/{corral.capacidad_maxima}){inactivo ? ' · inactivo' : lleno ? ' · lleno' : ''}</option>;
              })}
            </select>
            <small className="field-help" role="note">La ubicación y capacidad se validarán nuevamente al recuperar conexión.</small>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" data-modal-cerrar onClick={onCerrar}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={guardando || !corralId}>{guardando ? 'Guardando...' : sinConexion ? 'Guardar para sincronizar' : 'Confirmar traslado'}</button>
          </div>
        </form>
    </ModalAccesible>
  );
}
