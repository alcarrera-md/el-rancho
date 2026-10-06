import test from 'node:test';
import assert from 'node:assert/strict';
import { construirAtencionAnimal, TAREAS_LOTE, TAREAS_MOVIMIENTOS } from '../src/guidedUx.js';

test('la presentación de movimientos distingue las tres tareas sin fingir traslado masivo', () => {
  assert.deepEqual(TAREAS_MOVIMIENTOS.map((tarea) => tarea.id), ['individual', 'varios', 'historial']);
  assert.equal(TAREAS_MOVIMIENTOS.find((tarea) => tarea.id === 'varios').noDisponible, true);
});

test('las tareas por lote declaran el permiso que controla su visibilidad', () => {
  assert.deepEqual(TAREAS_LOTE.map((tarea) => tarea.id), ['pesaje', 'salud', 'alimentacion', 'venta']);
  assert.ok(TAREAS_LOTE.every((tarea) => tarea.permiso.length === 2));
});

test('el resumen del animal prioriza salud y pendientes reales', () => {
  const atencion = construirAtencionAnimal({
    animal: { estado: 'vivo', estado_salud: 'observacion' },
    pendientesPlan: 2,
    recomendaciones: ['Revisar peso'],
  });
  assert.equal(atencion.tono, 'atencion');
  assert.equal(atencion.avisos.length, 3);
  assert.match(atencion.avisos.join(' '), /revisión/);

  const estable = construirAtencionAnimal({ animal: { estado: 'vivo', estado_salud: 'sano' } });
  assert.equal(estable.tono, 'estable');
  assert.match(estable.avisos[0], /No hay alertas/);
});
