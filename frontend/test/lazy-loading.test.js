import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { RUTA_POR_VISTA } from '../src/routing.js';
import { CARGADORES_SUPERFICIES, CARGADORES_VISTAS, VISTAS_PESADAS_DIFERIDAS } from '../src/routeLoaders.js';
import {
  cargarModuloDiferido, clasificarErrorCarga, crearMapaDiferido,
  presentacionErrorCarga, resumenDiagnosticoCarga, TIPO_ERROR_CARGA,
} from '../src/lazyLoading.js';

test('cada ruta de primer nivel conserva un cargador diferido', () => {
  assert.deepEqual(Object.keys(CARGADORES_VISTAS).sort(), Object.keys(RUTA_POR_VISTA).sort());
  for (const cargar of Object.values(CARGADORES_VISTAS)) assert.equal(typeof cargar, 'function');
});

test('las superficies fuera de ruta también se cargan bajo demanda', () => {
  assert.deepEqual(Object.keys(CARGADORES_SUPERFICIES).sort(), ['capturaModuloOffline', 'capturaRapida', 'nuevoAnimal', 'seguimientoAnimal', 'seguimientoAnimalOffline']);
});

test('los módulos pesados declarados pertenecen al mapa diferido', () => {
  for (const vista of VISTAS_PESADAS_DIFERIDAS) {
    assert.equal(typeof CARGADORES_VISTAS[vista], 'function', `${vista} debe tener cargador diferido`);
  }
});

test('el límite de chunks registra el error original y permite recuperación local', async () => {
  const fuente = await readFile(new URL('../src/components/CargaDiferida.jsx', import.meta.url), 'utf8');
  const diagnostico = await readFile(new URL('../src/runtimeDiagnostics.js', import.meta.url), 'utf8');
  assert.match(fuente, /<Suspense fallback=/);
  assert.match(fuente, /<EstadoCarga mensaje=/);
  assert.match(fuente, /getDerivedStateFromError/);
  assert.match(fuente, /\[frontend-module-error\]/);
  assert.match(diagnostico, /original: \{/);
  assert.match(diagnostico, /stack: error\?\.stack/);
  assert.match(fuente, /this\.props\.onReintentar\(\{ tipo, error:/);
  assert.match(fuente, /Actualizar aplicación/);
  assert.match(fuente, /window\.location\.reload\(\)/);
});

test('clasifica red, 404 obsoleto, Vite, descarga, API y ejecución del módulo por separado', () => {
  const errorChunk = new TypeError('Failed to fetch dynamically imported module: /assets/vista-vieja.js');
  assert.equal(clasificarErrorCarga(errorChunk, { online: false }), TIPO_ERROR_CARGA.RED);
  assert.equal(clasificarErrorCarga(errorChunk, { online: true }), TIPO_ERROR_CARGA.IMPORTACION);
  errorChunk.cargaDiferida = { status: 404, entorno: 'produccion' };
  assert.equal(clasificarErrorCarga(errorChunk, { online: true }), TIPO_ERROR_CARGA.CHUNK_OBSOLETO);
  const errorVite = new TypeError('Failed to fetch dynamically imported module: /src/Vista.jsx');
  errorVite.cargaDiferida = { status: 500, entorno: 'desarrollo' };
  assert.equal(clasificarErrorCarga(errorVite, { online: true }), TIPO_ERROR_CARGA.SERVIDOR_DESARROLLO);
  assert.equal(clasificarErrorCarga(new TypeError('Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of text/html'), { online: true }), TIPO_ERROR_CARGA.CHUNK_OBSOLETO);
  assert.equal(clasificarErrorCarga(Object.assign(new Error('Servidor'), { status: 503 })), TIPO_ERROR_CARGA.API);
  assert.equal(clasificarErrorCarga(new ReferenceError('variable is not defined')), TIPO_ERROR_CARGA.MODULO);
  assert.doesNotMatch(presentacionErrorCarga(TIPO_ERROR_CARGA.MODULO).mensaje, /conexión/i);
  assert.equal(presentacionErrorCarga(TIPO_ERROR_CARGA.CHUNK_OBSOLETO).permiteActualizar, true);
});

test('el cargador adjunta módulo y status HTTP antes de entregar el error al límite', async () => {
  let errorCapturado;
  await assert.rejects(
    cargarModuloDiferido(
      'calendario',
      async () => { throw new TypeError('Failed to fetch dynamically imported module: /assets/calendario-viejo.js'); },
      async (url) => ({ url, status: 404 }),
    ),
    (error) => { errorCapturado = error; return true; },
  );
  assert.equal(errorCapturado.cargaDiferida.modulo, 'calendario');
  assert.equal(errorCapturado.cargaDiferida.status, 404);
  assert.match(resumenDiagnosticoCarga(errorCapturado), /chunk_obsoleto · módulo calendario · HTTP 404/);
});

test('los tipos lazy permanecen estables al navegar y cambian sólo al reintentar', async () => {
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /\[revisionCarga\]/);
  assert.doesNotMatch(app, /\[location\.key, revisionCarga\]/);
});

test('un reintento crea otro tipo lazy y vuelve a invocar un loader rechazado', async () => {
  let llamadas = 0;
  const loader = async () => {
    llamadas += 1;
    if (llamadas === 1) throw new TypeError('Failed to fetch dynamically imported module');
    return { default: 'Vista recuperada' };
  };
  const lazyDePrueba = (cargar) => ({ cargar });
  const primerMapa = crearMapaDiferido(lazyDePrueba, { vista: loader });
  await assert.rejects(primerMapa.vista.cargar(), /Failed to fetch/);
  const segundoMapa = crearMapaDiferido(lazyDePrueba, { vista: loader });
  assert.notEqual(primerMapa.vista, segundoMapa.vista);
  assert.deepEqual(await segundoMapa.vista.cargar(), { default: 'Vista recuperada' });
  assert.equal(llamadas, 2);
});

test('las librerías de exportación se solicitan dinámicamente', async () => {
  const fuente = await readFile(new URL('../src/exportUtils.js', import.meta.url), 'utf8');
  assert.doesNotMatch(fuente, /^import .* from ['"](?:jspdf|read-excel-file|write-excel-file|qrcode)/m);
  for (const dependencia of ['jspdf', 'jspdf-autotable', 'read-excel-file/browser', 'write-excel-file/browser', 'qrcode']) {
    assert.match(fuente, new RegExp(`import\\(['"]${dependencia}['"]\\)`));
  }
});
