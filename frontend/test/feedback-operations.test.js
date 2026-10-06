import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearGuardiaEnvio, MENSAJES_ACCION } from '../src/fieldActions.js';
import { detalleMovimientoConfirmado, DURACION_FEEDBACK_OPERACION, normalizarFeedbackOperacion } from '../src/feedbackOperacion.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const leer = (archivo) => fs.readFileSync(path.join(raiz, archivo), 'utf8');

test('el movimiento usa los datos confirmados por el servidor para el mensaje contextual', () => {
  const detalle = detalleMovimientoConfirmado(
    { nombre_alias: 'Lucero', arete_id: 'MX-18', sexo: 'hembra' },
    { corral_origen: 'Corral 2', corral_destino: 'Corral 5' },
  );
  assert.equal(detalle.titulo, 'Movimiento registrado');
  assert.match(detalle.mensaje, /Lucero fue trasladada de Corral 2 a Corral 5/);
});

test('Movimientos vuelve a consultar el servidor antes de confirmar y destaca la fila recibida', () => {
  const fuente = leer('src/components/Movimientos.jsx');
  assert.match(fuente, /await cargar[\s\S]*if \(!lista\) return;[\s\S]*setMovimientoDestacado[\s\S]*mostrarExito/);
  assert.match(fuente, /resultado\?\.movimiento/);
  assert.match(fuente, /movimiento-reciente/);
});

test('un fallo del endpoint conserva el formulario y no ejecuta el callback de éxito', () => {
  const fuente = leer('src/components/MoverAnimalModal.jsx');
  const bloqueGuardar = fuente.slice(fuente.indexOf('async function guardar'), fuente.indexOf('return ('));
  assert.match(bloqueGuardar, /await guardia\.current\.ejecutar/);
  assert.match(bloqueGuardar, /if \(resultado\.ejecutado\) onCreado/);
  assert.match(bloqueGuardar, /catch \(err\)[\s\S]*setError\(err\.message\)/);
  assert.doesNotMatch(bloqueGuardar.match(/catch \(err\)[\s\S]*?finally/)[0], /onCreado|mostrarExito/);
});

test('el feedback global tiene icono y semántica anunciable', () => {
  const fuente = leer('src/context/FeedbackOperacionContext.jsx');
  assert.match(fuente, /IconoCheck/);
  assert.match(fuente, /role=\{aviso\.tipo === 'error' \? 'alert' : 'status'\}/);
  assert.match(fuente, /aria-live=\{aviso\.tipo === 'error' \? 'assertive' : 'polite'\}/);
});

test('la desaparición es controlada y dura entre tres y cuatro segundos', () => {
  assert.ok(DURACION_FEEDBACK_OPERACION >= 3000 && DURACION_FEEDBACK_OPERACION <= 4000);
  const fuente = leer('src/context/FeedbackOperacionContext.jsx');
  assert.match(fuente, /window\.setTimeout\(\(\) => onCerrar\(aviso\.id\), aviso\.duracion\)/);
  assert.match(fuente, /window\.clearTimeout/);
});

test('prefers-reduced-motion elimina las animaciones de confirmación', () => {
  const css = leer('src/styles.css');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.feedback-global[\s\S]*animation: none !important/);
});

test('la guardia impide dos envíos simultáneos', async () => {
  const guardia = crearGuardiaEnvio();
  let resolver;
  let ejecuciones = 0;
  const primera = guardia.ejecutar(() => { ejecuciones += 1; return new Promise((listo) => { resolver = listo; }); });
  const segunda = await guardia.ejecutar(() => { ejecuciones += 1; });
  assert.deepEqual(segunda, { ejecutado: false });
  resolver('confirmado');
  assert.deepEqual(await primera, { ejecutado: true, valor: 'confirmado' });
  assert.equal(ejecuciones, 1);
});

test('varias operaciones consecutivas conservan avisos independientes', () => {
  const primero = normalizarFeedbackOperacion({ titulo: 'Pesaje guardado' });
  const segundo = normalizarFeedbackOperacion({ titulo: 'Nota guardada' });
  assert.notEqual(primero.id, segundo.id);
  const fuente = leer('src/context/FeedbackOperacionContext.jsx');
  assert.match(fuente, /\[\.\.\.actuales\.slice\(-2\), aviso\]/);
  assert.match(fuente, /avisos\.map/);
});

test('las acciones de campo usan mensajes específicos', () => {
  assert.match(MENSAJES_ACCION.pesaje, /Pesaje/);
  assert.match(MENSAJES_ACCION.alimentacion, /Alimentación/);
  assert.match(MENSAJES_ACCION.mover, /movido de corral/i);
  assert.match(MENSAJES_ACCION.leche, /leche/);
  assert.match(MENSAJES_ACCION.nota, /Nota/);
});
