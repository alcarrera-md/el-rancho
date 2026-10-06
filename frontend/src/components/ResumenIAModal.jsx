import { useEffect, useState } from 'react';
import { api } from '../api';

// Convierte **negritas** simples del texto de la IA en <strong>, sin usar HTML crudo
function renderizarTexto(texto) {
  return texto.split('\n').map((linea, i) => {
    if (!linea.trim()) return <div key={i} style={{ height: 8 }} />;
    const partes = linea.split(/(\*\*[^*]+\*\*)/g);
    return (
      <p key={i} style={{ margin: '0 0 6px' }}>
        {partes.map((parte, j) =>
          parte.startsWith('**') && parte.endsWith('**')
            ? <strong key={j}>{parte.slice(2, -2)}</strong>
            : <span key={j}>{parte}</span>
        )}
      </p>
    );
  });
}

export default function ResumenIAModal({ animalId, onCerrar }) {
  const [resumen, setResumen] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    api.generarResumenIA(animalId)
      .then((data) => setResumen(data.resumen))
      .catch((err) => setError(err.message))
      .finally(() => setCargando(false));
  }, [animalId]);

  return (
    <div className="modal-backdrop" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <h3>Resumen con IA</h3>
        {cargando && <div className="empty-state">Generando resumen...</div>}
        {error && <div className="error-banner">{error}</div>}
        {resumen && (
          <>
            <div style={{ fontSize: '0.9rem', lineHeight: 1.5 }}>{renderizarTexto(resumen)}</div>
            <p style={{ fontSize: '0.72rem', color: 'var(--ink-soft)', marginTop: 14 }}>
              Generado automáticamente a partir de los datos registrados de este animal. Verifica cualquier
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
