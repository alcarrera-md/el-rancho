import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { crearErrorApi } from '../src/api.js';
import {
  mensajeCargaParcial, resolverCargaParcial, respuestaEsArreglo,
} from '../src/cargasParciales.js';

test('los errores API conservan status, método y endpoint', () => {
  const error = crearErrorApi({ message: 'Acceso denegado', code: 'FORBIDDEN' }, 403, {
    ruta: '/api/bitacora', metodo: 'GET',
  });
  assert.equal(error.status, 403);
  assert.equal(error.code, 'FORBIDDEN');
  assert.equal(error.ruta, '/api/bitacora');
  assert.equal(error.metodo, 'GET');
});

test('la API usa el mismo origen y Vite declara proxy tanto en desarrollo como en preview', async () => {
  const api = await readFile(new URL('../src/api.js', import.meta.url), 'utf8');
  const vite = await readFile(new URL('../vite.config.js', import.meta.url), 'utf8');
  assert.match(api, /const BASE_URL = '\/api'/);
  assert.doesNotMatch(api, /localhost:3000/);
  assert.match(vite, /strictPort: true/);
  assert.match(vite, /ws: \{ clientPort: DEV_PORT \}/);
  assert.match(vite, /const API_PROXY = \{/);
  assert.match(vite, /'\/api': \{/);
  assert.match(vite, /target: 'http:\/\/127\.0\.0\.1:3000'/);
  assert.match(vite, /preview: \{[\s\S]*port: 4173,[\s\S]*proxy: API_PROXY/);
});

test('el modo de certificación no inicia trabajos programados ni expone el backend en la LAN', async () => {
  const servidor = await readFile(new URL('../../backend/scripts/serve-pwa-certification.js', import.meta.url), 'utf8');
  assert.match(servidor, /const HOST = '127\.0\.0\.1'/);
  assert.match(servidor, /validarJwtSecret\(\)/);
  assert.doesNotMatch(servidor, /node-cron|corteDiario|verificarYEnviar/);
});

test('el lanzador CMD usa ASCII y finales CRLF sin perder comandos', async () => {
  const bat = await readFile(new URL('../../EL RANCHO - PRUEBA PWA HTTPS.bat', import.meta.url));
  const contenido = bat.toString('ascii');
  assert.equal([...bat].some((byte) => byte > 127), false);
  assert.doesNotMatch(contenido, /(?<!\r)\n/);
  assert.match(contenido, /\r\nsetlocal EnableExtensions\r\n/);
  assert.match(contenido, /\r\necho \[1\/4\] Compilando frontend/);
  assert.match(contenido, /npm run certify:pwa/);
  assert.match(contenido, /npm run preview/);
  assert.match(contenido, /Cloudflare Quick Tunnel/);
  assert.match(contenido, /pause\r\n\s+exit \/b 1/);
});

test('una carga parcial identifica endpoint, status, rol y conserva resultados válidos', async () => {
  const aplicados = {};
  const errorOriginal = crearErrorApi('Sin permiso', 403, { ruta: '/api/bitacora', metodo: 'GET' });
  const originalConsoleError = console.error;
  let diagnosticoRegistrado;
  console.error = (_marca, diagnostico) => { diagnosticoRegistrado = diagnostico; };
  try {
    const diagnostico = await resolverCargaParcial([
      { clave: 'corrales', etiqueta: 'Corrales', ruta: '/api/corrales', promesa: Promise.resolve([]), aplicar: (valor) => { aplicados.corrales = valor; }, validar: respuestaEsArreglo },
      { clave: 'actividad', etiqueta: 'Actividad reciente', ruta: '/api/bitacora', promesa: Promise.reject(errorOriginal), aplicar: (valor) => { aplicados.actividad = valor; }, valorInicial: [], validar: respuestaEsArreglo },
    ], { contexto: 'Dashboard', rol: 'Trabajador' });
    assert.deepEqual(aplicados, { corrales: [], actividad: [] });
    assert.deepEqual(diagnostico.fallos[0], {
      clave: 'actividad', etiqueta: 'Actividad reciente', ruta: '/api/bitacora', metodo: 'GET',
      status: 403, codigo: null, mensaje: 'Sin permiso',
    });
    assert.equal(diagnosticoRegistrado.rol, 'Trabajador');
    assert.match(mensajeCargaParcial(diagnostico), /GET \/api\/bitacora, HTTP 403/);
  } finally {
    console.error = originalConsoleError;
  }
});

test('una respuesta 200 con forma inesperada se reporta y no rompe el módulo', async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    let valor;
    const diagnostico = await resolverCargaParcial([
      { clave: 'tareas', etiqueta: 'Tareas', ruta: '/api/asignaciones', promesa: Promise.resolve(null), aplicar: (resultado) => { valor = resultado; }, valorInicial: [], validar: respuestaEsArreglo },
    ]);
    assert.deepEqual(valor, []);
    assert.equal(diagnostico.fallos[0].codigo, 'RESPUESTA_INVALIDA');
    assert.equal(diagnostico.fallos[0].status, 200);
  } finally {
    console.error = originalConsoleError;
  }
});

test('la carga inicial con próximos partos en ventana válida no produce mensaje parcial', async () => {
  const diagnostico = await resolverCargaParcial([
    { clave: 'partos', etiqueta: 'Próximos partos', ruta: '/api/reproduccion/partos-proximos?dias=30', promesa: Promise.resolve([]), aplicar: () => {}, validar: respuestaEsArreglo },
  ], { contexto: 'Dashboard', rol: 'Veterinario' });
  assert.deepEqual(diagnostico.fallos, []);
  assert.equal(mensajeCargaParcial(diagnostico), null);
});
