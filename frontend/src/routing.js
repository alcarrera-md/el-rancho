import { puedeVerVista } from './authorization/permissions.js';
export { crearRutaContextual, leerIdContexto } from './navigationContext.js';

export const RUTA_POR_VISTA = Object.freeze({
  inicio: '/', alertas: '/alertas', tareas: '/tareas', calendario: '/calendario',
  animales: '/animales', seguimiento: '/seguimiento', corrales: '/corrales', movimientos: '/movimientos',
  'planes-sanitarios': '/salud', reproduccion: '/reproduccion', alimentacion: '/alimentacion',
  pesajes: '/pesajes', insumos: '/insumos', lote: '/trabajo-por-lote', ventas: '/ventas',
  compras: '/compras', gastos: '/gastos', finanzas: '/finanzas', rentabilidad: '/rentabilidad',
  reportes: '/reportes', listas: '/listas', terceros: '/terceros', trabajadores: '/trabajadores',
  usuarios: '/usuarios', bitacora: '/bitacora', configuracion: '/configuracion', sincronizacion: '/configuracion/sincronizacion', perfil: '/perfil',
});

const VISTA_POR_RUTA = Object.freeze(Object.fromEntries(Object.entries(RUTA_POR_VISTA).map(([vista, ruta]) => [ruta, vista])));

export function normalizarRuta(pathname = '/') {
  if (pathname === '/') return '/';
  return `/${pathname.split('/').filter(Boolean).join('/')}`;
}

export function rutaParaVista(vista) {
  return RUTA_POR_VISTA[vista] || '/';
}

export function rutaSeguimientoAnimal(id) {
  return `/animales/${encodeURIComponent(id)}/seguimiento`;
}

export function vistaParaRuta(pathname) {
  const ruta = normalizarRuta(pathname);
  if (/^\/animales\/\d+(?:\/seguimiento)?$/.test(ruta)) return 'seguimiento';
  if (ruta === '/configuracion/apariencia') return 'apariencia';
  if (ruta === '/configuracion/sincronizacion') return 'sincronizacion';
  if (/^\/configuracion\/(?:sistema|datos|notificaciones|avanzado)$/.test(ruta)) return 'configuracion';
  return VISTA_POR_RUTA[ruta] || null;
}

export function evaluarAccesoRuta(rol, pathname) {
  const vista = vistaParaRuta(pathname);
  if (!vista) return { estado: 'no_encontrada', vista: null };
  return { estado: puedeVerVista(rol, vista) ? 'permitida' : 'denegada', vista };
}

export function obtenerAreteLegacy(search = '') {
  return new URLSearchParams(search).get('animal')?.trim() || null;
}

export function esAnimalNoEncontrado(error) {
  return error?.status === 404 || error?.code === 'ANIMAL_NO_ENCONTRADO';
}

export const RUTA_DESPUES_LOGOUT = '/';
