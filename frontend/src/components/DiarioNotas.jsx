import { useRef, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthContext.jsx';
import { puedeEliminarNota, tienePermiso } from '../authorization/permissions.js';
import { crearGuardiaEnvio } from '../fieldActions.js';
import { FeedbackOperacion } from './EstadosUI.jsx';
import { useProteccionFormulario } from '../useProteccionFormulario.js';

const TAGS_SUGERIDOS = ['Salud', 'Comportamiento', 'Alimentación', 'Reproducción', 'General'];

const COLOR_TAG = {
  Salud: 'var(--rust)',
  Comportamiento: 'var(--morado-condicion)',
  Alimentación: 'var(--wheat)',
  Reproducción: 'var(--azul-leche)',
  General: 'var(--ink-soft)',
};

function formatearFechaHora(fecha) {
  return new Date(fecha).toLocaleString('es-MX', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function DiarioNotas({ animalId, notas, onActualizado }) {
  const { usuario } = useAuth();
  const puedeCrear = tienePermiso(usuario?.rol, 'notas_seguimiento', 'crear');
  const [tag, setTag] = useState('');
  const [tagPersonalizado, setTagPersonalizado] = useState(false);
  const [contenido, setContenido] = useState('');
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [confirmacion, setConfirmacion] = useState('');
  const guardia = useRef(crearGuardiaEnvio());
  useProteccionFormulario(!enviando && Boolean(contenido.trim()));

  async function enviar(e) {
    e.preventDefault();
    if (!contenido.trim()) return;
    setError(null);
    setConfirmacion('');
    const resultado = await guardia.current.ejecutar(async () => {
      setEnviando(true);
      try {
        await api.crearNota({ animal_id: animalId, tag: tag || null, contenido: contenido.trim() });
      } finally {
        setEnviando(false);
      }
    }).catch((err) => {
      setError(err.message);
      return null;
    });
    if (resultado?.ejecutado) {
      setContenido('');
      setTag('');
      setConfirmacion('Nota agregada al seguimiento.');
      onActualizado();
    }
  }

  async function eliminar(id) {
    if (!window.confirm('¿Eliminar esta nota?')) return;
    try {
      await api.eliminarNota(id);
      onActualizado();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="card" style={{ padding: '20px 24px' }}>
      <div className="section-title">Diario del animal — notas entre trabajadores</div>
      {error && <div className="error-banner">{error}</div>}
      <FeedbackOperacion mensaje={confirmacion} />

      {puedeCrear && <form onSubmit={enviar} style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          {!tagPersonalizado ? (
            <select value={tag} onChange={(e) => e.target.value === '__otro__' ? setTagPersonalizado(true) : setTag(e.target.value)}>
              <option value="">Sin tag</option>
              {TAGS_SUGERIDOS.map((t) => <option key={t} value={t}>#{t}</option>)}
              <option value="__otro__">Otro tag...</option>
            </select>
          ) : (
            <input
              className="input" style={{ maxWidth: 160 }} placeholder="Nombre del tag"
              value={tag} onChange={(e) => setTag(e.target.value)} autoFocus
            />
          )}
        </div>
        <textarea
          rows={3} value={contenido} onChange={(e) => setContenido(e.target.value)}
          placeholder="Deja una nota o actualización para el siguiente trabajador que revise a este animal..."
          required
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <button type="submit" className="btn btn-primary" disabled={enviando || !contenido.trim()}>
            {enviando ? 'Guardando...' : 'Agregar nota'}
          </button>
        </div>
      </form>}

      {notas.length === 0 ? (
        <div className="empty-state" style={{ padding: '20px' }}>
          <h3 style={{ fontSize: '0.95rem' }}>Todavía no hay notas para este animal</h3>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {notas.map((n) => (
            <div key={n.id} style={{ padding: '10px 12px', background: 'var(--paper)', borderRadius: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                <div>
                  {n.tag && (
                    <span style={{
                      fontWeight: 700, fontSize: '0.78rem', color: COLOR_TAG[n.tag] || 'var(--pasture)', marginRight: 6,
                    }}>
                      #{n.tag}
                    </span>
                  )}
                  <span style={{ fontSize: '0.78rem', color: 'var(--ink-soft)' }}>
                    {n.usuario || 'Usuario eliminado'} — {formatearFechaHora(n.fecha)}
                  </span>
                </div>
                {puedeEliminarNota(usuario?.rol, usuario?.id, n.usuario_id) && (
                  <button className="btn btn-ghost" style={{ padding: '1px 8px', fontSize: '0.72rem' }} onClick={() => eliminar(n.id)}>
                    Eliminar
                  </button>
                )}
              </div>
              <div style={{ fontSize: '0.9rem' }}>{n.contenido}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
