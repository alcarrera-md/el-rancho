import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizarPreferenciasApariencia, PREFERENCIAS_APARIENCIA_DEFAULT } from '../src/theme.js';

test('apariencia normaliza todas las preferencias y descarta valores desconocidos', () => {
  assert.deepEqual(normalizarPreferenciasApariencia({
    tema: 'oscuro', paleta: 'azul', texto: 'grande', densidad: 'compacta', contraste: 'alto', esquinas: 'redondas',
  }), { tema: 'oscuro', paleta: 'azul', texto: 'grande', densidad: 'compacta', contraste: 'alto', esquinas: 'redondas' });
  assert.deepEqual(normalizarPreferenciasApariencia({ tema: 'inexistente' }), PREFERENCIAS_APARIENCIA_DEFAULT);
});

test('perfil cambia únicamente la contraseña propia y nunca presenta contraseñas almacenadas', async () => {
  const perfil = await readFile(new URL('../src/components/Perfil.jsx', import.meta.url), 'utf8');
  const api = await readFile(new URL('../src/api.js', import.meta.url), 'utf8');
  assert.match(perfil, /cambiarPasswordPropio\(passwordActual, passwordNuevo\)/);
  assert.match(perfil, /CampoPassword label="Contraseña actual"/);
  assert.doesNotMatch(perfil, /password_hash/);
  assert.match(api, /request\('\/auth\/password'/);
});

test('volver se limita a subpantallas de configuración y al seguimiento interno', async () => {
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const configuracion = await readFile(new URL('../src/components/ConfiguracionPanel.jsx', import.meta.url), 'utf8');
  const seguimiento = await readFile(new URL('../src/components/SeguimientoAnimal.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /vista !== 'inicio' && <BotonVolver/);
  assert.equal((app.match(/<BotonVolver destino="\/animales"/g) || []).length, 1);
  assert.equal((seguimiento.match(/← Volver/g) || []).length, 0);
  assert.match(configuracion, /<BotonVolver destino="\/configuracion"/);
});

test('configuración ofrece las seis categorías con navegación explícita', async () => {
  const fuente = await readFile(new URL('../src/components/ConfiguracionPanel.jsx', import.meta.url), 'utf8');
  for (const titulo of ['Apariencia', 'Cuenta y seguridad', 'Sistema', 'Datos y respaldo', 'Notificaciones', 'Avanzado']) {
    assert.match(fuente, new RegExp(titulo));
  }
  assert.match(fuente, /settings-chevron/);
});

test('las nuevas superficies móviles contienen su ancho y Seguimiento evita navegación horizontal', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.settings-row \{[^}]*min-width: 0/);
  assert.match(css, /\.appearance-content \{ display: grid/);
  assert.match(css, /\.seg-tabs \{[^}]*flex-wrap: wrap; overflow: visible/);
  assert.match(css, /\.seg-tab \{ flex: 1 1 calc\(50% - 4px\)/);
  assert.doesNotMatch(css, /\.seguimiento-shell \{[^}]*background: var\(--pasture-dark\)/);
  assert.match(css, /\.seguimiento-shell \{ background: radial-gradient/);
});

function conAlmacenamiento(datos, fn) {
  const anterior = globalThis.window;
  const mapa = new Map(Object.entries(datos).map(([k, v]) => [k, JSON.stringify(v)]));
  globalThis.window = { localStorage: { getItem: (k) => mapa.get(k) ?? null, setItem: (k, v) => mapa.set(k, v) } };
  try { return fn(); } finally { if (anterior === undefined) delete globalThis.window; else globalThis.window = anterior; }
}

test('apariencia: sin elección el tema es claro; se respeta lo elegido, incluido "automático" explícito', async () => {
  const { obtenerPreferenciasApariencia } = await import('../src/theme.js');
  assert.equal(PREFERENCIAS_APARIENCIA_DEFAULT.tema, 'claro');
  assert.equal(conAlmacenamiento({}, () => obtenerPreferenciasApariencia().tema), 'claro');
  // "automatico" guardado sin elegirlo (el predeterminado anterior) vuelve al claro.
  assert.equal(conAlmacenamiento({ 'el-rancho:apariencia:7': { tema: 'automatico', paleta: 'azul' } }, () => obtenerPreferenciasApariencia(7)).tema, 'claro');
  assert.equal(conAlmacenamiento({ 'el-rancho:apariencia:7': { tema: 'automatico', paleta: 'azul' } }, () => obtenerPreferenciasApariencia(7)).paleta, 'azul');
  assert.equal(conAlmacenamiento({ 'el-rancho:apariencia:7': { tema: 'oscuro' } }, () => obtenerPreferenciasApariencia(7)).tema, 'oscuro');
  assert.equal(conAlmacenamiento({ 'el-rancho:apariencia:7': { tema: 'automatico', temaElegido: true } }, () => obtenerPreferenciasApariencia(7)).tema, 'automatico');
  const panel = await readFile(new URL('../src/components/AparienciaPanel.jsx', import.meta.url), 'utf8');
  assert.match(panel, /aplicarPreferenciasApariencia\(nuevas, usuario\?\.id, \{ elegidas: true \}\)/);
});

test('mi perfil: en móvil el encabezado apila texto y acciones a ancho completo', async () => {
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.profile-page \.module-header \{ grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(css, /\.profile-page \.profile-header-actions \{ width: 100%; display: grid; grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(css, /\.btn-secondary \{[^}]*background: var\(--pasture-soft\)/);
});

test('modo oscuro: un solo bloque de tokens antracita, sin islas claras forzadas y capa generada al día', async () => {
  const { generarCapa, aplicarCapa } = await import('../scripts/tema-oscuro.mjs');
  const css = (await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  assert.equal((css.match(/^\[data-mode="oscuro"\] \{$/gm) || []).length, 1);
  const bloque = css.slice(css.indexOf('[data-mode="oscuro"] {\n'));
  assert.match(bloque, /--paper: #15181b; --paper-raised: #1d2125;/);
  // El bloque oscuro va después del último :root para que sus tokens no lo pisen.
  assert.ok(css.indexOf('[data-mode="oscuro"] {\n') > css.lastIndexOf(':root {'));
  assert.doesNotMatch(css, /\[data-mode="oscuro"\] :where\(\s*\.task-filters/);
  assert.match(css, /\[data-mode="oscuro"\] \.seguimiento-shell \{ --ink: #e8ecef;/);
  assert.equal(aplicarCapa(css), css, 'ejecuta node scripts/tema-oscuro.mjs');
  const capa = generarCapa(css);
  assert.match(capa, /\[data-mode="oscuro"\] \.module-header \{ border-color: var\(--line\); background-color: var\(--paper-raised\); \}/);
  assert.doesNotMatch(capa, /\[data-mode="oscuro"\] \.sidebar/);
  // Solo propiedades de color: nunca tamaños ni layout.
  const propiedades = [...capa.matchAll(/\{ ([^{}]*); \}/g)].flatMap((m) => m[1].split('; ').map((d) => d.split(':')[0]));
  assert.ok(propiedades.length > 100);
  assert.deepEqual([...new Set(propiedades)].filter((p) => !/^(?:color|background-color|background-image|border(?:-(?:top|right|bottom|left))?-color)$/.test(p)), []);
});
