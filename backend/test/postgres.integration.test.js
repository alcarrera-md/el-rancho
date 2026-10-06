const test = require('node:test');
const assert = require('node:assert/strict');
const { cargarEntornoPruebas } = require('./helpers/testEnvironment');

cargarEntornoPruebas();
const db = require('../src/db');

test.after(async () => {
  await db.pool.end();
});

test('PostgreSQL responde desde la base aislada de pruebas', async () => {
  const { rows } = await db.query(
    'SELECT current_database() AS nombre, 2 + 2 AS resultado'
  );

  assert.equal(rows[0].nombre, 'sistema_ganadero_test');
  assert.equal(rows[0].resultado, 4);
});
