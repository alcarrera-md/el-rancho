export function calcularPanoramaEconomico(finanzas) {
  if (!finanzas) return null;
  const ingresos = Number(finanzas.ingresos?.total || 0);
  const costos = Number(finanzas.gastos?.total || 0);
  const resultado = Number(finanzas.utilidad_neta || 0);
  const margen = ingresos > 0 ? Number(((resultado / ingresos) * 100).toFixed(1)) : null;
  const conceptosIngreso = [
    { id: 'ventas', etiqueta: 'Ventas de animales', valor: Number(finanzas.ingresos?.ventas || 0), destino: '/ventas' },
    { id: 'leche', etiqueta: 'Producción de leche', valor: Number(finanzas.ingresos?.leche || 0), destino: null },
  ];
  const conceptosCosto = [
    { id: 'insumos', etiqueta: 'Compras de insumos', valor: Number(finanzas.gastos?.insumos || 0), destino: '/compras' },
    { id: 'animales', etiqueta: 'Compra de animales', valor: Number(finanzas.gastos?.animales || 0), destino: '/compras' },
    { id: 'generales', etiqueta: 'Gastos generales', valor: Number(finanzas.gastos?.generales || 0), destino: '/gastos' },
  ];
  const mayorIngreso = [...conceptosIngreso].sort((a, b) => b.valor - a.valor)[0];
  const mayorCosto = [...conceptosCosto].sort((a, b) => b.valor - a.valor)[0];
  return { ingresos, costos, resultado, margen, conceptosIngreso, conceptosCosto, mayorIngreso, mayorCosto };
}

export function filtrarRentabilidadAnimales(animales = [], { estado = '', consulta = '' } = {}) {
  const termino = consulta.trim().toLocaleLowerCase('es-MX');
  return animales.filter((animal) => {
    if (estado && animal.estado !== estado) return false;
    if (!termino) return true;
    return `${animal.arete_id || ''} ${animal.nombre_alias || ''}`.toLocaleLowerCase('es-MX').includes(termino);
  });
}

export function margenAnimal(animal) {
  const ingreso = Number(animal?.ingreso_total || 0);
  return ingreso > 0 ? Number(((Number(animal.neto || 0) / ingreso) * 100).toFixed(1)) : null;
}
