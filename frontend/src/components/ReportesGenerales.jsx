import { useEffect, useState } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../api';
import { exportarResumenExcel } from '../exportUtils.js';
import ModuleHeader from './ModuleHeader.jsx';

const ESTADO_LABEL = { vivo: 'Vivo', vendido: 'Vendido', sacrificado: 'Sacrificado', muerto: 'Muerto' };

function formatearMes(mes) {
  const [anio, m] = mes.split('-');
  return new Date(anio, m - 1).toLocaleDateString('es-MX', { month: 'short', year: '2-digit' });
}

export default function ReportesGenerales() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.reporteResumen().then(setData).catch((err) => setError(err.message));
  }, []);

  async function exportar() {
    setError(null);
    try {
      await exportarResumenExcel(data);
    } catch (err) {
      setError(`No se pudo preparar el archivo Excel: ${err.message}`);
    }
  }

  return (
    <div>
      <ModuleHeader eyebrow="Análisis" title="Información para tomar decisiones" description="Panorama general del rancho y sus indicadores principales." accent="tecnico" action={data ? <button className="btn btn-ghost" onClick={exportar}>Exportar Excel</button> : null} />

      {error && <div className="error-banner">No se pudo conectar con el servidor: {error}</div>}
      {!data ? (
        <div className="empty-state">Cargando reportes...</div>
      ) : (
        <>
          <div className="resumen-grid" style={{ marginBottom: 28 }}>
            <div className="card resumen-item">
              <div className="valor">{data.total_animales_vivos}</div>
              <div className="etiqueta">Animales vivos</div>
            </div>
            <div className="card resumen-item">
              <div className="valor">${Number(data.ingresos_totales).toLocaleString('es-MX')}</div>
              <div className="etiqueta">Ingresos totales por venta</div>
            </div>
            {data.animales_por_estado.map((e) => (
              <div className="card resumen-item" key={e.estado}>
                <div className="valor">{e.total}</div>
                <div className="etiqueta">{ESTADO_LABEL[e.estado] || e.estado}</div>
              </div>
            ))}
          </div>

          <div className="section-title">Indicadores productivos y reproductivos</div>
          <div className="resumen-grid" style={{ marginBottom: 28 }}>
            <div className="card resumen-item">
              <div className="valor">{data.tasa_mortalidad !== null ? `${data.tasa_mortalidad}%` : '—'}</div>
              <div className="etiqueta">Tasa de mortalidad</div>
            </div>
            <div className="card resumen-item">
              <div className="valor">{data.tasa_prenez !== null ? `${data.tasa_prenez}%` : 'No disponible'}</div>
              <div className="etiqueta">Tasa de preñez</div>
            </div>
            <div className="card resumen-item">
              <div className="valor">{data.tasa_destete !== null ? `${data.tasa_destete}%` : '—'}</div>
              <div className="etiqueta">Supervivencia de crías</div>
            </div>
            <div className="card resumen-item">
              <div className="valor">{data.ganancia_diaria_promedio_kg !== null ? `${data.ganancia_diaria_promedio_kg} kg` : '—'}</div>
              <div className="etiqueta">Ganancia diaria promedio</div>
            </div>
          </div>

          <div className="section-title">Peso promedio por corral</div>
          <div className="card" style={{ padding: '20px 24px', marginBottom: 28 }}>
            {data.peso_promedio_por_corral.length === 0 ? (
              <div className="empty-state">
                <h3>Todavía no hay suficientes pesajes</h3>
                <p>Registra pesajes en los animales para ver este comparativo.</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.peso_promedio_por_corral} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                  <XAxis dataKey="corral" tick={{ fontSize: 12, fill: 'var(--ink-soft)' }} />
                  <YAxis tick={{ fontSize: 12, fill: 'var(--ink-soft)' }} unit=" kg" width={60} />
                  <Tooltip
                    formatter={(value, name) => [`${value} kg`, 'Peso promedio']}
                    contentStyle={{ fontFamily: 'Inter, sans-serif', fontSize: '0.85rem', borderRadius: 8, border: '1px solid var(--line)' }}
                  />
                  <Bar dataKey="peso_promedio" fill="var(--pasture)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="section-title">Ingresos por venta, por mes</div>
          <div className="card" style={{ padding: '20px 24px' }}>
            {data.ventas_por_mes.length === 0 ? (
              <div className="empty-state">
                <h3>Todavía no hay ventas registradas</h3>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={data.ventas_por_mes.map((v) => ({ ...v, mesCorto: formatearMes(v.mes) }))} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                  <XAxis dataKey="mesCorto" tick={{ fontSize: 12, fill: 'var(--ink-soft)' }} />
                  <YAxis tick={{ fontSize: 12, fill: 'var(--ink-soft)' }} width={60} />
                  <Tooltip
                    formatter={(value) => [`$${Number(value).toLocaleString('es-MX')}`, 'Ingresos']}
                    contentStyle={{ fontFamily: 'Inter, sans-serif', fontSize: '0.85rem', borderRadius: 8, border: '1px solid var(--line)' }}
                  />
                  <Line type="monotone" dataKey="total" stroke="var(--wheat)" strokeWidth={2} dot={{ fill: 'var(--pasture)', r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </>
      )}
    </div>
  );
}
