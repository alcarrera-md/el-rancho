export const ROLES = Object.freeze({
  ADMINISTRADOR: 'Administrador',
  VETERINARIO: 'Veterinario',
  TRABAJADOR: 'Trabajador',
  AUDITOR: 'Auditor',
});

const { ADMINISTRADOR: A, VETERINARIO: V, TRABAJADOR: T, AUDITOR: U } = ROLES;
const TODOS = [A, V, T, U];

// Es el espejo de presentación de backend/src/authorization/policy.js.
// El backend continúa siendo la autoridad; esta matriz evita ofrecer acciones
// que la API rechazará y mantiene una sola fuente de verdad dentro del frontend.
export const MATRIZ_PERMISOS = Object.freeze({
  animales: { leer: TODOS, crear: [A, T], editar: [A, T], baja: [A], reportar_observacion: [A, V, T], estado_clinico: [A, V] },
  salud: { leer: TODOS, crear: [A, V], editar: [A, V], eliminar: [A, V] },
  reproduccion: { leer: TODOS, crear: [A, V], editar: [A, V] },
  costos_reproductivos: { leer: [A, U], crear: [A], editar: [A], eliminar: [A] },
  sync: { leer: TODOS },
  alimentacion: { leer: TODOS, crear: [A, T], editar: [A, T], eliminar: [A, T] },
  pesajes: { leer: TODOS, crear: [A, V, T], editar: [A, V, T], eliminar: [A, V, T] },
  condicion_corporal: { leer: TODOS, crear: [A, V, T], editar: [A, V, T], eliminar: [A, V, T] },
  produccion_leche: { leer: TODOS, crear: [A, T], editar: [A, T], eliminar: [A, T] },
  corrales: { leer: TODOS, crear: [A], editar: [A] },
  insumos: { leer: TODOS, crear: [A], editar: [A] },
  razas: { leer: TODOS, crear: [A] },
  planes_sanitarios: { leer: TODOS, crear: [A, V], editar: [A, V], eliminar_plan: [A], eliminar_item: [A, V], asignar: [A, V] },
  ventas: { leer: TODOS, crear: [A] },
  compras_animal: { leer: TODOS, crear: [A] },
  compras_insumo: { leer: TODOS, crear: [A] },
  gastos_generales: { leer: TODOS, crear: [A], editar: [A], eliminar: [A] },
  terceros: { leer: TODOS, crear: [A], editar: [A] },
  asignaciones: { leer: TODOS, crear: [A], editar: [A], completar: [A, V, T], eliminar: [A] },
  notas_seguimiento: { leer: TODOS, crear: [A, V, T], eliminar: [A, V, T], eliminar_cualquiera: [A] },
  trabajadores: { leer: [A], crear: [A], editar: [A] },
  usuarios: { leer: [A], crear: [A], editar: [A] },
  bitacora: { leer: [A, U], enviar_corte: [A] },
  calendario: { leer: TODOS },
  clima: { leer: TODOS },
  configuracion: { leer: TODOS, ver_panel: [A, U], editar: [A] },
  apariencia: { leer: TODOS },
  perfil: { leer: TODOS, cambiar_password: TODOS },
  genealogia: { leer: TODOS },
  modulos: { leer: TODOS, editar: [A] },
  corte_diario_destinatarios: { leer: [A], crear: [A], eliminar: [A] },
  reportes: { leer: TODOS },
  alertas: { leer: TODOS, analizar: TODOS },
  asistente: { resumen: [A, V, T], conversar: TODOS },
});

export function tienePermiso(rol, recurso, accion) {
  return Boolean(rol && MATRIZ_PERMISOS[recurso]?.[accion]?.includes(rol));
}

const PERMISO_POR_VISTA = Object.freeze({
  inicio: ['reportes', 'leer'],
  animales: ['animales', 'leer'],
  seguimiento: ['animales', 'leer'],
  corrales: ['corrales', 'leer'],
  'planes-sanitarios': ['salud', 'leer'],
  reproduccion: ['reproduccion', 'leer'],
  alimentacion: ['alimentacion', 'leer'],
  movimientos: ['corrales', 'leer'],
  pesajes: ['pesajes', 'leer'],
  alertas: ['alertas', 'leer'],
  calendario: ['calendario', 'leer'],
  insumos: ['insumos', 'leer'],
  tareas: ['asignaciones', 'leer'],
  listas: ['reportes', 'leer'],
  trabajadores: ['trabajadores', 'leer'],
  usuarios: ['usuarios', 'leer'],
  terceros: ['terceros', 'leer'],
  ventas: ['ventas', 'leer'],
  compras: ['compras_animal', 'leer'],
  gastos: ['gastos_generales', 'leer'],
  finanzas: ['reportes', 'leer'],
  rentabilidad: ['reportes', 'leer'],
  reportes: ['reportes', 'leer'],
  bitacora: ['bitacora', 'leer'],
  configuracion: ['configuracion', 'ver_panel'],
  sincronizacion: ['sync', 'leer'],
  apariencia: ['apariencia', 'leer'],
  perfil: ['perfil', 'leer'],
});

export function puedeVerVista(rol, vista) {
  if (vista === 'lote') {
    return tienePermiso(rol, 'pesajes', 'crear')
      || tienePermiso(rol, 'salud', 'crear')
      || tienePermiso(rol, 'alimentacion', 'crear')
      || tienePermiso(rol, 'ventas', 'crear');
  }
  const permiso = PERMISO_POR_VISTA[vista];
  return Boolean(permiso && tienePermiso(rol, permiso[0], permiso[1]));
}

export function puedeEliminarNota(rol, usuarioId, autorId) {
  if (!tienePermiso(rol, 'notas_seguimiento', 'eliminar')) return false;
  return tienePermiso(rol, 'notas_seguimiento', 'eliminar_cualquiera') || String(usuarioId) === String(autorId);
}
