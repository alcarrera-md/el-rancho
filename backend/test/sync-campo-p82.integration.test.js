const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { cargarEntornoPruebas } = require('./helpers/testEnvironment');

cargarEntornoPruebas();
const db = require('../src/db');
const app = require('../src/app');
const { construirBootstrap, LIMITES } = require('../src/syncBootstrap');

const actores = new Map();
const instalacionId = crypto.randomUUID();
const sufijo = `P82-${Date.now()}`;
let corral;
let vivo;
let vendido;
let antiguo;

async function crearActor(rol) {
  const { rows } = await db.query(
    `INSERT INTO usuario (nombre, email, password_hash, rol_id, activo)
     SELECT $1, $2, 'hash-test', id, true FROM rol WHERE nombre = $3
     RETURNING id, nombre, email, sesion_version`,
    [`P82 ${rol}`, `p82-${rol.toLowerCase()}-${Date.now()}@rancho.test`, rol]
  );
  const actor = { ...rows[0], rol };
  actor.token = jwt.sign({ id: actor.id, nombre: actor.nombre, email: actor.email, sesion_version: actor.sesion_version }, process.env.JWT_SECRET, { expiresIn: '1h' });
  actor.trabajador = (await db.query('INSERT INTO trabajador (usuario_id, nombre, activo) VALUES ($1,$2,true) RETURNING id', [actor.id, `Trabajador ${rol}`])).rows[0];
  actores.set(rol, actor);
}

async function crearAnimal(arete, extra = {}) {
  const { rows } = await db.query(
    `INSERT INTO animal (arete_id, nombre_alias, sexo, origen, estado, categoria, fecha_nacimiento, corral_actual_id)
     VALUES ($1,$2,'hembra','nacimiento','vivo','vientre','2022-01-01',$3) RETURNING *`,
    [arete, extra.alias || null, corral.id]
  );
  return rows[0];
}

function offline(rol, metodo, ruta, body, { key = crypto.randomUUID(), fechaLocal = '2026-09-21T10:00:00-06:00' } = {}) {
  return request(app)[metodo](ruta)
    .set('Authorization', `Bearer ${actores.get(rol).token}`)
    .set('X-Offline-Operation', 'true')
    .set('Idempotency-Key', key)
    .set('X-Client-Installation-Id', instalacionId)
    .set('X-Client-Local-Timestamp', fechaLocal)
    .send(body);
}

test.before(async () => {
  for (const rol of ['Administrador', 'Veterinario', 'Trabajador', 'Auditor']) await crearActor(rol);
  corral = (await db.query(`INSERT INTO corral (nombre, capacidad_maxima) VALUES ($1, 50) RETURNING *`, [`Corral ${sufijo}`])).rows[0];
  vivo = await crearAnimal(`${sufijo}-VIVO`, { alias: 'Campo P82' });
  vendido = await crearAnimal(`${sufijo}-VENDIDO`);
  antiguo = await crearAnimal(`${sufijo}-ANTIGUO`);
  // Historial más largo que los límites del snapshot.
  for (let i = 1; i <= 5; i += 1) {
    await db.query(`INSERT INTO pesaje (animal_id, fecha, peso_kg) VALUES ($1, CURRENT_DATE - $2::int, $3)`, [vivo.id, i * 10, 400 + i]);
    await db.query(`INSERT INTO evento_salud (animal_id, tipo, enfermedad, fecha, proxima_dosis) VALUES ($1,'vacuna',$2, CURRENT_DATE - $3::int, CURRENT_DATE + $3::int)`, [vivo.id, `Vacuna ${i}`, i]);
    await db.query(`INSERT INTO nota_seguimiento (animal_id, usuario_id, contenido, fecha) VALUES ($1,$2,$3, now() - ($4 || ' days')::interval)`, [vivo.id, actores.get('Veterinario').id, `Nota ${i} ${'x'.repeat(400)}`, i]);
    await db.query(`INSERT INTO condicion_corporal (animal_id, fecha, puntuacion) VALUES ($1, CURRENT_DATE - $2::int, $3)`, [vivo.id, i, (i % 5) + 1]);
  }
  await db.query(`INSERT INTO evento_salud (animal_id, tipo, enfermedad, fecha) VALUES ($1,'tratamiento','Antiguo', CURRENT_DATE - 400)`, [vivo.id]);
  await db.query(`UPDATE animal SET estado='vendido', fecha_baja='2026-09-20' WHERE id=$1`, [vendido.id]);
  await db.query(`UPDATE animal SET estado='muerto', fecha_baja=CURRENT_DATE - 90 WHERE id=$1`, [antiguo.id]);
  await db.query(`INSERT INTO asignacion_tarea (trabajador_id, titulo, descripcion, tipo, fecha, prioridad, estado) VALUES ($1,'Propia','Tarea propia','revision_general',CURRENT_DATE,'media','pendiente'), ($2,'Ajena','Tarea ajena','revision_general',CURRENT_DATE,'media','pendiente')`, [actores.get('Trabajador').trabajador.id, actores.get('Administrador').trabajador.id]);
});

test.after(async () => db.pool.end());

test('P8.2: snapshot trae la ficha de campo con límites y versión para los cuatro roles', async () => {
  for (const rol of ['Administrador', 'Veterinario', 'Trabajador', 'Auditor']) {
    const respuesta = await request(app).get('/api/sync/bootstrap').set('Authorization', `Bearer ${actores.get(rol).token}`);
    assert.equal(respuesta.status, 200, rol);
    const cuerpo = respuesta.body;
    assert.equal(cuerpo.schema, 'offline-bootstrap.v5');
    assert.equal(cuerpo.snapshot_version, 5);
    assert.ok(cuerpo.generado_en);
    assert.deepEqual(cuerpo.limites, JSON.parse(JSON.stringify(LIMITES)));
    const animal = cuerpo.animales.find((a) => a.id === vivo.id);
    assert.equal(animal.arete_id, `${sufijo}-VIVO`);
    assert.equal(animal.nombre_alias, 'Campo P82');
    assert.equal(animal.categoria, 'vientre');
    assert.equal(Number(animal.ultimo_peso_kg), 401);
    assert.match(animal.ultimo_peso_fecha, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(animal.condicion_corporal, 2);
    assert.equal(animal.eventos_salud_recientes.length, LIMITES.eventos_salud);
    assert.ok(animal.eventos_salud_recientes.every((e) => e.enfermedad !== 'Antiguo'), 'no manda historial de más de 180 días');
    assert.equal(animal.proximas_dosis.length, LIMITES.proximas_dosis);
    assert.equal(animal.notas_recientes.length, LIMITES.notas);
    assert.ok(animal.notas_recientes.every((n) => n.contenido.length <= LIMITES.caracteres_nota));
    // Bajas: la reciente se ve con su estado y fecha; la antigua no viaja.
    const baja = cuerpo.animales.find((a) => a.id === vendido.id);
    assert.deepEqual([baja.estado, baja.fecha_baja], ['vendido', '2026-09-20']);
    assert.equal(cuerpo.animales.some((a) => a.id === antiguo.id), false);
    // Corral: la ocupación solo cuenta animales vivos.
    const c = cuerpo.corrales.find((x) => x.id === corral.id);
    assert.deepEqual([c.capacidad_maxima, c.ocupacion_actual], [50, 1]);
    // Tareas: Veterinario y Trabajador solo ven las propias, igual que online.
    const titulos = cuerpo.tareas.map((t) => t.titulo);
    if (rol === 'Trabajador') assert.deepEqual(titulos.filter((t) => ['Propia', 'Ajena'].includes(t)), ['Propia']);
    if (rol === 'Veterinario') assert.equal(titulos.includes('Ajena'), false);
    if (['Administrador', 'Auditor'].includes(rol)) assert.ok(titulos.includes('Propia') && titulos.includes('Ajena'));
  }
});

test('P8.2: el snapshot usa un número fijo de consultas (sin N+1) y un tamaño acotado por animal', async () => {
  let consultas = 0;
  const contador = { query: (...args) => { consultas += 1; return db.query(...args); } };
  const actor = actores.get('Administrador');
  await construirBootstrap(contador, { ...actor, rol: 'Administrador' });
  const antes = consultas;
  for (let i = 0; i < 40; i += 1) await crearAnimal(`${sufijo}-MASA-${i}`);
  consultas = 0;
  const snapshot = await construirBootstrap(contador, { ...actor, rol: 'Administrador' });
  assert.equal(consultas, antes, 'agregar animales no agrega consultas');
  assert.equal(consultas, 7);
  const bytes = Buffer.byteLength(JSON.stringify(snapshot));
  const porAnimal = bytes / snapshot.animales.length;
  console.info('[p82-snapshot]', { animales: snapshot.animales.length, bytes, bytes_por_animal: Math.round(porAnimal) });
  assert.ok(porAnimal < 2500, `promedio por animal ${porAnimal}`);
});

test('P8.2: evento offline previo o igual a la baja se acepta; posterior es conflicto; el reintento no duplica', async () => {
  const antesDeBaja = { animal_id: vendido.id, fecha: '2026-09-19', peso_kg: 510 };
  const key = crypto.randomUUID();
  const aceptado = await offline('Trabajador', 'post', '/api/pesajes', antesDeBaja, { key });
  assert.equal(aceptado.status, 201);
  const repetido = await offline('Trabajador', 'post', '/api/pesajes', antesDeBaja, { key });
  assert.equal(repetido.status, 201);
  assert.equal(repetido.headers['idempotency-replayed'], 'true');
  const mismoDia = await offline('Trabajador', 'post', '/api/pesajes', { animal_id: vendido.id, fecha: '2026-09-20', peso_kg: 511 });
  assert.equal(mismoDia.status, 201, 'el mismo día de la baja se acepta');

  const posterior = { animal_id: vendido.id, fecha: '2026-09-21', peso_kg: 512 };
  const keyConflicto = crypto.randomUUID();
  const conflicto = await offline('Trabajador', 'post', '/api/pesajes', posterior, { key: keyConflicto });
  assert.equal(conflicto.status, 409);
  assert.equal(conflicto.body.error.code, 'ANIMAL_DADO_DE_BAJA');
  assert.deepEqual(conflicto.body.error.details?.[0] && { fecha_evento: conflicto.body.error.details[0].fecha_evento, fecha_baja: conflicto.body.error.details[0].fecha_baja, estado: conflicto.body.error.details[0].estado }, { fecha_evento: '2026-09-21', fecha_baja: '2026-09-20', estado: 'vendido' });
  const reintento = await offline('Trabajador', 'post', '/api/pesajes', posterior, { key: keyConflicto });
  assert.equal(reintento.status, 409, 'el reintento sigue siendo conflicto, no se aplica');

  const pesajes = (await db.query('SELECT fecha::text, peso_kg FROM pesaje WHERE animal_id=$1 ORDER BY fecha', [vendido.id])).rows;
  assert.deepEqual(pesajes.map((p) => [p.fecha, Number(p.peso_kg)]), [['2026-09-19', 510], ['2026-09-20', 511]]);
  const recibos = (await db.query('SELECT COUNT(*)::int n FROM operacion_cliente WHERE client_operation_id = ANY($1::uuid[])', [[key, keyConflicto]])).rows[0].n;
  assert.equal(recibos, 1, 'solo el aceptado deja recibo');
});

test('P8.2: nota, evento sanitario y condición corporal usan su fecha efectiva, no la de sincronización', async () => {
  const notaPrevia = await offline('Veterinario', 'post', '/api/notas-seguimiento', { animal_id: vendido.id, contenido: 'Revisada antes de la venta' }, { fechaLocal: '2026-09-19T17:00:00-06:00' });
  assert.equal(notaPrevia.status, 201);
  const guardada = (await db.query('SELECT fecha::date::text AS fecha FROM nota_seguimiento WHERE id=$1', [notaPrevia.body.id])).rows[0];
  assert.equal(guardada.fecha, '2026-09-19', 'la nota conserva la fecha de captura');
  const notaPosterior = await offline('Veterinario', 'post', '/api/notas-seguimiento', { animal_id: vendido.id, contenido: 'Después de la venta' }, { fechaLocal: '2026-09-22T08:00:00-06:00' });
  assert.equal(notaPosterior.status, 409);
  assert.equal(notaPosterior.body.error.code, 'ANIMAL_DADO_DE_BAJA');

  const saludPrevia = await offline('Veterinario', 'post', '/api/salud', { animal_id: vendido.id, tipo: 'vacuna', enfermedad: 'Rabia', fecha: '2026-09-18' });
  assert.equal(saludPrevia.status, 201);
  const saludPosterior = await offline('Veterinario', 'post', '/api/salud', { animal_id: vendido.id, tipo: 'vacuna', enfermedad: 'Rabia', fecha: '2026-09-22' });
  assert.equal(saludPosterior.status, 409);

  const ccPrevia = await offline('Trabajador', 'post', '/api/condicion-corporal', { animal_id: vendido.id, puntuacion: 3, fecha: '2026-09-20' });
  assert.equal(ccPrevia.status, 201);
  const ccPosterior = await offline('Trabajador', 'post', '/api/condicion-corporal', { animal_id: vendido.id, puntuacion: 3, fecha: '2026-09-23' });
  assert.equal(ccPosterior.status, 409);

  // Un animal vivo no se ve afectado por la regla.
  const vivoOk = await offline('Trabajador', 'post', '/api/pesajes', { animal_id: vivo.id, fecha: '2026-09-22', peso_kg: 430 });
  assert.equal(vivoOk.status, 201);
});

test('P8.2: permisos de escritura offline los decide el servidor según el rol actual', async () => {
  const auditor = await offline('Auditor', 'post', '/api/pesajes', { animal_id: vivo.id, fecha: '2026-09-22', peso_kg: 431 });
  assert.equal(auditor.status, 403);
  const veterinarioMueve = await offline('Veterinario', 'patch', `/api/animales/${vivo.id}/corral`, { corral_id: corral.id, corral_origen_id: corral.id, expected_version: 1, estado_observado: 'vivo' });
  assert.equal(veterinarioMueve.status, 403);
  // Rol cambiado mientras el dispositivo estaba offline: manda el rol nuevo.
  const trabajador = actores.get('Trabajador');
  await db.query(`UPDATE usuario SET rol_id = (SELECT id FROM rol WHERE nombre='Auditor') WHERE id=$1`, [trabajador.id]);
  const trasCambio = await offline('Trabajador', 'post', '/api/pesajes', { animal_id: vivo.id, fecha: '2026-09-22', peso_kg: 432 });
  assert.equal(trasCambio.status, 403);
  await db.query(`UPDATE usuario SET rol_id = (SELECT id FROM rol WHERE nombre='Trabajador') WHERE id=$1`, [trabajador.id]);
  // Usuario desactivado: la sincronización se rechaza por sesión, nada se aplica.
  await db.query('UPDATE usuario SET activo=false WHERE id=$1', [trabajador.id]);
  const desactivado = await offline('Trabajador', 'post', '/api/pesajes', { animal_id: vivo.id, fecha: '2026-09-22', peso_kg: 433 });
  assert.equal(desactivado.status, 401);
  await db.query('UPDATE usuario SET activo=true WHERE id=$1', [trabajador.id]);
  const pesos = (await db.query('SELECT peso_kg FROM pesaje WHERE animal_id=$1 AND peso_kg IN (431,432,433)', [vivo.id])).rows;
  assert.equal(pesos.length, 0);
});
