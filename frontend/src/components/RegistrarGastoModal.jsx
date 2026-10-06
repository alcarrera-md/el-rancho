import { useEffect, useState } from 'react';
import { api } from '../api';

export default function RegistrarGastoModal({ registro, onCerrar, onCreado }) {
  const editando = Boolean(registro);
  const [categorias, setCategorias] = useState([]);
  const [corrales, setCorrales] = useState([]);
  const [creandoCategoria, setCreandoCategoria] = useState(false);
  const [nuevaCategoria, setNuevaCategoria] = useState('');
  const [form, setForm] = useState({
    categoria_id: registro?.categoria_id || '',
    fecha: (registro?.fecha || new Date().toISOString()).slice(0, 10),
    monto: registro?.monto ?? '',
    descripcion: registro?.descripcion || '',
    corral_id: registro?.corral_id || '',
    comprobante_folio: registro?.comprobante_folio || '',
  });
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [eliminando, setEliminando] = useState(false);

  function cargarCategorias() {
    api.listarCategoriasGasto().then(setCategorias).catch(() => {});
  }
  useEffect(() => {
    cargarCategorias();
    api.listarCorrales().then(setCorrales).catch(() => {});
  }, []);

  function actualizar(campo, valor) {
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  async function crearCategoria() {
    if (!nuevaCategoria.trim()) return;
    try {
      const cat = await api.crearCategoriaGasto(nuevaCategoria.trim());
      cargarCategorias();
      actualizar('categoria_id', cat.id);
      setCreandoCategoria(false);
      setNuevaCategoria('');
    } catch (err) {
      setError(err.message);
    }
  }

  async function guardar(e) {
    e.preventDefault();
    if (!form.categoria_id || !form.monto) {
      setError('La categoría y el monto son obligatorios.');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const payload = { ...form, corral_id: form.corral_id || null };
      if (editando) {
        await api.editarGasto(registro.id, payload);
      } else {
        await api.crearGasto(payload);
      }
      onCreado();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar() {
    if (!window.confirm('¿Eliminar este gasto?')) return;
    setEliminando(true);
    try {
      await api.eliminarGasto(registro.id);
      onCreado();
    } catch (err) {
      setError(err.message);
      setEliminando(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{editando ? 'Editar gasto' : 'Registrar gasto'}</h3>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={guardar}>
          <div className="field">
            <label>Categoría *</label>
            {!creandoCategoria ? (
              <>
                <select value={form.categoria_id} onChange={(e) => actualizar('categoria_id', e.target.value)}>
                  <option value="">Selecciona una categoría</option>
                  {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
                <button type="button" className="btn btn-ghost" style={{ marginTop: 6, padding: '3px 10px', fontSize: '0.78rem' }} onClick={() => setCreandoCategoria(true)}>
                  + Nueva categoría
                </button>
              </>
            ) : (
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="input" placeholder="Ej. Diesel" value={nuevaCategoria} onChange={(e) => setNuevaCategoria(e.target.value)} />
                <button type="button" className="btn btn-primary" onClick={crearCategoria}>Guardar</button>
              </div>
            )}
          </div>
          <div className="field">
            <label>Monto *</label>
            <input className="input" type="number" step="0.01" value={form.monto} onChange={(e) => actualizar('monto', e.target.value)} />
          </div>
          <div className="field">
            <label>Fecha</label>
            <input className="input" type="date" value={form.fecha} onChange={(e) => actualizar('fecha', e.target.value)} />
          </div>
          <div className="field">
            <label>Corral relacionado (opcional)</label>
            <select value={form.corral_id} onChange={(e) => actualizar('corral_id', e.target.value)}>
              <option value="">Ninguno / gasto general</option>
              {corrales.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Descripción</label>
            <textarea rows={2} value={form.descripcion} onChange={(e) => actualizar('descripcion', e.target.value)} />
          </div>
          <div className="field">
            <label>Folio de comprobante (opcional)</label>
            <input className="input" value={form.comprobante_folio} onChange={(e) => actualizar('comprobante_folio', e.target.value)} />
          </div>
          <div className="modal-actions" style={{ justifyContent: editando ? 'space-between' : 'flex-end' }}>
            {editando && (
              <button type="button" className="btn btn-ghost" style={{ color: 'var(--rust)' }} onClick={eliminar} disabled={eliminando}>
                {eliminando ? 'Eliminando...' : 'Eliminar'}
              </button>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={guardando}>
                {guardando ? 'Guardando...' : editando ? 'Guardar cambios' : 'Registrar gasto'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
