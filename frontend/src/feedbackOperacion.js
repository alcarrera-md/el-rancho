export const EVENTO_FEEDBACK_OPERACION = 'feedback:operacion';
export const DURACION_FEEDBACK_OPERACION = 3800;

let siguienteId = 0;

export function normalizarFeedbackOperacion(detalle, tipo = 'exito') {
  const entrada = typeof detalle === 'string' ? { titulo: detalle } : (detalle || {});
  return {
    id: entrada.id || `feedback-${Date.now()}-${++siguienteId}`,
    tipo,
    titulo: entrada.titulo || (tipo === 'error' ? 'No se pudo completar' : 'Operación confirmada'),
    mensaje: entrada.mensaje || '',
    duracion: entrada.duracion ?? DURACION_FEEDBACK_OPERACION,
  };
}

export function notificarFeedbackOperacion(detalle, tipo = 'exito') {
  const feedback = normalizarFeedbackOperacion(detalle, tipo);
  window.dispatchEvent(new CustomEvent(EVENTO_FEEDBACK_OPERACION, { detail: feedback }));
  return feedback;
}

export function mostrarExito(detalle) {
  return notificarFeedbackOperacion(detalle, 'exito');
}

export function mostrarError(detalle) {
  return notificarFeedbackOperacion(detalle, 'error');
}

export function detalleMovimientoConfirmado(animal, movimiento) {
  const nombre = animal?.nombre_alias || animal?.arete_id || movimiento?.arete_id || 'El animal';
  const participio = animal?.sexo === 'hembra' ? 'trasladada' : 'trasladado';
  const origen = movimiento?.corral_origen || 'sin corral anterior';
  const destino = movimiento?.corral_destino || 'el corral seleccionado';
  return {
    titulo: 'Movimiento registrado',
    mensaje: `${nombre} fue ${participio} de ${origen} a ${destino}. La información visible ya está actualizada.`,
  };
}
