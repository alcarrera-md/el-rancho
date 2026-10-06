const test = require('node:test');
const assert = require('node:assert/strict');
const { contextoIdempotencia, hashPayload } = require('../src/idempotency');

function solicitud(headers = {}) {
  return { headers };
}

test('el hash idempotente es estable ante distinto orden de propiedades', () => {
  const primero = hashPayload('pesaje.crear', 'pesaje', { body: { animal_id: 7, peso_kg: 420 } });
  const segundo = hashPayload('pesaje.crear', 'pesaje', { body: { peso_kg: 420, animal_id: 7 } });
  assert.equal(primero, segundo);
  assert.match(primero, /^[0-9a-f]{64}$/);
});

test('una operación offline exige clave e instalación UUID', () => {
  assert.throws(
    () => contextoIdempotencia(solicitud({ 'x-offline-operation': 'true' })),
    (error) => error.code === 'IDEMPOTENCY_KEY_REQUIRED' && error.status === 400
  );
  assert.throws(
    () => contextoIdempotencia(solicitud({
      'x-offline-operation': 'true',
      'idempotency-key': '50cf3854-2f49-4bb8-8b30-646f5ab99a2a',
    })),
    (error) => error.code === 'INSTALLATION_ID_REQUIRED' && error.status === 400
  );
});

test('la metadata acepta únicamente UUID y fecha ISO con zona', () => {
  assert.throws(
    () => contextoIdempotencia(solicitud({ 'idempotency-key': 'no-es-uuid' })),
    (error) => error.code === 'INVALID_IDEMPOTENCY_KEY'
  );
  const contexto = contextoIdempotencia(solicitud({
    'x-offline-operation': 'true',
    'idempotency-key': '50cf3854-2f49-4bb8-8b30-646f5ab99a2a',
    'x-client-installation-id': 'e1a49024-ed70-4d30-9322-b21f434afaaf',
    'x-client-local-timestamp': '2026-09-01T06:30:00-06:00',
  }));
  assert.equal(contexto.offline, true);
  assert.equal(contexto.habilitada, true);
  assert.equal(contexto.fechaLocal.toISOString(), '2026-09-01T12:30:00.000Z');
});
