import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES } from '../src/authorization/permissions.js';
import { GRUPOS_NAVEGACION } from '../src/navigation.js';
import {
  RUTA_DESPUES_LOGOUT, evaluarAccesoRuta, esAnimalNoEncontrado, obtenerAreteLegacy,
  rutaParaVista, rutaSeguimientoAnimal, vistaParaRuta,
} from '../src/routing.js';

const { ADMINISTRADOR: A, VETERINARIO: V, TRABAJADOR: T, AUDITOR: U } = ROLES;

test('la ruta inicial monta Inicio', () => {
  assert.equal(vistaParaRuta('/'), 'inicio');
  assert.deepEqual(evaluarAccesoRuta(T, '/'), { estado: 'permitida', vista: 'inicio' });
});

test('cada entrada del sidebar tiene una URL persistente reconocida', () => {
  for (const item of GRUPOS_NAVEGACION.flatMap((grupo) => grupo.items)) {
    const ruta = rutaParaVista(item.id);
    assert.equal(vistaParaRuta(ruta), item.id, `${item.id} -> ${ruta}`);
  }
});

test('una ruta protegida permitida se resuelve para el rol vigente', () => {
  assert.deepEqual(evaluarAccesoRuta(U, '/bitacora'), { estado: 'permitida', vista: 'bitacora' });
});

test('perfil, apariencia y sincronización son personales; las demás subrutas conservan permiso administrativo', () => {
  assert.deepEqual(evaluarAccesoRuta(T, '/perfil'), { estado: 'permitida', vista: 'perfil' });
  assert.deepEqual(evaluarAccesoRuta(T, '/configuracion/apariencia'), { estado: 'permitida', vista: 'apariencia' });
  assert.deepEqual(evaluarAccesoRuta(T, '/configuracion/sincronizacion'), { estado: 'permitida', vista: 'sincronizacion' });
  assert.deepEqual(evaluarAccesoRuta(V, '/configuracion/sincronizacion'), { estado: 'permitida', vista: 'sincronizacion' });
  assert.deepEqual(evaluarAccesoRuta(T, '/configuracion/sistema'), { estado: 'denegada', vista: 'configuracion' });
  assert.deepEqual(evaluarAccesoRuta(U, '/configuracion/sistema'), { estado: 'permitida', vista: 'configuracion' });
});

test('una ruta protegida denegada se distingue de una ruta inexistente', () => {
  assert.deepEqual(evaluarAccesoRuta(T, '/usuarios'), { estado: 'denegada', vista: 'usuarios' });
});

test('un animal válido usa la URL canónica de seguimiento', () => {
  assert.equal(rutaSeguimientoAnimal(42), '/animales/42/seguimiento');
  assert.deepEqual(evaluarAccesoRuta(T, '/animales/42/seguimiento'), { estado: 'permitida', vista: 'seguimiento' });
  assert.equal(vistaParaRuta('/animales/42'), 'seguimiento');
});

test('un animal inexistente se reconoce por estado o código estructurado', () => {
  assert.equal(esAnimalNoEncontrado({ status: 404 }), true);
  assert.equal(esAnimalNoEncontrado({ code: 'ANIMAL_NO_ENCONTRADO' }), true);
  assert.equal(esAnimalNoEncontrado({ status: 500 }), false);
});

test('el deep link antiguo conserva el arete y puede migrar al destino canónico', () => {
  assert.equal(obtenerAreteLegacy('?animal=MX-204'), 'MX-204');
  assert.equal(obtenerAreteLegacy('?otro=1'), null);
  assert.equal(rutaSeguimientoAnimal(204), '/animales/204/seguimiento');
});

test('una URL inexistente produce un 404 interno', () => {
  assert.deepEqual(evaluarAccesoRuta(A, '/modulo-que-no-existe'), { estado: 'no_encontrada', vista: null });
  assert.equal(vistaParaRuta('/animales/no-es-un-id/seguimiento'), null);
});

test('un cambio de rol modifica inmediatamente la decisión de acceso', () => {
  assert.equal(evaluarAccesoRuta(A, '/usuarios').estado, 'permitida');
  assert.equal(evaluarAccesoRuta(U, '/usuarios').estado, 'denegada');
});

test('logout tiene un destino público y controlado', () => {
  assert.equal(RUTA_DESPUES_LOGOUT, '/');
});
