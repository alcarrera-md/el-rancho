import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

function formatearFechaCorta(fecha) {
  return new Date(fecha).toLocaleDateString('es-MX', { month: 'short', day: 'numeric' });
}

export default function CurvaLeche({ registros }) {
  if (!registros || registros.length === 0) return null;

  // Suma los turnos (mañana/tarde) en un total por día para la gráfica
  const porDia = {};
  registros.forEach((r) => {
    porDia[r.fecha] = (porDia[r.fecha] || 0) + Number(r.litros);
  });
  const datos = Object.entries(porDia)
    .map(([fecha, litros]) => ({ fecha, fechaCorta: formatearFechaCorta(fecha), litros: Number(litros.toFixed(1)) }))
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

  return (
    <div className="card" style={{ padding: '20px 24px 8px', marginBottom: 24 }}>
      <div className="section-title">Producción de leche por día</div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={datos} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
          <XAxis dataKey="fechaCorta" tick={{ fontSize: 12, fill: 'var(--ink-soft)' }} />
          <YAxis tick={{ fontSize: 12, fill: 'var(--ink-soft)' }} unit=" L" width={50} />
          <Tooltip
            formatter={(value) => [`${value} L`, 'Producción']}
            contentStyle={{ fontFamily: 'Inter, sans-serif', fontSize: '0.85rem', borderRadius: 8, border: '1px solid var(--line)' }}
          />
          <Bar dataKey="litros" fill="var(--wheat)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
