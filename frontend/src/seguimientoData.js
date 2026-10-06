function listaHistorica(valor, campo) {
  if (valor == null) return [];
  if (Array.isArray(valor)) return valor;
  const error = new TypeError(`Respuesta inesperada de /api/animales/:id/historial: ${campo} debe ser una lista.`);
  error.code = 'INVALID_RESPONSE';
  error.ruta = '/api/animales/:id/historial';
  throw error;
}

export function normalizarExpedienteAnimal(valor) {
  if (!valor || typeof valor !== 'object' || !valor.animal || typeof valor.animal !== 'object') {
    const error = new TypeError('Respuesta inesperada de /api/animales/:id/historial: falta el animal.');
    error.code = 'INVALID_RESPONSE';
    error.ruta = '/api/animales/:id/historial';
    throw error;
  }

  const timeline = listaHistorica(valor.timeline, 'timeline').map((evento) => ({
    ...evento,
    detalle: evento?.detalle && typeof evento.detalle === 'object' ? evento.detalle : {},
  }));

  return {
    ...valor,
    resumen: {
      total_pesajes: 0,
      total_eventos_salud: 0,
      total_eventos_reproductivos: 0,
      ultimo_peso: null,
      ...(valor.resumen && typeof valor.resumen === 'object' ? valor.resumen : {}),
    },
    recomendaciones: listaHistorica(valor.recomendaciones, 'recomendaciones'),
    timeline,
    crias: listaHistorica(valor.crias, 'crias'),
    notas: listaHistorica(valor.notas, 'notas'),
    plan_sanitario: listaHistorica(valor.plan_sanitario, 'plan_sanitario'),
  };
}
