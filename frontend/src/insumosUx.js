export const ESTADO_STOCK = Object.freeze({ AGOTADO: 'agotado', BAJO: 'bajo', BIEN: 'bien' });

export function estadoStock(insumo) {
  const actual = Number(insumo?.stock_actual || 0);
  const minimo = Number(insumo?.stock_minimo || 0);
  if (actual <= 0) return ESTADO_STOCK.AGOTADO;
  if (actual <= minimo) return ESTADO_STOCK.BAJO;
  return ESTADO_STOCK.BIEN;
}

export function nivelStock(insumo) {
  const actual = Math.max(0, Number(insumo?.stock_actual || 0));
  const minimo = Math.max(0, Number(insumo?.stock_minimo || 0));
  const referencia = Math.max(actual, minimo * 2, 1);
  return { porcentaje: Math.min(100, Math.round((actual / referencia) * 100)), minimo: Math.round((minimo / referencia) * 100) };
}

export function estaCaducado(insumo, hoy = new Date()) {
  if (!insumo?.fecha_caducidad) return false;
  return new Date(insumo.fecha_caducidad) < hoy;
}

export function requiereAtencion(insumo, hoy = new Date()) {
  return estadoStock(insumo) !== ESTADO_STOCK.BIEN || estaCaducado(insumo, hoy);
}

export function resumirInsumos(insumos = []) {
  const resumen = { total: insumos.length, bien: 0, bajo: 0, agotado: 0, categorias: new Set() };
  insumos.forEach((insumo) => {
    resumen[estadoStock(insumo)] += 1;
    if (insumo.tipo) resumen.categorias.add(insumo.tipo);
  });
  return { ...resumen, categorias: resumen.categorias.size };
}

export function filtrarOrdenarInsumos(insumos = [], { tipo = '', consulta = '', soloAtencion = false, hoy = new Date() } = {}) {
  const prioridad = { agotado: 0, bajo: 1, bien: 2 };
  const termino = consulta.trim().toLocaleLowerCase('es-MX');
  return insumos.filter((insumo) => {
    const estado = estadoStock(insumo);
    return (!tipo || insumo.tipo === tipo)
      && (!soloAtencion || requiereAtencion(insumo, hoy))
      && (!termino || `${insumo.nombre || ''} ${insumo.tipo || ''}`.toLocaleLowerCase('es-MX').includes(termino));
  }).sort((a, b) => prioridad[estadoStock(a)] - prioridad[estadoStock(b)] || String(a.nombre).localeCompare(String(b.nombre), 'es-MX'));
}
