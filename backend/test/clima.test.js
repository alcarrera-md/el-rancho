const test = require('node:test');
const assert = require('node:assert/strict');
const { errorUbicacion, solicitarPronostico, validarRespuesta } = require('../src/clima');

const payloadValido = {
  list: [{ dt_txt: '2026-09-09 12:00:00', main: { temp: 24 }, pop: 0.2, wind: { speed: 3 }, weather: [{ description: 'nubes' }] }],
};

test('clima distingue ubicación faltante de coordenadas inválidas', () => {
  assert.equal(errorUbicacion('', -99).code, 'CLIMA_UBICACION_FALTANTE');
  assert.equal(errorUbicacion(19, null).code, 'CLIMA_UBICACION_FALTANTE');
  assert.equal(errorUbicacion(91, -99).code, 'CLIMA_CONFIG_INVALIDA');
  assert.equal(errorUbicacion(19, -181).code, 'CLIMA_CONFIG_INVALIDA');
  assert.deepEqual(errorUbicacion('19.4', '-99.1'), { latitud: 19.4, longitud: -99.1 });
});

test('clima valida el contrato mínimo de OpenWeatherMap', () => {
  assert.equal(validarRespuesta(payloadValido), true);
  assert.equal(validarRespuesta({ list: [] }), false);
  assert.equal(validarRespuesta({ list: [{ dt_txt: 'fecha', main: {}, weather: [] }] }), false);
});

test('clima clasifica timeout, transporte, rechazo y respuesta inválida', async () => {
  const timeout = () => new Promise((_resolve, reject) => {
    const error = new Error('abortada'); error.name = 'AbortError';
    setTimeout(() => reject(error), 2);
  });
  await assert.rejects(solicitarPronostico(19, -99, { fetchImpl: timeout, timeoutMs: 5, apiKey: 'prueba' }), { code: 'CLIMA_TIMEOUT' });
  await assert.rejects(solicitarPronostico(19, -99, { fetchImpl: async () => { throw new TypeError('sin ruta'); }, apiKey: 'prueba' }), { code: 'CLIMA_TRANSPORTE_ERROR' });
  await assert.rejects(solicitarPronostico(19, -99, { fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ message: 'rechazo privado' }) }), apiKey: 'prueba' }), { code: 'CLIMA_PROVEEDOR_RECHAZO' });
  await assert.rejects(solicitarPronostico(19, -99, { fetchImpl: async () => ({ ok: true, json: async () => ({ list: [] }) }), apiKey: 'prueba' }), { code: 'CLIMA_RESPUESTA_INVALIDA' });
});

test('clima acepta una respuesta válida sin exponer la clave', async () => {
  const datos = await solicitarPronostico(19, -99, { fetchImpl: async () => ({ ok: true, json: async () => payloadValido }), apiKey: 'no-se-registra' });
  assert.equal(datos.list.length, 1);
});
