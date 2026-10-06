import { useEffect, useState } from 'react';
import { api } from '../api';

const hoy = new Date().toISOString().slice(0, 10);

export default function BajaAnimalModal({ animalId, onCerrar, onCreado }) {
  const [tipo, setTipo] = useState('vendido');
  const [compradores, setCompradores] = useState([]);
  const [creandoComprador, setCreandoComprador] = useState(false);
  const [nuevoComprador, setNuevoComprador] = useState('');
  const [modoPrecio, setModoPrecio] = useState('total');
  const [form, setForm] = useState({
    fecha: new Date().toISOString().slice(0, 10), tercero_id: '', precio: '', peso_kg: '', precio_kg: '', factura_folio: '', razon_baja: '',
  });
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  function cargarCompradores() {
    api.listarTerceros('comprador').then(setCompradores).catch(() => {});
  }
  useEffect(cargarCompradores, []);

  function actualizar(campo, valor) {
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  async function crearComprador() {
    if (!nuevoComprador.trim()) return;
    try {
      const tercero = await api.crearTercero({ nombre: nuevoComprador.trim(), tipo: 'comprador' });
      cargarCompradores();
      actualizar('tercero_id', tercero.id);
      setCreandoComprador(false);
      setNuevoComprador('');
    } catch (err) {
      setError(err.message);
    }
  }

  const precioCalculado = modoPrecio === 'por_kilo' ? (Number(form.peso_kg) || 0) * (Number(form.precio_kg) || 0) : Number(form.precio) || 0;

  async function guardar(e) {
    e.preventDefault();
    setError(null);

    if (tipo === 'vendido') {
      if (!form.tercero_id) { setError('El comprador es obligatorio.'); return; }
      if (modoPrecio === 'total' && !form.precio) { setError('El precio es obligatorio.'); return; }
      if (modoPrecio === 'por_kilo' && (!form.peso_kg || !form.precio_kg)) { setError('El peso y el precio por kilo son obligatorios.'); return; }
    }

    setGuardando(true);
    try {
      if (tipo === 'vendido') {
        await api.registrarVenta({
          animal_id: animalId,
          tercero_id: form.tercero_id,
          fecha: form.fecha,
          precio: precioCalculado,
          factura_folio: form.factura_folio || null,
        });
      } else {
        await api.darDeBaja(animalId, { estado: tipo, razon_baja: form.razon_baja, fecha_baja: form.fecha });
      }
      onCreado({ tipo });
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Dar de baja al animal</h3>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={guardar}>
          <div className="field">
            <label>Motivo</label>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="vendido">Venta</option>
              <option value="sacrificado">Sacrificio</option>
              <option value="muerto">Muerte</option>
            </select>
          </div>
          <div className="field">
            <label>Fecha</label>
            <input className="input" type="date" max={hoy} value={form.fecha} onChange={(e) => actualizar('fecha', e.target.value)} />
          </div>

          {tipo === 'vendido' ? (
            <>
              <div className="field">
                <label>Comprador *</label>
                {!creandoComprador ? (
                  <>
                    <select value={form.tercero_id} onChange={(e) => actualizar('tercero_id', e.target.value)}>
                      <option value="">Selecciona un comprador</option>
                      {compradores.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                    </select>
                    <button type="button" className="btn btn-ghost" style={{ marginTop: 8 }} onClick={() => setCreandoComprador(true)}>
                      + Nuevo comprador
                    </button>
                  </>
                ) : (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input className="input" placeholder="Nombre del comprador" value={nuevoComprador} onChange={(e) => setNuevoComprador(e.target.value)} />
                    <button type="button" className="btn btn-primary" onClick={crearComprador}>Guardar</button>
                  </div>
                )}
              </div>
              <div className="field">
                <label>Precio</label>
                <select value={modoPrecio} onChange={(e) => setModoPrecio(e.target.value)} style={{ marginBottom: 8 }}>
                  <option value="total">Precio total</option>
                  <option value="por_kilo">Precio por kilo</option>
                </select>
                {modoPrecio === 'total' ? (
                  <input className="input" type="number" step="0.01" placeholder="Precio total" value={form.precio} onChange={(e) => actualizar('precio', e.target.value)} />
                ) : (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input className="input" type="number" step="0.1" placeholder="Peso (kg)" value={form.peso_kg} onChange={(e) => actualizar('peso_kg', e.target.value)} />
                    <input className="input" type="number" step="0.01" placeholder="$/kg" value={form.precio_kg} onChange={(e) => actualizar('precio_kg', e.target.value)} />
                  </div>
                )}
                {modoPrecio === 'por_kilo' && precioCalculado > 0 && (
                  <p style={{ fontSize: '0.82rem', color: 'var(--ink-soft)', marginTop: 6 }}>
                    {form.peso_kg} kg × ${Number(form.precio_kg).toLocaleString('es-MX')}/kg = <strong>${precioCalculado.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</strong>
                  </p>
                )}
              </div>
              <div className="field">
                <label>Folio de factura (opcional)</label>
                <input className="input" value={form.factura_folio} onChange={(e) => actualizar('factura_folio', e.target.value)} />
              </div>
            </>
          ) : (
            <div className="field">
              <label>Razón / causa</label>
              <textarea rows={2} value={form.razon_baja} onChange={(e) => actualizar('razon_baja', e.target.value)} />
            </div>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={guardando}>
              {guardando ? 'Guardando...' : 'Confirmar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
