function IconoSolAnimado({ tamano = 40 }) {
  return (
    <svg width={tamano} height={tamano} viewBox="0 0 40 40" fill="none">
      <g className="clima-sol-rayos" stroke="var(--wheat)" strokeWidth="2" strokeLinecap="round">
        <path d="M20 3v5M20 32v5M37 20h-5M8 20H3M31.5 8.5l-3.5 3.5M11.5 28.5l-3.5 3.5M31.5 31.5l-3.5-3.5M11.5 11.5l-3.5-3.5" />
      </g>
      <circle className="clima-sol-circulo" cx="20" cy="20" r="9" fill="var(--wheat)" />
    </svg>
  );
}

function IconoNubeAnimada({ tamano = 40, lluvia = false, tormenta = false }) {
  return (
    <svg width={tamano} height={tamano} viewBox="0 0 40 40" fill="none">
      <g className="clima-nube">
        <path d="M11 26a6.5 6.5 0 0 1 1-13 8 8 0 0 1 15.4-2.5A6.5 6.5 0 0 1 29 26H11Z" fill="#fff" stroke="var(--ink-soft)" strokeWidth="1.4" />
      </g>
      {lluvia && (
        <g stroke="var(--azul-leche)" strokeWidth="2" strokeLinecap="round">
          <line className="clima-gota" x1="14" y1="28" x2="14" y2="33" />
          <line className="clima-gota" x1="20" y1="28" x2="20" y2="33" />
          <line className="clima-gota" x1="26" y1="28" x2="26" y2="33" />
        </g>
      )}
      {tormenta && (
        <path className="clima-rayo" d="M21 26l-4 7h4l-2 5 6-8h-4l3-4Z" fill="var(--wheat)" />
      )}
    </svg>
  );
}

function IconoNieblaAnimada({ tamano = 40 }) {
  return (
    <svg width={tamano} height={tamano} viewBox="0 0 40 40" fill="none" stroke="var(--ink-soft)" strokeWidth="2.2" strokeLinecap="round">
      <line className="clima-niebla-linea" x1="7" y1="14" x2="33" y2="14" />
      <line className="clima-niebla-linea" x1="5" y1="20" x2="35" y2="20" />
      <line className="clima-niebla-linea" x1="9" y1="26" x2="31" y2="26" />
    </svg>
  );
}

// Clasifica la descripción en español que da OpenWeatherMap en una categoría visual
export function categoriaClima(descripcion = '') {
  const d = descripcion.toLowerCase();
  if (d.includes('tormenta')) return 'tormenta';
  if (d.includes('lluvia') || d.includes('llovizna')) return 'lluvia';
  if (d.includes('nieve')) return 'nieve';
  if (d.includes('niebla') || d.includes('bruma') || d.includes('neblina')) return 'niebla';
  if (d.includes('nub')) return 'nublado';
  return 'sol';
}

export default function IconoClima({ descripcion, tamano = 40 }) {
  const categoria = categoriaClima(descripcion);
  if (categoria === 'sol') return <IconoSolAnimado tamano={tamano} />;
  if (categoria === 'tormenta') return <IconoNubeAnimada tamano={tamano} tormenta />;
  if (categoria === 'lluvia') return <IconoNubeAnimada tamano={tamano} lluvia />;
  if (categoria === 'niebla') return <IconoNieblaAnimada tamano={tamano} />;
  return <IconoNubeAnimada tamano={tamano} />;
}
