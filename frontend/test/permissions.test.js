import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MATRIZ_PERMISOS, ROLES, puedeEliminarNota, puedeVerVista, tienePermiso } from '../src/authorization/permissions.js';
import { etiquetaVista, gruposVisibles } from '../src/navigation.js';
import { ACCIONES_CAMPO, accionesCampoDisponibles, crearGuardiaEnvio, fechaLocalISO } from '../src/fieldActions.js';

const require = createRequire(import.meta.url);
const { MATRIZ_PERMISOS: MATRIZ_BACKEND } = require('../../backend/src/authorization/policy.js');

const { ADMINISTRADOR: A, VETERINARIO: V, TRABAJADOR: T, AUDITOR: U } = ROLES;

test('la matriz del frontend coincide con la autoridad del backend', () => {
  assert.deepEqual(MATRIZ_PERMISOS, MATRIZ_BACKEND);
});

test('Administrador conserva las operaciones administrativas', () => {
  assert.equal(tienePermiso(A, 'usuarios', 'crear'), true);
  assert.equal(tienePermiso(A, 'insumos', 'editar'), true);
  assert.equal(tienePermiso(A, 'asistente', 'confirmar'), false);
});

test('Auditor accede a lectura y nunca a controles operativos', () => {
  for (const vista of ['animales', 'planes-sanitarios', 'reproduccion', 'alimentacion', 'gastos', 'terceros', 'bitacora', 'configuracion']) {
    assert.equal(puedeVerVista(U, vista), true, vista);
  }
  assert.equal(puedeVerVista(U, 'lote'), false);
  assert.equal(puedeVerVista(U, 'usuarios'), false);
  assert.equal(tienePermiso(U, 'notas_seguimiento', 'crear'), false);
  assert.equal(tienePermiso(U, 'bitacora', 'enviar_corte'), false);
  assert.equal(puedeEliminarNota(U, 7, 7), false);
});

test('Veterinario conserva acciones clínicas sin administrar insumos', () => {
  assert.equal(tienePermiso(V, 'salud', 'crear'), true);
  assert.equal(tienePermiso(V, 'reproduccion', 'editar'), true);
  assert.equal(tienePermiso(V, 'planes_sanitarios', 'asignar'), true);
  assert.equal(tienePermiso(V, 'insumos', 'crear'), false);
  assert.equal(tienePermiso(V, 'insumos', 'editar'), false);
});

test('Trabajador solo reporta observación y no administra razas', () => {
  assert.equal(tienePermiso(T, 'animales', 'reportar_observacion'), true);
  assert.equal(tienePermiso(T, 'animales', 'estado_clinico'), false);
  assert.equal(tienePermiso(T, 'alimentacion', 'crear'), true);
  assert.equal(tienePermiso(T, 'razas', 'crear'), false);
  assert.equal(puedeVerVista(T, 'configuracion'), false);
  assert.equal(puedeVerVista(V, 'configuracion'), false);
  assert.equal(puedeVerVista(U, 'configuracion'), true);
});

test('las notas propias respetan rol y autoría', () => {
  assert.equal(puedeEliminarNota(V, 7, 7), true);
  assert.equal(puedeEliminarNota(V, 7, 8), false);
  assert.equal(puedeEliminarNota(A, 7, 8), true);
});

test('la navegación agrupa solo vistas permitidas para cada rol', () => {
  const vistasAuditor = gruposVisibles(U).flatMap((grupo) => grupo.items.map((item) => item.id));
  assert.equal(vistasAuditor.includes('bitacora'), true);
  assert.equal(vistasAuditor.includes('usuarios'), false);
  assert.equal(vistasAuditor.includes('lote'), false);

  const vistasAdministrador = gruposVisibles(A).flatMap((grupo) => grupo.items.map((item) => item.id));
  assert.equal(vistasAdministrador.includes('usuarios'), true);
  assert.equal(vistasAdministrador.includes('lote'), true);

  const vistasTrabajador = gruposVisibles(T).flatMap((grupo) => grupo.items.map((item) => item.id));
  const vistasVeterinario = gruposVisibles(V).flatMap((grupo) => grupo.items.map((item) => item.id));
  assert.equal(vistasTrabajador.includes('configuracion'), false);
  assert.equal(vistasVeterinario.includes('configuracion'), false);
  assert.equal(vistasAuditor.includes('configuracion'), true);
  for (const rol of [A, V, T, U]) {
    assert.equal(gruposVisibles(rol).flatMap((grupo) => grupo.items.map((item) => item.id)).includes('perfil'), true);
  }
});

test('la navegación respeta módulos desactivados y ofrece una etiqueta móvil', () => {
  const grupos = gruposVisibles(A, (clave) => clave !== 'calendario');
  const vistas = grupos.flatMap((grupo) => grupo.items.map((item) => item.id));
  assert.equal(vistas.includes('calendario'), false);
  assert.equal(etiquetaVista('planes-sanitarios'), 'Sanidad');
});

test('las acciones rápidas respetan rol, sexo y estado del animal', () => {
  const hembra = { id: 1, estado: 'vivo', sexo: 'hembra' };
  const accionesTrabajador = accionesCampoDisponibles(T, hembra).map((accion) => accion.id);
  assert.deepEqual(accionesTrabajador, [
    ACCIONES_CAMPO.PESAJE, ACCIONES_CAMPO.ALIMENTACION, ACCIONES_CAMPO.OBSERVACION,
    ACCIONES_CAMPO.MOVER, ACCIONES_CAMPO.LECHE, ACCIONES_CAMPO.NOTA, ACCIONES_CAMPO.CONDICION,
  ]);

  const accionesVeterinario = accionesCampoDisponibles(V, hembra).map((accion) => accion.id);
  assert.deepEqual(accionesVeterinario, [
    ACCIONES_CAMPO.PESAJE, ACCIONES_CAMPO.OBSERVACION, ACCIONES_CAMPO.SALUD, ACCIONES_CAMPO.NOTA, ACCIONES_CAMPO.CONDICION,
  ]);

  assert.deepEqual(accionesCampoDisponibles(U, hembra, { incluirAbrir: true }).map((accion) => accion.id), [ACCIONES_CAMPO.ABRIR]);
  assert.deepEqual(accionesCampoDisponibles(T, { ...hembra, estado: 'muerto' }, { incluirAbrir: true }).map((accion) => accion.id), [ACCIONES_CAMPO.ABRIR]);
  assert.equal(accionesCampoDisponibles(T, { ...hembra, sexo: 'macho' }).some((accion) => accion.id === ACCIONES_CAMPO.LECHE), false);
});

test('la fecha predeterminada usa el día local y no UTC', () => {
  assert.equal(fechaLocalISO(new Date(2026, 0, 9, 23, 30)), '2026-01-09');
});

test('la guardia impide dos envíos simultáneos y permite reintentar después', async () => {
  const guardia = crearGuardiaEnvio();
  let liberar;
  let ejecuciones = 0;
  const pendiente = new Promise((resolve) => { liberar = resolve; });
  const primero = guardia.ejecutar(async () => { ejecuciones += 1; await pendiente; return 'ok'; });
  const segundo = await guardia.ejecutar(async () => { ejecuciones += 1; });
  assert.equal(segundo.ejecutado, false);
  assert.equal(ejecuciones, 1);
  liberar();
  assert.deepEqual(await primero, { ejecutado: true, valor: 'ok' });
  assert.equal((await guardia.ejecutar(async () => 'reintento')).ejecutado, true);
});
