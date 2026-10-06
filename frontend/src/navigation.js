import { puedeVerVista } from './authorization/permissions.js';

export const GRUPOS_NAVEGACION = Object.freeze([
  {
    id: 'hoy',
    titulo: 'Hoy',
    siempreAbierto: true,
    items: [
      { id: 'inicio', label: 'Inicio' },
      { id: 'alertas', label: 'Alertas' },
      { id: 'tareas', label: 'Tareas' },
      { id: 'calendario', label: 'Calendario', moduloClave: 'calendario' },
    ],
  },
  {
    id: 'ganado',
    titulo: 'Ganado',
    items: [
      { id: 'animales', label: 'Animales' },
      { id: 'seguimiento', label: 'Seguimiento' },
      { id: 'corrales', label: 'Lotes y corrales' },
      { id: 'movimientos', label: 'Movimientos' },
    ],
  },
  {
    id: 'manejo',
    titulo: 'Manejo del hato',
    items: [
      { id: 'planes-sanitarios', label: 'Sanidad', moduloClave: 'planes-sanitarios' },
      { id: 'reproduccion', label: 'Reproducción' },
      { id: 'alimentacion', label: 'Alimentación' },
      { id: 'pesajes', label: 'Pesajes' },
      { id: 'insumos', label: 'Insumos' },
      { id: 'lote', label: 'Trabajo por lote', moduloClave: 'lote' },
    ],
  },
  {
    id: 'negocio',
    titulo: 'Negocio',
    items: [
      { id: 'ventas', label: 'Ventas' },
      { id: 'compras', label: 'Compras' },
      { id: 'gastos', label: 'Gastos generales', moduloClave: 'gastos' },
      { id: 'finanzas', label: 'Finanzas', moduloClave: 'finanzas' },
      { id: 'rentabilidad', label: 'Rentabilidad' },
      { id: 'reportes', label: 'Reportes' },
      { id: 'listas', label: 'Listas imprimibles', moduloClave: 'listas' },
      { id: 'terceros', label: 'Proveedores y compradores' },
    ],
  },
  {
    id: 'cuenta',
    titulo: 'Cuenta',
    items: [
      { id: 'perfil', label: 'Mi perfil' },
    ],
  },
  {
    id: 'administracion',
    titulo: 'Administración',
    items: [
      { id: 'trabajadores', label: 'Trabajadores' },
      { id: 'usuarios', label: 'Usuarios' },
      { id: 'bitacora', label: 'Bitácora' },
      { id: 'configuracion', label: 'Configuración' },
    ],
  },
]);

export function gruposVisibles(rol, moduloActivo = () => true) {
  return GRUPOS_NAVEGACION.map((grupo) => ({
    ...grupo,
    items: grupo.items.filter((item) => puedeVerVista(rol, item.id)
      && (!item.moduloClave || moduloActivo(item.moduloClave))),
  })).filter((grupo) => grupo.items.length > 0);
}

export function etiquetaVista(vista) {
  if (vista === 'apariencia') return 'Apariencia';
  for (const grupo of GRUPOS_NAVEGACION) {
    const item = grupo.items.find((candidato) => candidato.id === vista);
    if (item) return item.label;
  }
  return 'Inicio';
}
