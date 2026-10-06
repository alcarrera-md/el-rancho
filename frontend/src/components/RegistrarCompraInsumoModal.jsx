import { useEffect, useId, useState } from 'react';
import { api } from '../api';
import ModalAccesible from './ModalAccesible.jsx';
import { FeedbackOperacion } from './EstadosUI.jsx';

export default function RegistrarCompraInsumoModal({ onCerrar, onCreado, insumoInicialId = '' }) {
  const id = useId();
  const [insumos, setInsumos] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [creandoProveedor, setCreandoProveedor] = useState(false);
  const [nuevoProveedor, setNuevoProveedor] = useState('');
  const [form, setForm] = useState({ insumo_id: String(insumoInicialId || ''), tercero_id: '', cantidad: '', costo_total: '', fecha: new Date().toISOString().slice(0, 10) });
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [sucio, setSucio] = useState(false);

  function cargarProveedores() {
    api.listarTerceros('proveedor').then(setProveedores).catch(() => {});
  }

  useEffect(() => {
    api.listarInsumos().then(setInsumos).catch(() => {});
    cargarProveedores();
  }, []);

  function actualizar(campo, valor) {
    setForm((f) => ({ ...f, [campo]: valor }));
    setSucio(true);
  }

  async function crearProveedor() {
    if (!nuevoProveedor.trim()) return;
    try {
      const tercero = await api.crearTercero({ nombre: nuevoProveedor.trim(), tipo: 'proveedor' });
      cargarProveedores();
      actualizar('tercero_id', tercero.id);
      setCreandoProveedor(false);
      setNuevoProveedor('');
    } catch (err) {
      setError(err.message);
    }
  }

  async function guardar(e) {
    e.preventDefault();
    if (!form.insumo_id || !form.tercero_id || !form.cantidad) {
      setError('El insumo, el proveedor y la cantidad son obligatorios.');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      await api.crearCompraInsumo({ ...form, costo_total: form.costo_total || null });
      onCreado();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <ModalAccesible titulo="Registrar compra de insumo" onCerrar={onCerrar} sucio={sucio} ocupado={guardando}>
        {error && <FeedbackOperacion tipo="error" mensaje={error} />}
        <form onSubmit={guardar}>
          <div className="field">
            <label htmlFor={`${id}-insumo`}>Insumo <span aria-hidden="true">*</span></label>
            <select id={`${id}-insumo`} data-autofocus required aria-invalid={!form.insumo_id} value={form.insumo_id} onChange={(e) => actualizar('insumo_id', e.target.value)}>
              <option value="">Selecciona un insumo</option>
              {insumos.map((i) => (
                <option key={i.id} value={i.id}>{i.nombre} (stock actual: {i.stock_actual} {i.unidad_medida})</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${id}-proveedor`}>Proveedor <span aria-hidden="true">*</span></label>
            {!creandoProveedor ? (
              <>
                <select id={`${id}-proveedor`} required aria-invalid={!form.tercero_id} value={form.tercero_id} onChange={(e) => actualizar('tercero_id', e.target.value)}>
                  <option value="">Selecciona un proveedor</option>
                  {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
                <button type="button" className="btn btn-ghost" style={{ marginTop: 8 }} onClick={() => setCreandoProveedor(true)}>
                  + Nuevo proveedor
                </button>
              </>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <input id={`${id}-proveedor`} className="input" aria-label="Nombre del nuevo proveedor" placeholder="Nombre del proveedor" value={nuevoProveedor} onChange={(e) => { setNuevoProveedor(e.target.value); setSucio(true); }} />
                <button type="button" className="btn btn-primary" onClick={crearProveedor}>Guardar</button>
              </div>
            )}
          </div>
          <div className="field">
            <label htmlFor={`${id}-cantidad`}>Cantidad <span aria-hidden="true">*</span></label>
            <input id={`${id}-cantidad`} className="input" type="number" inputMode="decimal" min="0" step="0.1" required aria-invalid={!form.cantidad} value={form.cantidad} onChange={(e) => actualizar('cantidad', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`${id}-costo`}>Costo total (opcional)</label>
            <input id={`${id}-costo`} className="input" type="number" inputMode="decimal" min="0" step="0.01" value={form.costo_total} onChange={(e) => actualizar('costo_total', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`${id}-fecha`}>Fecha</label>
            <input id={`${id}-fecha`} className="input" type="date" value={form.fecha} onChange={(e) => actualizar('fecha', e.target.value)} />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" data-modal-cerrar onClick={onCerrar}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={guardando}>
              {guardando ? 'Guardando...' : 'Registrar compra'}
            </button>
          </div>
        </form>
    </ModalAccesible>
  );
}
