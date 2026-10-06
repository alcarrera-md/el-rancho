import { useState } from 'react';
import { api, urlFoto } from '../api';
import SelectorRaza from './SelectorRaza.jsx';

const hoy = new Date().toISOString().slice(0, 10);

export default function EditarAnimalModal({ animal, onCerrar, onGuardado }) {
  const [form, setForm] = useState({
    nombre_alias: animal.nombre_alias || '',
    sexo: animal.sexo,
    fecha_nacimiento: animal.fecha_nacimiento ? animal.fecha_nacimiento.slice(0, 10) : '',
    peso_nacimiento_kg: animal.peso_nacimiento_kg || '',
    raza_id: animal.raza_id || '',
  });
  const [foto, setFoto] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  function actualizar(campo, valor) {
    setForm((f) => ({ ...f, [campo]: valor }));
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
    setPreviewUrl(URL.createObjectURL(archivo));
  }

  async function guardar(e) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      const datos = new FormData();
      datos.append('nombre_alias', form.nombre_alias);
      datos.append('sexo', form.sexo);
      if (form.fecha_nacimiento) datos.append('fecha_nacimiento', form.fecha_nacimiento);
      if (form.peso_nacimiento_kg) datos.append('peso_nacimiento_kg', form.peso_nacimiento_kg);
      if (form.raza_id) datos.append('raza_id', form.raza_id);
      if (foto) datos.append('foto', foto);

      await api.actualizarAnimal(animal.id, datos);
      onGuardado();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Editar datos de {animal.arete_id}</h3>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={guardar}>
          <div className="field">
            <label>Foto</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <img
                src={previewUrl || urlFoto(animal.foto_url) || undefined}
                alt=""
                style={{
                  width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line)',
                  display: (previewUrl || animal.foto_url) ? 'block' : 'none',
                }}
              />
              <input type="file" accept="image/png, image/jpeg, image/webp" onChange={seleccionarFoto} />
            </div>
          </div>
          <div className="field">
            <label>Nombre (opcional)</label>
            <input className="input" value={form.nombre_alias} onChange={(e) => actualizar('nombre_alias', e.target.value)} />
          </div>
          <div className="field">
            <label>Sexo</label>
            <select value={form.sexo} onChange={(e) => actualizar('sexo', e.target.value)}>
              <option value="hembra">Hembra</option>
              <option value="macho">Macho</option>
            </select>
          </div>
          <div className="field">
            <label>Fecha de nacimiento</label>
            <input className="input" type="date" max={hoy} value={form.fecha_nacimiento} onChange={(e) => actualizar('fecha_nacimiento', e.target.value)} />
          </div>
          <div className="field">
            <label>Peso al nacer (kg)</label>
            <input className="input" type="number" step="0.1" value={form.peso_nacimiento_kg} onChange={(e) => actualizar('peso_nacimiento_kg', e.target.value)} />
          </div>
          <SelectorRaza value={form.raza_id} onChange={(v) => actualizar('raza_id', v)} />
          <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>
            El arete no se puede editar aquí — es el identificador oficial del animal.
          </p>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onCerrar}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={guardando}>
              {guardando ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
