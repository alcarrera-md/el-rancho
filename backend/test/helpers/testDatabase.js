const { URL } = require('node:url');

function identidadBase(valor) {
  const url = new URL(valor);
  const puerto = url.port || '5432';
  const nombreBase = decodeURIComponent(url.pathname.replace(/^\//, '')).toLowerCase();
  return `${url.hostname.toLowerCase()}:${puerto}/${nombreBase}`;
}

function validarTestDatabaseUrl(env = process.env) {
  const valor = env.TEST_DATABASE_URL;
  if (!valor) {
    throw new Error('TEST_DATABASE_URL es obligatoria para pruebas de integración con PostgreSQL.');
  }

  let testUrl;
  try {
    testUrl = new URL(valor);
  } catch {
    throw new Error('TEST_DATABASE_URL no es una URL válida.');
  }

  if (!['postgres:', 'postgresql:'].includes(testUrl.protocol)) {
    throw new Error('TEST_DATABASE_URL debe usar el protocolo postgres:// o postgresql://.');
  }

  const nombreBase = decodeURIComponent(testUrl.pathname.replace(/^\//, '')).toLowerCase();
  if (!nombreBase || !nombreBase.includes('test')) {
    throw new Error('La base indicada por TEST_DATABASE_URL debe incluir "test" en su nombre.');
  }

  if (env.DATABASE_URL) {
    let identidadNormal;
    try {
      identidadNormal = identidadBase(env.DATABASE_URL);
    } catch {
      throw new Error('DATABASE_URL no es una URL válida; no se puede comprobar el aislamiento de pruebas.');
    }
    if (identidadNormal === identidadBase(valor)) {
      throw new Error('TEST_DATABASE_URL no puede apuntar a la misma base que DATABASE_URL.');
    }
  }

  return valor;
}

module.exports = { validarTestDatabaseUrl };
