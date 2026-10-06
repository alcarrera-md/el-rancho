const path = require('node:path');
const dotenv = require('dotenv');
const { validarTestDatabaseUrl } = require('./testDatabase');

function cargarEntornoPruebas() {
  const backendDir = path.resolve(__dirname, '..', '..');
  dotenv.config({ path: path.join(backendDir, '.env'), quiet: true });
  dotenv.config({ path: path.join(backendDir, '.env.test'), quiet: true });

  const testDatabaseUrl = validarTestDatabaseUrl(process.env);
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.JWT_SECRET ||= 'secreto-exclusivo-para-pruebas';
  return testDatabaseUrl;
}

module.exports = { cargarEntornoPruebas };
