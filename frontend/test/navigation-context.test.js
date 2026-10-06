import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { construirAlertas } from '../src/alertas.js';
import {
  accionesContextualesTarea, actualizarContexto, crearRutaContextual, leerIdContexto,
  seccionSeguimientoValida,
} from '../src/navigationContext.js';

const leer = (ruta) => readFileSync(new URL(`../${ruta}`, import.meta.url), 'utf8');

test('alerta de stock conserva el insumo al abrir inventario', () => {
  const [alerta] = construirAlertas({ stock: [{ id: 12, nombre: 'Heno', stock_actual: 2, stock_minimo: 8, unidad_medida: 'kg' }] });
  assert.deepEqual(alerta.accion, { tipo: 'vista', vista: 'insumos', etiqueta: 'Ver inventario', contexto: { insumo: 12 } });
  assert.equal(crearRutaContextual('/insumos', alerta.accion.contexto), '/insumos?insumo=12');
});

test('insumo abre Compras con inventario, intención y preselección persistentes', () => {
  assert.equal(crearRutaContextual('/compras', { vista: 'insumos', insumo: 7, accion: 'comprar' }), '/compras?vista=insumos&insumo=7&accion=comprar');
  const insumos = leer('src/components/InsumosList.jsx');
  const compras = leer('src/components/ComprasList.jsx');
  assert.match(insumos, /crearRutaContextual\('\/compras', \{ vista: 'insumos', insumo: insumo\.id, accion: 'comprar' \}\)/);
  assert.match(compras, /RegistrarCompraInsumoModal insumoInicialId=\{insumoContextoId \|\| ''\}/);
});

test('tarea vinculada a animal abre su seguimiento en la sección adecuada', () => {
  assert.deepEqual(accionesContextualesTarea({ animal_id: 42, tipo: 'revision_salud' })[0], {
    id: 'animal', etiqueta: 'Ver animal', ruta: '/animales/42/seguimiento?seccion=salud',
  });
});

test('tarea vinculada a corral conserva el corral', () => {
  assert.deepEqual(accionesContextualesTarea({ corral_id: 3, tipo: 'revision_salud' }), [
    { id: 'corral', etiqueta: 'Ver corral', ruta: '/corrales?corral=3' },
  ]);
});

test('corral abre Movimientos y Animales con el mismo identificador', () => {
  const corrales = leer('src/components/CorralesList.jsx');
  assert.match(corrales, /crearRutaContextual\('\/movimientos', \{ corral: corral\.id \}\)/);
  assert.match(corrales, /crearRutaContextual\('\/animales', \{ corral: corral\.id \}\)/);
});

test('solo acepta parámetros de entidad enteros positivos', () => {
  assert.equal(leerIdContexto('?insumo=0012', 'insumo'), '12');
  assert.equal(leerIdContexto('?corral=3', 'corral'), '3');
  for (const invalido of ['', '0', '-1', '12x', '1.5', 'undefined']) assert.equal(leerIdContexto(`?animal=${invalido}`, 'animal'), null);
});

test('limpiar un filtro conserva el resto del contexto', () => {
  const resultado = actualizarContexto(new URLSearchParams('insumo=12&vista=insumos&accion=comprar'), { insumo: null, accion: null });
  assert.equal(resultado.toString(), 'vista=insumos');
});

test('recargar la misma URL reconstruye el contexto sin estado React', () => {
  const url = crearRutaContextual('/movimientos', { corral: 3 });
  const search = new URL(`http://local${url}`).search;
  assert.equal(leerIdContexto(search, 'corral'), '3');
});

test('Seguimiento guarda la sección en URL y tolera una sección inválida', () => {
  const seguimiento = leer('src/components/SeguimientoAnimal.jsx');
  assert.match(seguimiento, /setParametros\(actualizarContexto\(parametros, \{ seccion:/);
  assert.equal(seccionSeguimientoValida('pesajes'), 'pesajes');
  assert.equal(seccionSeguimientoValida('desconocida'), 'info');
});

test('los módulos contextuales ofrecen una salida visible del filtro', () => {
  const contexto = leer('src/components/ContextoNavegacion.jsx');
  for (const componente of ['InsumosList.jsx', 'ComprasList.jsx', 'CorralesList.jsx', 'Movimientos.jsx', 'AnimalesList.jsx']) {
    assert.match(leer(`src/components/${componente}`), /ContextoNavegacion/);
  }
  assert.match(contexto, /Quitar filtro/);
});
