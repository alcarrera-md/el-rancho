import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../api';
import { crearGuardiaEnvio, fechaLocalISO } from '../fieldActions.js';
import { useProteccionFormulario } from '../useProteccionFormulario.js';
import ModalAccesible from './ModalAccesible.jsx';
import { FeedbackOperacion } from './EstadosUI.jsx';
import { AUTH_OFFLINE, useAuth } from '../auth/AuthContext.jsx';
import { CONECTIVIDAD_OFFLINE, obtenerEstadoConectividad } from '../offline/connectivity.js';
import { ALMACEN_INSUMOS, leerColeccionLocal, listarOperacionesLocal } from '../offline/campoDB.js';
import { alimentacionPendientePorInsumo, textoStockOffline } from '../offline/fichaOffline.js';
import { capturarConSoporteOffline, metadataOperacion, TIPO_OPERACION } from '../offline/colaOperaciones.js';

export default function RegistrarAlimentacionModal({ animalId, animal, registro, onCerrar, onCreado }) {
  const { usuario, estadoAutenticacion, sincronizarAhora } = useAuth();
  const sinConexion = estadoAutenticacion === AUTH_OFFLINE || obtenerEstadoConectividad() === CONECTIVIDAD_OFFLINE;
  const editando = Boolean(registro);
  const [insumos, setInsumos] = useState([]);
  const [form, setForm] = useState({
    insumo_id: registro?.insumo_id || '',
    cantidad: registro?.cantidad ?? '',
    fecha: registro?.fecha ? registro.fecha.slice(0, 10) : fechaLocalISO(),
  });
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [cargandoInsumos, setCargandoInsumos] = useState(true);
  const [pendientes, setPendientes] = useState(() => new Map());
  const guardia = useRef(crearGuardiaEnvio());
  const formularioId = useId();
  const [sucio, setSucio] = useState(false);
  useProteccionFormulario(sucio && !guardando && !eliminando);

  useEffect(() => {
    let vigente = true;
    setCargandoInsumos(true);
    const carga = sinConexion
      ? leerColeccionLocal(ALMACEN_INSUMOS, usuario?.id).then((local) => local?.datos || [])
      : api.listarInsumos('alimento');
    carga
      .then((datos) => { if (vigente) setInsumos(datos); })
      .catch(() => { if (vigente) setError('No se pudo consultar el inventario de alimentos.'); })
      .finally(() => { if (vigente) setCargandoInsumos(false); });
    // Consumo capturado sin conexión que el servidor aún no confirmó.
    if (sinConexion && usuario?.id) {
      listarOperacionesLocal(usuario.id).then((operaciones) => { if (vigente) setPendientes(alimentacionPendientePorInsumo(operaciones)); }).catch(() => {});
    }
    return () => { vigente = false; };
  }, [sinConexion, usuario?.id]);

  function actualizar(campo, valor) {
    setSucio(true);
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  const insumoSeleccionado = insumos.find((i) => String(i.id) === String(form.insumo_id));

  async function guardar(e) {
    e.preventDefault();
    if (!form.insumo_id || !form.cantidad) {
      setError('El insumo y la cantidad son obligatorios.');
      return;
    }
    if (Number(form.cantidad) > Number(insumoSeleccionado?.stock_actual)) {
      setError(`La cantidad supera el stock sincronizado (${insumoSeleccionado?.stock_actual || 0} ${insumoSeleccionado?.unidad_medida || ''}).`);
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const payload = editando ? form : {
        animal_id: animalId,
        corral_contexto_id: animal?.corral_actual_id || undefined,
        ...form,
        unidad_medida: insumoSeleccionado.unidad_medida,
        expected_version: Number(insumoSeleccionado.version),
        stock_observado: Number(insumoSeleccionado.stock_actual),
      };
      const resultado = await guardia.current.ejecutar(() => editando
        ? api.actualizarAlimentacion(registro.id, form)
        : capturarConSoporteOffline({
          usuario,
          sinConexion,
          tipo: TIPO_OPERACION.ALIMENTACION,
          entidadId: animalId,
          payload,
          contextoPublico: {
            entidad: `${insumoSeleccionado.nombre} · ${animal?.arete_id ? `Animal ${animal.arete_id}` : 'Animal seleccionado'}${animal?.corral_actual ? ` · ${animal.corral_actual}` : ''}`,
          },
          ejecutarOnline: (operacion) => api.registrarAlimentacion(payload, metadataOperacion(operacion, false)),
        }));
      if (resultado.ejecutado) {
        if (!editando && !resultado.valor?.offline_pending) {
          await sincronizarAhora().catch(() => {});
        }
        onCreado(resultado.valor);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar() {
    if (!window.confirm('¿Eliminar este registro de alimentación? El insumo se devolverá al inventario.')) return;
    setEliminando(true);
    setError(null);
    try {
      await api.eliminarAlimentacion(registro.id);
      onCreado();
    } catch (err) {
      setError(err.message);
      setEliminando(false);
    }
  }

  return (
    <ModalAccesible titulo={editando ? 'Editar alimentación' : 'Registrar alimentación'} onCerrar={onCerrar} sucio={sucio} ocupado={guardando || eliminando}>
        {animal && <div className="animal-context"><strong>{animal.arete_id}</strong><span>{animal.nombre_alias || 'Sin alias'} · {animal.corral_actual || 'Sin corral'}</span></div>}
        <FeedbackOperacion tipo="error" mensaje={error} />
        {!cargandoInsumos && insumos.length === 0 && !editando && (
          <div className="error-banner" style={{ background: 'var(--wheat-soft)', color: '#6b4f10', borderColor: 'var(--wheat)' }}>
            No hay insumos de tipo "alimento" registrados todavía.
          </div>
        )}
        <form onSubmit={guardar}>
          <div className="field">
            <label htmlFor={`${formularioId}-insumo`}>Alimento <span className="required-mark">Obligatorio</span></label>
            <select id={`${formularioId}-insumo`} data-autofocus required value={form.insumo_id} onChange={(e) => actualizar('insumo_id', e.target.value)} aria-invalid={Boolean(error && !form.insumo_id)}>
              <option value="">Selecciona un alimento</option>
              {insumos.map((i) => (
                <option key={i.id} value={i.id} disabled={['caducado', 'sin_stock', 'inactivo'].includes(i.estado)}>{i.nombre} (stock: {i.stock_actual} {i.unidad_medida}){i.estado === 'caducado' ? ' · caducado' : i.estado === 'inactivo' ? ' · inactivo' : ''}</option>
              ))}
            </select>
            {insumoSeleccionado && sinConexion && <small className="field-help" role="note">{textoStockOffline(insumoSeleccionado, pendientes.get(String(insumoSeleccionado.id)))}. Puede estar desactualizado; al sincronizar se aplica solo si todavía alcanza.</small>}
            {insumoSeleccionado && !sinConexion && <small className="field-help" role="note">Stock actual: {insumoSeleccionado.stock_actual} {insumoSeleccionado.unidad_medida}.</small>}
          </div>
          <div className="field">
            <label htmlFor={`${formularioId}-cantidad`}>Cantidad {insumoSeleccionado ? `(${insumoSeleccionado.unidad_medida})` : ''} <span className="required-mark">Obligatorio</span></label>
            <input id={`${formularioId}-cantidad`} className="input" type="number" inputMode="decimal" min="0.1" step="0.1" value={form.cantidad} onChange={(e) => actualizar('cantidad', e.target.value)} required aria-invalid={Boolean(error && !form.cantidad)} />
          </div>
          <div className="field">
            <label htmlFor={`${formularioId}-fecha`}>Fecha <span className="required-mark">Obligatorio</span></label>
            <input id={`${formularioId}-fecha`} className="input" type="date" max={fechaLocalISO()} value={form.fecha} onChange={(e) => actualizar('fecha', e.target.value)} required />
          </div>
          <div className="modal-actions" style={{ justifyContent: editando ? 'space-between' : 'flex-end' }}>
            {editando && (
              <button type="button" className="btn btn-ghost" style={{ color: 'var(--rust)' }} onClick={eliminar} disabled={eliminando}>
                {eliminando ? 'Eliminando...' : 'Eliminar'}
              </button>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="btn btn-ghost" data-modal-cerrar onClick={onCerrar}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={guardando || eliminando || cargandoInsumos || insumos.length === 0}>
                {guardando ? 'Guardando...' : editando ? 'Guardar cambios' : sinConexion ? 'Guardar para sincronizar' : 'Registrar'}
              </button>
            </div>
          </div>
        </form>
    </ModalAccesible>
  );
}
