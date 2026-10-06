const test = require('node:test');
const assert = require('node:assert/strict');
const { validarTestDatabaseUrl } = require('./helpers/testDatabase');

test('rechaza ejecutar integración sin TEST_DATABASE_URL', () => {
  assert.throws(
    () => validarTestDatabaseUrl({}),
    /TEST_DATABASE_URL es obligatoria/
  );
});

test('rechaza una base cuyo nombre no indique que es de pruebas', () => {
  assert.throws(
    () => validarTestDatabaseUrl({ TEST_DATABASE_URL: 'postgres://localhost/sistema_ganadero' }),
    /debe incluir "test"/
  );
});

test('rechaza usar la misma conexión de desarrollo y pruebas', () => {
  const url = 'postgres://usuario:clave@localhost/sistema_ganadero_test';
  assert.throws(
    () => validarTestDatabaseUrl({ DATABASE_URL: url, TEST_DATABASE_URL: url }),
    /no puede apuntar a la misma base/
  );
});

test('rechaza la misma base aunque las credenciales sean diferentes', () => {
  assert.throws(
    () => validarTestDatabaseUrl({
      DATABASE_URL: 'postgres://app:clave@localhost/sistema_ganadero_test',
      TEST_DATABASE_URL: 'postgres://tester:otra@localhost:5432/sistema_ganadero_test',
    }),
    /no puede apuntar a la misma base/
  );
});

test('acepta una URL PostgreSQL aislada con nombre de pruebas', () => {
  const url = 'postgres://usuario:clave@localhost/sistema_ganadero_test';
  assert.equal(validarTestDatabaseUrl({ TEST_DATABASE_URL: url }), url);
});
