import { cargarModuloDiferido } from './lazyLoading.js';

const cargarVista = (clave, cargar) => () => cargarModuloDiferido(clave, cargar);
// Los cargadores conservan imports literales para que Vite pueda invalidarlos mediante HMR.

// Un cargador por vista de primer nivel. Los imports son literales para que Vite
// pueda generar chunks estables y cada permiso se evalúe antes de montar la vista.
export const CARGADORES_VISTAS = Object.freeze({
  inicio: cargarVista('inicio', () => import('./components/Dashboard.jsx')),
  animales: cargarVista('animales', () => import('./components/AnimalesList.jsx')),
  seguimiento: cargarVista('seguimiento', () => import('./components/SeguimientoList.jsx')),
  corrales: cargarVista('corrales', () => import('./components/CorralesList.jsx')),
  movimientos: cargarVista('movimientos', () => import('./components/Movimientos.jsx')),
  'planes-sanitarios': cargarVista('planes-sanitarios', () => import('./components/Sanidad.jsx')),
  reproduccion: cargarVista('reproduccion', () => import('./components/Reproduccion.jsx')),
  alimentacion: cargarVista('alimentacion', () => import('./components/Alimentacion.jsx')),
  pesajes: cargarVista('pesajes', () => import('./components/Pesajes.jsx')),
  insumos: cargarVista('insumos', () => import('./components/InsumosList.jsx')),
  lote: cargarVista('lote', () => import('./components/TrabajoPorLote.jsx')),
  ventas: cargarVista('ventas', () => import('./components/VentasReporte.jsx')),
  compras: cargarVista('compras', () => import('./components/ComprasList.jsx')),
  gastos: cargarVista('gastos', () => import('./components/GastosGenerales.jsx')),
  finanzas: cargarVista('finanzas', () => import('./components/Finanzas.jsx')),
  rentabilidad: cargarVista('rentabilidad', () => import('./components/RentabilidadReporte.jsx')),
  reportes: cargarVista('reportes', () => import('./components/ReportesGenerales.jsx')),
  tareas: cargarVista('tareas', () => import('./components/TareasList.jsx')),
  calendario: cargarVista('calendario', () => import('./components/Calendario.jsx')),
  listas: cargarVista('listas', () => import('./components/ListasImprimibles.jsx')),
  alertas: cargarVista('alertas', () => import('./components/Alertas.jsx')),
  terceros: cargarVista('terceros', () => import('./components/TercerosList.jsx')),
  trabajadores: cargarVista('trabajadores', () => import('./components/TrabajadoresList.jsx')),
  usuarios: cargarVista('usuarios', () => import('./components/UsuariosList.jsx')),
  bitacora: cargarVista('bitacora', () => import('./components/BitacoraList.jsx')),
  configuracion: cargarVista('configuracion', () => import('./components/ConfiguracionPanel.jsx')),
  sincronizacion: cargarVista('sincronizacion', () => import('./components/ConfiguracionPanel.jsx')),
  perfil: cargarVista('perfil', () => import('./components/Perfil.jsx')),
});

export const CARGADORES_SUPERFICIES = Object.freeze({
  seguimientoAnimal: cargarVista('seguimiento-animal', () => import('./components/SeguimientoAnimal.jsx')),
  nuevoAnimal: cargarVista('nuevo-animal', () => import('./components/NuevoAnimalModal.jsx')),
  capturaRapida: cargarVista('captura-rapida', () => import('./components/CapturaRapidaModal.jsx')),
  capturaModuloOffline: cargarVista('captura-modulo-offline', () => import('./components/CapturaModuloOffline.jsx')),
  seguimientoAnimalOffline: cargarVista('seguimiento-animal-offline', () => import('./components/SeguimientoAnimalOffline.jsx')),
});

export const VISTAS_PESADAS_DIFERIDAS = Object.freeze([
  'finanzas', 'reportes', 'rentabilidad', 'listas', 'bitacora', 'configuracion', 'perfil',
]);
