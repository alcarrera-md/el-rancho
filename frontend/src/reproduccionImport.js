export const CAMPOS_REPRODUCCION_EXCEL = Object.freeze([
  ['arete_vaca', 'Arete vaca'], ['arete_toro', 'Arete toro'],
  ['fecha_servicio', 'Fecha servicio'], ['tipo_servicio', 'Tipo servicio'],
  ['fecha_diagnostico', 'Fecha diagnóstico'], ['metodo', 'Método'],
  ['resultado_diagnostico', 'Resultado diagnóstico'], ['fecha_parto', 'Fecha parto'],
  ['resultado_parto', 'Resultado parto'], ['observaciones', 'Observaciones'],
]);

const ALIAS = Object.freeze({
  arete_vaca: ['arete_vaca', 'arete', 'vaca', 'identificacion_vaca'],
  arete_toro: ['arete_toro', 'toro', 'padre', 'semental'],
  fecha_servicio: ['fecha_servicio', 'fecha_monta', 'monta', 'servicio'],
  tipo_servicio: ['tipo_servicio', 'tipo_monta', 'tipo'],
  fecha_diagnostico: ['fecha_diagnostico', 'fecha_palpacion', 'palpacion'],
  metodo: ['metodo', 'metodo_diagnostico'],
  resultado_diagnostico: ['resultado_diagnostico', 'resultado_palpacion', 'diagnostico'],
  fecha_parto: ['fecha_parto', 'parto'],
  resultado_parto: ['resultado_parto', 'tipo_parto'],
  observaciones: ['observaciones', 'observacion', 'notas', 'comentarios'],
});

function clave(valor) {
  return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export function sugerirMapeoReproductivo(encabezados) {
  const usados = new Set(); const mapeo = {};
  for (const [campo] of CAMPOS_REPRODUCCION_EXCEL) {
    const indice = encabezados.findIndex((encabezado, i) => !usados.has(i) && ALIAS[campo].includes(clave(encabezado)));
    if (indice >= 0) { mapeo[campo] = String(indice); usados.add(indice); }
    else mapeo[campo] = '';
  }
  return mapeo;
}

export function normalizarFilasReproductivas(filas, mapeo, fechaATexto = (valor) => String(valor ?? '').trim()) {
  const indice = (campo) => mapeo[campo] === '' || mapeo[campo] === undefined ? -1 : Number(mapeo[campo]);
  const valor = (fila, campo) => indice(campo) < 0 ? '' : fila[indice(campo)];
  const fecha = (fila, campo) => fechaATexto(valor(fila, campo));
  return filas.map((fila, posicion) => ({
    fila: posicion + 2,
    arete_vaca: String(valor(fila, 'arete_vaca') ?? '').trim(),
    arete_toro: String(valor(fila, 'arete_toro') ?? '').trim(),
    fecha_servicio: fecha(fila, 'fecha_servicio'),
    tipo_servicio: String(valor(fila, 'tipo_servicio') ?? '').trim(),
    fecha_diagnostico: fecha(fila, 'fecha_diagnostico'),
    metodo: String(valor(fila, 'metodo') ?? '').trim(),
    resultado_diagnostico: String(valor(fila, 'resultado_diagnostico') ?? '').trim(),
    fecha_parto: fecha(fila, 'fecha_parto'),
    resultado_parto: String(valor(fila, 'resultado_parto') ?? '').trim(),
    observaciones: String(valor(fila, 'observaciones') ?? '').trim(),
  }));
}

export function nuevoIdLote() {
  return globalThis.crypto?.randomUUID?.() || '00000000-0000-4000-8000-000000000000';
}
