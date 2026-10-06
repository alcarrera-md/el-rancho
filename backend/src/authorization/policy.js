const { autorizacion } = require('../errors');

const ROLES = Object.freeze({
  ADMINISTRADOR: 'Administrador',
  VETERINARIO: 'Veterinario',
  TRABAJADOR: 'Trabajador',
  AUDITOR: 'Auditor',
});

const A = ROLES.ADMINISTRADOR;
const V = ROLES.VETERINARIO;
const T = ROLES.TRABAJADOR;
const U = ROLES.AUDITOR;
const TODOS = Object.freeze([A, V, T, U]);

// Esta es la única matriz de roles del backend. Las rutas se traducen a una
// acción semántica y nunca declaran listas de roles por separado.
const MATRIZ_PERMISOS = Object.freeze({
  alertas: { leer: TODOS, analizar: TODOS },
  alimentacion: { leer: TODOS, crear: [A, T], editar: [A, T], eliminar: [A, T] },
  asignaciones: { leer: TODOS, crear: [A], editar: [A], completar: [A, V, T], eliminar: [A] },
  animales: {
    leer: TODOS,
    crear: [A, T],
    editar: [A, T],
    baja: [A],
    reportar_observacion: [A, V, T],
    estado_clinico: [A, V],
  },
  asistente: { resumen: [A, V, T], conversar: TODOS },
  bitacora: { leer: [A, U], enviar_corte: [A] },
  calendario: { leer: TODOS },
  clima: { leer: TODOS },
  compras_animal: { leer: TODOS, crear: [A] },
  compras_insumo: { leer: TODOS, crear: [A] },
  condicion_corporal: { leer: TODOS, crear: [A, V, T], editar: [A, V, T], eliminar: [A, V, T] },
  configuracion: { leer: TODOS, ver_panel: [A, U], editar: [A] },
  apariencia: { leer: TODOS },
  perfil: { leer: TODOS, cambiar_password: TODOS },
  corrales: { leer: TODOS, crear: [A], editar: [A] },
  corte_diario_destinatarios: { leer: [A], crear: [A], eliminar: [A] },
  gastos_generales: { leer: TODOS, crear: [A], editar: [A], eliminar: [A] },
  genealogia: { leer: TODOS },
  insumos: { leer: TODOS, crear: [A], editar: [A] },
  modulos: { leer: TODOS, editar: [A] },
  notas_seguimiento: {
    leer: TODOS,
    crear: [A, V, T],
    eliminar: [A, V, T],
    eliminar_cualquiera: [A],
  },
  pesajes: { leer: TODOS, crear: [A, V, T], editar: [A, V, T], eliminar: [A, V, T] },
  planes_sanitarios: {
    leer: TODOS,
    crear: [A, V],
    editar: [A, V],
    eliminar_plan: [A],
    eliminar_item: [A, V],
    asignar: [A, V],
  },
  produccion_leche: { leer: TODOS, crear: [A, T], editar: [A, T], eliminar: [A, T] },
  razas: { leer: TODOS, crear: [A] },
  reportes: { leer: TODOS },
  reproduccion: { leer: TODOS, crear: [A, V], editar: [A, V] },
  costos_reproductivos: { leer: [A, U], crear: [A], editar: [A], eliminar: [A] },
  salud: { leer: TODOS, crear: [A, V], editar: [A, V], eliminar: [A, V] },
  sync: { leer: TODOS },
  terceros: { leer: TODOS, crear: [A], editar: [A] },
  trabajadores: { leer: [A], crear: [A], editar: [A] },
  usuarios: { leer: [A], crear: [A], editar: [A] },
  ventas: { leer: TODOS, crear: [A] },
});

const RECURSO_POR_RUTA = Object.freeze({
  'compras-animal': 'compras_animal',
  'compras-insumo': 'compras_insumo',
  'condicion-corporal': 'condicion_corporal',
  configuracion: 'configuracion',
  'corte-diario-destinatarios': 'corte_diario_destinatarios',
  'gastos-generales': 'gastos_generales',
  leche: 'produccion_leche',
  'notas-seguimiento': 'notas_seguimiento',
  'planes-sanitarios': 'planes_sanitarios',
  'produccion-leche': 'produccion_leche',
});

const ACCION_POR_METODO = Object.freeze({
  GET: 'leer',
  POST: 'crear',
  PATCH: 'editar',
  PUT: 'editar',
  DELETE: 'eliminar',
});

function rutaSinQuery(req) {
  return req.originalUrl.split('?')[0].replace(/^\/api\/?/, '');
}

function recursoDeRuta(ruta) {
  const segmento = ruta.split('/')[0];
  return RECURSO_POR_RUTA[segmento] || segmento.replaceAll('-', '_');
}

function accionEspecial(recurso, metodo, ruta, body = {}) {
  if (recurso === 'animales' && metodo === 'PATCH' && /\/baja$/.test(ruta)) return 'baja';
  if (recurso === 'animales' && metodo === 'PATCH' && /\/estado-salud$/.test(ruta)) {
    const soloObservacion = body.estado_salud === 'observacion'
      && !body.salud_diagnostico
      && !body.salud_tratamiento
      && !body.salud_fecha_inicio;
    return soloObservacion ? 'reportar_observacion' : 'estado_clinico';
  }
  if (recurso === 'alertas' && metodo === 'POST') return 'analizar';
  if (recurso === 'asignaciones' && metodo === 'PATCH' && /\/completar$/.test(ruta)) return 'completar';
  if (recurso === 'asistente' && metodo === 'POST' && /\/resumen-animal\//.test(ruta)) return 'resumen';
  if (recurso === 'asistente' && metodo === 'POST' && /\/chat$/.test(ruta)) return 'conversar';
  if (recurso === 'bitacora' && metodo === 'POST' && /\/corte-diario$/.test(ruta)) return 'enviar_corte';
  if (recurso === 'planes_sanitarios' && metodo === 'DELETE' && /\/items\//.test(ruta)) return 'eliminar_item';
  if (recurso === 'planes_sanitarios' && metodo === 'DELETE' && /\/asignaciones\//.test(ruta)) return 'asignar';
  if (recurso === 'planes_sanitarios' && metodo === 'DELETE') return 'eliminar_plan';
  if (recurso === 'planes_sanitarios' && metodo === 'POST' && /\/asignar$/.test(ruta)) return 'asignar';
  return null;
}

function resolverPermiso(req) {
  const ruta = rutaSinQuery(req);
  const recurso = recursoDeRuta(ruta);
  const accion = accionEspecial(recurso, req.method, ruta, req.body) || ACCION_POR_METODO[req.method];
  return { recurso, accion };
}

function tienePermiso(rol, recurso, accion) {
  return Boolean(accion && MATRIZ_PERMISOS[recurso]?.[accion]?.includes(rol));
}

function autorizarSolicitud(req, res, next) {
  if (!req.usuario) return next(autorizacion('No hay sesión activa.'));
  const permiso = resolverPermiso(req);
  if (!tienePermiso(req.usuario.rol, permiso.recurso, permiso.accion)) {
    return next(autorizacion('Tu rol no tiene permiso para realizar esta acción.'));
  }
  req.permiso = permiso;
  return next();
}

module.exports = { MATRIZ_PERMISOS, ROLES, autorizarSolicitud, resolverPermiso, tienePermiso };
