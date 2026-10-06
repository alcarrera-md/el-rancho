import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const raiz = new URL('../', import.meta.url);
const leer = (ruta) => readFile(new URL(ruta, raiz), 'utf8');

test('el shell experimental identifica el módulo y permite compactar la navegación', async () => {
  const [app, sidebar, estilos] = await Promise.all([
    leer('src/App.jsx'), leer('src/components/Sidebar.jsx'), leer('src/styles.css'),
  ]);
  assert.match(app, /data-active-module=\{vista\}/);
  assert.match(app, /data-module=\{vista\}/);
  assert.match(sidebar, /el-rancho:sidebar-compacto/);
  assert.match(sidebar, /aria-label=\{compacto \? 'Ampliar menú lateral'/);
  assert.match(sidebar, /sidebar-ranch-status/);
  assert.match(estilos, /\[data-sidebar="compacto"\] \.app-shell/);
});

test('los acentos de navegación son semánticos y no sustituyen el color de marca', async () => {
  const estilos = await leer('src/styles.css');
  for (const modulo of ['animales', 'seguimiento', 'planes-sanitarios', 'reproduccion', 'pesajes', 'alimentacion', 'corrales', 'movimientos', 'tareas', 'alertas', 'insumos', 'ventas', 'compras', 'gastos', 'rentabilidad', 'reportes', 'usuarios', 'bitacora', 'configuracion', 'perfil']) {
    assert.match(estilos, new RegExp(`nav-module-${modulo.replace('-', '\\-')}`), `falta acento para ${modulo}`);
  }
  assert.match(estilos, /--module-accent: var\(--accent-animals\)/);
});

test('seguimiento expone pestañas semánticas y superficies adaptables sin desbordamiento', async () => {
  const [seguimiento, estilos] = await Promise.all([
    leer('src/components/SeguimientoAnimal.jsx'), leer('src/styles.css'),
  ]);
  assert.match(seguimiento, /data-tab=\{t\.id\}/);
  assert.match(seguimiento, /<PaisajeGanadero compacto/);
  assert.match(seguimiento, /seg-profile-stamp/);
  assert.match(estilos, /\.seg-tab\[data-tab="salud"\]/);
  assert.match(estilos, /overflow-x: clip/);
  assert.match(estilos, /@media \(max-width: 780px\)/);
  assert.match(estilos, /\.seg-profile-land \{ position: absolute/);
});

test('el dashboard presenta prioridades antes que acciones rápidas en el flujo documental', async () => {
  const dashboard = await leer('src/components/Dashboard.jsx');
  assert.ok(dashboard.indexOf('dashboard-pendientes') < dashboard.indexOf('dashboard-acciones'));
  assert.match(dashboard, /ops-control-panel/);
  assert.match(dashboard, /ops-dashboard-grid/);
  assert.match(dashboard, /<ModuleHeader/);
  assert.match(dashboard, /title="Cómo está el rancho hoy"/);
  assert.match(dashboard, /DonutSalud/);
});

test('los módulos comparten un encabezado contextual flexible y accesible', async () => {
  const [header, presentacion, animales, alertas, seguimiento, estilos] = await Promise.all([
    leer('src/components/ModuleHeader.jsx'),
    leer('src/components/PresentacionGuiada.jsx'),
    leer('src/components/AnimalesList.jsx'),
    leer('src/components/Alertas.jsx'),
    leer('src/components/SeguimientoAnimal.jsx'),
    leer('src/styles.css'),
  ]);
  assert.match(header, /aria-labelledby=\{titleId\}/);
  assert.match(header, /eyebrow/);
  assert.match(header, /status/);
  assert.match(header, /action/);
  assert.match(presentacion, /<ModuleHeader/);
  assert.match(animales, /'Selecciona un animal' : 'Tu ganado'/);
  assert.match(alertas, /titulo="¿Qué requiere atención ahora\?"/);
  assert.match(seguimiento, /title="Expediente y evolución del animal"/);
  assert.match(estilos, /\.module-header h1,\.module-header h2/);
  assert.match(estilos, /\.alert-center-card\.alerta-critica/);
});

test('Inicio prioriza datos operativos legibles y relega la ilustración al seguimiento', async () => {
  const [dashboard, estilos, paisaje] = await Promise.all([
    leer('src/components/Dashboard.jsx'), leer('src/styles.css'), leer('src/components/PaisajeGanadero.jsx'),
  ]);
  assert.ok(dashboard.indexOf('Cómo está el rancho hoy') < dashboard.indexOf('Atención inmediata'));
  assert.ok(dashboard.indexOf('Atención inmediata') < dashboard.indexOf('Acciones rápidas'));
  assert.doesNotMatch(dashboard, /PaisajeGanadero/);
  assert.match(dashboard, /dashboard-top-row/);
  assert.match(dashboard, /dashboard-primary-row/);
  assert.match(dashboard, /dashboard-priority-stack/);
  assert.match(dashboard, /dashboard-secondary-row/);
  assert.match(dashboard, /dashboard-insight-stack/);
  assert.match(estilos, /\.ops-dashboard-grid \{[^}]*grid-template-columns: minmax\(0,1fr\)/);
  assert.match(estilos, /\.ops-dashboard-grid > \.dashboard-primary-row,[\s\S]*grid-column: 1 \/ -1/);
  assert.match(estilos, /\.ops-control-panel \{/);
  assert.match(estilos, /\.ops-attention-widget \{ grid-column: span 7/);
  assert.match(estilos, /\.ops-health-widget \{ grid-column: span 3/);
  assert.match(estilos, /@media \(max-width: 640px\)/);
  assert.match(paisaje, /ranch-cattle/);
  assert.match(paisaje, /ranch-fence/);
  assert.doesNotMatch(paisaje, /https?:\/\//);
});

test('la ronda de claridad organiza Inicio y los módulos de apoyo por decisiones reales', async () => {
  const [dashboard, imprimibles, terceros, pesajes, estilos] = await Promise.all([
    leer('src/components/Dashboard.jsx'),
    leer('src/components/ListasImprimibles.jsx'),
    leer('src/components/TercerosList.jsx'),
    leer('src/components/Pesajes.jsx'),
    leer('src/styles.css'),
  ]);

  assert.ok(dashboard.indexOf('dashboard-weather-card') < dashboard.indexOf('ops-control-panel'));
  for (const indicador of ['Ganado activo', 'Salud general', 'Tareas activas', 'Requieren atención', 'Corrales por revisar']) {
    assert.match(dashboard, new RegExp(indicador));
  }
  assert.match(dashboard, /estadoOperativoCorral/);
  assert.doesNotMatch(dashboard, /ops-map-field/);

  for (const categoria of ['Operación diaria', 'Sanidad y seguimiento', 'Apoyo para campo e identificación']) {
    assert.match(imprimibles, new RegExp(categoria));
  }
  assert.match(imprimibles, /Para qué sirve/);
  assert.match(imprimibles, /Cuándo usarlo/);

  assert.match(terceros, /third-party-overview/);
  assert.match(terceros, /Buscar contacto/);
  assert.doesNotMatch(terceros, /<table/);
  assert.match(pesajes, /tendenciaPeso/);
  assert.match(pesajes, /weight-lot-card/);
  assert.match(estilos, /\.ops-header-weather \.weather-compact/);
  assert.match(estilos, /\.third-party-card/);
  assert.match(estilos, /\.weight-chart-card/);
});

test('Tareas usa un panel de filtros compacto en dos filas y Seguimiento separa texto y foto', async () => {
  const [tareas, seguimiento, estilos] = await Promise.all([
    leer('src/components/TareasList.jsx'), leer('src/components/SeguimientoAnimal.jsx'), leer('src/styles.css'),
  ]);
  assert.match(tareas, /Filtrar tareas/);
  assert.match(tareas, /Encuentra rápidamente el trabajo que necesitas revisar/);
  assert.match(tareas, /Limpiar filtros/);
  assert.match(tareas, /filtrosActivos/);
  assert.match(estilos, /\.task-filter-grid \{ grid-template-columns: repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(estilos, /\.task-filter-grid label:nth-child\(n\+4\) \{ grid-column: span 3/);
  assert.match(seguimiento, /seg-profile-orbit[\s\S]*seg-identidad/);
  assert.match(estilos, /\.seg-animal-profile \.seg-identidad \{ left: 170px/);
});

test('la ronda ganadera final elimina actividad de Inicio y diferencia Sanidad, Reproducción y Animales', async () => {
  const [dashboard, animales, sanidad, reproduccion, iconos, estilos] = await Promise.all([
    leer('src/components/Dashboard.jsx'), leer('src/components/AnimalesList.jsx'),
    leer('src/components/Sanidad.jsx'), leer('src/components/Reproduccion.jsx'),
    leer('src/components/Iconos.jsx'), leer('src/styles.css'),
  ]);
  assert.doesNotMatch(dashboard, /listarBitacora|dashboard-actividad|Actividad reciente/);
  assert.match(animales, /className="animals-module-header"[\s\S]*'Modo offline limitado' : 'Inventario'[\s\S]*'Selecciona un animal' : 'Tu ganado'/);
  assert.match(sanidad, /health-clinical-board/);
  assert.ok(sanidad.indexOf('Enfermos') < sanidad.indexOf('En observación'));
  assert.ok(sanidad.indexOf('En observación') < sanidad.indexOf('Vacunas próximas'));
  assert.match(sanidad, /health-care-lane is-attention/);
  assert.match(sanidad, /health-record-list/);
  assert.match(reproduccion, /title="Estado reproductivo del hato"/);
  assert.ok(reproduccion.indexOf('Estado reproductivo del hato') < reproduccion.indexOf('Qué requiere atención'));
  assert.ok(reproduccion.indexOf('Qué requiere atención') < reproduccion.indexOf('Vacas del hato'));
  assert.doesNotMatch(reproduccion, /Acciones rápidas/);
  assert.match(reproduccion, /repro-attention-card/);
  assert.match(reproduccion, /repro-field-card/);
  assert.doesNotMatch(reproduccion, /<table/);
  assert.match(iconos, /from 'lucide-react'/);
  assert.match(estilos, /\.animals-module-header/);
  assert.match(estilos, /\.repro-attention-card/);
});

test('Corrales, Movimientos, Sanidad y Reproducción expresan actividades visualmente distintas', async () => {
  const [corrales, movimientos, sanidad, reproduccion, iconos, pwa, estilos] = await Promise.all([
    leer('src/components/CorralesList.jsx'), leer('src/components/Movimientos.jsx'),
    leer('src/components/Sanidad.jsx'), leer('src/components/Reproduccion.jsx'),
    leer('src/components/Iconos.jsx'), leer('src/components/EstadoPwa.jsx'), leer('src/styles.css'),
  ]);

  assert.match(corrales, /corral-layout-board/);
  assert.match(corrales, /Esquema operativo; no representa la ubicación física/);
  assert.match(movimientos, /movement-route-list/);
  assert.match(movimientos, /Origen[\s\S]*Destino/);
  assert.match(sanidad, /health-clinical-board/);
  assert.match(sanidad, /Necesitan revisión clínica[\s\S]*Cuidados programados/);
  assert.match(reproduccion, /repro-state-strip/);
  assert.match(reproduccion, /'Pendientes'[\s\S]*'Próximas'[\s\S]*'Vacías'/);
  assert.match(iconos, /IconoRuta = crearIcono\(Route\)/);
  assert.match(iconos, /IconoClinica = crearIcono\(Stethoscope\)/);
  assert.doesNotMatch(pwa, /Instalar El Rancho|beforeinstallprompt|pwa-install-action/);
  assert.match(estilos, /@media \(max-width: 430px\)[\s\S]*\.movement-route-card/);
});

test('Ventas gana pulso visual y los módulos físicos usan imágenes locales optimizadas sin desbordar Sanidad', async () => {
  const [ventas, corrales, movimientos, estilos, imagenCorrales, imagenMovimientos] = await Promise.all([
    leer('src/components/VentasReporte.jsx'), leer('src/components/CorralesList.jsx'),
    leer('src/components/Movimientos.jsx'), leer('src/styles.css'),
    stat(new URL('public/images/modules/corrales-panorama.jpg', raiz)),
    stat(new URL('public/images/modules/movimientos-recorrido.jpg', raiz)),
  ]);

  assert.match(ventas, /sales-overview/);
  assert.match(ventas, /sales-pulse/);
  assert.match(ventas, /sales-record-list/);
  assert.match(ventas, /exportarVentasPDF/);
  assert.match(ventas, /exportarVentasExcel/);
  assert.match(corrales, /\/images\/modules\/corrales-panorama\.jpg/);
  assert.match(movimientos, /\/images\/modules\/movimientos-recorrido\.jpg/);
  assert.ok(imagenCorrales.size < 350_000, 'la fotografía de corrales debe ser ligera');
  assert.ok(imagenMovimientos.size < 350_000, 'la fotografía de movimientos debe ser ligera');
  assert.match(estilos, /\.health-attention-grid > div > \.card \{[^}]*overflow: hidden/);
  assert.match(estilos, /\.health-attention-grid \.health-record \{[^}]*grid-template-columns: 34px minmax\(0,1fr\) auto/);
});
