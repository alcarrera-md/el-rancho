const fs = require('node:fs/promises');
const path = require('node:path');
const { Client } = require('pg');
const { cargarEntornoPruebas } = require('../test/helpers/testEnvironment');
const runner = require('../src/migrations/runner');

const ACCIONES = new Set(['create', 'reset']);

function datosConexion(testDatabaseUrl) {
  const testUrl = new URL(testDatabaseUrl);
  const database = decodeURIComponent(testUrl.pathname.replace(/^\//, ''));
  if (!/^[a-z0-9_]+$/i.test(database) || !database.toLowerCase().includes('test')) {
    throw new Error('El nombre de la base de pruebas debe ser simple y contener "test".');
  }

  const adminUrl = new URL(testUrl);
  adminUrl.pathname = '/postgres';
  adminUrl.search = '';
  adminUrl.hash = '';
  return { database, adminUrl: adminUrl.toString(), testUrl: testUrl.toString() };
}

async function crearBaseSiFalta({ database, adminUrl }) {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const existe = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (existe.rowCount) {
      console.log(`Base de pruebas existente: ${database}`);
      return;
    }
    await client.query(`CREATE DATABASE "${database}"`);
    console.log(`Base de pruebas creada: ${database}`);
  } finally {
    await client.end();
  }
}

async function reinicializarBase({ database, testUrl }) {
  const client = new Client({ connectionString: testUrl });
  await client.connect();
  try {
    const actual = await client.query('SELECT current_database() AS nombre');
    if (actual.rows[0].nombre !== database || !database.toLowerCase().includes('test')) {
      throw new Error('Protección activada: la conexión no corresponde a la base de pruebas validada.');
    }

    await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');

    const schemaPath = path.resolve(__dirname, '..', '..', 'database', 'schema.sql');
    const fixturePath = path.resolve(__dirname, '..', 'test', 'fixtures', 'auth.sql');
    const [schemaSql, fixtureSql] = await Promise.all([
      fs.readFile(schemaPath, 'utf8'),
      fs.readFile(fixturePath, 'utf8'),
    ]);

    await client.query(schemaSql);
    await client.query(fixtureSql);
  } finally {
    await client.end();
  }
  const migrationsDir = path.resolve(__dirname, '..', '..', 'database', 'migrations');
  await runner.baseline({ connectionString: testUrl, migrationsDir });
  await runner.up({ connectionString: testUrl, migrationsDir });
  console.log(`Esquema, migraciones y fixtures inicializados en: ${database}`);
}

async function main() {
  const accion = process.argv[2];
  if (!ACCIONES.has(accion)) {
    throw new Error('Uso: node scripts/test-db.js <create|reset>');
  }

  const testDatabaseUrl = cargarEntornoPruebas();
  const conexion = datosConexion(testDatabaseUrl);

  if (accion === 'create') {
    await crearBaseSiFalta(conexion);
    return;
  }
  await reinicializarBase(conexion);
}

main().catch((err) => {
  console.error(`No se pudo preparar PostgreSQL de pruebas: ${err.message}`);
  process.exitCode = 1;
});
