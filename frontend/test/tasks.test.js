import test from 'node:test';
import assert from 'node:assert/strict';
import { agruparMisTareas, ejecutarCargaEnEfecto, esTareaVencida, normalizarTarea, resumirTareas, textoCantidadSugerida, TIPOS_TAREA } from '../src/tareas.js';

test('el efecto de Tareas no devuelve la promesa del cargador como cleanup', async () => {
  let resolver;
  const promesa = new Promise((resolve) => { resolver = resolve; });
  let llamadas = 0;
  const retorno = ejecutarCargaEnEfecto(() => {
    llamadas += 1;
    return promesa;
  });

  assert.equal(retorno, undefined);
  assert.equal(llamadas, 1);
  resolver();
  await promesa;
});

test('normaliza tareas históricas sin perder descripción, fecha ni completada', () => {
  const tarea = normalizarTarea({ descripcion: 'Alimentar corral', fecha: '2026-08-20', completada: true, trabajador: 'César' });
  assert.equal(tarea.titulo, 'Alimentar corral');
  assert.equal(tarea.fecha_limite, '2026-08-20');
  assert.equal(tarea.estado, 'completada');
  assert.equal(tarea.responsable, 'César');
});

test('alimentación con cantidad y sin insumo conserva visible la cantidad sugerida', () => {
  assert.equal(textoCantidadSugerida({ tipo: 'alimentacion', cantidad: '12.50', insumo_id: null }), '12.50');
  assert.equal(textoCantidadSugerida({ tipo: 'alimentacion', cantidad: '12.50', unidad_medida: 'kg', insumo: 'Maíz' }), '12.50 kg');
  assert.equal(textoCantidadSugerida({ tipo: 'revision_salud', cantidad: '12.50' }), null);
});

test('resume y agrupa el trabajo propio por atención, próximas y completadas', () => {
  const tareas = [
    { id: 1, titulo: 'Vencida', estado: 'pendiente', fecha_limite: '2026-08-19' },
    { id: 2, titulo: 'Hoy', estado: 'en_progreso', fecha_limite: '2026-08-20' },
    { id: 3, titulo: 'Próxima', estado: 'pendiente', fecha_limite: '2026-08-21' },
    { id: 4, titulo: 'Lista', estado: 'completada', fecha_limite: '2026-08-18' },
  ];
  assert.equal(esTareaVencida(tareas[0], '2026-08-20'), true);
  assert.deepEqual(resumirTareas(tareas, '2026-08-20'), { pendientes: 3, vencidas: 1, completadas: 1, hoy: 1 });
  const grupos = agruparMisTareas(tareas, '2026-08-20');
  assert.deepEqual(grupos.hoy.map((tarea) => tarea.id), [1, 2]);
  assert.deepEqual(grupos.proximas.map((tarea) => tarea.id), [3]);
  assert.deepEqual(grupos.completadas.map((tarea) => tarea.id), [4]);
  assert.equal(TIPOS_TAREA.length, 7);
});
