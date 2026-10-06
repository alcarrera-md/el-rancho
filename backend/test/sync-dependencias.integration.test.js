const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { cargarEntornoPruebas } = require('./helpers/testEnvironment');

cargarEntornoPruebas();
const db = require('../src/db');
const { resolverReferenciasOperacion } = require('../src/idempotency');

let usuarioA;
let usuarioB;

async function crearUsuario(sufijo) {
  const { rows } = await db.query(
    `INSERT INTO usuario (nombre, email, password_hash, rol_id, activo)
     SELECT $1, $2, 'hash-test', id, true FROM rol WHERE nombre = 'Veterinario' RETURNING id`,
    [`P8 ${sufijo}`, `p8-${sufijo}-${Date.now()}@rancho.test`]
  );
  return rows[0].id;
}

async function recibo(usuarioId, resultado, estado = 'aplicada') {
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO operacion_cliente (usuario_id, client_operation_id, tipo, entidad, payload_hash, estado, resultado_publico, http_status, fecha_aplicada)
     VALUES ($1,$2,'reproduccion.servicio','servicio_reproductivo',$3,$4,$5,$6,$7)`,
    [usuarioId, id, 'a'.repeat(64), estado, resultado, estado === 'aplicada' ? 201 : null, estado === 'aplicada' ? new Date() : null]
  );
  return id;
}

test.before(async () => {
  usuarioA = await crearUsuario('a');
  usuarioB = await crearUsuario('b');
});

test.after(async () => db.pool.end());

test('P8.1: una referencia $op se resuelve con el recibo aplicado del mismo usuario', async () => {
  const servicio = await recibo(usuarioA, { servicio: { id: 81 }, ciclo: { id: 42 } });
  const payload = { ciclo_id: { $op: servicio, ruta: 'ciclo.id' }, resultado: 'prenada', anidado: [{ servicio_id: { $op: servicio.toUpperCase(), ruta: 'servicio.id' } }] };
  const resuelto = await resolverReferenciasOperacion(db, usuarioA, payload);
  assert.deepEqual(resuelto, { ciclo_id: 42, resultado: 'prenada', anidado: [{ servicio_id: 81 }] });
  assert.deepEqual(payload.ciclo_id, { $op: servicio, ruta: 'ciclo.id' }, 'no muta el payload usado para el hash');
  assert.equal(await resolverReferenciasOperacion(db, usuarioA, { sin: 'referencias' }).then((p) => p.sin), 'referencias');
});

test('P8.1: el recibo de otro usuario, uno en proceso o uno inexistente nunca se usan', async () => {
  const ajeno = await recibo(usuarioB, { ciclo: { id: 99 } });
  const enProceso = await recibo(usuarioA, {}, 'procesando');
  for (const id of [ajeno, enProceso, crypto.randomUUID()]) {
    await assert.rejects(
      resolverReferenciasOperacion(db, usuarioA, { ciclo_id: { $op: id, ruta: 'ciclo.id' } }),
      (error) => error.code === 'DEPENDENCIA_NO_APLICADA' && error.status === 409,
    );
  }
});

test('P8.1: referencias mal formadas o sin el dato requerido se rechazan sin consultar datos ajenos', async () => {
  const servicio = await recibo(usuarioA, { ciclo: { id: 42 } });
  const invalidas = [
    { $op: 'no-es-uuid', ruta: 'ciclo.id' },
    { $op: servicio, ruta: 'ciclo.id; DROP TABLE animal' },
    { $op: servicio, ruta: '__proto__.x', extra: true },
    { $op: servicio },
  ];
  for (const referencia of invalidas) {
    await assert.rejects(resolverReferenciasOperacion(db, usuarioA, { ciclo_id: referencia }), (error) => error.code === 'DEPENDENCIA_INVALIDA');
  }
  await assert.rejects(resolverReferenciasOperacion(db, usuarioA, { ciclo_id: { $op: servicio, ruta: 'ciclo.no_existe' } }), (error) => error.code === 'DEPENDENCIA_INVALIDA');
  await assert.rejects(resolverReferenciasOperacion(db, usuarioA, { ciclo: { $op: servicio, ruta: 'ciclo' } }), (error) => error.code === 'DEPENDENCIA_INVALIDA', 'solo valores escalares');
});
