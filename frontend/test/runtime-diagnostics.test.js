import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resumenDiagnosticoCarga, TIPO_ERROR_CARGA } from '../src/lazyLoading.js';
import { crearReferenciaRuntime, crearRegistroErrorModulo } from '../src/runtimeDiagnostics.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const leer = (ruta) => fs.readFileSync(path.join(DIR, '..', ruta), 'utf8');

test('un error de render conserva módulo, ruta, excepción y stacks en desarrollo', () => {
  const error = new TypeError('No se puede leer la propiedad salud de undefined');
  error.stack = 'TypeError: fallo\n    at CorralesList.jsx:88:10';
  const registro = crearRegistroErrorModulo({
    error,
    componentStack: '\n    at CorralesList',
    modulo: 'corrales',
    ruta: '/corrales',
    desarrollo: true,
    referencia: 'RT-PRUEBA',
    fecha: new Date('2026-08-28T04:00:00.000Z'),
  });

  assert.equal(registro.modulo, 'corrales');
  assert.equal(registro.ruta, '/corrales');
  assert.equal(registro.original.mensaje, error.message);
  assert.match(registro.original.stack, /CorralesList\.jsx/);
  assert.match(registro.componentStack, /CorralesList/);
});

test('producción conserva una referencia útil sin publicar mensaje ni stack', () => {
  const registro = crearRegistroErrorModulo({
    error: new Error('dato privado'), modulo: 'seguimiento', ruta: '/seguimiento', desarrollo: false, referencia: 'RT-SEGURA', fecha: new Date(0),
  });
  assert.deepEqual(registro, { referencia: 'RT-SEGURA', tipo: TIPO_ERROR_CARGA.MODULO, modulo: 'seguimiento', ruta: '/seguimiento', fecha: new Date(0).toISOString() });
  assert.equal(resumenDiagnosticoCarga(new Error('fallo'), TIPO_ERROR_CARGA.MODULO, { modulo: 'seguimiento', referencia: 'RT-SEGURA' }), 'modulo · módulo seguimiento · referencia RT-SEGURA');
  assert.match(crearReferenciaRuntime(new Date(0), 0), /^RT-0-/);
});

test('cada límite de ruta entrega su identidad y las superficies diferidas también', () => {
  const app = leer('src/App.jsx');
  const limite = leer('src/components/CargaDiferida.jsx');
  assert.match(app, /<CargaDiferida nombreModulo=\{vista\}/);
  assert.match(app, /nombreModulo="seguimiento-animal"/);
  assert.match(app, /nombreModulo="nuevo-animal"/);
  assert.match(app, /nombreModulo="captura-rapida"/);
  assert.match(limite, /\[frontend-module-error\]/);
  assert.match(limite, /desarrollo: import\.meta\.env\.DEV/);
});

test('Gastos no devuelve la promesa de carga como cleanup del efecto', () => {
  const gastos = leer('src/components/GastosGenerales.jsx');
  assert.match(gastos, /useEffect\(\(\) => \{\s*cargar\(\)\.catch\(\(\) => \{\}\);[\s\S]*\}, \[desde, hasta\]\)/);
  assert.doesNotMatch(gastos, /useEffect\(cargar, \[desde, hasta\]\)/);
});
