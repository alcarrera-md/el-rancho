import { formatearFechaHora, formatearFechaNegocio } from './formatoTiempo.js';
import { TIPO_OPERACION } from './colaOperaciones.js';

const INTENTO_POR_TIPO = Object.freeze({
  [TIPO_OPERACION.PESAJE]: 'Registrar un pesaje',
  [TIPO_OPERACION.NOTA]: 'Agregar una nota de seguimiento',
  [TIPO_OPERACION.OBSERVACION]: 'Reportar que un animal requiere revisión',
  [TIPO_OPERACION.COMPLETAR_TAREA]: 'Completar una tarea',
  [TIPO_OPERACION.ALIMENTACION]: 'Registrar alimentación',
  [TIPO_OPERACION.MOVIMIENTO]: 'Mover un animal',
  [TIPO_OPERACION.EVENTO_SALUD]: 'Registrar un evento sanitario',
  [TIPO_OPERACION.CONDICION_CORPORAL]: 'Registrar condición corporal',
});

export function entidadAmigable(operacion) {
  if (operacion?.contexto_publico?.entidad) return operacion.contexto_publico.entidad;
  if (operacion?.tipo === TIPO_OPERACION.COMPLETAR_TAREA) return 'Tarea asignada';
  if (operacion?.tipo === TIPO_OPERACION.OBSERVACION) return 'Animal seleccionado';
  if ([TIPO_OPERACION.PESAJE, TIPO_OPERACION.NOTA, TIPO_OPERACION.EVENTO_SALUD, TIPO_OPERACION.CONDICION_CORPORAL].includes(operacion?.tipo)) return 'Animal seleccionado';
  if (operacion?.tipo === TIPO_OPERACION.ALIMENTACION) return 'Alimento y destino seleccionados';
  if (operacion?.tipo === TIPO_OPERACION.MOVIMIENTO) return 'Animal y corrales seleccionados';
  return 'Registro de campo';
}

export function describirConflicto(operacion) {
  const code = operacion?.conflicto?.code;
  const cantidadAlimentacion = operacion?.tipo === TIPO_OPERACION.ALIMENTACION
    ? `${operacion.payload?.cantidad ?? 'la cantidad capturada'} ${operacion.payload?.unidad_medida || ''}`.trim()
    : null;
  const intento = cantidadAlimentacion
    ? `Registrar ${cantidadAlimentacion} de alimentación`
    : INTENTO_POR_TIPO[operacion?.tipo] || 'Enviar un cambio de campo';
  const base = {
    intento,
    entidad: entidadAmigable(operacion),
    cambio: 'La información disponible en El Rancho cambió desde que hiciste la captura.',
    motivo: 'Para proteger los datos, el cambio no se aplicó automáticamente.',
    siguiente: 'Revisa la información actual y vuelve a capturar solo si todavía corresponde.',
  };
  if (code === 'TAREA_CANCELADA') return { ...base, cambio: 'La tarea fue cancelada mientras estabas sin conexión.', motivo: 'Una tarea cancelada ya no puede marcarse como completada.' };
  if (code === 'TAREA_REASIGNADA') return { ...base, cambio: 'La tarea fue reasignada a otra persona.', motivo: 'La asignación actual ya no coincide con la que descargaste.' };
  if (code === 'TAREA_ALREADY_COMPLETED') return { ...base, cambio: 'Esta tarea ya fue completada mientras estabas sin conexión.', motivo: 'No es necesario enviar otra finalización.', siguiente: 'Revisa la tarea actual y descarta esta captura.' };
  if (code === 'TAREA_VERSION_CONFLICT') return { ...base, cambio: 'La tarea fue modificada después de tu última descarga.', motivo: 'La versión guardada en el dispositivo ya no es la vigente.' };
  if (code === 'ANIMAL_INACTIVO') return { ...base, cambio: 'El animal ya no está activo.', motivo: 'No se pueden agregar observaciones operativas a un animal inactivo.' };
  if (code === 'ANIMAL_CORRAL_CAMBIO') {
    const detalle = operacion?.conflicto?.details?.find((item) => item.field === 'corral_origen_id');
    const actual = detalle?.corral_actual ? ` Ahora aparece en ${detalle.corral_actual}.` : '';
    return { ...base, cambio: `El animal fue movido a otro corral.${actual}`, motivo: 'La ubicación actual ya no coincide con la que viste al capturar.' };
  }
  if (code === 'ANIMAL_VERSION_CONFLICT') return { ...base, cambio: 'El animal cambió después de tu última sincronización.', motivo: 'La versión actual ya no coincide con la observada al preparar el movimiento.' };
  if (code === 'CORRAL_SIN_CAPACIDAD') {
    const detalle = operacion?.conflicto?.details?.find((item) => item.field === 'corral_id');
    const ocupacion = Number.isFinite(Number(detalle?.actual)) && Number.isFinite(Number(detalle?.capacidad_actual))
      ? ` Actualmente tiene ${detalle.actual} de ${detalle.capacidad_actual} lugares ocupados.`
      : '';
    return { ...base, cambio: `El corral destino ya no tiene capacidad disponible.${ocupacion}`, motivo: 'Otro movimiento ocupó el espacio disponible antes de sincronizar.' };
  }
  if (code === 'CORRAL_INACTIVO') return { ...base, cambio: 'El corral destino fue desactivado.', motivo: 'No se puede mover un animal a un corral inactivo.' };
  if (code === 'CORRAL_DESTINO_IGUAL_ORIGEN') return { ...base, cambio: 'El animal ya se encuentra en el destino seleccionado.', motivo: 'No es necesario crear otro movimiento.' };
  if (code === 'INSUMO_VERSION_CONFLICT') {
    const detalle = operacion?.conflicto?.details?.find((item) => item.field === 'stock_actual');
    const existencias = detalle && Number.isFinite(Number(detalle.actual))
      ? ` El servidor registra ${detalle.actual} ${detalle.unidad_medida || ''}.`.trimEnd()
      : '';
    return { ...base, cambio: `El stock del alimento cambió mientras estabas sin conexión.${existencias}`, motivo: 'La existencia y versión actuales ya no coinciden con las que viste al capturar.' };
  }
  if (code === 'STOCK_INSUFICIENTE') {
    const detalle = operacion?.conflicto?.details?.find((item) => item.field === 'cantidad');
    const unidad = detalle?.unidad_medida || '';
    const disponible = detalle && Number.isFinite(Number(detalle.disponible ?? detalle.actual)) ? ` Quedan ${detalle.disponible ?? detalle.actual} ${unidad}`.trimEnd() : '';
    const requerido = detalle && Number.isFinite(Number(detalle.requerido)) ? ` y la captura necesita ${detalle.requerido} ${unidad}`.trimEnd() : '';
    const insumo = detalle?.insumo ? ` de ${detalle.insumo}` : '';
    return { ...base, cambio: `Ya no hay alimento suficiente${insumo}.${disponible}${requerido}${disponible || requerido ? '.' : ''}`, motivo: 'Otro consumo redujo las existencias antes de que esta captura llegara al servidor.' };
  }
  if (code === 'INSUMO_CADUCADO') return { ...base, cambio: 'El alimento aparece como caducado.', motivo: 'Un insumo caducado no puede descontarse ni registrarse.' };
  if (code === 'INSUMO_INACTIVO') return { ...base, cambio: 'El alimento fue desactivado.', motivo: 'Un insumo inactivo ya no puede utilizarse en nuevas alimentaciones.' };
  if (code === 'INSUMO_UNIDAD_CAMBIO') return { ...base, cambio: 'Cambió la unidad de medida del alimento.', motivo: 'La cantidad capturada ya no puede interpretarse con seguridad.' };
  if (code === 'ANIMAL_DADO_DE_BAJA') {
    const detalle = operacion?.conflicto?.details?.find((item) => item.field === 'fecha');
    const estado = { vendido: 'vendido', muerto: 'registrado como muerto', sacrificado: 'sacrificado' }[detalle?.estado] || 'dado de baja';
    const baja = formatearFechaNegocio(detalle?.fecha_baja);
    const evento = formatearFechaNegocio(detalle?.fecha_evento);
    return {
      ...base,
      cambio: `El animal fue ${estado}${baja ? ` el ${baja}` : ''} mientras estabas sin conexión.`,
      motivo: `Este registro tiene fecha ${evento || 'posterior'}, después de la baja; solo se aceptan registros de esa fecha o anteriores.`,
      siguiente: 'Si la fecha capturada era incorrecta, vuelve a capturarlo con la fecha real; si no, descártalo.',
    };
  }
  if (code === 'DEPENDENCIA_NO_APLICADA') return { ...base, cambio: 'Esta captura dependía de otra que no llegó a El Rancho.', motivo: 'El registro anterior fue descartado o quedó en conflicto.', siguiente: 'Revisa primero el registro anterior y vuelve a capturar si todavía corresponde.' };
  if (code === 'FORBIDDEN' || operacion?.conflicto?.status === 403) return { ...base, cambio: 'Tu rol o tus permisos cambiaron.', motivo: 'Tu cuenta ya no permite realizar esta acción.', siguiente: 'Consulta con un administrador antes de volver a intentarlo.' };
  if (operacion?.conflicto?.status === 404) return { ...base, cambio: 'El registro ya no está disponible.', motivo: 'El elemento relacionado fue eliminado o ya no puede consultarse.' };
  return base;
}

export function rutaParaVolverACapturar(operacion) {
  if (!operacion?.entidad_id) return null;
  if (operacion.tipo === TIPO_OPERACION.COMPLETAR_TAREA) return `/tareas?tarea=${encodeURIComponent(operacion.entidad_id)}`;
  const accion = {
    [TIPO_OPERACION.PESAJE]: 'pesaje',
    [TIPO_OPERACION.NOTA]: 'nota',
    [TIPO_OPERACION.OBSERVACION]: 'observacion',
    [TIPO_OPERACION.ALIMENTACION]: 'alimentacion',
    [TIPO_OPERACION.MOVIMIENTO]: 'mover',
    [TIPO_OPERACION.EVENTO_SALUD]: 'salud',
    [TIPO_OPERACION.CONDICION_CORPORAL]: 'condicion',
  }[operacion.tipo];
  return accion ? `/animales/${encodeURIComponent(operacion.entidad_id)}/seguimiento?accion=${accion}` : null;
}

const plural = (n, singular, pluralTexto) => `${n} ${n === 1 ? singular : pluralTexto}`;

/**
 * Estado compacto para la esquina de la pantalla (P8.2). Sin conexión
 * siempre dice desde cuándo son los datos; con conexión solo aparece si hay
 * algo que atender, para no llenar cada pantalla de avisos.
 */
export function resumenEstadoCompacto({ conectividad, cola, ultimaSincronizacion, preparacionOffline = null }) {
  const pendientes = (cola?.pendientes || 0) + (cola?.bloqueadas || 0) + (cola?.errores || 0);
  const conflictos = cola?.conflictos?.length || 0;
  if (conectividad === 'offline') {
    const fecha = formatearFechaHora(ultimaSincronizacion);
    const partes = [fecha ? `Última sincronización: ${fecha}` : null, pendientes ? plural(pendientes, 'cambio pendiente', 'cambios pendientes') : null, conflictos ? plural(conflictos, 'conflicto', 'conflictos') : null].filter(Boolean);
    return { offline: { titulo: 'Trabajando offline', detalle: partes.join(' · ') || null }, chip: null };
  }
  // Si el snapshot no se pudo guardar, perder la conexión dejaría al usuario
  // sin datos: se avisa mientras todavía hay conexión para reintentar.
  if (preparacionOffline && preparacionOffline.ok === false) return { offline: null, chip: { clave: 'conflicto', texto: 'Modo sin conexión no preparado' } };
  if (conflictos) return { offline: null, chip: { clave: 'conflicto', texto: `${plural(conflictos, 'conflicto requiere', 'conflictos requieren')} atención` } };
  if (cola?.progreso?.activo) return { offline: null, chip: { clave: 'sincronizando', texto: 'Sincronizando…' } };
  if (pendientes) return { offline: null, chip: { clave: 'pendiente', texto: plural(pendientes, 'cambio pendiente', 'cambios pendientes') } };
  return { offline: null, chip: null };
}

export function estadoGeneralSincronizacion({ conectividad, autenticacion, estado }) {
  const conflictos = estado?.conflictos?.length || 0;
  const pendientes = estado?.pendientes || 0;
  const errores = estado?.errores || 0;
  const progreso = estado?.progreso;
  if (conflictos) return { clave: 'conflicto', titulo: `${conflictos} conflicto${conflictos === 1 ? '' : 's'} necesita${conflictos === 1 ? '' : 'n'} revisión`, detalle: 'Tus datos no fueron sobrescritos.' };
  if (autenticacion === 'offline_session_expired' || autenticacion === 'unauthenticated') return { clave: 'sesion', titulo: 'Sesión necesaria para sincronizar', detalle: 'Inicia sesión con la misma cuenta para continuar.' };
  if (conectividad === 'offline') return { clave: 'offline', titulo: pendientes ? `Sin conexión · ${pendientes} pendiente${pendientes === 1 ? '' : 's'}` : 'Sin conexión', detalle: 'Las capturas permanecen en este dispositivo.' };
  if (progreso?.activo) return { clave: 'sincronizando', titulo: `Sincronizando ${progreso.actual} de ${progreso.total}`, detalle: 'Mantén abierta la aplicación unos instantes.' };
  const bloqueadas = estado?.bloqueadas || 0;
  if (bloqueadas && !pendientes) return { clave: 'bloqueada', titulo: `${bloqueadas} cambio${bloqueadas === 1 ? '' : 's'} en espera de revisión`, detalle: 'Dependen de un registro que necesita atención.' };
  if (errores) return { clave: 'error', titulo: `${errores} cambio${errores === 1 ? '' : 's'} necesita${errores === 1 ? '' : 'n'} reintento`, detalle: 'La captura sigue guardada.' };
  if (pendientes) return { clave: 'pendiente', titulo: `${pendientes} cambio${pendientes === 1 ? '' : 's'} pendiente${pendientes === 1 ? '' : 's'}`, detalle: 'Se enviarán en orden.' };
  return { clave: 'listo', titulo: 'Todo al día', detalle: 'No hay cambios pendientes.' };
}
