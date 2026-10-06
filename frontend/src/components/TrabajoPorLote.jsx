import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext.jsx';
import { tienePermiso } from '../authorization/permissions.js';
import { TAREAS_LOTE } from '../guidedUx.js';
import { EncabezadoDetalle, PresentacionPantalla, SelectorTarea } from './PresentacionGuiada.jsx';
import { IconoBalanza, IconoSalud, IconoHoja, IconoEtiqueta } from './Iconos.jsx';
import { EstadoCarga, EstadoVacio } from './EstadosUI.jsx';

function ResultadoLote({ resultado, onCerrar }) {
  if (!resultado) return null;
  return (
    <div className="error-banner" style={{
      background: resultado.errores.length ? 'var(--rust-soft)' : 'var(--wheat-soft)',
      color: resultado.errores.length ? 'var(--rust)' : '#6b4f10',
      borderColor: resultado.errores.length ? '#e3b7ab' : 'var(--wheat)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>{resultado.creados.length} registrado(s) correctamente{resultado.errores.length ? `, ${resultado.errores.length} con error` : ''}.</strong>
        <button className="btn btn-ghost" style={{ padding: '1px 8px', fontSize: '0.75rem' }} onClick={onCerrar}>Cerrar</button>
      </div>
      {resultado.errores.length > 0 && (
        <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
          {resultado.errores.map((e, i) => (
            <li key={i} style={{ fontSize: '0.82rem' }}>Animal #{e.animal_id}: {e.error}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function TrabajoPorLote() {
  const { usuario } = useAuth();
  const puedePesaje = tienePermiso(usuario?.rol, 'pesajes', 'crear');
  const puedeSalud = tienePermiso(usuario?.rol, 'salud', 'crear');
  const puedeAlimentacion = tienePermiso(usuario?.rol, 'alimentacion', 'crear');
  const puedeVenta = tienePermiso(usuario?.rol, 'ventas', 'crear');

  const [corrales, setCorrales] = useState([]);
  const [corralId, setCorralId] = useState('');
  const [animales, setAnimales] = useState(null);
  const [seleccionados, setSeleccionados] = useState({});
  const [tab, setTab] = useState(null);
  const [error, setError] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api.listarCorrales().then(setCorrales).catch(() => {});
  }, []);

  function cargarAnimales(corral) {
    setResultado(null);
    setError(null);
    setAnimales(null);
    const params = { estado: 'vivo' };
    if (corral) params.corral_id = corral;
    api.listarAnimales(params).then((data) => {
      setAnimales(data);
      setSeleccionados(Object.fromEntries(data.map((a) => [a.id, true]))); // todos seleccionados por defecto
    }).catch((err) => setError(err.message));
  }

  useEffect(() => {
    if (tab) cargarAnimales(corralId);
  }, [corralId, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  function alternarSeleccion(id) {
    setSeleccionados((s) => ({ ...s, [id]: !s[id] }));
  }

  function idsSeleccionados() {
    return (animales || []).filter((a) => seleccionados[a.id]).map((a) => a.id);
  }

  const iconos = { pesaje: IconoBalanza, salud: IconoSalud, alimentacion: IconoHoja, venta: IconoEtiqueta };
  const tareas = TAREAS_LOTE.filter((tarea) => {
    if (tarea.id === 'pesaje') return puedePesaje;
    if (tarea.id === 'salud') return puedeSalud;
    if (tarea.id === 'alimentacion') return puedeAlimentacion;
    return puedeVenta;
  }).map((tarea) => ({ ...tarea, icono: iconos[tarea.id] }));
  const tareaActiva = tareas.find((tarea) => tarea.id === tab);

  return (
    <div>
      <PresentacionPantalla
        etiqueta="Operaciones de campo"
        titulo="Trabajo por lote"
        descripcion="Registra una misma actividad para varios animales al mismo tiempo."
      />

      <SelectorTarea opciones={tareas} valor={tab} onSeleccionar={(valor) => { setTab(valor); setResultado(null); }} />

      {!tab && <p className="guided-choice-hint" role="status">Primero elige la actividad. Después podrás seleccionar el corral y los animales.</p>}

      {tab && (
        <section className="guided-detail-panel">
          <EncabezadoDetalle titulo={tareaActiva?.titulo} descripcion="Elige el grupo de animales y completa únicamente los datos de esta actividad." />
          <div className="toolbar guided-toolbar">
            <label htmlFor="lote-corral">Animales que deseas revisar</label>
            <select id="lote-corral" value={corralId} onChange={(e) => setCorralId(e.target.value)}>
              <option value="">Todos los animales vivos</option>
              {corrales.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>

          {error && <div className="error-banner" role="alert">{error}</div>}
          <ResultadoLote resultado={resultado} onCerrar={() => setResultado(null)} />

          {animales === null ? (
            <EstadoCarga mensaje="Preparando los animales disponibles…" />
          ) : animales.length === 0 ? (
            <EstadoVacio titulo="No hay animales vivos en esta selección" descripcion="Prueba con otro corral o revisa el estado de los animales." />
          ) : (
            <>
          {tab === 'pesaje' && (
            <LotePesaje animales={animales} seleccionados={seleccionados} onAlternar={alternarSeleccion}
              enviando={enviando} setEnviando={setEnviando} setResultado={setResultado} setError={setError} idsSeleccionados={idsSeleccionados} />
          )}
          {tab === 'salud' && (
            <LoteSalud animales={animales} seleccionados={seleccionados} onAlternar={alternarSeleccion}
              enviando={enviando} setEnviando={setEnviando} setResultado={setResultado} setError={setError} idsSeleccionados={idsSeleccionados} />
          )}
          {tab === 'alimentacion' && (
            <LoteAlimentacion animales={animales} seleccionados={seleccionados} onAlternar={alternarSeleccion}
              enviando={enviando} setEnviando={setEnviando} setResultado={setResultado} setError={setError} idsSeleccionados={idsSeleccionados} />
          )}
          {tab === 'venta' && (
            <LoteVenta animales={animales} seleccionados={seleccionados} onAlternar={alternarSeleccion}
              enviando={enviando} setEnviando={setEnviando} setResultado={setResultado} setError={setError}
              idsSeleccionados={idsSeleccionados} onExito={() => cargarAnimales(corralId)} />
          )}
            </>
          )}
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------
// Pesaje: tabla con un campo de peso editable por animal
// ---------------------------------------------------------
function LotePesaje({ animales, enviando, setEnviando, setResultado, setError }) {
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [pesos, setPesos] = useState({});

  async function guardar() {
    const registros = animales
      .filter((a) => pesos[a.id])
      .map((a) => ({ animal_id: a.id, peso_kg: pesos[a.id] }));
    if (registros.length === 0) {
      setError('Ingresa al menos un peso.');
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const resultado = await api.registrarPesajesLote({ fecha, registros });
      setResultado(resultado);
      setPesos({});
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="card" style={{ padding: '20px 24px' }}>
      <div className="field" style={{ maxWidth: 200 }}>
        <label>Fecha (para todos)</label>
        <input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
      </div>
      <table className="animal-table">
        <thead><tr><th>Arete</th><th>Alias</th><th>Peso (kg)</th></tr></thead>
        <tbody>
          {animales.map((a) => (
            <tr key={a.id}>
              <td><span className="tag-badge">{a.arete_id}</span></td>
              <td>{a.nombre_alias || '—'}</td>
              <td>
                <input
                  className="input" type="number" step="0.1" style={{ maxWidth: 120 }}
                  value={pesos[a.id] || ''} onChange={(e) => setPesos((p) => ({ ...p, [a.id]: e.target.value }))}
                  placeholder="—"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="btn btn-primary" onClick={guardar} disabled={enviando}>
          {enviando ? 'Guardando...' : 'Guardar pesajes'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------
// Salud: un solo formulario compartido + checkboxes de a quién aplica
// ---------------------------------------------------------
const TIPOS_SALUD = [
  { value: 'vacuna', label: 'Vacuna' },
  { value: 'tratamiento', label: 'Tratamiento' },
  { value: 'diagnostico', label: 'Diagnóstico' },
  { value: 'desparasitacion', label: 'Desparasitación' },
];

function LoteSalud({ animales, seleccionados, onAlternar, enviando, setEnviando, setResultado, setError, idsSeleccionados }) {
  const [insumos, setInsumos] = useState([]);
  const [form, setForm] = useState({
    tipo: 'vacuna', insumo_id: '', enfermedad: '', descripcion: '',
    fecha: new Date().toISOString().slice(0, 10), proxima_dosis: '',
  });

  useEffect(() => {
    api.listarInsumos().then((data) => setInsumos(data.filter((i) => i.tipo === 'vacuna' || i.tipo === 'medicamento'))).catch(() => {});
  }, []);

  function actualizar(campo, valor) {
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  async function guardar() {
    const ids = idsSeleccionados();
    if (ids.length === 0) {
      setError('Selecciona al menos un animal.');
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const resultado = await api.registrarSaludLote({
        animal_ids: ids, ...form, insumo_id: form.insumo_id || null, proxima_dosis: form.proxima_dosis || null,
      });
      setResultado(resultado);
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="card" style={{ padding: '20px 24px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 16 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Tipo</label>
          <select value={form.tipo} onChange={(e) => actualizar('tipo', e.target.value)}>
            {TIPOS_SALUD.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Vacuna/medicamento</label>
          <select value={form.insumo_id} onChange={(e) => actualizar('insumo_id', e.target.value)}>
            <option value="">Ninguno</option>
            {insumos.map((i) => <option key={i.id} value={i.id}>{i.nombre} (stock: {i.stock_actual})</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Fecha</label>
          <input className="input" type="date" value={form.fecha} onChange={(e) => actualizar('fecha', e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Próxima dosis (opcional)</label>
          <input className="input" type="date" value={form.proxima_dosis} onChange={(e) => actualizar('proxima_dosis', e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Enfermedad / notas (opcional, aplica a todos)</label>
        <input className="input" value={form.enfermedad} onChange={(e) => actualizar('enfermedad', e.target.value)} />
      </div>

      <div className="section-title">¿A quién se le aplica?</div>
      <TablaSeleccion animales={animales} seleccionados={seleccionados} onAlternar={onAlternar} />

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="btn btn-primary" onClick={guardar} disabled={enviando}>
          {enviando ? 'Guardando...' : `Aplicar a ${idsSeleccionados().length} animal(es)`}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------
// Alimentación: mismo insumo y cantidad para cada animal seleccionado
// ---------------------------------------------------------
function LoteAlimentacion({ animales, seleccionados, onAlternar, enviando, setEnviando, setResultado, setError, idsSeleccionados }) {
  const [insumos, setInsumos] = useState([]);
  const [insumoId, setInsumoId] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));

  useEffect(() => {
    api.listarInsumos('alimento').then(setInsumos).catch(() => {});
  }, []);

  async function guardar() {
    const ids = idsSeleccionados();
    if (ids.length === 0 || !insumoId || !cantidad) {
      setError('Selecciona el insumo, la cantidad y al menos un animal.');
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const resultado = await api.registrarAlimentacionLote({ animal_ids: ids, insumo_id: insumoId, cantidad, fecha });
      setResultado(resultado);
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="card" style={{ padding: '20px 24px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 16 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Alimento</label>
          <select value={insumoId} onChange={(e) => setInsumoId(e.target.value)}>
            <option value="">Selecciona un alimento</option>
            {insumos.map((i) => <option key={i.id} value={i.id}>{i.nombre} (stock: {i.stock_actual} {i.unidad_medida})</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Cantidad por animal</label>
          <input className="input" type="number" step="0.1" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Fecha</label>
          <input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
      </div>

      <div className="section-title">¿A quién se le aplica?</div>
      <TablaSeleccion animales={animales} seleccionados={seleccionados} onAlternar={onAlternar} />

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="btn btn-primary" onClick={guardar} disabled={enviando}>
          {enviando ? 'Guardando...' : `Aplicar a ${idsSeleccionados().length} animal(es)`}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------
// Venta: un solo trato (comprador + precio) repartido entre los
// animales seleccionados — precio total a repartir, o precio por cabeza
// ---------------------------------------------------------
function LoteVenta({ animales, seleccionados, onAlternar, enviando, setEnviando, setResultado, setError, idsSeleccionados, onExito }) {
  const [compradores, setCompradores] = useState([]);
  const [creandoComprador, setCreandoComprador] = useState(false);
  const [nuevoComprador, setNuevoComprador] = useState('');
  const [form, setForm] = useState({
    tercero_id: '', modo: 'total', monto: '', peso_total_kg: '', factura_folio: '', fecha: new Date().toISOString().slice(0, 10),
  });

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

  const cantidad = idsSeleccionados().length;
  const montoNum = Number(form.monto) || 0;
  const pesoTotalNum = Number(form.peso_total_kg) || 0;
  const precioTotal = form.modo === 'por_cabeza' ? montoNum * cantidad : form.modo === 'por_kilo' ? montoNum * pesoTotalNum : montoNum;
  const precioPorCabeza = cantidad > 0 ? precioTotal / cantidad : 0;

  async function guardar() {
    const ids = idsSeleccionados();
    if (ids.length === 0 || !form.tercero_id || !form.monto) {
      setError('Selecciona el comprador, el precio y al menos un animal.');
      return;
    }
    if (form.modo === 'por_kilo' && !form.peso_total_kg) {
      setError('Ingresa el peso total del lote.');
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      const resultado = await api.registrarVentaLote({
        animal_ids: ids, tercero_id: form.tercero_id, fecha: form.fecha,
        precio_total: precioTotal, factura_folio: form.factura_folio || null,
      });
      setResultado({ creados: resultado.ventas, errores: [] });
      onExito();
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="card" style={{ padding: '20px 24px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 16 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Comprador</label>
          {!creandoComprador ? (
            <>
              <select value={form.tercero_id} onChange={(e) => actualizar('tercero_id', e.target.value)}>
                <option value="">Selecciona un comprador</option>
                {compradores.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
              <button type="button" className="btn btn-ghost" style={{ marginTop: 6, padding: '3px 10px', fontSize: '0.78rem' }} onClick={() => setCreandoComprador(true)}>
                + Nuevo comprador
              </button>
            </>
          ) : (
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="input" placeholder="Nombre" value={nuevoComprador} onChange={(e) => setNuevoComprador(e.target.value)} />
              <button type="button" className="btn btn-primary" onClick={crearComprador}>Guardar</button>
            </div>
          )}
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Modo de precio</label>
          <select value={form.modo} onChange={(e) => actualizar('modo', e.target.value)}>
            <option value="total">Precio total del lote (se reparte)</option>
            <option value="por_cabeza">Precio por cabeza (mismo para cada uno)</option>
            <option value="por_kilo">Precio por kilo (peso conjunto en báscula)</option>
          </select>
        </div>
        {form.modo === 'por_kilo' && (
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Peso total del lote (kg)</label>
            <input className="input" type="number" step="0.1" value={form.peso_total_kg} onChange={(e) => actualizar('peso_total_kg', e.target.value)} />
          </div>
        )}
        <div className="field" style={{ marginBottom: 0 }}>
          <label>{form.modo === 'por_cabeza' ? 'Precio por animal' : form.modo === 'por_kilo' ? 'Precio por kilo' : 'Precio total'}</label>
          <input className="input" type="number" step="0.01" value={form.monto} onChange={(e) => actualizar('monto', e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Fecha</label>
          <input className="input" type="date" value={form.fecha} onChange={(e) => actualizar('fecha', e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Folio de factura (opcional)</label>
        <input className="input" value={form.factura_folio} onChange={(e) => actualizar('factura_folio', e.target.value)} />
      </div>

      {cantidad > 0 && montoNum > 0 && form.modo !== 'por_kilo' && (
        <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>
          {cantidad} animal(es) × ${precioPorCabeza.toLocaleString('es-MX', { minimumFractionDigits: 2 })} c/u = <strong>${precioTotal.toLocaleString('es-MX', { minimumFractionDigits: 2 })} total</strong>
        </p>
      )}
      {form.modo === 'por_kilo' && montoNum > 0 && pesoTotalNum > 0 && (
        <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>
          {pesoTotalNum} kg × ${montoNum.toLocaleString('es-MX')}/kg = <strong>${precioTotal.toLocaleString('es-MX', { minimumFractionDigits: 2 })} total</strong> (${precioPorCabeza.toLocaleString('es-MX', { minimumFractionDigits: 2 })} por cabeza entre {cantidad})
        </p>
      )}

      <div className="section-title">¿Cuáles animales se venden?</div>
      <TablaSeleccion animales={animales} seleccionados={seleccionados} onAlternar={onAlternar} />

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="btn btn-primary" onClick={guardar} disabled={enviando}>
          {enviando ? 'Guardando...' : `Vender ${cantidad} animal(es)`}
        </button>
      </div>
    </div>
  );
}

function TablaSeleccion({ animales, seleccionados, onAlternar }) {
  return (
    <table className="animal-table">
      <thead><tr><th></th><th>Arete</th><th>Alias</th><th>Corral</th></tr></thead>
      <tbody>
        {animales.map((a) => (
          <tr key={a.id} className="clickable" onClick={() => onAlternar(a.id)}>
            <td><input type="checkbox" checked={!!seleccionados[a.id]} onChange={() => onAlternar(a.id)} onClick={(e) => e.stopPropagation()} /></td>
            <td><span className="tag-badge">{a.arete_id}</span></td>
            <td>{a.nombre_alias || '—'}</td>
            <td>{a.corral_actual || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
