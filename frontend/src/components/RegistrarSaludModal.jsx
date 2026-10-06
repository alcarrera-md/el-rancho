import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../api';
import { AUTH_OFFLINE, useAuth } from '../auth/AuthContext.jsx';
import { ALMACEN_INSUMOS, leerColeccionLocal } from '../offline/campoDB.js';
import { capturarConSoporteOffline, metadataOperacion, TIPO_OPERACION } from '../offline/colaOperaciones.js';
import { CONECTIVIDAD_OFFLINE, obtenerEstadoConectividad } from '../offline/connectivity.js';
import { crearGuardiaEnvio, fechaLocalISO } from '../fieldActions.js';
import { useProteccionFormulario } from '../useProteccionFormulario.js';
import ModalAccesible from './ModalAccesible.jsx';
import { FeedbackOperacion } from './EstadosUI.jsx';

const TIPOS = [
  { value: 'vacuna', label: 'Vacuna' },
  { value: 'tratamiento', label: 'Tratamiento' },
  { value: 'diagnostico', label: 'Diagnóstico' },
  { value: 'desparasitacion', label: 'Desparasitación' },
];

export default function RegistrarSaludModal({ animalId, animal, registro, prellenado, onCerrar, onCreado }) {
  const editando = Boolean(registro);
  const { usuario, estadoAutenticacion } = useAuth();
  const sinConexion = estadoAutenticacion === AUTH_OFFLINE || obtenerEstadoConectividad() === CONECTIVIDAD_OFFLINE;
  const [insumos, setInsumos] = useState([]);
  const [form, setForm] = useState({
    tipo: registro?.tipo || prellenado?.tipo || 'vacuna',
    insumo_id: registro?.insumo_id || prellenado?.insumo_id || '',
    enfermedad: registro?.enfermedad || '',
    descripcion: registro?.descripcion || prellenado?.descripcion || '',
    fecha: registro?.fecha ? registro.fecha.slice(0, 10) : fechaLocalISO(),
    proxima_dosis: registro?.proxima_dosis ? registro.proxima_dosis.slice(0, 10) : '',
  });
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const guardia = useRef(crearGuardiaEnvio());
  const formularioId = useId();
  const [sucio, setSucio] = useState(false);
  useProteccionFormulario(sucio && !guardando && !eliminando);

  useEffect(() => {
    // Sin conexión se usa el catálogo sanitario del último snapshot; el
    // servidor vuelve a validar caducidad al sincronizar.
    const carga = sinConexion
      ? leerColeccionLocal(ALMACEN_INSUMOS, usuario?.id).then((local) => (local?.sanitarios || []).filter((i) => i.estado !== 'inactivo'))
      : api.listarInsumos().then((data) => data.filter((i) => i.tipo === 'vacuna' || i.tipo === 'medicamento'));
    carga.then(setInsumos).catch(() => setInsumos([]));
  }, [sinConexion, usuario?.id]);

  function actualizar(campo, valor) {
    setSucio(true);
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  async function guardar(e) {
    e.preventDefault();
    setError(null);
    if (editando && sinConexion) {
      setError('Editar un evento sanitario requiere conexión.');
      return;
    }
    const resultado = await guardia.current.ejecutar(async () => {
      setGuardando(true);
      const payload = { ...form, insumo_id: form.insumo_id ? Number(form.insumo_id) : null, proxima_dosis: form.proxima_dosis || null };
      try {
        if (editando) return await api.actualizarSalud(registro.id, payload);
        // Alta: misma cola offline de P8.1 (UUID estable e idempotencia).
        const alta = { animal_id: Number(animalId), plan_item_id: prellenado?.planItemId || null, ...payload };
        return await capturarConSoporteOffline({
          usuario, sinConexion, tipo: TIPO_OPERACION.EVENTO_SALUD, entidadId: animalId, payload: alta,
          contextoPublico: { entidad: `${animal?.arete_id ? `Animal ${animal.arete_id}` : 'Animal seleccionado'} · ${form.tipo}` },
          ejecutarOnline: (operacion) => api.registrarSalud(alta, metadataOperacion(operacion, false)),
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
    if (!window.confirm('¿Eliminar este evento de salud? Esta acción no se puede deshacer.')) return;
    setEliminando(true);
    setError(null);
    try {
      await api.eliminarSalud(registro.id);
      onCreado();
    } catch (err) {
      setError(err.message);
      setEliminando(false);
    }
  }

  return (
    <ModalAccesible titulo={editando ? 'Editar evento de salud' : 'Registrar evento de salud'} onCerrar={onCerrar} sucio={sucio} ocupado={guardando || eliminando} className="modal-corto">
        {animal && <div className="animal-context"><strong>{animal.arete_id}</strong><span>{animal.nombre_alias || 'Sin alias'} · {animal.corral_actual || 'Sin corral'}</span></div>}
        {prellenado && !editando && (
          <div className="error-banner" style={{ background: 'var(--wheat-soft)', color: '#6b4f10', borderColor: 'var(--wheat)' }}>
            Esto marcará como cumplido: <strong>{prellenado.nombre_evento}</strong> ({prellenado.planNombre})
          </div>
        )}
        <FeedbackOperacion tipo="error" mensaje={error} />
        {sinConexion && !editando && <p className="offline-action-help" role="note">Sin conexión: se guardará en este dispositivo y se enviará al recuperar Internet.</p>}
        <form onSubmit={guardar}>
          <div className="field">
            <label htmlFor={`${formularioId}-tipo`}>Tipo <span className="required-mark">Obligatorio</span></label>
            <select id={`${formularioId}-tipo`} data-autofocus required value={form.tipo} onChange={(e) => actualizar('tipo', e.target.value)}>
              {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${formularioId}-insumo`}>Vacuna/medicamento usado (opcional)</label>
            <select id={`${formularioId}-insumo`} value={form.insumo_id} onChange={(e) => actualizar('insumo_id', e.target.value)}>
              <option value="">Ninguno / no aplica</option>
              {insumos.map((i) => (
                <option key={i.id} value={i.id}>{i.nombre} (stock: {i.stock_actual} {i.unidad_medida})</option>
              ))}
            </select>
          </div>
          {(form.tipo === 'tratamiento' || form.tipo === 'diagnostico') && <div className="field">
            <label htmlFor={`${formularioId}-enfermedad`}>Enfermedad o diagnóstico</label>
            <input id={`${formularioId}-enfermedad`} className="input" value={form.enfermedad} onChange={(e) => actualizar('enfermedad', e.target.value)} />
          </div>}
          <div className="field">
            <label htmlFor={`${formularioId}-fecha`}>Fecha <span className="required-mark">Obligatorio</span></label>
            <input id={`${formularioId}-fecha`} className="input" type="date" required max={fechaLocalISO()} value={form.fecha} onChange={(e) => actualizar('fecha', e.target.value)} />
          </div>
          <details className="form-opcionales" open={editando && Boolean(form.descripcion || form.proxima_dosis)}>
            <summary>Agregar notas o próxima dosis</summary>
            <div className="field">
              <label htmlFor={`${formularioId}-descripcion`}>Descripción / notas</label>
              <textarea id={`${formularioId}-descripcion`} rows={2} value={form.descripcion} onChange={(e) => actualizar('descripcion', e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor={`${formularioId}-proxima`}>Próxima dosis</label>
              <input id={`${formularioId}-proxima`} className="input" type="date" min={form.fecha || fechaLocalISO()} value={form.proxima_dosis} onChange={(e) => actualizar('proxima_dosis', e.target.value)} />
            </div>
          </details>
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
