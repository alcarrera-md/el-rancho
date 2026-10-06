import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PASSWORD_MAX, PASSWORD_MIN, evaluarFortalezaPassword } from '../src/passwordSecurity.js';

const leer = (ruta) => readFile(new URL(`../${ruta}`, import.meta.url), 'utf8');

test('la política de contraseña usa longitud de 12 a 72 sin composición artificial', () => {
  assert.equal(PASSWORD_MIN, 12);
  assert.equal(PASSWORD_MAX, 72);
  assert.equal(evaluarFortalezaPassword('frase corta').nivel, 'insuficiente');
  assert.equal(evaluarFortalezaPassword('una frase de contraseña extensa y memorizable').nivel, 'muy fuerte');
});

test('el acceso no depende de un cambio inicial de contraseña', async () => {
  const [app, contexto, api] = await Promise.all([leer('src/App.jsx'), leer('src/auth/AuthContext.jsx'), leer('src/api.js')]);
  assert.doesNotMatch(app, /requiere_cambio_password|cambiar-password-inicial|CambiarPasswordInicial/);
  assert.doesNotMatch(contexto, /completarPasswordInicial|cambiarPasswordInicial/);
  assert.doesNotMatch(api, /password-inicial|cambiarPasswordInicial/);
  assert.doesNotMatch(app, /Contraseña temporal|contraseña temporal/i);
});

test('las pantallas administrativas hablan de una contraseña usable inmediatamente', async () => {
  const [alta, reset] = await Promise.all([
    leer('src/components/NuevoUsuarioModal.jsx'),
    leer('src/components/RestablecerPasswordModal.jsx'),
  ]);
  assert.match(alta, /label="Contraseña"/);
  assert.match(alta, /Generar contraseña segura/);
  assert.match(reset, /label="Nueva contraseña"/);
  assert.match(reset, /usarla inmediatamente/);
  assert.doesNotMatch(`${alta}\n${reset}`, /temporal|cambio obligatorio/i);
});
