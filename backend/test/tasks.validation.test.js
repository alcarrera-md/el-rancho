const test = require('node:test');
const assert = require('node:assert/strict');
const esquemas = require('../src/validation/asignaciones');

const valida = {
  titulo: 'Revisar salud del corral norte',
  descripcion: 'Comprobar apetito y temperatura de los animales marcados.',
  tipo: 'revision_salud',
  trabajador_id: 2,
  corral_id: 1,
  animal_id: 3,
  fecha_limite: '2026-08-28',
  prioridad: 'alta',
};

test('valida una tarea operativa completa y normaliza identificadores de formulario', () => {
  const resultado = esquemas.crear.safeParse({ ...valida, trabajador_id: '2', corral_ids: ['1', '4', '1'], cantidad: '' });
  assert.equal(resultado.success, true);
  assert.equal(resultado.data.trabajador_id, 2);
  assert.equal(resultado.data.cantidad, undefined);
  assert.deepEqual(resultado.data.corral_ids, [1, 4]);
});

test('rechaza tipos, prioridad, fecha e identificadores inválidos', () => {
  const resultado = esquemas.crear.safeParse({
    ...valida, tipo: 'codigo_inventado', prioridad: 'máxima', fecha_limite: 'mañana', animal_id: -1,
  });
  assert.equal(resultado.success, false);
  const campos = resultado.error.issues.map((issue) => issue.path.join('.'));
  assert.ok(campos.includes('tipo'));
  assert.ok(campos.includes('prioridad'));
  assert.ok(campos.includes('fecha_limite'));
  assert.ok(campos.includes('animal_id'));
});

test('edición permite limpiar contexto opcional pero no payload vacío', () => {
  assert.deepEqual(esquemas.editar.parse({ corral_id: null, animal_id: '', insumo_id: null, cantidad: null }), {
    corral_id: null, animal_id: null, insumo_id: null, cantidad: null,
  });
  assert.equal(esquemas.editar.safeParse({}).success, false);
  assert.deepEqual(esquemas.editar.parse({ corral_ids: [] }), { corral_ids: [] });
});
