import { useEffect, useState } from 'react';
import { generarQRDataURL, enlaceAnimal } from '../exportUtils.js';

export default function CodigoQRModal({ animal, onCerrar }) {
  const [dataUrl, setDataUrl] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    generarQRDataURL(animal.id).then(setDataUrl).catch((err) => setError(err.message));
  }, [animal.id]);

  function descargar() {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `qr-${animal.arete_id}.png`;
    a.click();
  }

  return (
    <div className="modal-backdrop" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ textAlign: 'center' }}>
        <h3>Código QR — {animal.nombre_alias || animal.arete_id}</h3>
        {error && <div className="error-banner">{error}</div>}
        {dataUrl && (
          <>
            <img src={dataUrl} alt={`QR de ${animal.arete_id}`} style={{ width: 200, height: 200, margin: '10px 0' }} />
            <p style={{ fontSize: '0.78rem', color: 'var(--ink-soft)', wordBreak: 'break-all' }}>{enlaceAnimal(animal.id)}</p>
            <p style={{ fontSize: '0.78rem', color: 'var(--ink-soft)' }}>
              Solo funciona si quien lo escanea está en la misma red WiFi que esta computadora.
            </p>
          </>
        )}
        <div className="modal-actions" style={{ justifyContent: 'center' }}>
          <button className="btn btn-ghost" onClick={onCerrar}>Cerrar</button>
          {dataUrl && <button className="btn btn-primary" onClick={descargar}>Descargar</button>}
        </div>
      </div>
    </div>
  );
}
