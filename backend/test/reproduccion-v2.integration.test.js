const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const request = require('supertest');
const { cargarEntornoPruebas } = require('./helpers/testEnvironment');

cargarEntornoPruebas();
const db = require('../src/db');
const app = require('../src/app');

const tokens = {};
let secuencia = 0;
const marca = (prefijo) => `R2-${prefijo}-${Date.now()}-${++secuencia}`;

async function usuario(rol) {
  const { rows } = await db.query(
    `INSERT INTO usuario (nombre,email,password_hash,rol_id,activo)
     SELECT $1,$2,'hash',id,true FROM rol WHERE nombre=$3 RETURNING id,nombre,email`,
    [marca(rol), `${marca(rol).toLowerCase()}@test.local`, rol]
  );
  tokens[rol] = jwt.sign({ ...rows[0], rol, sesion_version: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

function api(rol, metodo, ruta, body) {
  const llamada = request(app)[metodo](ruta).set('Authorization', `Bearer ${tokens[rol]}`);
  return body === undefined ? llamada : llamada.send(body);
}

async function animal(sexo, estado = 'vivo') {
  const { rows } = await db.query(
    `INSERT INTO animal (arete_id,sexo,origen,estado,categoria,fecha_nacimiento)
     VALUES ($1,$2,'nacimiento',$3,$4,'2020-01-01') RETURNING *`,
    [marca(sexo), sexo, estado, sexo === 'hembra' ? 'vientre' : 'reproductor']
  );
  return rows[0];
}

test.before(async () => {
  for (const rol of ['Administrador', 'Veterinario', 'Trabajador', 'Auditor']) await usuario(rol);
});
test.after(async () => db.pool.end());

test('servicio sin diagnóstico no aparece como preñada ni como parto próximo', async () => {
  const hembra = await animal('hembra');
  const macho = await animal('macho');
  const alta = await api('Veterinario', 'post', '/api/reproduccion/servicios', {
    hembra_id: hembra.id, macho_id: macho.id, tipo: 'natural', fecha: '2026-01-10',
  });
  assert.equal(alta.status, 201);
  assert.equal((await api('Trabajador', 'get', '/api/reproduccion/gestantes')).body.some((r) => r.madre_id === hembra.id), false);
  assert.equal((await api('Auditor', 'get', '/api/reproduccion/partos-proximos?dias=365')).body.some((r) => r.madre_id === hembra.id), false);
});

test('valida hembra, macho, identidad y fechas', async () => {
  const hembra = await animal('hembra');
  const macho = await animal('macho');
  const casos = [
    { hembra_id: macho.id, tipo: 'natural', fecha: '2026-01-10' },
    { hembra_id: hembra.id, macho_id: hembra.id, tipo: 'natural', fecha: '2026-01-10' },
    { hembra_id: hembra.id, macho_id: hembra.id + 999999, tipo: 'natural', fecha: '2026-01-10' },
    { hembra_id: hembra.id, macho_id: macho.id, tipo: 'natural', fecha: '2019-01-10' },
  ];
  for (const payload of casos) assert.ok([404, 409].includes((await api('Administrador', 'post', '/api/reproduccion/servicios', payload)).status));
});

test('diagnósticos positivo, dudoso y positivo sucesivo gobiernan la gestación vigente', async () => {
  const hembra = await animal('hembra');
  const servicio = await api('Administrador', 'post', '/api/reproduccion/servicios', {
    hembra_id: hembra.id, tipo: 'inseminacion_artificial', fecha: '2026-01-01',
  });
  const cicloId = servicio.body.ciclo.id;
  const servicioId = servicio.body.servicio.id;
  const positivo = await api('Veterinario', 'post', `/api/reproduccion/ciclos/${cicloId}/diagnosticos`, {
    servicio_id: servicioId, fecha: '2026-02-10', metodo: 'palpacion', resultado: 'prenada',
  });
  assert.equal(positivo.status, 201);
  assert.equal((await api('Trabajador', 'get', '/api/reproduccion/gestantes')).body.some((r) => r.madre_id === hembra.id), true);

  const dudoso = await api('Veterinario', 'post', `/api/reproduccion/ciclos/${cicloId}/diagnosticos`, {
    servicio_id: servicioId, fecha: '2026-02-20', metodo: 'ecografia', resultado: 'dudoso', fecha_siguiente_revision: '2026-03-01',
  });
  assert.equal(dudoso.status, 201);
  assert.equal((await api('Trabajador', 'get', '/api/reproduccion/gestantes')).body.some((r) => r.madre_id === hembra.id), false);
  const cicloDudoso = await api('Trabajador', 'get', `/api/reproduccion/animales/${hembra.id}/ciclo-actual`);
  assert.equal(cicloDudoso.body.estado_actual.codigo, 'requiere_revision');

  await api('Veterinario', 'post', `/api/reproduccion/ciclos/${cicloId}/diagnosticos`, {
    servicio_id: servicioId, fecha: '2026-03-02', metodo: 'palpacion', resultado: 'prenada',
  });
  assert.equal((await api('Trabajador', 'get', '/api/reproduccion/gestantes')).body.some((r) => r.madre_id === hembra.id), true);
});

test('diagnóstico vacío cierra el ciclo y permite uno nuevo', async () => {
  const hembra = await animal('hembra');
  const alta = await api('Administrador', 'post', '/api/reproduccion/servicios', { hembra_id: hembra.id, tipo: 'natural', fecha: '2026-01-01' });
  const vacia = await api('Veterinario', 'post', `/api/reproduccion/ciclos/${alta.body.ciclo.id}/diagnosticos`, {
    fecha: '2026-02-15', metodo: 'palpacion', resultado: 'vacia',
  });
  assert.equal(vacia.status, 201);
  const anterior = await db.query('SELECT fecha_cierre,resultado_final FROM ciclo_reproductivo WHERE id=$1', [alta.body.ciclo.id]);
  assert.equal(anterior.rows[0].resultado_final, 'vacia');
  const nuevo = await api('Administrador', 'post', '/api/reproduccion/servicios', { hembra_id: hembra.id, tipo: 'natural', fecha: '2026-03-01' });
  assert.equal(nuevo.status, 201);
  assert.notEqual(nuevo.body.ciclo.id, alta.body.ciclo.id);
});

test('parto exige preñez, cierra una sola vez, enlaza cría y audita', async () => {
  const hembra = await animal('hembra');
  const macho = await animal('macho');
  const cria = await animal('hembra');
  await db.query('UPDATE animal SET fecha_nacimiento=$1 WHERE id=$2', ['2026-09-01', cria.id]);
  const alta = await api('Veterinario', 'post', '/api/reproduccion/servicios', { hembra_id: hembra.id, macho_id: macho.id, tipo: 'natural', fecha: '2025-11-20' });
  const cicloId = alta.body.ciclo.id;
  const sinDiagnostico = await api('Veterinario', 'post', `/api/reproduccion/ciclos/${cicloId}/partos`, { fecha_real: '2026-09-01', resultado: 'parto', crias: [] });
  assert.equal(sinDiagnostico.status, 409);
  await api('Veterinario', 'post', `/api/reproduccion/ciclos/${cicloId}/diagnosticos`, { fecha: '2026-01-10', metodo: 'palpacion', resultado: 'prenada' });
  const parto = await api('Veterinario', 'post', `/api/reproduccion/ciclos/${cicloId}/partos`, { fecha_real: '2026-09-01', resultado: 'parto', crias: [{ cria_id: cria.id, estado_nacimiento: 'vivo' }] });
  assert.equal(parto.status, 201);
  const repetido = await api('Veterinario', 'post', `/api/reproduccion/ciclos/${cicloId}/partos`, { fecha_real: '2026-09-02', resultado: 'parto', crias: [] });
  assert.equal(repetido.status, 409);
  const parentesco = await db.query('SELECT madre_id,padre_id FROM animal WHERE id=$1', [cria.id]);
  assert.deepEqual(parentesco.rows[0], { madre_id: hembra.id, padre_id: macho.id });
  const audit = await db.query("SELECT accion FROM bitacora WHERE accion='registrar_parto_reproductivo' AND entidad_id=$1", [parto.body.parto.id]);
  assert.equal(audit.rowCount, 1);
});

test('una falla dentro del parto revierte parto, crías y cierre del ciclo', async () => {
  const hembra = await animal('hembra');
  const alta = await api('Administrador', 'post', '/api/reproduccion/servicios', { hembra_id: hembra.id, tipo: 'natural', fecha: '2026-01-01' });
  await api('Administrador', 'post', `/api/reproduccion/ciclos/${alta.body.ciclo.id}/diagnosticos`, { fecha: '2026-02-10', metodo: 'palpacion', resultado: 'prenada' });
  const fallo = await api('Administrador', 'post', `/api/reproduccion/ciclos/${alta.body.ciclo.id}/partos`, {
    fecha_real: '2026-09-01', resultado: 'parto', crias: [{ sexo_capturado: 'macho', estado_nacimiento: 'vivo' }, { cria_id: 2147483647, estado_nacimiento: 'vivo' }],
  });
  assert.equal(fallo.status, 404);
  const estado = await db.query('SELECT fecha_cierre FROM ciclo_reproductivo WHERE id=$1', [alta.body.ciclo.id]);
  const partos = await db.query('SELECT id FROM parto_reproductivo WHERE ciclo_id=$1', [alta.body.ciclo.id]);
  assert.equal(estado.rows[0].fecha_cierre, null);
  assert.equal(partos.rowCount, 0);
});

test('roles de lectura no pueden escribir y sí pueden consultar', async () => {
  const hembra = await animal('hembra');
  for (const rol of ['Trabajador', 'Auditor']) {
    assert.equal((await api(rol, 'get', `/api/reproduccion/animales/${hembra.id}/ciclo-actual`)).status, 200);
    assert.equal((await api(rol, 'post', '/api/reproduccion/servicios', { hembra_id: hembra.id, tipo: 'natural', fecha: '2026-01-01' })).status, 403);
  }
});

test('el hato operable excluye vendidos, muertos y sacrificados sin borrar su historia', async () => {
  const viva = await animal('hembra');
  const vendida = await animal('hembra');
  const muerta = await animal('hembra');
  const sacrificada = await animal('hembra');
  for (const hembra of [viva, vendida, muerta, sacrificada]) {
    await api('Administrador', 'post', '/api/reproduccion/servicios', { hembra_id: hembra.id, tipo: 'natural', fecha: '2026-01-10' });
  }
  await db.query("UPDATE animal SET estado='vendido' WHERE id=$1", [vendida.id]);
  await db.query("UPDATE animal SET estado='muerto' WHERE id=$1", [muerta.id]);
  await db.query("UPDATE animal SET estado='sacrificado' WHERE id=$1", [sacrificada.id]);

  const operables = await api('Trabajador', 'get', '/api/reproduccion/hato-operable');
  assert.equal(operables.status, 200);
  const ids = operables.body.map((fila) => fila.animal.id);
  assert.equal(ids.includes(viva.id), true);
  assert.equal(ids.includes(vendida.id), false);
  assert.equal(ids.includes(muerta.id), false);
  assert.equal(ids.includes(sacrificada.id), false);

  for (const hembra of [vendida, muerta, sacrificada]) {
    const historia = await api('Auditor', 'get', `/api/reproduccion/animales/${hembra.id}/historial`);
    assert.equal(historia.status, 200);
    assert.equal(historia.body.ciclos.length, 1);
  }
});

test('un cambio concurrente de estado bloquea diagnóstico y parto con mensaje contextual', async () => {
  const hembra = await animal('hembra');
  const alta = await api('Administrador', 'post', '/api/reproduccion/servicios', { hembra_id: hembra.id, tipo: 'natural', fecha: '2026-01-10' });
  await db.query("UPDATE animal SET estado='vendido' WHERE id=$1", [hembra.id]);
  const diagnostico = await api('Veterinario', 'post', `/api/reproduccion/ciclos/${alta.body.ciclo.id}/diagnosticos`, { fecha: '2026-02-20', metodo: 'palpacion', resultado: 'prenada' });
  assert.equal(diagnostico.status, 409);
  assert.equal(diagnostico.body.error.code, 'ANIMAL_REPRODUCTIVO_NO_DISPONIBLE');
  assert.equal(diagnostico.body.error.message, 'Este animal ya no está disponible para acciones reproductivas.');

  const gestante = await animal('hembra');
  const servicio = await api('Administrador', 'post', '/api/reproduccion/servicios', { hembra_id: gestante.id, tipo: 'natural', fecha: '2026-01-10' });
  await api('Veterinario', 'post', `/api/reproduccion/ciclos/${servicio.body.ciclo.id}/diagnosticos`, { fecha: '2026-02-20', metodo: 'palpacion', resultado: 'prenada' });
  await db.query("UPDATE animal SET estado='muerto' WHERE id=$1", [gestante.id]);
  const parto = await api('Veterinario', 'post', `/api/reproduccion/ciclos/${servicio.body.ciclo.id}/partos`, { fecha_real: '2026-09-01', resultado: 'parto', crias: [] });
  assert.equal(parto.status, 409);
  assert.equal(parto.body.error.code, 'ANIMAL_REPRODUCTIVO_NO_DISPONIBLE');
});

test('selectores backend y dominio rechazan machos y crías no disponibles', async () => {
  const hembra = await animal('hembra');
  const macho = await animal('macho');
  await db.query("UPDATE animal SET estado='muerto' WHERE id=$1", [macho.id]);
  const servicio = await api('Administrador', 'post', '/api/reproduccion/servicios', { hembra_id: hembra.id, macho_id: macho.id, tipo: 'natural', fecha: '2026-01-10' });
  assert.equal(servicio.status, 409);
  assert.equal(servicio.body.error.code, 'MACHO_REPRODUCTIVO_NO_DISPONIBLE');

  const alta = await api('Administrador', 'post', '/api/reproduccion/servicios', { hembra_id: hembra.id, tipo: 'natural', fecha: '2026-01-10' });
  await api('Administrador', 'post', `/api/reproduccion/ciclos/${alta.body.ciclo.id}/diagnosticos`, { fecha: '2026-02-20', metodo: 'palpacion', resultado: 'prenada' });
  const cria = await animal('hembra');
  await db.query("UPDATE animal SET estado='sacrificado',fecha_nacimiento='2026-09-01' WHERE id=$1", [cria.id]);
  const parto = await api('Administrador', 'post', `/api/reproduccion/ciclos/${alta.body.ciclo.id}/partos`, { fecha_real: '2026-09-01', resultado: 'parto', crias: [{ cria_id: cria.id, estado_nacimiento: 'vivo' }] });
  assert.equal(parto.status, 409);
  assert.equal(parto.body.error.code, 'CRIA_NO_DISPONIBLE');
});

test('captura masiva valida sin escribir y confirma el lote completo atómicamente', async () => {
  const vacas = [await animal('hembra'), await animal('hembra')];
  const payload = {
    import_batch_id: crypto.randomUUID(), modo: 'captura', tipo_lote: 'servicios',
    filas: vacas.map((vaca, i) => ({ fila: i + 1, arete_vaca: vaca.arete_id, fecha: '2026-04-01', tipo: 'natural' })),
  };
  const previo = await api('Veterinario', 'post', '/api/reproduccion/lotes/validar', payload);
  assert.equal(previo.status, 200);
  assert.equal(previo.body.puede_confirmar, true);
  assert.equal((await db.query('SELECT id FROM ciclo_reproductivo WHERE hembra_id=ANY($1)', [vacas.map((v) => v.id)])).rowCount, 0);

  const confirmado = await api('Veterinario', 'post', '/api/reproduccion/lotes/confirmar', payload);
  assert.equal(confirmado.status, 201);
  assert.equal(confirmado.body.total, 2);
  const guardados = await db.query(`SELECT sr.origen FROM servicio_reproductivo sr JOIN ciclo_reproductivo cr ON cr.id=sr.ciclo_id
    WHERE cr.hembra_id=ANY($1)`, [vacas.map((v) => v.id)]);
  assert.deepEqual(guardados.rows.map((r) => r.origen), ['captura_masiva', 'captura_masiva']);
});

test('una fila inválida, duplicada o con toro no disponible bloquea todo el lote', async () => {
  const valida = await animal('hembra'); const invalida = await animal('hembra'); const toro = await animal('macho');
  await db.query("UPDATE animal SET estado='muerto' WHERE id=$1", [invalida.id]);
  await db.query("UPDATE animal SET estado='sacrificado' WHERE id=$1", [toro.id]);
  const payload = {
    import_batch_id: crypto.randomUUID(), modo: 'captura', tipo_lote: 'servicios', filas: [
      { fila: 1, arete_vaca: valida.arete_id, arete_toro: toro.arete_id, fecha: '2026-04-02', tipo: 'natural' },
      { fila: 2, arete_vaca: invalida.arete_id, fecha: '2026-04-02', tipo: 'natural' },
      { fila: 3, arete_vaca: invalida.arete_id, fecha: '2026-04-02', tipo: 'natural', observaciones: 'misma acción con texto distinto' },
    ],
  };
  const previo = await api('Administrador', 'post', '/api/reproduccion/lotes/validar', payload);
  assert.equal(previo.body.puede_confirmar, false);
  assert.ok(previo.body.filas.flatMap((f) => f.errores).some((e) => e.codigo === 'TORO_INVALIDO'));
  assert.ok(previo.body.filas.flatMap((f) => f.errores).some((e) => e.codigo === 'ANIMAL_NO_OPERABLE'));
  assert.ok(previo.body.filas.flatMap((f) => f.errores).some((e) => e.codigo === 'EVENTO_SIMILAR_ARCHIVO'));
  const rechazo = await api('Administrador', 'post', '/api/reproduccion/lotes/confirmar', payload);
  assert.equal(rechazo.status, 409);
  assert.equal((await db.query('SELECT id FROM ciclo_reproductivo WHERE hembra_id=$1', [valida.id])).rowCount, 0);
});

test('importación histórica conserva servicio y parto sin inventar diagnóstico y es idempotente', async () => {
  const vaca = await animal('hembra'); const batchId = crypto.randomUUID();
  const payload = {
    import_batch_id: batchId, modo: 'importacion', tipo_lote: 'historico', nombre_archivo: 'historial.xlsx',
    mapeo: { arete_vaca: 'Vaca', fecha_servicio: 'Monta', fecha_parto: 'Parto' },
    filas: [{ fila: 2, arete_vaca: vaca.arete_id, fecha_servicio: '2025-01-10', tipo_servicio: 'natural', fecha_parto: '2025-10-15', resultado_parto: 'parto' }],
  };
  const previo = await api('Administrador', 'post', '/api/reproduccion/lotes/validar', payload);
  assert.equal(previo.body.puede_confirmar, true);
  assert.equal(previo.body.resumen.advertencias, 1);
  assert.equal(previo.body.filas[0].advertencias.some((a) => a.codigo === 'DIAGNOSTICO_HISTORICO_AUSENTE'), true);
  const primera = await api('Administrador', 'post', '/api/reproduccion/lotes/confirmar', payload);
  const repetida = await api('Administrador', 'post', '/api/reproduccion/lotes/confirmar', payload);
  assert.equal(primera.status, 201);
  assert.equal(repetida.status, 200);
  assert.equal(repetida.body.repetido, true);
  const idReutilizado = await api('Administrador', 'post', '/api/reproduccion/lotes/confirmar', {
    ...payload, filas: [{ ...payload.filas[0], observaciones: 'contenido diferente' }],
  });
  assert.equal(idReutilizado.status, 409);
  assert.equal(idReutilizado.body.error.code, 'IMPORT_BATCH_REUTILIZADO');
  const hechos = await db.query(`SELECT
    (SELECT COUNT(*)::int FROM servicio_reproductivo sr JOIN ciclo_reproductivo cr ON cr.id=sr.ciclo_id WHERE cr.hembra_id=$1) servicios,
    (SELECT COUNT(*)::int FROM diagnostico_gestacion dg JOIN ciclo_reproductivo cr ON cr.id=dg.ciclo_id WHERE cr.hembra_id=$1) diagnosticos,
    (SELECT COUNT(*)::int FROM parto_reproductivo pr JOIN ciclo_reproductivo cr ON cr.id=pr.ciclo_id WHERE cr.hembra_id=$1) partos`, [vaca.id]);
  assert.deepEqual(hechos.rows[0], { servicios: 1, diagnosticos: 0, partos: 1 });
});

test('importación detecta fechas inconsistentes, método faltante y duplicado contra base', async () => {
  const vaca = await animal('hembra');
  await api('Administrador', 'post', '/api/reproduccion/servicios', { hembra_id: vaca.id, tipo: 'natural', fecha: '2026-01-10' });
  const payload = {
    import_batch_id: crypto.randomUUID(), modo: 'importacion', tipo_lote: 'historico', filas: [
      { fila: 2, arete_vaca: vaca.arete_id, fecha_servicio: '2026-01-10', tipo_servicio: 'natural' },
      { fila: 3, arete_vaca: vaca.arete_id, fecha_servicio: '2026-04-01', tipo_servicio: 'natural', fecha_diagnostico: '2026-03-01', resultado_diagnostico: 'prenada' },
    ],
  };
  const previo = await api('Administrador', 'post', '/api/reproduccion/lotes/validar', payload);
  const codigos = previo.body.filas.flatMap((f) => f.errores.map((e) => e.codigo));
  assert.ok(codigos.includes('DUPLICADO_BASE'));
  assert.ok(codigos.includes('METODO_FALTANTE'));
  assert.ok(codigos.includes('CRONOLOGIA_INVALIDA'));
});

test('exportación filtra por animal, periodo, ciclo, diagnósticos y partos sin columnas técnicas', async () => {
  const vaca = await animal('hembra');
  const alta = await api('Administrador', 'post', '/api/reproduccion/servicios', { hembra_id: vaca.id, tipo: 'natural', fecha: '2026-01-15' });
  await api('Administrador', 'post', `/api/reproduccion/ciclos/${alta.body.ciclo.id}/diagnosticos`, { fecha: '2026-02-20', metodo: 'palpacion', resultado: 'prenada' });
  const reporte = await api('Auditor', 'get', `/api/reproduccion/exportacion?tipo=diagnosticos&arete=${encodeURIComponent(vaca.arete_id)}&desde=2026-01-01&hasta=2026-12-31&ciclo_id=${alta.body.ciclo.id}`);
  assert.equal(reporte.status, 200);
  assert.equal(reporte.body.diagnosticos.length, 1);
  assert.deepEqual(reporte.body.servicios, []);
  assert.equal(Object.hasOwn(reporte.body.diagnosticos[0], 'ciclo_id'), false);
  assert.equal(reporte.body.diagnosticos[0].resultado, 'Preñada');
});

test('un lote razonablemente grande conserva validación, atomicidad y auditoría', async () => {
  const vacas = [];
  for (let i = 0; i < 60; i += 1) vacas.push(await animal('hembra'));
  const payload = {
    import_batch_id: crypto.randomUUID(), modo: 'captura', tipo_lote: 'servicios',
    filas: vacas.map((vaca, i) => ({ fila: i + 1, arete_vaca: vaca.arete_id, fecha: '2026-05-01', tipo: 'inseminacion_artificial' })),
  };
  const previo = await api('Veterinario', 'post', '/api/reproduccion/lotes/validar', payload);
  assert.equal(previo.status, 200);
  assert.equal(previo.body.puede_confirmar, true);
  assert.equal(previo.body.resumen.total, 60);
  const confirmado = await api('Veterinario', 'post', '/api/reproduccion/lotes/confirmar', payload);
  assert.equal(confirmado.status, 201);
  assert.equal(confirmado.body.total, 60);
  const auditorias = await db.query("SELECT COUNT(*)::int total FROM bitacora WHERE accion='registrar_servicio_reproductivo' AND detalle->'contexto'->>'lote'='true'");
  assert.ok(auditorias.rows[0].total >= 60);
});

test('próximos partos conserva ventana operativa y el histórico de tres años usa exportación', async () => {
  const vaca = await animal('hembra');
  const alta = await api('Administrador', 'post', '/api/reproduccion/servicios', {
    hembra_id: vaca.id, tipo: 'natural', fecha: '2023-12-01',
  });
  await api('Administrador', 'post', `/api/reproduccion/ciclos/${alta.body.ciclo.id}/diagnosticos`, {
    fecha: '2024-01-15', metodo: 'palpacion', resultado: 'prenada',
  });
  await api('Administrador', 'post', `/api/reproduccion/ciclos/${alta.body.ciclo.id}/partos`, {
    fecha_real: '2024-09-10', resultado: 'parto', crias: [],
  });

  const operativo = await api('Auditor', 'get', '/api/reproduccion/partos-proximos?dias=30');
  const invalido = await api('Auditor', 'get', '/api/reproduccion/partos-proximos?dias=1095');
  const historico = await api('Auditor', 'get', `/api/reproduccion/exportacion?tipo=partos&desde=2023-09-17&hasta=2026-09-17&arete=${encodeURIComponent(vaca.arete_id)}`);
  assert.equal(operativo.status, 200);
  assert.equal(invalido.status, 400);
  assert.equal(invalido.body.error.code, 'VALIDATION_ERROR');
  assert.equal(historico.status, 200);
  assert.equal(historico.body.partos.length, 1);
  assert.equal(historico.body.partos[0].arete_vaca, vaca.arete_id);
});

test('las lecturas transversales de reproducción cargan con datos v2, vacíos, históricos y legacy mezclados', async () => {
  const conCiclo = await animal('hembra');
  const sinCiclo = await animal('hembra');
  const historica = await animal('hembra');

  await db.query(
    `INSERT INTO evento_reproductivo
       (madre_id, tipo_monta, fecha_monta, fecha_parto_estimada, fecha_parto_real, resultado)
     VALUES ($1, 'natural', '2024-01-01', '2024-10-10', '2024-10-08', 'exitoso')`,
    [conCiclo.id]
  );
  const alta = await api('Administrador', 'post', '/api/reproduccion/servicios', {
    hembra_id: conCiclo.id,
    tipo: 'inseminacion_artificial',
    fecha: '2026-01-01',
  });
  assert.equal(alta.status, 201);
  assert.equal((await api('Veterinario', 'post', `/api/reproduccion/ciclos/${alta.body.ciclo.id}/diagnosticos`, {
    servicio_id: alta.body.servicio.id,
    fecha: '2026-02-15',
    metodo: 'palpacion',
    resultado: 'prenada',
  })).status, 201);

  const altaHistorica = await api('Administrador', 'post', '/api/reproduccion/servicios', {
    hembra_id: historica.id,
    tipo: 'natural',
    fecha: '2025-12-01',
  });
  assert.equal(altaHistorica.status, 201);
  await db.query("UPDATE animal SET estado='vendido' WHERE id=$1", [historica.id]);

  const partos = await api('Auditor', 'get', '/api/reproduccion/partos-proximos?dias=30&incluirVencidos=true');
  const partosSinVencidos = await api('Auditor', 'get', '/api/reproduccion/partos-proximos?dias=30');
  const alertas = await api('Administrador', 'get', '/api/alertas/resumen');
  const calendario = await api('Administrador', 'get', '/api/calendario?desde=2026-09-01&hasta=2026-10-31');
  const seguimientoConCiclo = await api('Auditor', 'get', `/api/animales/${conCiclo.id}/historial`);
  const cicloConCiclo = await api('Auditor', 'get', `/api/reproduccion/animales/${conCiclo.id}/ciclo-actual`);
  const historiaConCiclo = await api('Auditor', 'get', `/api/reproduccion/animales/${conCiclo.id}/historial`);
  const seguimientoSinCiclo = await api('Auditor', 'get', `/api/animales/${sinCiclo.id}/historial`);
  const cicloSinCiclo = await api('Auditor', 'get', `/api/reproduccion/animales/${sinCiclo.id}/ciclo-actual`);
  const historiaSinCiclo = await api('Auditor', 'get', `/api/reproduccion/animales/${sinCiclo.id}/historial`);
  const seguimientoHistorico = await api('Auditor', 'get', `/api/animales/${historica.id}/historial`);
  const historiaHistorica = await api('Auditor', 'get', `/api/reproduccion/animales/${historica.id}/historial`);
  const calendarioVacio = await api('Administrador', 'get', '/api/calendario?desde=2040-01-01&hasta=2040-01-02');
  const inicioResumen = await api('Administrador', 'get', '/api/reportes/resumen');
  const inicioVacunas = await api('Administrador', 'get', '/api/salud/proximas?dias=14');
  const inicioTareas = await api('Administrador', 'get', '/api/asignaciones');
  const inicioCorrales = await api('Administrador', 'get', '/api/corrales');
  const reproduccionPrincipal = await api('Administrador', 'get', '/api/reproduccion/hato-operable');
  const animales = await api('Administrador', 'get', '/api/animales');

  for (const respuesta of [
    partos, partosSinVencidos, alertas, calendario,
    seguimientoConCiclo, cicloConCiclo, historiaConCiclo,
    seguimientoSinCiclo, cicloSinCiclo, historiaSinCiclo,
    seguimientoHistorico, historiaHistorica, calendarioVacio,
    inicioResumen, inicioVacunas, inicioTareas, inicioCorrales,
    reproduccionPrincipal, animales,
  ]) assert.equal(respuesta.status, 200);

  assert.ok(partos.body.some((fila) => fila.madre_id === conCiclo.id));
  assert.equal(typeof alertas.body.partos_proximos, 'number');
  assert.ok(calendario.body.some((evento) => evento.tipo === 'parto' && evento.animal_id === conCiclo.id));
  assert.equal(seguimientoConCiclo.body.resumen.total_eventos_reproductivos, 2);
  assert.equal(historiaConCiclo.body.ciclos.length, 1);
  assert.equal(historiaConCiclo.body.legado_no_clasificado.length, 1);
  assert.equal(cicloSinCiclo.body.ciclo, null);
  assert.deepEqual(historiaSinCiclo.body, { ciclos: [], legado_no_clasificado: [] });
  assert.equal(seguimientoSinCiclo.body.resumen.total_eventos_reproductivos, 0);
  assert.equal(historiaHistorica.body.ciclos.length, 1);
  assert.deepEqual(calendarioVacio.body, []);
});

test('P4 calcula indicadores exactos, drill-down y perfiles de semental con evidencia conocida', async () => {
  const corral = (await db.query(
    'INSERT INTO corral (nombre,capacidad_maxima) VALUES ($1,100) RETURNING id',
    [marca('Analitica')]
  )).rows[0];
  const toro1 = await animal('macho');
  const toro2 = await animal('macho');
  const vacas = [];
  for (let i = 0; i < 7; i += 1) vacas.push(await animal('hembra'));
  await db.query('UPDATE animal SET corral_actual_id=$1 WHERE id=ANY($2::int[])', [corral.id, vacas.map((v) => v.id)]);

  async function ciclo(vaca, inicio, cierre = null, resultado = null, origen = 'manual') {
    return (await db.query(
      `INSERT INTO ciclo_reproductivo (hembra_id,fecha_inicio,fecha_cierre,resultado_final,origen)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`, [vaca.id, inicio, cierre, resultado, origen]
    )).rows[0];
  }
  async function servicio(cicloId, fecha, macho, origen = 'manual') {
    return (await db.query(
      `INSERT INTO servicio_reproductivo (ciclo_id,fecha,tipo,macho_id,origen)
       VALUES ($1,$2,'natural',$3,$4) RETURNING id`, [cicloId, fecha, macho?.id || null, origen]
    )).rows[0];
  }
  async function diagnostico(cicloId, servicioId, fecha, resultado, origen = 'manual') {
    return (await db.query(
      `INSERT INTO diagnostico_gestacion (ciclo_id,servicio_id,fecha,metodo,resultado,origen)
       VALUES ($1,$2,$3,'palpacion',$4,$5) RETURNING id`, [cicloId, servicioId, fecha, resultado, origen]
    )).rows[0];
  }
  async function parto(cicloId, fecha, resultado, crias = 0, origen = 'manual') {
    const creado = (await db.query(
      `INSERT INTO parto_reproductivo (ciclo_id,fecha_real,resultado,origen)
       VALUES ($1,$2,$3,$4) RETURNING id`, [cicloId, fecha, resultado, origen]
    )).rows[0];
    for (let i = 0; i < crias; i += 1) {
      await db.query(`INSERT INTO parto_cria (parto_id,sexo_capturado,estado_nacimiento)
        VALUES ($1,$2,'vivo')`, [creado.id, i % 2 ? 'macho' : 'hembra']);
    }
    return creado;
  }

  const cicloPrenada = await ciclo(vacas[0], '2026-01-01');
  await servicio(cicloPrenada.id, '2026-01-01', toro1);
  const servicioConcepcion = await servicio(cicloPrenada.id, '2026-01-15', toro1);
  await diagnostico(cicloPrenada.id, servicioConcepcion.id, '2026-02-20', 'prenada');

  const cicloVacia = await ciclo(vacas[1], '2026-01-02', '2026-02-20', 'vacia');
  const servicioVacia = await servicio(cicloVacia.id, '2026-01-02', toro1);
  await diagnostico(cicloVacia.id, servicioVacia.id, '2026-02-20', 'vacia');

  const cicloDudosa = await ciclo(vacas[2], '2026-01-03');
  const servicioDudosa = await servicio(cicloDudosa.id, '2026-01-03', toro2);
  await diagnostico(cicloDudosa.id, servicioDudosa.id, '2026-02-20', 'dudoso');

  const cicloPendiente = await ciclo(vacas[3], '2026-01-04');
  await servicio(cicloPendiente.id, '2026-01-04', null);

  const parto1 = await ciclo(vacas[4], '2023-12-20', '2024-10-01', 'parida');
  const servicioParto1 = await servicio(parto1.id, '2023-12-20', toro1);
  await diagnostico(parto1.id, servicioParto1.id, '2024-02-01', 'prenada');
  await parto(parto1.id, '2024-10-01', 'parto', 1);
  const parto2 = await ciclo(vacas[4], '2024-12-20', '2025-10-01', 'parida');
  const servicioParto2 = await servicio(parto2.id, '2024-12-20', toro1);
  await diagnostico(parto2.id, servicioParto2.id, '2025-02-01', 'prenada');
  await parto(parto2.id, '2025-10-01', 'parto', 1);

  const cicloAborto = await ciclo(vacas[5], '2026-01-05', '2026-06-01', 'perdida_aborto');
  const servicioAborto = await servicio(cicloAborto.id, '2026-01-05', toro2);
  await diagnostico(cicloAborto.id, servicioAborto.id, '2026-02-21', 'prenada');
  await parto(cicloAborto.id, '2026-06-01', 'aborto');

  const cicloImportado = await ciclo(vacas[6], '2025-03-01', '2025-12-01', 'parida', 'importacion_excel');
  await servicio(cicloImportado.id, '2025-03-01', null, 'importacion_excel');
  await parto(cicloImportado.id, '2025-12-01', 'parto', 1, 'importacion_excel');

  const filtros = `periodo=personalizado&desde=2023-01-01&hasta=2026-12-31&corral_id=${corral.id}`;
  const resumen = await api('Auditor', 'get', `/api/reproduccion/analitica/resumen?${filtros}`);
  assert.equal(resumen.status, 200);
  assert.equal(resumen.body.metrics.prenadas.valor, 1);
  assert.equal(resumen.body.metrics.vacias.valor, 1);
  assert.equal(resumen.body.metrics.pendientes.valor, 1);
  assert.equal(resumen.body.metrics.revision.valor, 1);
  assert.equal(resumen.body.metrics.proximos_partos.valor, 1);
  assert.equal(resumen.body.metrics.partos.valor, 3);
  assert.equal(resumen.body.metrics.partos.crias, 3);
  assert.equal(resumen.body.metrics.servicios.valor, 9);
  assert.equal(resumen.body.metrics.tasa_prenez.numerador, 4);
  assert.equal(resumen.body.metrics.tasa_prenez.denominador, 5);
  assert.equal(resumen.body.metrics.tasa_prenez.valor, 80);
  assert.equal(resumen.body.metrics.servicios_por_concepcion.valor, 1.25);
  assert.equal(resumen.body.metrics.servicios_por_concepcion.completitud.porcentaje, 100);
  assert.equal(resumen.body.metrics.intervalo_partos.valor, 365);
  assert.equal(resumen.body.metrics.intervalo_partos.denominador, 1);
  assert.equal(resumen.body.metrics.perdidas.abortos, 1);
  assert.equal(resumen.body.metrics.perdidas.perdidas, 0);
  assert.equal(resumen.body.attribution.servicios_con_toro.numerador, 7);
  assert.equal(resumen.body.attribution.servicios_con_toro.denominador, 9);
  assert.equal(resumen.body.attribution.gestaciones_con_servicio_y_toro.porcentaje, 100);

  const detalle = await api('Trabajador', 'get', `/api/reproduccion/analitica/drill-down?${filtros}&metrica=tasa_prenez`);
  assert.equal(detalle.status, 200);
  assert.equal(detalle.body.total, 4);
  assert.equal(detalle.body.items.length, 4);
  assert.ok(detalle.body.items.every((item) => item.animal_id && item.ciclo_id));
  const paginado = await api('Auditor', 'get', `/api/reproduccion/analitica/drill-down?${filtros}&metrica=tasa_prenez&limite=1`);
  assert.equal(paginado.body.items.length, 1);
  assert.equal(paginado.body.has_more, true);
  const serviciosVaca = await api('Auditor', 'get', `/api/reproduccion/analitica/drill-down?periodo=personalizado&desde=2023-01-01&hasta=2026-12-31&animal_id=${vacas[0].id}&metrica=servicios`);
  assert.equal(serviciosVaca.body.total, 2);
  assert.ok(serviciosVaca.body.items.every((item) => item.toro_id === toro1.id));

  const porToro = await api('Auditor', 'get', `/api/reproduccion/analitica/resumen?periodo=personalizado&desde=2023-01-01&hasta=2026-12-31&corral_id=${corral.id}&toro_id=${toro1.id}`);
  assert.equal(porToro.status, 200);
  assert.equal(porToro.body.metrics.tasa_prenez.numerador, 3);
  assert.equal(porToro.body.metrics.tasa_prenez.denominador, 4);
  assert.equal(porToro.body.metrics.tasa_prenez.valor, 75);
  assert.equal(porToro.body.attribution.servicios_con_toro.denominador, 5);
  const porAnimal = await api('Auditor', 'get', `/api/reproduccion/analitica/resumen?periodo=personalizado&desde=2023-01-01&hasta=2026-12-31&animal_id=${vacas[0].id}`);
  assert.equal(porAnimal.body.metrics.tasa_prenez.valor, 100);
  assert.equal(porAnimal.body.metrics.servicios_por_concepcion.valor, 2);
  const porEstado = await api('Auditor', 'get', `/api/reproduccion/analitica/resumen?${filtros}&estado_reproductivo=requiere_revision`);
  assert.equal(porEstado.body.total, 1);
  assert.equal(porEstado.body.metrics.revision.valor, 1);
  const porTipoSinDatos = await api('Auditor', 'get', `/api/reproduccion/analitica/resumen?${filtros}&tipo_servicio=inseminacion_artificial`);
  assert.equal(porTipoSinDatos.body.total, 0);

  const sementales = await api('Veterinario', 'get', `/api/reproduccion/analitica/sementales?${filtros}`);
  assert.equal(sementales.status, 200);
  const perfil1 = sementales.body.items.find((item) => item.id === toro1.id);
  const perfil2 = sementales.body.items.find((item) => item.id === toro2.id);
  assert.deepEqual(
    { servicios: perfil1.servicios, vacas: perfil1.vacas_distintas, positivos: perfil1.diagnosticos_positivos, negativos: perfil1.diagnosticos_negativos, partos: perfil1.partos, crias: perfil1.crias },
    { servicios: 5, vacas: 3, positivos: 3, negativos: 1, partos: 2, crias: 2 }
  );
  assert.equal(perfil2.servicios, 2);
  assert.equal(perfil2.diagnosticos_positivos, 1);
  assert.equal(perfil2.diagnosticos_dudosos, 1);
  assert.equal(perfil2.partos, 0);
  assert.equal(perfil1.completitud.porcentaje, 80);
  const perfil = await api('Auditor', 'get', `/api/reproduccion/analitica/sementales/${toro1.id}?${filtros}`);
  assert.equal(perfil.status, 200);
  assert.equal(perfil.body.item.id, toro1.id);

  const cero = await api('Auditor', 'get', `/api/reproduccion/analitica/resumen?periodo=personalizado&desde=2030-01-01&hasta=2030-12-31&corral_id=${corral.id}`);
  assert.equal(cero.status, 200);
  assert.equal(cero.body.metrics.tasa_prenez.estado, 'datos_insuficientes');
  assert.equal(cero.body.metrics.partos.valor, 0);
  const invalido = await api('Auditor', 'get', '/api/reproduccion/analitica/resumen?periodo=anio_actual&desconocido=1');
  assert.equal(invalido.status, 400);

  const corralMixto = (await db.query(
    'INSERT INTO corral (nombre,capacidad_maxima) VALUES ($1,20) RETURNING id',
    [marca('AnaliticaMixta')]
  )).rows[0];
  const mixtas = [];
  for (let i = 0; i < 4; i += 1) mixtas.push(await animal('hembra'));
  await db.query('UPDATE animal SET corral_actual_id=$1 WHERE id=ANY($2::int[])', [corralMixto.id, mixtas.map((v) => v.id)]);
  for (const vaca of mixtas.slice(0, 2)) {
    const cicloPrenado = await ciclo(vaca, '2026-01-10');
    const servicioPrenado = await servicio(cicloPrenado.id, '2026-01-10', toro1);
    await diagnostico(cicloPrenado.id, servicioPrenado.id, '2026-02-20', 'prenada');
  }
  const cicloLegacy = await ciclo(mixtas[2], '2024-01-01', '2024-10-10', 'parida', 'migracion_legado');
  await servicio(cicloLegacy.id, '2024-01-01', null, 'migracion_legado');
  await parto(cicloLegacy.id, '2024-10-10', 'parto', 1, 'migracion_legado');
  const cicloExcel = await ciclo(mixtas[3], '2025-01-01', '2025-10-10', 'parida', 'importacion_excel');
  await servicio(cicloExcel.id, '2025-01-01', null, 'importacion_excel');
  await parto(cicloExcel.id, '2025-10-10', 'parto', 1, 'importacion_excel');
  const mixto = await api('Auditor', 'get', `/api/reproduccion/analitica/resumen?periodo=personalizado&desde=2024-01-01&hasta=2026-12-31&corral_id=${corralMixto.id}`);
  assert.equal(mixto.status, 200);
  assert.equal(mixto.body.metrics.prenadas.valor, 2);
  assert.equal(mixto.body.metrics.partos.valor, 2);
  assert.equal(mixto.body.metrics.partos.crias, 2);
  assert.equal(mixto.body.metrics.tasa_prenez.numerador, 2);
  assert.equal(mixto.body.metrics.tasa_prenez.denominador, 2);
  assert.equal(mixto.body.metrics.tasa_prenez.valor, 100);
  assert.equal(mixto.body.metrics.servicios.valor, 4);
});
