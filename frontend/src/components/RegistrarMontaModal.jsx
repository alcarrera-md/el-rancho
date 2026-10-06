import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext.jsx';
import { tienePermiso } from '../authorization/permissions.js';
import CostoReproductivoOpcional, { costoParaApi } from './CostoReproductivoOpcional.jsx';

export default function RegistrarMontaModal({ animalId, onCerrar, onCreado, onNoDisponible }) {
  const { usuario } = useAuth();
  const [machos, setMachos] = useState([]);
  const [responsables, setResponsables] = useState([]);
  const [form, setForm] = useState({
    padre_id: '', tipo_monta: 'inseminacion_artificial', tipo_otro: '',
    fecha_monta: new Date().toISOString().slice(0, 10), fecha_parto_estimada: '', responsable_id: '', observaciones: '',
  });
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [avisoConsanguinidad, setAvisoConsanguinidad] = useState(null);
  const [diasGestacion, setDiasGestacion] = useState(283);
  const [costo, setCosto] = useState({ categoria: 'inseminacion', monto: '', descripcion: '' });
  const puedeRegistrarCosto = tienePermiso(usuario?.rol, 'costos_reproductivos', 'crear');

  useEffect(() => {
    api.listarAnimales({ sexo: 'macho', estado: 'vivo' }).then((data) => setMachos(data.filter((animal) => animal.estado === 'vivo' && animal.sexo === 'macho'))).catch(() => {});
    api.listarResponsablesReproduccion().then(setResponsables).catch(() => {});
    api.obtenerConfiguracion().then((filas) => {
      const configurada = Number(filas.find((fila) => fila.clave === 'dias_gestacion_bovina')?.valor);
      if (Number.isFinite(configurada)) setDiasGestacion(configurada);
    }).catch(() => {});
  }, []);

  function actualizar(campo, valor) {
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  async function elegirPadre(padreId) {
    actualizar('padre_id', padreId);
    setAvisoConsanguinidad(null);
    if (!padreId) return;
    try {
      const resultado = await api.verificarConsanguinidad(animalId, padreId);
      if (resultado.relacionados) setAvisoConsanguinidad(resultado.mensaje);
    } catch (err) {
      // si falla la verificación, no bloquea el registro — solo no se muestra el aviso
    }
  }

  function actualizarFechaMonta(valor) {
    actualizar('fecha_monta', valor);
  }

  const fechaCalculada = (() => {
    if (!form.fecha_monta) return '';
    const fecha = new Date(`${form.fecha_monta}T00:00:00Z`);
    fecha.setUTCDate(fecha.getUTCDate() + diasGestacion);
    return fecha.toISOString().slice(0, 10);
  })();

  async function guardar(e) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      await api.registrarServicioReproductivo({
        hembra_id: animalId,
        macho_id: form.padre_id || undefined,
        tipo: form.tipo_monta,
        tipo_otro: form.tipo_monta === 'otro' ? form.tipo_otro : undefined,
        fecha: form.fecha_monta,
        responsable_id: form.responsable_id || undefined,
        observaciones: form.observaciones || undefined,
        fecha_parto_estimada_ajustada: form.fecha_parto_estimada || undefined,
        costo: puedeRegistrarCosto ? costoParaApi(costo) : undefined,
      });
      onCreado();
    } catch (err) {
      if (err.code === 'ANIMAL_REPRODUCTIVO_NO_DISPONIBLE') return onNoDisponible?.(err);
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Registrar servicio</h3>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={guardar}>
          <div className="field">
            <label>Fecha</label>
            <input className="input" type="date" value={form.fecha_monta} onChange={(e) => actualizarFechaMonta(e.target.value)} required />
          </div>
          <div className="field">
            <label>Tipo de servicio</label>
            <select value={form.tipo_monta} onChange={(e) => actualizar('tipo_monta', e.target.value)}>
              <option value="inseminacion_artificial">Inseminación artificial</option>
              <option value="natural">Monta natural</option>
              <option value="otro">Otro</option>
            </select>
          </div>
          {form.tipo_monta === 'otro' && <div className="field"><label>Describe el tipo</label><input className="input" value={form.tipo_otro} onChange={(e) => actualizar('tipo_otro', e.target.value)} required /></div>}
          <div className="field">
            <label>Toro / semental (opcional)</label>
            <select value={form.padre_id} onChange={(e) => elegirPadre(e.target.value)}>
              <option value="">Desconocido / no aplica</option>
              {machos.map((m) => (
                <option key={m.id} value={m.id}>{m.arete_id}{m.nombre_alias ? ` — ${m.nombre_alias}` : ''}</option>
              ))}
            </select>
          </div>

          {avisoConsanguinidad && (
            <div className="error-banner" style={{ background: 'var(--rust-soft)', color: 'var(--rust)', borderColor: '#e3b7ab' }}>
              ⚠ Posible consanguinidad: {avisoConsanguinidad} Puedes continuar si es intencional, pero revísalo.
            </div>
          )}
          <div className="field"><label>Responsable (opcional)</label><select value={form.responsable_id} onChange={(e) => actualizar('responsable_id', e.target.value)}><option value="">Sin especificar</option>{responsables.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}</select></div>
          <div className="field"><label>Observaciones (opcional)</label><textarea value={form.observaciones} onChange={(e) => actualizar('observaciones', e.target.value)} /></div>
          <div className={`repro-estimated-date ${form.fecha_parto_estimada ? 'is-manual' : ''}`}><span>Parto estimado</span><strong>{form.fecha_parto_estimada || fechaCalculada}</strong><small>{form.fecha_parto_estimada ? 'Fecha ajustada manualmente' : `Calculada automáticamente (${diasGestacion} días)`}</small></div>
          <details className="repro-manual-date"><summary>Ajustar fecha estimada</summary><div className="field"><label>Nueva fecha estimada</label><input className="input" type="date" value={form.fecha_parto_estimada} onChange={(e) => actualizar('fecha_parto_estimada', e.target.value)} /><small>Déjala vacía para volver al cálculo automático.</small></div></details>
          {puedeRegistrarCosto && <CostoReproductivoOpcional etapa="servicio" valor={costo} onChange={setCosto} />}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={guardando}>
              {guardando ? 'Guardando...' : 'Registrar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
