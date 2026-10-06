import test from 'node:test';
import assert from 'node:assert/strict';
import { mensajeErrorClima } from '../src/climaUx.js';

test('distingue los fallos operativos del clima en la interfaz', () => {
  const mensajes = [
    'OFFLINE',
    'CLIMA_UBICACION_FALTANTE',
    'CLIMA_CONFIG_INVALIDA',
    'CLIMA_TIMEOUT',
    'CLIMA_PROVEEDOR_RECHAZO',
    'CLIMA_TRANSPORTE_ERROR',
    'CLIMA_RESPUESTA_INVALIDA',
  ].map((code) => mensajeErrorClima({ code }));

  assert.equal(new Set(mensajes).size, mensajes.length);
  assert.match(mensajes[0], /Sin conexión/);
  assert.match(mensajes[1], /ubicación/);
  assert.match(mensajes[3], /tiempo/);
  assert.match(mensajes[4], /rechazó/);
});

test('conserva un mensaje seguro para errores desconocidos', () => {
  assert.equal(mensajeErrorClima({}), 'No se pudo cargar el clima.');
});
