import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

function formatearFechaCorta(fecha) {
  return new Date(fecha).toLocaleDateString('es-MX', { month: 'short', day: 'numeric' });
}

export default function CurvaPeso({ pesajes }) {
  if (!pesajes || pesajes.length < 2) return null;

  const datos = pesajes.map((p) => ({
    fecha: p.fecha,
    fechaCorta: formatearFechaCorta(p.fecha),
    peso: Number(p.peso_kg),
  }));

  return (
    <div className="card" style={{ padding: '20px 24px 8px', marginBottom: 24 }}>
      <div className="section-title">Curva de crecimiento</div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={datos} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
          <XAxis dataKey="fechaCorta" tick={{ fontSize: 12, fill: 'var(--ink-soft)' }} />
          <YAxis tick={{ fontSize: 12, fill: 'var(--ink-soft)' }} unit=" kg" width={60} />
          <Tooltip
            formatter={(value) => [`${value} kg`, 'Peso']}
            labelFormatter={(_, payload) => payload?.[0] ? formatearFechaCorta(payload[0].payload.fecha) : ''}
            contentStyle={{ fontFamily: 'Inter, sans-serif', fontSize: '0.85rem', borderRadius: 8, border: '1px solid var(--line)' }}
          />
          <Line type="monotone" dataKey="peso" stroke="var(--pasture)" strokeWidth={2} dot={{ fill: 'var(--wheat)', r: 4 }} activeDot={{ r: 6 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
