const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  MATRIZ_PERMISOS,
  resolverPermiso,
  tienePermiso,
} = require('../src/authorization/policy');

function solicitud(method, originalUrl, body = {}) {
  return { method, originalUrl, body };
}

test('la matriz central representa los permisos críticos de cada rol', () => {
  assert.equal(tienePermiso('Administrador', 'usuarios', 'crear'), true);
  assert.equal(tienePermiso('Veterinario', 'salud', 'crear'), true);
  assert.equal(tienePermiso('Veterinario', 'usuarios', 'leer'), false);
  assert.equal(tienePermiso('Trabajador', 'alimentacion', 'crear'), true);
  assert.equal(tienePermiso('Trabajador', 'ventas', 'crear'), false);
  assert.equal(tienePermiso('Trabajador', 'configuracion', 'leer'), true);
  assert.equal(tienePermiso('Veterinario', 'configuracion', 'leer'), true);
  assert.equal(tienePermiso('Trabajador', 'configuracion', 'ver_panel'), false);
  assert.equal(tienePermiso('Veterinario', 'configuracion', 'ver_panel'), false);
  assert.equal(tienePermiso('Auditor', 'reportes', 'leer'), true);
  assert.equal(tienePermiso('Auditor', 'configuracion', 'ver_panel'), true);
  assert.equal(tienePermiso('Auditor', 'bitacora', 'leer'), true);
  assert.equal(tienePermiso('Auditor', 'animales', 'editar'), false);
  assert.equal(tienePermiso('Administrador', 'costos_reproductivos', 'crear'), true);
  assert.equal(tienePermiso('Auditor', 'costos_reproductivos', 'leer'), true);
  assert.equal(tienePermiso('Veterinario', 'costos_reproductivos', 'leer'), false);
  assert.equal(tienePermiso('Trabajador', 'costos_reproductivos', 'leer'), false);
});

test('el reporte de observación del trabajador se separa de decisiones clínicas', () => {
  const observacion = resolverPermiso(solicitud(
    'PATCH', '/api/animales/7/estado-salud', { estado_salud: 'observacion' }
  ));
  const diagnostico = resolverPermiso(solicitud(
    'PATCH', '/api/animales/7/estado-salud', {
      estado_salud: 'enfermo', salud_diagnostico: 'Diagnóstico clínico',
    }
  ));
  assert.deepEqual(observacion, { recurso: 'animales', accion: 'reportar_observacion' });
  assert.deepEqual(diagnostico, { recurso: 'animales', accion: 'estado_clinico' });
  assert.equal(tienePermiso('Trabajador', observacion.recurso, observacion.accion), true);
  assert.equal(tienePermiso('Trabajador', diagnostico.recurso, diagnostico.accion), false);
});

test('Auditor solo aparece en permisos de lectura o consultas sin mutación', () => {
  const accionesNoMutantes = new Set(['leer', 'ver_panel', 'conversar', 'analizar']);
  for (const [recurso, acciones] of Object.entries(MATRIZ_PERMISOS)) {
    for (const [accion, roles] of Object.entries(acciones)) {
      if (roles.includes('Auditor')) {
        if (recurso === 'perfil' && accion === 'cambiar_password') continue;
        assert.equal(accionesNoMutantes.has(accion), true, `${recurso}.${accion} no debe modificar datos`);
      }
    }
  }
});

test('todos los roles pueden consultar y proteger su propia cuenta', () => {
  for (const rol of ['Administrador', 'Veterinario', 'Trabajador', 'Auditor']) {
    assert.equal(tienePermiso(rol, 'perfil', 'leer'), true);
    assert.equal(tienePermiso(rol, 'perfil', 'cambiar_password'), true);
  }
});

test('cada ruta protegida declarada resuelve a una entrada de la matriz central', () => {
  const backendDir = path.resolve(__dirname, '..');
  const appSource = fs.readFileSync(path.join(backendDir, 'src', 'app.js'), 'utf8');
  const archivoPorRouter = new Map();
  for (const match of appSource.matchAll(/const (\w+Router) = require\('\.\/routes\/([^']+)'\);/g)) {
    archivoPorRouter.set(match[1], match[2]);
  }

  let total = 0;
  for (const match of appSource.matchAll(/app\.use\('\/api\/([^']+)', (\w+Router)\);/g)) {
    const [, montaje, variable] = match;
    const archivo = archivoPorRouter.get(variable);
    if (!archivo || archivo === 'auth') continue;
    const source = fs.readFileSync(path.join(backendDir, 'src', 'routes', `${archivo}.js`), 'utf8');
    for (const route of source.matchAll(/router\.(get|post|put|patch|delete)\(\s*['`]([^'`]+)['`]/g)) {
      const metodo = route[1].toUpperCase();
      const subruta = route[2] === '/' ? '' : route[2].replace(/:[^/]+/g, '1');
      const req = solicitud(metodo, `/api/${montaje}${subruta}`);
      const permiso = resolverPermiso(req);
      assert.ok(
        MATRIZ_PERMISOS[permiso.recurso]?.[permiso.accion],
        `${metodo} /api/${montaje}${subruta} no tiene política (${permiso.recurso}.${permiso.accion})`
      );
      total += 1;
    }
  }
  assert.ok(total >= 120, `Se esperaban al menos 120 rutas protegidas y se revisaron ${total}`);
});
