import { IconoBalanza, IconoSalud, IconoHoja, IconoCorazon, IconoGota, IconoCheck } from './Iconos.jsx';

const ESTILO_TIPO = {
  pesaje: { color: 'var(--pasture)', Icono: IconoBalanza },
  salud: { color: 'var(--rust)', Icono: IconoSalud },
  alimentacion: { color: 'var(--wheat)', Icono: IconoHoja },
  reproduccion: { color: 'var(--morado-condicion)', Icono: IconoCorazon },
  leche: { color: 'var(--azul-leche)', Icono: IconoGota },
  ok: { color: 'var(--pasture)', Icono: IconoCheck },
};

export default function RecomendacionesPanel({ recomendaciones }) {
  return (
    <div className="card" style={{ padding: '20px 24px', marginBottom: 24 }}>
      <div className="section-title">Recomendaciones para este animal</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {recomendaciones.map((r, i) => {
          const estilo = ESTILO_TIPO[r.tipo] || ESTILO_TIPO.ok;
          const Icono = estilo.Icono;
          return (
            <div
              key={i}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px',
                borderRadius: 8, background: 'var(--paper)', borderLeft: `3px solid ${estilo.color}`,
              }}
            >
              <span style={{ color: estilo.color, flexShrink: 0, marginTop: 1 }}><Icono width={16} height={16} /></span>
              <span style={{ fontSize: '0.9rem' }}>{r.mensaje}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
