import { useEffect, useState } from 'react';
import { api } from '../api';
import { exportarHistorialTercero } from '../exportUtils.js';

function formatearFecha(fecha) {
  return new Date(fecha).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' });
}

const ESTADO_SALUD_LABEL = { sano: 'Sano', observacion: 'En observación', enfermo: 'Enfermo' };
const ESTADO_SALUD_COLOR = { sano: 'var(--pasture)', observacion: 'var(--wheat)', enfermo: 'var(--rust)' };

export default function HistorialTercero() {
  const [terceros, setTerceros] = useState([]);
  const [terceroId, setTerceroId] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [ventas, setVentas] = useState(null);
  const [compras, setCompras] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.listarTerceros().then(setTerceros).catch(() => {});
  }, []);

  useEffect(() => {
    if (!terceroId) { setVentas(null); setCompras(null); return; }
    const params = { tercero_id: terceroId };
    if (desde) params.desde = desde;
    if (hasta) params.hasta = hasta;
    setError(null);
    api.reporteVentas(params).then((r) => setVentas(r.ventas)).catch((err) => setError(err.message));
    api.listarComprasAnimal(params).then(setCompras).catch((err) => setError(err.message));
  }, [terceroId, desde, hasta]);

  const terceroActual = terceros.find((t) => String(t.id) === String(terceroId));

  // Cuenta cuántos de los animales comprados a este proveedor están en cada estado de salud ahora
  const resumenSalud = (() => {
    if (!compras || compras.length === 0) return null;
    const conteo = { sano: 0, observacion: 0, enfermo: 0, no_vivo: 0 };
    compras.forEach((c) => {
      if (c.animal_estado !== 'vivo') conteo.no_vivo++;
      else conteo[c.estado_salud || 'sano']++;
    });
    return conteo;
  })();

  async function exportar() {
    const saludTexto = resumenSalud
      ? `${resumenSalud.sano} sano(s), ${resumenSalud.observacion} en observación, ${resumenSalud.enfermo} enfermo(s), ${resumenSalud.no_vivo} ya no vivo(s)`
      : null;
    setError(null);
    try {
      await exportarHistorialTercero(terceroActual, { ventas, compras, saludResumen: saludTexto });
    } catch (err) {
      setError(`No se pudo preparar el PDF: ${err.message}`);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Historial por proveedor/comprador</h1>
          <div className="subtitle">Todo lo que le has comprado o vendido a alguien específico, en el periodo que quieras</div>
        </div>
        {terceroActual && (ventas?.length > 0 || compras?.length > 0) && (
          <button className="btn btn-primary" onClick={exportar}>Exportar PDF</button>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="toolbar">
        <select value={terceroId} onChange={(e) => setTerceroId(e.target.value)}>
          <option value="">Selecciona un proveedor o comprador</option>
          {terceros.map((t) => <option key={t.id} value={t.id}>{t.nombre} ({t.tipo})</option>)}
        </select>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Desde</label>
          <input className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Hasta</label>
          <input className="input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
      </div>

      {!terceroId ? (
        <div className="card empty-state">
          <h3>Elige un proveedor o comprador para ver su historial</h3>
        </div>
      ) : (
        <>
          {resumenSalud && (
            <div className="card" style={{ padding: '18px 24px', marginBottom: 20 }}>
              <div className="section-title">Estado de salud actual de los animales comprados aquí</div>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                <span style={{ color: ESTADO_SALUD_COLOR.sano, fontWeight: 600 }}>{resumenSalud.sano} sano(s)</span>
                <span style={{ color: ESTADO_SALUD_COLOR.observacion, fontWeight: 600 }}>{resumenSalud.observacion} en observación</span>
                <span style={{ color: ESTADO_SALUD_COLOR.enfermo, fontWeight: 600 }}>{resumenSalud.enfermo} enfermo(s)</span>
                <span style={{ color: 'var(--ink-soft)' }}>{resumenSalud.no_vivo} ya no vivo(s)</span>
              </div>
              {resumenSalud.enfermo >= 2 && (
                <p style={{ fontSize: '0.82rem', color: 'var(--rust)', marginTop: 10, marginBottom: 0 }}>
                  Varios animales de este proveedor están enfermos actualmente — puede valer la pena revisar el patrón.
                </p>
              )}
            </div>
          )}

          {ventas && ventas.length > 0 && (
            <>
              <div className="section-title">Ventas</div>
              <div className="card" style={{ marginBottom: 24 }}>
                <table className="animal-table">
                  <thead><tr><th>Fecha</th><th>Arete</th><th>Precio</th></tr></thead>
                  <tbody>
                    {ventas.map((v, i) => (
                      <tr key={i}>
                        <td>{formatearFecha(v.fecha)}</td>
                        <td><span className="tag-badge">{v.arete_id}</span></td>
                        <td>${Number(v.precio).toLocaleString('es-MX')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {compras && compras.length > 0 && (
            <>
              <div className="section-title">Compras</div>
              <div className="card" style={{ marginBottom: 24 }}>
                <table className="animal-table">
                  <thead><tr><th>Fecha</th><th>Arete</th><th>Precio</th><th>Estado de salud</th></tr></thead>
                  <tbody>
                    {compras.map((c, i) => (
                      <tr key={i}>
                        <td>{formatearFecha(c.fecha)}</td>
                        <td><span className="tag-badge">{c.arete_id}</span></td>
                        <td>{c.precio ? `$${Number(c.precio).toLocaleString('es-MX')}` : '—'}</td>
                        <td>
                          {c.animal_estado !== 'vivo'
                            ? <span style={{ color: 'var(--ink-soft)' }}>{c.animal_estado}</span>
                            : <span style={{ color: ESTADO_SALUD_COLOR[c.estado_salud] }}>{ESTADO_SALUD_LABEL[c.estado_salud] || c.estado_salud}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {ventas?.length === 0 && compras?.length === 0 && (
            <div className="card empty-state">
              <h3>No hay compras ni ventas registradas con este tercero en este periodo</h3>
            </div>
          )}
        </>
      )}
    </div>
  );
}
