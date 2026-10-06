import { useEffect, useState } from 'react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { api } from '../api';
import ModuleHeader from './ModuleHeader.jsx';

const COLORES_CATEGORIA = ['#2f5233', '#c99a2e', '#a8412c', '#3b6ea5', '#6d4a94', '#5b6b5f', '#7a9e7e', '#d9b96a'];

function formatoMoneda(n) {
  return `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function Finanzas() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');

  function cargar() {
    const params = {};
    if (desde) params.desde = desde;
    if (hasta) params.hasta = hasta;
    api.reporteFinanciero(params).then(setData).catch((err) => setError(err.message));
  }
  useEffect(cargar, [desde, hasta]); // eslint-disable-line react-hooks/exhaustive-deps

  // Junta ingresos y gastos por mes en una sola serie para la gráfica comparativa
  const datosComparativos = (() => {
    if (!data) return [];
    const meses = {};
    data.ingresos_por_mes.forEach((i) => { meses[i.mes] = { mes: i.mes, ingresos: Number(i.total) }; });
    data.gastos_por_mes.forEach((g) => {
      meses[g.mes] = { ...(meses[g.mes] || { mes: g.mes, ingresos: 0 }), gastos: Number(g.total) };
    });
    return Object.values(meses).sort((a, b) => a.mes.localeCompare(b.mes));
  })();

  return (
    <div>
      <ModuleHeader eyebrow="Resultado económico" title="Cómo está rindiendo el rancho" description="Compara todo lo que entró contra todo lo que salió en el periodo." accent="finanzas" />

      {error && <div className="error-banner">{error}</div>}

      <div className="toolbar">
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Desde</label>
          <input className="input" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Hasta</label>
          <input className="input" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
      </div>

      {!data ? (
        <div className="empty-state">Cargando...</div>
      ) : (
        <>
          <div className="resumen-grid" style={{ marginBottom: 28 }}>
            <div className="card resumen-item">
              <div className="valor" style={{ color: 'var(--pasture)' }}>{formatoMoneda(data.ingresos.total)}</div>
              <div className="etiqueta">Ingresos totales</div>
            </div>
            <div className="card resumen-item">
              <div className="valor" style={{ color: 'var(--rust)' }}>{formatoMoneda(data.gastos.total)}</div>
              <div className="etiqueta">Gastos totales</div>
            </div>
            <div className="card resumen-item">
              <div className="valor" style={{ color: data.utilidad_neta >= 0 ? 'var(--pasture)' : 'var(--rust)' }}>
                {formatoMoneda(data.utilidad_neta)}
              </div>
              <div className="etiqueta">Utilidad neta</div>
            </div>
          </div>

          <div className="finance-charts-grid">
            <div>
              <div className="section-title">Ingresos vs. gastos, por mes</div>
              <div className="card" style={{ padding: '20px 24px' }}>
                {datosComparativos.length === 0 ? (
                  <div className="empty-state"><h3 style={{ fontSize: '0.9rem' }}>Todavía no hay datos suficientes</h3></div>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={datosComparativos} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                      <XAxis dataKey="mes" tick={{ fontSize: 11, fill: 'var(--ink-soft)' }} />
                      <YAxis tick={{ fontSize: 11, fill: 'var(--ink-soft)' }} width={55} />
                      <Tooltip formatter={(v) => formatoMoneda(v)} contentStyle={{ fontFamily: 'Inter, sans-serif', fontSize: '0.85rem', borderRadius: 8, border: '1px solid var(--line)' }} />
                      <Legend wrapperStyle={{ fontSize: '0.8rem' }} />
                      <Bar dataKey="ingresos" name="Ingresos" fill="var(--pasture)" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="gastos" name="Gastos" fill="var(--rust)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div>
              <div className="section-title">Gastos generales por categoría</div>
              <div className="card" style={{ padding: '20px 24px' }}>
                {data.gastos_por_categoria.length === 0 ? (
                  <div className="empty-state"><h3 style={{ fontSize: '0.9rem' }}>Todavía no hay gastos generales registrados</h3></div>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie data={data.gastos_por_categoria} dataKey="total" nameKey="categoria" cx="50%" cy="50%" outerRadius={90} label={(e) => e.categoria}>
                        {data.gastos_por_categoria.map((_, i) => <Cell key={i} fill={COLORES_CATEGORIA[i % COLORES_CATEGORIA.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v) => formatoMoneda(v)} contentStyle={{ fontFamily: 'Inter, sans-serif', fontSize: '0.85rem', borderRadius: 8, border: '1px solid var(--line)' }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          <div className="section-title" style={{ marginTop: 28 }}>Desglose</div>
          <div className="card" style={{ padding: '20px 24px' }}>
            <table className="animal-table">
              <tbody>
                <tr><td>Ingresos por venta de animales</td><td style={{ textAlign: 'right' }}>{formatoMoneda(data.ingresos.ventas)}</td></tr>
                <tr><td>Ingresos por leche (estimado)</td><td style={{ textAlign: 'right' }}>{formatoMoneda(data.ingresos.leche)}</td></tr>
                <tr><td>Gastos en compra de insumos</td><td style={{ textAlign: 'right' }}>{formatoMoneda(data.gastos.insumos)}</td></tr>
                <tr><td>Gastos en compra de animales</td><td style={{ textAlign: 'right' }}>{formatoMoneda(data.gastos.animales)}</td></tr>
                <tr><td>Gastos generales (veterinario, luz, combustible, etc.)</td><td style={{ textAlign: 'right' }}>{formatoMoneda(data.gastos.generales)}</td></tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
