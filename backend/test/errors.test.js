const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { crearError, integracion, noEncontrado } = require('../src/errors');
const { autorizarSolicitud } = require('../src/authorization/policy');
const { crearManejadorErrores, normalizarRespuestasLegacy } = require('../src/middleware/errorHandler');

function appConError(error, logs = []) {
  const app = express();
  app.use(express.json());
  app.use(normalizarRespuestasLegacy);
  app.get('/', (req, res, next) => next(error));
  app.use(crearManejadorErrores({ error: (...args) => logs.push(args) }));
  return app;
}

test('serializa un error conocido de aplicación sin enviar su causa', async () => {
  const error = crearError('OPERACION_NO_DISPONIBLE', 'La operación no está disponible.', 409, {
    details: [{ field: 'estado', message: 'Debe estar activo.' }],
    cause: new Error('detalle interno secreto'),
  });
  const response = await request(appConError(error)).get('/');

  assert.equal(response.status, 409);
  assert.deepEqual(response.body, {
    error: {
      code: 'OPERACION_NO_DISPONIBLE',
      message: 'La operación no está disponible.',
      details: [{ field: 'estado', message: 'Debe estar activo.' }],
    },
  });
  assert.doesNotMatch(JSON.stringify(response.body), /secreto|stack|cause/i);
});

test('representa un recurso inexistente con código estable', async () => {
  const response = await request(appConError(
    noEncontrado('ANIMAL_NO_ENCONTRADO', 'No se encontró el animal solicitado.')
  )).get('/');

  assert.equal(response.status, 404);
  assert.deepEqual(response.body.error, {
    code: 'ANIMAL_NO_ENCONTRADO',
    message: 'No se encontró el animal solicitado.',
  });
});

test('representa una denegación de autorización sin exponer el rol', async () => {
  const app = express();
  app.use(normalizarRespuestasLegacy);
  app.use((req, res, next) => {
    req.usuario = { id: 7, rol: 'Trabajador' };
    next();
  });
  app.get('/api/usuarios', autorizarSolicitud, (req, res) => res.json({ ok: true }));
  app.use(crearManejadorErrores({ error: () => {} }));

  const response = await request(app).get('/api/usuarios');
  assert.equal(response.status, 403);
  assert.deepEqual(response.body.error, {
    code: 'AUTHORIZATION_ERROR',
    message: 'Tu rol no tiene permiso para realizar esta acción.',
  });
  assert.doesNotMatch(JSON.stringify(response.body), /Trabajador/);
});

test('traduce 23505 sin exponer constraint ni detalle PostgreSQL', async () => {
  const logs = [];
  const pgError = Object.assign(new Error('duplicate key value violates unique constraint "secreto_key"'), {
    code: '23505',
    constraint: 'secreto_key',
    detail: 'Key (email)=(privado@interno) already exists.',
  });
  const response = await request(appConError(pgError, logs)).get('/');

  assert.equal(response.status, 409);
  assert.deepEqual(response.body.error, {
    code: 'DUPLICATE_RESOURCE',
    message: 'Ya existe un registro con los datos proporcionados.',
  });
  assert.doesNotMatch(JSON.stringify(response.body), /secreto_key|privado@interno|duplicate key/i);
  assert.equal(logs[0][1].internal.constraint, 'secreto_key');
});

test('traduce 23503 como referencia inválida', async () => {
  const error = Object.assign(new Error('violates foreign key constraint'), { code: '23503' });
  const response = await request(appConError(error)).get('/');

  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'INVALID_REFERENCE');
  assert.doesNotMatch(JSON.stringify(response.body), /foreign key/i);
});

test('traduce 23514 como restricción de datos', async () => {
  const error = Object.assign(new Error('violates check constraint "precio_check"'), {
    code: '23514', constraint: 'precio_check',
  });
  const response = await request(appConError(error)).get('/');

  assert.equal(response.status, 422);
  assert.deepEqual(response.body.error, {
    code: 'DATA_CONSTRAINT_ERROR',
    message: 'Los datos no cumplen las restricciones requeridas.',
  });
  assert.doesNotMatch(JSON.stringify(response.body), /precio_check|check constraint/i);
});

test('clasifica una regla de negocio de trigger sólo después de reconocer P0001', async () => {
  const error = Object.assign(new Error('Stock insuficiente del insumo 9 (disponible: 1).'), {
    code: 'P0001',
  });
  const response = await request(appConError(error)).get('/');

  assert.equal(response.status, 409);
  assert.deepEqual(response.body.error, {
    code: 'STOCK_INSUFICIENTE',
    message: 'No hay stock suficiente para realizar la operación.',
  });
  assert.doesNotMatch(JSON.stringify(response.body), /insumo 9|disponible: 1/i);
});

test('un mensaje parecido sin código PostgreSQL no se trata como trigger', async () => {
  const response = await request(appConError(new Error('Stock insuficiente; SELECT * FROM insumo'))).get('/');
  assert.equal(response.status, 500);
  assert.equal(response.body.error.code, 'INTERNAL_ERROR');
});

test('oculta mensaje, SQL y stack de un error interno inesperado', async () => {
  const error = new Error('relation "usuario" does not exist; SELECT password_hash FROM usuario');
  const response = await request(appConError(error)).get('/');
  const texto = JSON.stringify(response.body);

  assert.equal(response.status, 500);
  assert.deepEqual(response.body.error, {
    code: 'INTERNAL_ERROR',
    message: 'Ocurrió un error interno. Intenta nuevamente más tarde.',
  });
  assert.doesNotMatch(texto, /relation|SELECT|password_hash|errors\.test|stack/i);
});

test('representa fallos de integración con mensaje público y causa privada', async () => {
  const error = integracion(
    'CLIMA_NO_DISPONIBLE',
    'No fue posible obtener el pronóstico del clima.',
    new Error('OPENWEATHERMAP_API_KEY=secreto')
  );
  const response = await request(appConError(error)).get('/');

  assert.equal(response.status, 502);
  assert.deepEqual(response.body.error, {
    code: 'CLIMA_NO_DISPONIBLE',
    message: 'No fue posible obtener el pronóstico del clima.',
  });
  assert.doesNotMatch(JSON.stringify(response.body), /API_KEY|secreto/);
});

test('normaliza respuestas legacy sin romper su mensaje público', async () => {
  const app = express();
  app.use(normalizarRespuestasLegacy);
  app.get('/', (req, res) => res.status(404).json({ error: 'Animal no encontrado' }));

  const response = await request(app).get('/');
  assert.deepEqual(response.body.error, {
    code: 'ANIMAL_NO_ENCONTRADO',
    message: 'Animal no encontrado',
  });
});

test('el frontend interpreta respuestas antiguas y nuevas', async () => {
  const { crearErrorApi } = await import('../../frontend/src/api.js');

  const anterior = crearErrorApi('Mensaje anterior.', 400);
  assert.equal(anterior.message, 'Mensaje anterior.');
  assert.equal(anterior.code, undefined);

  const nuevo = crearErrorApi({
    code: 'CONFLICT',
    message: 'La operación no puede realizarse.',
    details: [{ field: 'estado', message: 'Estado inválido.' }],
  }, 409);
  assert.equal(nuevo.message, 'La operación no puede realizarse.');
  assert.equal(nuevo.code, 'CONFLICT');
  assert.deepEqual(nuevo.details, [{ field: 'estado', message: 'Estado inválido.' }]);
});
