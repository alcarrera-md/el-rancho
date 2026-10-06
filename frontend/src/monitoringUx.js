const ORDEN_SALUD = Object.freeze({ enfermo: 0, observacion: 1, sano: 2 });

export function exigirListaModulo(valor, endpoint) {
  if (Array.isArray(valor)) return valor;
  const tipoRecibido = valor === null ? 'null' : typeof valor;
  const error = new TypeError(`Respuesta inesperada de ${endpoint}: se esperaba una lista y se recibió ${tipoRecibido}.`);
  error.code = 'INVALID_RESPONSE';
  error.ruta = endpoint;
  throw error;
}

export function nivelAtencionAnimal(animal) {
  if (animal?.estado_salud === 'enfermo') return 'alerta';
  if (animal?.estado_salud === 'observacion') return 'observacion';
  return 'estable';
}

export function resumirSeguimiento(animales = []) {
  return animales.reduce((resumen, animal) => {
    resumen.total += 1;
    resumen[nivelAtencionAnimal(animal)] += 1;
    if (!animal.corral_actual) resumen.sinCorral += 1;
    if (!animal.ultimo_peso_kg) resumen.sinPesaje += 1;
    return resumen;
  }, { total: 0, alerta: 0, observacion: 0, estable: 0, sinCorral: 0, sinPesaje: 0 });
}

export function filtrarSeguimiento(animales = [], { consulta = '', vista = 'todos' } = {}) {
  const termino = consulta.trim().toLocaleLowerCase('es-MX');
  return [...animales]
    .filter((animal) => vista === 'todos' || nivelAtencionAnimal(animal) === vista)
    .filter((animal) => !termino || [animal.arete_id, animal.nombre_alias, animal.corral_actual, animal.raza]
      .some((valor) => String(valor || '').toLocaleLowerCase('es-MX').includes(termino)))
    .sort((a, b) => {
      const prioridad = (ORDEN_SALUD[a.estado_salud] ?? 9) - (ORDEN_SALUD[b.estado_salud] ?? 9);
      return prioridad || String(a.arete_id).localeCompare(String(b.arete_id), 'es-MX');
    });
}

export function estadoOperativoCorral(corral, umbralCasiLleno = 90) {
  const ocupacion = Number(corral?.ocupacion_actual) || 0;
  const capacidad = Number(corral?.capacidad_maxima) || 0;
  const porcentaje = capacidad > 0 ? Math.min(100, (ocupacion / capacidad) * 100) : 0;

  if (Number(corral?.enfermos) > 0) return { id: 'alerta', texto: 'Revisar salud', prioridad: 0, porcentaje };
  if (porcentaje >= 100) return { id: 'lleno', texto: 'Capacidad completa', prioridad: 1, porcentaje };
  if (porcentaje >= umbralCasiLleno) return { id: 'limite', texto: 'Cerca del límite', prioridad: 2, porcentaje };
  if (Number(corral?.en_observacion) > 0) return { id: 'observacion', texto: 'Con observación', prioridad: 3, porcentaje };
  return { id: 'normal', texto: 'Operación normal', prioridad: 4, porcentaje };
}

export function ordenarCorrales(corrales = [], umbralCasiLleno = 90) {
  return [...corrales].sort((a, b) => {
    const estadoA = estadoOperativoCorral(a, umbralCasiLleno);
    const estadoB = estadoOperativoCorral(b, umbralCasiLleno);
    return estadoA.prioridad - estadoB.prioridad || estadoB.porcentaje - estadoA.porcentaje;
  });
}

export function resumirCorrales(corrales = [], umbralCasiLleno = 90) {
  return corrales.reduce((resumen, corral) => {
    const estado = estadoOperativoCorral(corral, umbralCasiLleno);
    resumen.corrales += 1;
    resumen.animales += Number(corral.ocupacion_actual) || 0;
    resumen.capacidad += Number(corral.capacidad_maxima) || 0;
    resumen.alertas += ['alerta', 'lleno', 'limite'].includes(estado.id) ? 1 : 0;
    resumen.observacion += Number(corral.en_observacion) || 0;
    return resumen;
  }, { corrales: 0, animales: 0, capacidad: 0, alertas: 0, observacion: 0 });
}
