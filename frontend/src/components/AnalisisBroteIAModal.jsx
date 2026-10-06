import { useEffect, useState } from 'react';
import { api } from '../api';

const VEREDICTO_CONFIG = {
  brote_probable: { texto: 'Brote probable', color: 'var(--rust)' },
  posible_coincidencia: { texto: 'Posible coincidencia', color: 'var(--pasture)' },
  datos_insuficientes: { texto: 'Datos insuficientes', color: 'var(--ink-soft)' },
};

export default function AnalisisBroteIAModal({ animalId, onCerrar }) {
  const [resultado, setResultado] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    api.analizarBroteIA(animalId)
      .then(setResultado)
      .catch((err) => setError(err.message))
      .finally(() => setCargando(false));
  }, [animalId]);

  const veredicto = resultado ? (VEREDICTO_CONFIG[resultado.veredicto] || { texto: resultado.veredicto, color: 'var(--ink-soft)' }) : null;

  return (
    <div className="modal-backdrop" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <h3>Análisis de brote con IA</h3>
        {cargando && <div className="empty-state">Analizando el grupo de contacto...</div>}
        {error && <div className="error-banner">{error}</div>}
        {resultado && (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 14 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '2rem', fontWeight: 600, color: veredicto.color }}>
                {resultado.probabilidad_real}%
              </div>
              <div>
                <div style={{ fontWeight: 600, color: veredicto.color }}>{veredicto.texto}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--ink-soft)' }}>Probabilidad de que sea un brote real</div>
              </div>
            </div>

            <p style={{ fontSize: '0.9rem', lineHeight: 1.5 }}>{resultado.justificacion}</p>

            {resultado.recomendaciones?.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 16, marginBottom: 8 }}>Recomendaciones</div>
                <ul style={{ margin: 0, paddingLeft: 20, fontSize: '0.9rem', lineHeight: 1.6 }}>
                  {resultado.recomendaciones.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </>
            )}

            <p style={{ fontSize: '0.72rem', color: 'var(--ink-soft)', marginTop: 14 }}>
              Generado automáticamente a partir de quién compartió corral con quién y cuándo. Verifica cualquier
              decisión importante con un veterinario.
            </p>
          </>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-primary" onClick={onCerrar}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
