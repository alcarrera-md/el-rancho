const test = require('node:test');
const assert = require('node:assert/strict');
const { construirDetalle, sanitizar } = require('../src/bitacora');

test('sanitizar elimina secretos incluso en estructuras anidadas', () => {
  const limpio = sanitizar({
    email: 'usuario@rancho.test',
    password: 'no-debe-aparecer',
    nested: { password_hash: 'hash', JWT: 'token', dato: 7 },
    items: [{ api_key: 'secreto', nombre: 'visible' }],
  });
  assert.deepEqual(limpio, {
    email: 'usuario@rancho.test',
    nested: { dato: 7 },
    items: [{ nombre: 'visible' }],
  });
});

test('construirDetalle produce el contrato versionado y conserva antes/después', () => {
  const detalle = construirDetalle({ rol: 'Administrador' }, {
    antes: { estado: 'vivo' },
    despues: { estado: 'vendido' },
    contexto: { origen: 'venta' },
  });
  assert.deepEqual(detalle, {
    version: 1,
    resultado: 'exito',
    actor: { rol: 'Administrador' },
    antes: { estado: 'vivo' },
    despues: { estado: 'vendido' },
    contexto: { origen: 'venta' },
  });
});
