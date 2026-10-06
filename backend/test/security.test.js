const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { crearLimitadorLogin } = require('../src/middleware/authRateLimit');
const { crearOpcionesCors, validarJwtSecret } = require('../src/securityConfig');

test('JWT_SECRET exige al menos 32 caracteres y rechaza placeholders', () => {
  assert.throws(() => validarJwtSecret({ JWT_SECRET: 'corto' }), /al menos 32/);
  assert.throws(() => validarJwtSecret({ JWT_SECRET: 'reemplaza_por_un_secreto_largo_y_aleatorio' }), /aleatorio/);
  assert.equal(validarJwtSecret({ JWT_SECRET: '9fK!r2xQ7vLm4pZa8nWs3dYe6uIo1cBh' }).length, 32);
});

test('CORS acepta lista explícita, desarrollo LAN y rechaza orígenes externos', async () => {
  const produccion = crearOpcionesCors({ NODE_ENV: 'production', CORS_ORIGINS: 'https://rancho.example' });
  await new Promise((resolve) => produccion.origin('https://rancho.example', (error, permitido) => { assert.ifError(error); assert.equal(permitido, true); resolve(); }));
  await new Promise((resolve) => produccion.origin('https://evil.example', (error, permitido) => { assert.ifError(error); assert.equal(permitido, false); resolve(); }));
  const desarrollo = crearOpcionesCors({ NODE_ENV: 'development' });
  await new Promise((resolve) => desarrollo.origin('http://192.168.1.20:5173', (error, permitido) => { assert.ifError(error); assert.equal(permitido, true); resolve(); }));
});

test('el rate limit afecta solo el punto donde se monta y responde de forma genérica', async () => {
  const app = express();
  app.post('/login', crearLimitadorLogin({ NODE_ENV: 'production', AUTH_RATE_LIMIT_MAX: '2', AUTH_RATE_LIMIT_WINDOW_MINUTES: '1' }), (req, res) => res.status(401).json({ error: 'fallo' }));
  app.get('/operacion-normal', (req, res) => res.json({ ok: true }));
  assert.equal((await request(app).post('/login')).status, 401);
  assert.equal((await request(app).post('/login')).status, 401);
  const limitada = await request(app).post('/login');
  assert.equal(limitada.status, 429);
  assert.equal(limitada.body.error.code, 'AUTH_RATE_LIMITED');
  assert.equal((await request(app).get('/operacion-normal')).status, 200);
});
