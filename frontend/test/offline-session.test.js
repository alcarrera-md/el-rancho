import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodificarJWT } from '../src/offline/jwt.js';
import { calcularExpiracionVentanaOffline, ventanaOfflineVigente, puedeArrancarOffline, VENTANA_OFFLINE_MS } from '../src/offline/sessionWindow.js';
import { construirBootstrapLocal, validarContratoBootstrap, ContratoBootstrapInvalidoError, ESQUEMA_BOOTSTRAP_ESPERADO } from '../src/offline/bootstrapSync.js';
import { CONECTIVIDAD_OFFLINE, CONECTIVIDAD_ONLINE, comprobarConectividadReal, esFalloDeConectividad, obtenerEstadoConectividad, _reiniciarConectividadParaPruebas } from '../src/offline/connectivity.js';

function fabricarJWT(claims) {
  const base64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url(claims)}.firma-no-verificada-en-cliente`;
}

test('decodificarJWT lee los claims sin depender de la firma', () => {
  const exp = Math.floor(new Date('2026-09-01T18:00:00.000Z').getTime() / 1000);
  const token = fabricarJWT({ id: 'user-a', nombre: 'Ana', email: 'ana@rancho.com', rol: 'Trabajador', sesion_version: 3, exp });
  const claims = decodificarJWT(token);
  assert.equal(claims.id, 'user-a');
  assert.equal(claims.sesion_version, 3);
  assert.equal(claims.expiraEn, '2026-09-01T18:00:00.000Z');
});

test('decodificarJWT devuelve null ante tokens ausentes o mal formados', () => {
  assert.equal(decodificarJWT(null), null);
  assert.equal(decodificarJWT(''), null);
  assert.equal(decodificarJWT('no-es-un-jwt'), null);
  assert.equal(decodificarJWT('a.b'), null);
});

test('P8.3.1: la ventana offline son 72 h desde la última validación online, sin depender del JWT', () => {
  const ultimaValidacion = '2026-09-01T10:00:00.000Z';
  assert.equal(VENTANA_OFFLINE_MS, 72 * 60 * 60 * 1000);
  assert.equal(calcularExpiracionVentanaOffline(ultimaValidacion), '2026-09-04T10:00:00.000Z');
  // Un JWT de 8 h ya no acorta el uso local: sincronizar sí exige al servidor.
  assert.equal(calcularExpiracionVentanaOffline(ultimaValidacion, '2026-09-01T18:00:00.000Z'), '2026-09-04T10:00:00.000Z');
});

test('ventanaOfflineVigente respeta el límite exacto sin extenderlo', () => {
  const expiraEn = '2026-09-01T18:00:00.000Z';
  assert.equal(ventanaOfflineVigente(expiraEn, new Date('2026-09-01T17:59:59.000Z')), true);
  assert.equal(ventanaOfflineVigente(expiraEn, new Date('2026-09-01T18:00:01.000Z')), false);
  assert.equal(ventanaOfflineVigente(null), false);
});

test('puedeArrancarOffline exige mismo usuario, validación online previa y ventana vigente', () => {
  const snapshotVigente = { usuario_id: 'user-a', ultima_validacion_online: '2026-09-01T10:00:00.000Z', jwt_expira_en: '2026-09-01T18:00:00.000Z', ventana_offline_expira_en: '2026-09-04T10:00:00.000Z' };
  assert.equal(puedeArrancarOffline({ snapshot: snapshotVigente, usuarioIdLocal: 'user-a', ahora: new Date('2026-09-01T12:00:00.000Z') }), true);
  // JWT vencido mientras estaba sin Internet: sigue pudiendo usar los datos locales.
  assert.equal(puedeArrancarOffline({ snapshot: snapshotVigente, usuarioIdLocal: 'user-a', ahora: new Date('2026-09-02T12:00:00.000Z') }), true);
  // Nunca reutiliza el snapshot de OTRO usuario, aunque esté vigente.
  assert.equal(puedeArrancarOffline({ snapshot: snapshotVigente, usuarioIdLocal: 'user-b', ahora: new Date('2026-09-01T12:00:00.000Z') }), false);
  // Más de 72 h: no arranca offline aunque sea el mismo usuario.
  assert.equal(puedeArrancarOffline({ snapshot: snapshotVigente, usuarioIdLocal: 'user-a', ahora: new Date('2026-09-04T10:00:01.000Z') }), false);
  assert.equal(puedeArrancarOffline({ snapshot: null, usuarioIdLocal: 'user-a' }), false);
  assert.equal(puedeArrancarOffline({ snapshot: { ...snapshotVigente, ultima_validacion_online: null }, usuarioIdLocal: 'user-a', ahora: new Date('2026-09-01T12:00:00.000Z') }), false);
});

test('validarContratoBootstrap acepta un payload conforme al esquema', () => {
  const payload = {
    schema: ESQUEMA_BOOTSTRAP_ESPERADO,
    server_timestamp: '2026-09-01T10:00:00.000Z',
    partition: { usuario_id: 'user-a', sesion_version: 1 },
    usuario: { id: 'user-a', nombre: 'Ana', email: 'ana@rancho.com', rol: 'Trabajador', sesion_version: 1, trabajador: null },
    animales: [], corrales: [], tareas: [], insumos: [],
  };
  assert.deepEqual(validarContratoBootstrap(payload, 'user-a'), payload);
});

test('validarContratoBootstrap rechaza schema desconocido, arreglos ausentes o usuario_id que no coincide', () => {
  const base = { schema: ESQUEMA_BOOTSTRAP_ESPERADO, server_timestamp: '2026-09-01T10:00:00.000Z', partition: { usuario_id: 'user-a', sesion_version: 1 }, usuario: { id: 'user-a', sesion_version: 1 }, animales: [], corrales: [], tareas: [], insumos: [] };
  assert.throws(() => validarContratoBootstrap({ ...base, schema: 'otra-cosa' }), ContratoBootstrapInvalidoError);
  assert.throws(() => validarContratoBootstrap({ ...base, animales: undefined }), ContratoBootstrapInvalidoError);
  assert.throws(() => validarContratoBootstrap(base, 'user-b'), ContratoBootstrapInvalidoError);
  assert.throws(() => validarContratoBootstrap(null), ContratoBootstrapInvalidoError);
});

test('construirBootstrapLocal conserva identidad mínima, versión de tarea y vencimiento conocido', () => {
  const exp = Math.floor(new Date('2026-09-01T18:00:00.000Z').getTime() / 1000);
  const payload = {
    schema: ESQUEMA_BOOTSTRAP_ESPERADO,
    server_timestamp: '2026-09-01T10:00:00.000Z',
    partition: { usuario_id: 'user-a', sesion_version: 4 },
    usuario: { id: 'user-a', nombre: 'Ana', email: 'ana@rancho.com', rol: 'Trabajador', sesion_version: 4, trabajador: { id: 8, nombre: 'Ana campo' } },
    animales: [{ id: 1, arete_id: 'A-1', estado: 'vivo' }],
    corrales: [{ id: 2, nombre: 'Norte', ocupacion_actual: 1 }],
    tareas: [{ id: 3, titulo: 'Revisar', version: 7 }],
    insumos: [{ id: 4, nombre: 'Forraje', stock_actual: 80, unidad_medida: 'kg', version: 2, estado: 'disponible' }],
  };
  const preparado = construirBootstrapLocal(payload, { id: 'user-a' }, {
    token: fabricarJWT({ id: 'user-a', exp }), instalacionId: 'instalacion-a',
  });
  assert.equal(preparado.contenido.sesion.trabajador.nombre, 'Ana campo');
  assert.equal(preparado.contenido.sesion.jwt_expira_en, '2026-09-01T18:00:00.000Z');
  assert.equal(preparado.contenido.tareas.datos[0].version, 7);
  assert.equal(preparado.contenido.insumos.datos[0].version, 2);
  assert.equal(preparado.contenido.metadatos.propietario_usuario_id, 'user-a');
});

test('comprobarConectividadReal usa /api/health con timeout, sin depender solo de navigator.onLine', async () => {
  _reiniciarConectividadParaPruebas();
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (ruta) => {
    assert.equal(ruta, '/api/health');
    return { ok: true };
  };
  try {
    const estado = await comprobarConectividadReal();
    assert.equal(estado, CONECTIVIDAD_ONLINE);
    assert.equal(obtenerEstadoConectividad(), CONECTIVIDAD_ONLINE);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test('comprobarConectividadReal se resuelve offline si /api/health falla o no responde ok', async () => {
  _reiniciarConectividadParaPruebas();
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network down'); };
  try {
    const estado = await comprobarConectividadReal();
    assert.equal(estado, CONECTIVIDAD_OFFLINE);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test('solo errores de transporte se consideran conectividad; un HTTP 500 no se disfraza como offline', () => {
  assert.equal(esFalloDeConectividad({ code: 'NETWORK_ERROR' }), true);
  assert.equal(esFalloDeConectividad({ code: 'OFFLINE' }), true);
  assert.equal(esFalloDeConectividad({ status: 500, code: 'INTERNAL_ERROR' }), false);
  assert.equal(esFalloDeConectividad({ status: 401 }), false);
});

test('AuthContext declara los cuatro estados y una revocación no habilita el snapshot', async () => {
  const source = await readFile(new URL('../src/auth/AuthContext.jsx', import.meta.url), 'utf8');
  for (const estado of ['authenticated_online', 'authenticated_offline', 'offline_session_expired', 'unauthenticated']) {
    assert.match(source, new RegExp(estado));
  }
  // La regla vive en decidirSinServidor (probada en offline-arranque-p831.test.js).
  assert.match(source, /decidirSinServidor\(\{ status: error\.status \?\? null, esFalloRed, sesionLocal, usuarioIdLocal \}\)/);
  assert.match(source, /decision === 'sesion_invalida'[\s\S]*preservarOperaciones: true/);
  assert.match(source, /esFalloDeConectividad\(error\)/);
  assert.match(source, /huboCorte \|\| veniaDeModoOffline/);
  assert.match(source, /sincronizarOperacionesPendientes\(usuarioValidado\)/);
});
