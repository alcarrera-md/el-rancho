export function totalAlertasActivas(resumen) {
  if (!resumen) return 0;
  return resumen.vacunas_proximas + resumen.stock_bajo + resumen.partos_proximos
    + resumen.corrales_casi_llenos + (resumen.plan_sanitario_pendiente || 0);
}

export function totalTareasActivas(resumen) {
  return resumen?.tareas_pendientes || 0;
}

const ESTADOS_TAREA_ACTIVA = new Set(['pendiente', 'en_progreso']);

export function actualizarResumenPorCambioTarea(resumen, estadoAnterior, estadoNuevo) {
  if (!resumen) return resumen;
  const eraActiva = ESTADOS_TAREA_ACTIVA.has(estadoAnterior);
  const seraActiva = ESTADOS_TAREA_ACTIVA.has(estadoNuevo);
  if (eraActiva === seraActiva) return resumen;

  return {
    ...resumen,
    tareas_pendientes: Math.max(0, totalTareasActivas(resumen) + (seraActiva ? 1 : -1)),
  };
}
