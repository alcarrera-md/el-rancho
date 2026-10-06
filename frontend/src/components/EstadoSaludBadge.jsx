const CONFIG = {
  sano: { texto: 'Sano', color: 'var(--pasture)' },
  observacion: { texto: 'En observación', color: 'var(--wheat)' },
  enfermo: { texto: 'Enfermo', color: 'var(--rust)' },
};

const CONFIG_ESTADO = {
  vendido: { texto: 'Vendido', color: 'var(--ink-soft)' },
  sacrificado: { texto: 'Sacrificado', color: 'var(--ink-soft)' },
  muerto: { texto: 'Muerto', color: 'var(--ink-soft)' },
};

function Punto({ color }) {
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: color, marginRight: 6, flexShrink: 0,
    }} />
  );
}

export default function EstadoSaludBadge({ estado, estadoSalud, tamano = 'normal' }) {
  if (estado !== 'vivo') {
    const c = CONFIG_ESTADO[estado] || { texto: estado, color: 'var(--ink-soft)' };
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: tamano === 'chico' ? '0.78rem' : '0.85rem', color: 'var(--ink-soft)' }}>
        <Punto color={c.color} />{c.texto}
      </span>
    );
  }
  const c = CONFIG[estadoSalud] || CONFIG.sano;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: tamano === 'chico' ? '0.78rem' : '0.85rem', color: c.color, fontWeight: 600 }}>
      <Punto color={c.color} />{c.texto}
    </span>
  );
}
