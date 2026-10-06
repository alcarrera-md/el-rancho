import { useEffect, useId, useMemo, useState } from 'react';
import { api } from '../api';
import { fechaLocalISO } from '../fieldActions.js';
import { ESTADOS_TAREA, PRIORIDADES_TAREA, TIPOS_TAREA } from '../tareas.js';
import ModalAccesible from './ModalAccesible.jsx';
import { FeedbackOperacion } from './EstadosUI.jsx';

export default function NuevaTareaModal({ tarea = null, onCerrar, onCreado }) {
  const id = useId();
  const editando = Boolean(tarea);
  const [trabajadores, setTrabajadores] = useState([]);
  const [corrales, setCorrales] = useState([]);
  const [animales, setAnimales] = useState([]);
  const [insumos, setInsumos] = useState([]);
  const [form, setForm] = useState({
    titulo: tarea?.titulo || '', descripcion: tarea?.descripcion || '', tipo: tarea?.tipo || 'revision_general',
    trabajador_id: tarea?.trabajador_id || '', corral_ids: (tarea?.corral_ids || (tarea?.corral_id ? [tarea.corral_id] : [])).map(String), animal_id: tarea?.animal_id || '',
    insumo_id: tarea?.insumo_id || '', cantidad: tarea?.cantidad || '', fecha_limite: (tarea?.fecha_limite || tarea?.fecha || fechaLocalISO()).slice(0, 10),
    prioridad: tarea?.prioridad || 'media', estado: tarea?.estado || 'pendiente',
  });
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [sucio, setSucio] = useState(false);

  useEffect(() => {
    Promise.all([
      api.listarTrabajadores(), api.listarCorrales(), api.listarAnimales({ estado: 'vivo' }), api.listarInsumos(),
    ]).then(([personas, listaCorrales, listaAnimales, listaInsumos]) => {
      setTrabajadores(personas.filter((persona) => persona.activo));
      setCorrales(listaCorrales.filter((corral) => corral.activo !== false));
      setAnimales(listaAnimales);
      setInsumos(listaInsumos);
    }).catch((err) => setError(err.message));
  }, []);

  const insumosAplicables = useMemo(() => {
    if (form.tipo === 'alimentacion') return insumos.filter((insumo) => insumo.tipo === 'alimento');
    if (form.tipo === 'vacunacion_tratamiento' || form.tipo === 'revision_salud') {
      return insumos.filter((insumo) => ['vacuna', 'medicamento'].includes(insumo.tipo));
    }
    return [];
  }, [form.tipo, insumos]);

  function actualizar(campo, valor) {
    setForm((actual) => ({ ...actual, [campo]: valor }));
    setSucio(true);
  }

  function alternarCorral(corralId) {
    const idCorral = String(corralId);
    setForm((actual) => ({ ...actual, corral_ids: actual.corral_ids.includes(idCorral) ? actual.corral_ids.filter((idActual) => idActual !== idCorral) : [...actual.corral_ids, idCorral] }));
    setSucio(true);
  }

  async function guardar(evento) {
    evento.preventDefault();
    if (!form.titulo.trim() || !form.descripcion.trim() || !form.trabajador_id || !form.fecha_limite) {
      setError('Título, descripción, responsable y fecha límite son obligatorios.');
      return;
    }
    setGuardando(true);
    setError(null);
    const payload = {
      titulo: form.titulo, descripcion: form.descripcion, tipo: form.tipo,
      trabajador_id: form.trabajador_id, corral_ids: form.corral_ids, animal_id: form.animal_id || null,
      insumo_id: form.insumo_id || null, cantidad: form.cantidad || null,
      fecha_limite: form.fecha_limite, prioridad: form.prioridad,
      ...(editando ? { estado: form.estado } : {}),
    };
    try {
      if (editando) await api.editarTarea(tarea.id, payload);
      else await api.crearTarea(payload);
      onCreado(editando ? 'Tarea actualizada correctamente.' : 'Tarea asignada correctamente.');
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <ModalAccesible titulo={editando ? 'Editar tarea' : 'Asignar tarea'} onCerrar={onCerrar} sucio={sucio} ocupado={guardando} className="modal-tarea">
      {error && <FeedbackOperacion tipo="error" mensaje={error} />}
      <form onSubmit={guardar}>
        <div className="field">
          <label htmlFor={`${id}-titulo`}>Título <span className="required-mark">Obligatorio</span></label>
          <input id={`${id}-titulo`} className="input" data-autofocus required maxLength="150" value={form.titulo} onChange={(e) => actualizar('titulo', e.target.value)} placeholder="Revisar salud del Corral Norte" />
        </div>
        <div className="field">
          <label htmlFor={`${id}-descripcion`}>¿Qué debe hacerse? <span className="required-mark">Obligatorio</span></label>
          <textarea id={`${id}-descripcion`} rows="3" required maxLength="2000" value={form.descripcion} onChange={(e) => actualizar('descripcion', e.target.value)} placeholder="Describe el resultado esperado y cualquier indicación necesaria." />
        </div>
        <div className="form-grid-2">
          <div className="field"><label htmlFor={`${id}-tipo`}>Tipo de actividad</label><select id={`${id}-tipo`} value={form.tipo} onChange={(e) => actualizar('tipo', e.target.value)}>{TIPOS_TAREA.map((opcion) => <option key={opcion.value} value={opcion.value}>{opcion.label}</option>)}</select></div>
          <div className="field"><label htmlFor={`${id}-responsable`}>Responsable <span className="required-mark">Obligatorio</span></label><select id={`${id}-responsable`} required value={form.trabajador_id} onChange={(e) => actualizar('trabajador_id', e.target.value)}><option value="">Selecciona una persona</option>{trabajadores.map((persona) => <option key={persona.id} value={persona.id}>{persona.nombre}{persona.rol ? ` · ${persona.rol}` : persona.email ? ' · Con acceso' : ' · Sin cuenta'}</option>)}</select></div>
          <div className="field"><label htmlFor={`${id}-fecha`}>Fecha límite <span className="required-mark">Obligatorio</span></label><input id={`${id}-fecha`} className="input" type="date" required value={form.fecha_limite} onChange={(e) => actualizar('fecha_limite', e.target.value)} /></div>
          <div className="field"><label htmlFor={`${id}-prioridad`}>Prioridad</label><select id={`${id}-prioridad`} value={form.prioridad} onChange={(e) => actualizar('prioridad', e.target.value)}>{PRIORIDADES_TAREA.map((opcion) => <option key={opcion.value} value={opcion.value}>{opcion.label}</option>)}</select></div>
          <fieldset className="field task-corral-selector"><legend>Corrales relacionados</legend><p>Selecciona uno o varios si la misma actividad aplica a diferentes corrales.</p><div>{corrales.map((corral) => <label key={corral.id}><input type="checkbox" checked={form.corral_ids.includes(String(corral.id))} onChange={() => alternarCorral(corral.id)} /> <span>{corral.nombre}</span></label>)}</div></fieldset>
          <div className="field"><label htmlFor={`${id}-animal`}>Animal relacionado</label><select id={`${id}-animal`} value={form.animal_id} onChange={(e) => actualizar('animal_id', e.target.value)}><option value="">Ninguno</option>{animales.map((animal) => <option key={animal.id} value={animal.id}>{animal.arete_id}{animal.nombre_alias ? ` · ${animal.nombre_alias}` : ''}</option>)}</select></div>
        </div>

        {insumosAplicables.length > 0 && (
          <div className="task-context-fields">
            <div className="field"><label htmlFor={`${id}-insumo`}>{form.tipo === 'alimentacion' ? 'Alimento' : 'Vacuna o medicamento'} (opcional)</label><select id={`${id}-insumo`} value={form.insumo_id} onChange={(e) => actualizar('insumo_id', e.target.value)}><option value="">Sin especificar</option>{insumosAplicables.map((insumo) => <option key={insumo.id} value={insumo.id}>{insumo.nombre} · {insumo.stock_actual} {insumo.unidad_medida}</option>)}</select></div>
            {form.tipo === 'alimentacion' && <div className="field"><label htmlFor={`${id}-cantidad`}>Cantidad sugerida</label><input id={`${id}-cantidad`} className="input" type="number" inputMode="decimal" min="0.01" step="0.01" value={form.cantidad} onChange={(e) => actualizar('cantidad', e.target.value)} /><small className="field-help">Referencia para quien realiza la alimentación; no descuenta inventario al completar la tarea.</small></div>}
          </div>
        )}

        {editando && <div className="field"><label htmlFor={`${id}-estado`}>Estado</label><select id={`${id}-estado`} value={form.estado} onChange={(e) => actualizar('estado', e.target.value)}>{ESTADOS_TAREA.map((opcion) => <option key={opcion.value} value={opcion.value}>{opcion.label}</option>)}</select></div>}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" data-modal-cerrar onClick={onCerrar}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={guardando}>{guardando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Asignar tarea'}</button>
        </div>
      </form>
    </ModalAccesible>
  );
}
