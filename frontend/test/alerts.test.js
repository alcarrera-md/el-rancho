import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIAS_ALERTA, construirAlertas, describirFechaAlerta,
  obtenerAtencionInmediata, resumirAlertas,
} from '../src/alertas.js';

const referencia = new Date(2026, 7, 27, 12);

function datosCompletos() {
  return {
    vacunas: [
      { id: 1, animal_id: 10, arete_id: 'A-10', tipo: 'Refuerzo', proxima_dosis: '2026-08-26' },
      { id: 2, animal_id: 11, arete_id: 'A-11', tipo: 'Clostridial', proxima_dosis: '2026-08-28' },
    ],
    partos: [{ id: 3, madre_id: 12, madre_arete: 'A-12', fecha_parto_estimada: '2026-08-29' }],
    enfermos: [{ id: 13, arete_id: 'A-13', nombre_alias: 'Luna' }],
    observacion: [{ id: 14, arete_id: 'A-14' }],
    stock: [
      { id: 20, nombre: 'Sales', stock_actual: 0, stock_minimo: 5, unidad_medida: 'kg' },
      { id: 21, nombre: 'Forraje', stock_actual: 3, stock_minimo: 10, unidad_medida: 'kg' },
    ],
    corrales: [{ id: 30, nombre: 'Corral Norte', ocupacion_actual: 9, capacidad_maxima: 10, enfermos: 2 }],
    hato: {
      pesajes_atrasados: [{ corral_id: 30, corral: 'Corral Norte', atrasados: 4, total_corral: 9 }],
      mortalidad: { mes_actual: 1, mes_anterior: 1 },
      clusters: [{
        animal_ids: [13, 14], corrales: ['Corral Norte'],
        animales: [
          { id: 13, arete_id: 'A-13', estado: 'vivo', estado_salud: 'enfermo' },
          { id: 14, arete_id: 'A-14', estado: 'vivo', estado_salud: 'observacion' },
        ],
      }],
    },
    resumen: { plan_sanitario_pendiente: 2, tareas_pendientes: 3 },
  };
}

test('transforma fuentes existentes en alertas orientadas a tareas sin perder categorías', () => {
  const alertas = construirAlertas(datosCompletos(), referencia);
  const resumen = resumirAlertas(alertas);

  assert.deepEqual(CATEGORIAS_ALERTA.map((categoria) => categoria.id), ['sanidad', 'reproduccion', 'inventario', 'corrales', 'trabajo', 'hato']);
  assert.deepEqual(
    { total: resumen.total, critica: resumen.critica, advertencia: resumen.advertencia, info: resumen.info },
    { total: 14, critica: 5, advertencia: 7, info: 2 }
  );
  assert.deepEqual(resumen.categorias, { sanidad: 6, corrales: 3, inventario: 2, reproduccion: 1, hato: 1, trabajo: 1 });

  const vacuna = alertas.find((alerta) => alerta.id === 'vacuna-1');
  assert.equal(vacuna.entidad, 'Animal A-10');
  assert.equal(vacuna.accion.etiqueta, 'Ver animal');
  const stock = alertas.find((alerta) => alerta.id === 'stock-20');
  assert.equal(stock.accion.etiqueta, 'Ver inventario');
  const tareas = alertas.find((alerta) => alerta.id === 'tareas-pendientes');
  assert.equal(tareas.accion.vista, 'tareas');
});

test('la atención inmediata limita el scroll y conserva el orden de urgencia', () => {
  const alertas = construirAlertas(datosCompletos(), referencia);
  const inmediatas = obtenerAtencionInmediata(alertas, 4);
  assert.equal(inmediatas.length, 4);
  assert.ok(inmediatas.every((alerta) => alerta.severidad === 'critica'));
  assert.ok(!inmediatas.some((alerta) => alerta.severidad === 'info'));
});

test('conserva el detalle de brotes y expresa fechas en lenguaje operativo', () => {
  const alertas = construirAlertas(datosCompletos(), referencia);
  const brote = alertas.find((alerta) => alerta.tipo === 'Posible brote');
  assert.equal(brote.detalle.animales.length, 2);
  assert.equal(brote.detalle.animalAnclaId, 13);
  assert.equal(describirFechaAlerta('2026-08-26', referencia), 'ayer');
  assert.equal(describirFechaAlerta('2026-08-28', referencia), 'mañana');
});

