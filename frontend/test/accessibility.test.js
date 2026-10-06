import test from 'node:test';
import assert from 'node:assert/strict';
import { atributosAnuncio, debeConfirmarCierre, indiceFocoAtrapado, SELECTOR_FOCABLE } from '../src/accessibility.js';
import { esEnlaceInternoDistinto } from '../src/useProteccionFormulario.js';

test('un formulario sucio solicita confirmación, excepto mientras guarda', () => {
  assert.equal(debeConfirmarCierre({ sucio: false, ocupado: false }), false);
  assert.equal(debeConfirmarCierre({ sucio: true, ocupado: false }), true);
  assert.equal(debeConfirmarCierre({ sucio: true, ocupado: true }), false);
});

test('el foco del modal se envuelve en ambos extremos', () => {
  assert.equal(indiceFocoAtrapado(2, 3, false), 0);
  assert.equal(indiceFocoAtrapado(0, 3, true), 2);
  assert.equal(indiceFocoAtrapado(1, 3, false), 2);
  assert.equal(indiceFocoAtrapado(0, 0, false), -1);
  assert.match(SELECTOR_FOCABLE, /button:not\(\[disabled\]\)/);
  assert.match(SELECTOR_FOCABLE, /\[tabindex\]/);
});

test('los anuncios usan semántica adecuada según su urgencia', () => {
  assert.deepEqual(atributosAnuncio('estado'), { role: 'status', 'aria-live': 'polite' });
  assert.deepEqual(atributosAnuncio('error'), { role: 'alert', 'aria-live': 'assertive' });
});

test('la protección de formularios funciona con BrowserRouter sin depender de useBlocker', () => {
  const crearEnlace = (href, extras = {}) => ({ href, target: '', hasAttribute: () => false, ...extras });
  assert.equal(esEnlaceInternoDistinto(crearEnlace('http://localhost:5173/corrales'), 'http://localhost:5173/seguimiento'), true);
  assert.equal(esEnlaceInternoDistinto(crearEnlace('http://localhost:5173/seguimiento'), 'http://localhost:5173/seguimiento'), false);
  assert.equal(esEnlaceInternoDistinto(crearEnlace('https://ejemplo.com/'), 'http://localhost:5173/seguimiento'), false);
  assert.equal(esEnlaceInternoDistinto(crearEnlace('http://localhost:5173/corrales', { target: '_blank' }), 'http://localhost:5173/seguimiento'), false);
});
