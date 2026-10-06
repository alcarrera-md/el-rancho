const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { validar } = require('../src/middleware/validar');
const { paramsId } = require('../src/validation/comun');
const { cambiarPassword, login } = require('../src/validation/auth');
const animales = require('../src/validation/animales');
const ventas = require('../src/validation/ventas');
const compras = require('../src/validation/compras');
const alimentacion = require('../src/validation/alimentacion');

function appPara(esquemas, metodo = 'post') {
  const app = express();
  app.use(express.json());
  app[metodo]('/:id?', validar(esquemas), (req, res) => {
    res.json({ body: req.body, params: req.params });
  });
  return app;
}

function detalle(response, field) {
  return response.body.error.details.find((item) => item.field === field);
}

function comprobarFormato(response) {
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  assert.equal(response.body.error.message, 'Los datos enviados no son válidos.');
  assert.ok(Array.isArray(response.body.error.details));
}

test('rechaza campos obligatorios ausentes con el formato uniforme', async () => {
  const response = await request(appPara({ body: login })).post('/').send({ email: 'admin@rancho.com' });
  comprobarFormato(response);
  assert.deepEqual(detalle(response, 'password'), { field: 'password', message: 'Campo obligatorio.' });
});

test('la contraseña nueva admite frases de 12 a 72 caracteres', async () => {
  for (const password_nuevo of ['demasiado11', 'x'.repeat(73)]) {
    const response = await request(appPara({ body: cambiarPassword })).post('/').send({ password_actual: 'actual', password_nuevo });
    comprobarFormato(response);
    assert.ok(detalle(response, 'password_nuevo'));
  }
  const valida = await request(appPara({ body: cambiarPassword })).post('/').send({ password_actual: 'actual', password_nuevo: 'frase extensa' });
  assert.equal(valida.status, 200);
  assert.equal(valida.body.body.password_nuevo, 'frase extensa');
});

test('rechaza tipos incorrectos antes de llegar al controlador', async () => {
  const response = await request(appPara({ body: ventas.venta })).post('/').send({
    animal_id: { valor: 1 }, tercero_id: 2, precio: 100,
  });
  comprobarFormato(response);
  assert.equal(detalle(response, 'animal_id').message, 'Tipo de dato incorrecto.');
});

test('rechaza fechas inexistentes y fechas futuras cuando corresponde', async () => {
  const invalida = await request(appPara({ body: animales.alta })).post('/').send({
    arete_id: 'A-1', sexo: 'hembra', fecha_nacimiento: '2026-02-30',
  });
  comprobarFormato(invalida);
  assert.match(detalle(invalida, 'fecha_nacimiento').message, /fecha válida/);

  const year = new Date().getUTCFullYear() + 1;
  const futura = await request(appPara({ body: alimentacion.alimentacion })).post('/').send({
    animal_id: 1, insumo_id: 2, cantidad: 1, fecha: `${year}-01-01`,
  });
  comprobarFormato(futura);
  assert.match(detalle(futura, 'fecha').message, /futura/);
});

test('rechaza cantidades y precios negativos', async () => {
  const venta = await request(appPara({ body: ventas.venta })).post('/').send({
    animal_id: 1, tercero_id: 2, precio: -0.01,
  });
  comprobarFormato(venta);
  assert.match(detalle(venta, 'precio').message, /mayor o igual a cero/);

  const compra = await request(appPara({ body: compras.compraInsumo })).post('/').send({
    insumo_id: 1, tercero_id: 2, cantidad: -5,
  });
  comprobarFormato(compra);
  assert.match(detalle(compra, 'cantidad').message, /mayor que cero/);
});

test('rechaza valores fuera de enumeraciones', async () => {
  const response = await request(appPara({ body: animales.baja })).post('/').send({ estado: 'escapado' });
  comprobarFormato(response);
  assert.equal(
    detalle(response, 'estado').message,
    'Debe ser sacrificado o muerto. Las ventas deben registrarse mediante el módulo de ventas.'
  );
});

test('rechaza identificadores de ruta inválidos', async () => {
  const response = await request(appPara({ params: paramsId }, 'get')).get('/abc');
  comprobarFormato(response);
  assert.equal(detalle(response, 'id').message, 'Tipo de dato incorrecto.');
});

test('rechaza arreglos vacíos y duplicados en operaciones por lote', async () => {
  const vacio = await request(appPara({ body: ventas.ventaLote })).post('/').send({
    animal_ids: [], tercero_id: 1, precio_total: 100,
  });
  comprobarFormato(vacio);
  assert.match(detalle(vacio, 'animal_ids').message, /al menos/);

  const duplicado = await request(appPara({ body: alimentacion.alimentacionLote })).post('/').send({
    animal_ids: [1, 1], insumo_id: 2, cantidad: 3,
  });
  comprobarFormato(duplicado);
  assert.match(detalle(duplicado, 'animal_ids').message, /duplicados/);
});

test('rechaza propiedades inesperadas en una operación sensible', async () => {
  const response = await request(appPara({ body: ventas.venta })).post('/').send({
    animal_id: 1, tercero_id: 2, precio: 100, estado: 'vendido',
  });
  comprobarFormato(response);
  assert.deepEqual(detalle(response, 'estado'), { field: 'estado', message: 'Propiedad no permitida.' });
});

test('un payload válido llega al controlador con números de formulario normalizados', async () => {
  const response = await request(appPara({ body: compras.compraAnimalNuevo })).post('/').send({
    arete_id: ' MX-42 ', sexo: 'hembra', tercero_id: '7', precio: '12500.50', corral_id: '',
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.body.arete_id, 'MX-42');
  assert.equal(response.body.body.tercero_id, 7);
  assert.equal(response.body.body.precio, 12500.5);
  assert.equal(response.body.body.corral_id, undefined);
});

test('alimentación offline normaliza versión y stock observado sin aceptar valores absurdos', async () => {
  const valida = await request(appPara({ body: alimentacion.alimentacion })).post('/').send({
    animal_id: '4', insumo_id: '8', cantidad: '12.5', unidad_medida: ' kg ',
    expected_version: '3', stock_observado: '100',
  });
  assert.equal(valida.status, 200);
  assert.deepEqual(valida.body.body, {
    animal_id: 4, insumo_id: 8, cantidad: 12.5, unidad_medida: 'kg', expected_version: 3, stock_observado: 100,
  });

  const invalida = await request(appPara({ body: alimentacion.alimentacion })).post('/').send({
    animal_id: 4, insumo_id: 8, cantidad: 12.5, unidad_medida: 'kg', expected_version: 0, stock_observado: -1,
  });
  comprobarFormato(invalida);
  assert.ok(detalle(invalida, 'expected_version'));
  assert.ok(detalle(invalida, 'stock_observado'));
});

test('movimiento offline normaliza sus precondiciones y rechaza contexto inválido', async () => {
  const valida = await request(appPara({ body: animales.traslado })).post('/').send({
    corral_id: '8', corral_origen_id: '3', expected_version: '5', estado_observado: 'vivo',
    destino_ocupacion_observada: '9', destino_capacidad_observada: '10',
  });
  assert.equal(valida.status, 200);
  assert.deepEqual(valida.body.body, {
    corral_id: 8, corral_origen_id: 3, expected_version: 5, estado_observado: 'vivo',
    destino_ocupacion_observada: 9, destino_capacidad_observada: 10,
  });

  const invalida = await request(appPara({ body: animales.traslado })).post('/').send({
    corral_id: 8, corral_origen_id: 3, expected_version: 0, estado_observado: 'reactivado',
    destino_ocupacion_observada: -1,
  });
  comprobarFormato(invalida);
  assert.ok(detalle(invalida, 'expected_version'));
  assert.ok(detalle(invalida, 'estado_observado'));
  assert.ok(detalle(invalida, 'destino_ocupacion_observada'));
});

test('la importación rechaza propiedades desconocidas sin romper errores por fila existentes', async () => {
  const desconocida = await request(appPara({ body: animales.importacion })).post('/').send({
    animales: [{ fila: 2, arete_id: 'A-2', sexo: 'hembra', sql: 'inesperado' }],
  });
  comprobarFormato(desconocida);
  assert.deepEqual(detalle(desconocida, 'animales.0.sql'), {
    field: 'animales.0.sql', message: 'Propiedad no permitida.',
  });

  const filaIncompleta = await request(appPara({ body: animales.importacion })).post('/').send({
    animales: [{ fila: 2, arete_id: '', sexo: 'desconocido' }],
  });
  assert.equal(filaIncompleta.status, 200);
  assert.equal(filaIncompleta.body.body.animales[0].sexo, 'desconocido');
});

test('los errores funcionales anteriores siguen pudiendo ser cadenas JSON', async () => {
  const app = express();
  app.use(express.json());
  app.post('/', validar({ body: login }), (req, res) => res.status(401).json({ error: 'Correo o contraseña incorrectos.' }));

  const response = await request(app).post('/').send({ email: 'nadie@rancho.com', password: 'incorrecta' });
  assert.equal(response.status, 401);
  assert.equal(response.body.error, 'Correo o contraseña incorrectos.');
});
