import { useEffect, useId, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext.jsx';
import { tienePermiso } from '../authorization/permissions.js';
import SelectorRaza from './SelectorRaza.jsx';
import ModalAccesible from './ModalAccesible.jsx';
import { FeedbackOperacion } from './EstadosUI.jsx';

const hoy = new Date().toISOString().slice(0, 10);

export default function NuevoAnimalModal({ onCerrar, onCreado, origenInicial = 'nacimiento', origenFijo = false }) {
  const id = useId();
  const { usuario } = useAuth();
  const esAdmin = tienePermiso(usuario?.rol, 'compras_animal', 'crear');

  const [corrales, setCorrales] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [creandoProveedor, setCreandoProveedor] = useState(false);
  const [nuevoProveedor, setNuevoProveedor] = useState('');
  const [form, setForm] = useState({
    arete_id: '', nombre_alias: '', sexo: 'hembra', fecha_nacimiento: '',
    corral_actual_id: '', peso_nacimiento_kg: '', origen: origenInicial, raza_id: '',
    tercero_id: '', precio: '', identificacion_previa: '', fecha_compra: new Date().toISOString().slice(0, 10),
  });
  const [foto, setFoto] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [sucio, setSucio] = useState(false);

  const esCompra = form.origen === 'compra';

  useEffect(() => {
    api.listarCorrales().then(setCorrales).catch(() => {});
  }, []);

  function cargarProveedores() {
    api.listarTerceros('proveedor').then(setProveedores).catch(() => {});
  }
  useEffect(() => { if (esCompra) cargarProveedores(); }, [esCompra]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  function actualizar(campo, valor) {
    setForm((f) => ({ ...f, [campo]: valor }));
    setSucio(true);
  }

  function seleccionarFoto(e) {
    const archivo = e.target.files[0];
    if (!archivo) return;
    if (archivo.size > 5 * 1024 * 1024) {
      setError('La imagen no puede pesar más de 5 MB.');
      return;
    }
    setError(null);
    setFoto(archivo);
    setSucio(true);
    setPreviewUrl(URL.createObjectURL(archivo));
  }

  function quitarFoto() {
    setFoto(null);
    setPreviewUrl(null);
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
    if (!form.arete_id) {
      setError('El número de arete es obligatorio.');
      return;
    }
    if (esCompra && !form.tercero_id) {
      setError('Selecciona el proveedor al que le compraste el animal.');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      let animal;
      if (esCompra) {
        // Se crean el animal y su compra juntos, ya enlazados — así aparece
        // correctamente en "Compras" sin pasos extra.
        const resultado = await api.comprarAnimalNuevo({
          arete_id: form.arete_id, sexo: form.sexo, nombre_alias: form.nombre_alias || null,
          fecha_nacimiento: form.fecha_nacimiento || null, raza_id: form.raza_id || null,
          peso_nacimiento_kg: form.peso_nacimiento_kg || null, corral_id: form.corral_actual_id || null,
          tercero_id: form.tercero_id, fecha: form.fecha_compra, precio: form.precio || null,
          identificacion_previa: form.identificacion_previa || null,
        });
        animal = resultado.animal;
        // La foto (si se seleccionó) se sube en un segundo paso, ya con el animal creado
        if (foto) {
          const datosFoto = new FormData();
          datosFoto.append('foto', foto);
          await api.actualizarAnimal(animal.id, datosFoto);
        }
      } else {
        const datos = new FormData();
        datos.append('arete_id', form.arete_id);
        datos.append('nombre_alias', form.nombre_alias);
        datos.append('sexo', form.sexo);
        datos.append('origen', form.origen);
        if (form.fecha_nacimiento) datos.append('fecha_nacimiento', form.fecha_nacimiento);
        if (form.peso_nacimiento_kg) datos.append('peso_nacimiento_kg', form.peso_nacimiento_kg);
        if (form.corral_actual_id) datos.append('corral_actual_id', form.corral_actual_id);
        if (form.raza_id) datos.append('raza_id', form.raza_id);
        if (foto) datos.append('foto', foto);
        animal = await api.crearAnimal(datos);
      }
      onCreado(animal);
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <ModalAccesible titulo="Registrar animal" onCerrar={onCerrar} sucio={sucio} ocupado={guardando}>
        {error && <FeedbackOperacion tipo="error" mensaje={error} />}
        <form onSubmit={guardar}>
          <div className="field">
            <label htmlFor={`${id}-foto`}>Foto (opcional)</label>
            {previewUrl ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <img
                  src={previewUrl}
                  alt="Previsualización"
                  style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line)' }}
                />
                <button type="button" className="btn btn-ghost" onClick={quitarFoto}>Quitar</button>
              </div>
            ) : (
              <input id={`${id}-foto`} type="file" accept="image/png, image/jpeg, image/webp" onChange={seleccionarFoto} />
            )}
          </div>
          <div className="field">
            <label htmlFor={`${id}-arete`}>Número de arete <span aria-hidden="true">*</span></label>
            <input id={`${id}-arete`} className="input" data-autofocus required aria-invalid={!form.arete_id.trim()} value={form.arete_id} onChange={(e) => actualizar('arete_id', e.target.value)} placeholder="MX-0003" />
          </div>
          <div className="field">
            <label htmlFor={`${id}-nombre`}>Nombre (opcional)</label>
            <input id={`${id}-nombre`} className="input" value={form.nombre_alias} onChange={(e) => actualizar('nombre_alias', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`${id}-sexo`}>Sexo</label>
            <select id={`${id}-sexo`} value={form.sexo} onChange={(e) => actualizar('sexo', e.target.value)}>
              <option value="hembra">Hembra</option>
              <option value="macho">Macho</option>
            </select>
          </div>
          <SelectorRaza value={form.raza_id} onChange={(v) => actualizar('raza_id', v)} />
          <div className="field">
            <label htmlFor={`${id}-origen`}>Origen</label>
            {origenFijo ? (
              <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600 }}>Compra</p>
            ) : (
              <>
                <select id={`${id}-origen`} value={form.origen} onChange={(e) => actualizar('origen', e.target.value)}>
                  <option value="nacimiento">Nacimiento en el rancho</option>
                  {esAdmin && <option value="compra">Compra</option>}
                  <option value="ingreso_externo">Ingreso externo</option>
                </select>
                {!esAdmin && (
                  <p style={{ fontSize: '0.75rem', color: 'var(--ink-soft)', margin: '4px 0 0' }}>
                    Solo un Administrador puede registrar animales de compra (hay que capturar el proveedor y el precio).
                  </p>
                )}
              </>
            )}
          </div>

          {esCompra ? (
            <>
              <div className="section-title" style={{ marginTop: 16, marginBottom: 10 }}>Datos de la compra</div>
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="field">
                  <label htmlFor={`${id}-precio`}>Precio (opcional)</label>
                  <input id={`${id}-precio`} className="input" type="number" inputMode="decimal" min="0" step="0.01" value={form.precio} onChange={(e) => actualizar('precio', e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor={`${id}-fecha-compra`}>Fecha de compra</label>
                  <input id={`${id}-fecha-compra`} className="input" type="date" value={form.fecha_compra} onChange={(e) => actualizar('fecha_compra', e.target.value)} />
                </div>
              </div>
              <div className="field">
                <label htmlFor={`${id}-identificacion`}>Identificación previa (arete de origen, opcional)</label>
                <input id={`${id}-identificacion`} className="input" value={form.identificacion_previa} onChange={(e) => actualizar('identificacion_previa', e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor={`${id}-peso`}>Peso al comprarlo (kg, opcional)</label>
                <input id={`${id}-peso`} className="input" type="number" inputMode="decimal" min="0" step="0.1" value={form.peso_nacimiento_kg} onChange={(e) => actualizar('peso_nacimiento_kg', e.target.value)} />
              </div>
            </>
          ) : (
            <div className="field">
              <label htmlFor={`${id}-peso`}>Peso al nacer (kg)</label>
              <input id={`${id}-peso`} className="input" type="number" inputMode="decimal" min="0" step="0.1" value={form.peso_nacimiento_kg} onChange={(e) => actualizar('peso_nacimiento_kg', e.target.value)} />
            </div>
          )}

          <div className="field">
            <label htmlFor={`${id}-nacimiento`}>Fecha de nacimiento {esCompra ? '(si se sabe)' : ''}</label>
            <input id={`${id}-nacimiento`} className="input" type="date" max={hoy} value={form.fecha_nacimiento} onChange={(e) => actualizar('fecha_nacimiento', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`${id}-corral`}>Corral</label>
            <select id={`${id}-corral`} value={form.corral_actual_id} onChange={(e) => actualizar('corral_actual_id', e.target.value)}>
              <option value="">Sin asignar</option>
              {corrales.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre} ({c.ocupacion_actual}/{c.capacidad_maxima})</option>
              ))}
            </select>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" data-modal-cerrar onClick={onCerrar}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={guardando}>
              {guardando ? 'Guardando...' : esCompra ? 'Comprar animal' : 'Registrar animal'}
            </button>
          </div>
        </form>
    </ModalAccesible>
  );
}
