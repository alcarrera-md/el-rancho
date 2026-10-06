const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('pg');
const { cargarEntornoPruebas } = require('./helpers/testEnvironment');
const runner = require('../src/migrations/runner');

const connectionString = cargarEntornoPruebas();
const migrationsDir = path.resolve(__dirname, '..', '..', 'database', 'migrations');
const schemaPath = path.resolve(__dirname, '..', '..', 'database', 'schema.sql');

async function conCliente(callback) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function vaciarPublic() {
  await conCliente((client) => client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;'));
}

async function cargarSchemaActual() {
  await vaciarPublic();
  const sql = await fs.readFile(schemaPath, 'utf8');
  await conCliente((client) => client.query(sql));
}

async function directorioTemporalMigraciones() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ganadero-migrations-'));
  const baseline = await fs.readFile(path.join(migrationsDir, '0001_baseline.sql'));
  await fs.writeFile(path.join(dir, '0001_baseline.sql'), baseline);
  return dir;
}

async function directorioTemporalHasta(versionFinal) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ganadero-migrations-'));
  const archivos = (await fs.readdir(migrationsDir))
    .filter((archivo) => /^\d{4}_.+\.sql$/.test(archivo) && archivo.slice(0, 4) <= versionFinal)
    .sort();
  await Promise.all(archivos.map((archivo) => (
    fs.copyFile(path.join(migrationsDir, archivo), path.join(dir, archivo))
  )));
  return dir;
}

test.after(async () => {
  await cargarSchemaActual();
  await runner.baseline({ connectionString, migrationsDir });
  await runner.up({ connectionString, migrationsDir });
});

test('una base limpia se inicializa y queda sin migraciones pendientes', async () => {
  await vaciarPublic();

  const resultado = await runner.init({ connectionString, migrationsDir, schemaPath });
  const estado = await runner.status({ connectionString, migrationsDir });

  assert.equal(resultado.baseline, '0001');
  assert.equal(estado.baseline_registered, true);
  assert.equal(estado.pendientes.length, 0);
  assert.equal(estado.aplicadas.length, 11);
  assert.equal(estado.aplicadas[0].version, '0001');
  assert.equal(estado.aplicadas[0].name, 'baseline');
  assert.equal(estado.aplicadas[0].checksum.length, 64);
  assert.ok(estado.aplicadas[0].applied_at);
  assert.equal(estado.aplicadas[1].version, '0002');
  assert.equal(estado.aplicadas[2].version, '0003');
  assert.equal(estado.aplicadas[3].version, '0004');
  assert.equal(estado.aplicadas[4].version, '0005');
  assert.equal(estado.aplicadas[5].version, '0006');
  assert.equal(estado.aplicadas[6].version, '0007');
  assert.equal(estado.aplicadas[7].version, '0008');
  assert.equal(estado.aplicadas[8].version, '0009');
  assert.equal(estado.aplicadas[9].version, '0010');
  assert.equal(estado.aplicadas[10].version, '0011');
});

test('una instalación construida con migraciones incluye seguridad y versiones para tareas, insumos y animales', async () => {
  await vaciarPublic();
  await runner.init({ connectionString, migrationsDir, schemaPath });

  const { rows: columnas } = await conCliente((client) => client.query(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'corte_diario_destinatario'
     ORDER BY ordinal_position`
  ));
  assert.deepEqual(columnas.map(({ column_name, data_type, is_nullable }) => ({ column_name, data_type, is_nullable })), [
    { column_name: 'id', data_type: 'integer', is_nullable: 'NO' },
    { column_name: 'email', data_type: 'text', is_nullable: 'NO' },
    { column_name: 'creado_en', data_type: 'timestamp without time zone', is_nullable: 'NO' },
    { column_name: 'creado_por', data_type: 'integer', is_nullable: 'YES' },
  ]);
  assert.match(columnas.find((columna) => columna.column_name === 'id').column_default, /nextval/);
  assert.match(columnas.find((columna) => columna.column_name === 'creado_en').column_default, /now\(\)/);

  const { rows: restricciones } = await conCliente((client) => client.query(
    `SELECT constraint_type
     FROM information_schema.table_constraints
     WHERE table_schema = 'public' AND table_name = 'corte_diario_destinatario'`
  ));
  const tiposRestriccion = new Set(restricciones.map((restriccion) => restriccion.constraint_type));
  for (const tipo of ['PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY']) assert.ok(tiposRestriccion.has(tipo));

  const { rows: indices } = await conCliente((client) => client.query(
    `SELECT indexname, indexdef
     FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'corte_diario_destinatario'
     ORDER BY indexname`
  ));
  assert.equal(indices.length, 2);
  assert.ok(indices.some((indice) => /UNIQUE INDEX .*\(id\)/.test(indice.indexdef)));
  assert.ok(indices.some((indice) => /UNIQUE INDEX .*\(email\)/.test(indice.indexdef)));

  const { rows: referencias } = await conCliente((client) => client.query(
    `SELECT kcu.column_name, ccu.table_name AS tabla_referenciada, ccu.column_name AS columna_referenciada
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.constraint_schema = kcu.constraint_schema
     JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name AND tc.constraint_schema = ccu.constraint_schema
     WHERE tc.table_schema = 'public' AND tc.table_name = 'corte_diario_destinatario' AND tc.constraint_type = 'FOREIGN KEY'`
  ));
  assert.deepEqual(referencias, [{ column_name: 'creado_por', tabla_referenciada: 'usuario', columna_referenciada: 'id' }]);

  const { rows: seguridad } = await conCliente((client) => client.query(
    `SELECT column_name, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'usuario'
       AND column_name IN ('requiere_cambio_password', 'sesion_version', 'password_cambiado_en')
     ORDER BY column_name`
  ));
  assert.deepEqual(seguridad.map(({ column_name, is_nullable }) => ({ column_name, is_nullable })), [
    { column_name: 'password_cambiado_en', is_nullable: 'YES' },
    { column_name: 'requiere_cambio_password', is_nullable: 'NO' },
    { column_name: 'sesion_version', is_nullable: 'NO' },
  ]);
  assert.match(seguridad.find((columna) => columna.column_name === 'requiere_cambio_password').column_default, /false/);
  assert.match(seguridad.find((columna) => columna.column_name === 'sesion_version').column_default, /1/);

  const { rows: offline } = await conCliente((client) => client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'operacion_cliente'
     ORDER BY ordinal_position`
  ));
  const columnasOffline = new Set(offline.map((fila) => fila.column_name));
  for (const columna of [
    'usuario_id', 'client_operation_id', 'tipo', 'entidad', 'entidad_id',
    'payload_hash', 'estado', 'resultado_publico', 'fecha_local_reportada',
    'fecha_recibida', 'fecha_aplicada', 'dispositivo_id',
  ]) assert.ok(columnasOffline.has(columna), `falta operacion_cliente.${columna}`);
  const versionTarea = await conCliente((client) => client.query(
    `SELECT column_default, is_nullable FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'asignacion_tarea' AND column_name = 'version'`
  ));
  assert.equal(versionTarea.rows[0].is_nullable, 'NO');
  assert.match(versionTarea.rows[0].column_default, /1/);

  const versionInsumo = await conCliente((client) => client.query(
    `SELECT column_name, column_default, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'insumo'
       AND column_name IN ('activo', 'version')
     ORDER BY column_name`
  ));
  assert.deepEqual(versionInsumo.rows.map((fila) => fila.column_name), ['activo', 'version']);
  assert.ok(versionInsumo.rows.every((fila) => fila.is_nullable === 'NO'));
  const insumo = await conCliente((client) => client.query(
    `INSERT INTO insumo (nombre, tipo, unidad_medida, stock_actual)
     VALUES ('Prueba versionada', 'alimento', 'kg', 10) RETURNING id, version`
  ));
  const actualizado = await conCliente((client) => client.query(
    'UPDATE insumo SET stock_actual = 9 WHERE id = $1 RETURNING version',
    [insumo.rows[0].id]
  ));
  assert.equal(actualizado.rows[0].version, insumo.rows[0].version + 1);

  const animal = await conCliente((client) => client.query(
    `INSERT INTO animal (arete_id, sexo, origen, estado)
     VALUES ('VERSION-MOVIMIENTO-TEST', 'hembra', 'nacimiento', 'vivo')
     RETURNING id, version`
  ));
  assert.equal(animal.rows[0].version, 1);
  const sinCambioUbicacion = await conCliente((client) => client.query(
    "UPDATE animal SET nombre_alias = 'Sin cambio de versión' WHERE id = $1 RETURNING version",
    [animal.rows[0].id]
  ));
  assert.equal(sinCambioUbicacion.rows[0].version, 1);
  const conCambioEstado = await conCliente((client) => client.query(
    "UPDATE animal SET estado = 'muerto' WHERE id = $1 RETURNING version",
    [animal.rows[0].id]
  ));
  assert.equal(conCambioEstado.rows[0].version, 2);

  const { rows: indicesOffline } = await conCliente((client) => client.query(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname = 'public' AND indexname IN (
       'idx_operacion_cliente_tipo_fecha', 'idx_operacion_cliente_entidad',
       'idx_operacion_cliente_dispositivo', 'idx_insumo_tipo_version',
       'idx_animal_corral_version'
     ) ORDER BY indexname`
  ));
  assert.deepEqual(indicesOffline.map((fila) => fila.indexname), [
    'idx_animal_corral_version', 'idx_insumo_tipo_version',
    'idx_operacion_cliente_dispositivo', 'idx_operacion_cliente_entidad',
    'idx_operacion_cliente_tipo_fecha',
  ]);
  const { rows: triggersOffline } = await conCliente((client) => client.query(
    `SELECT DISTINCT trigger_name FROM information_schema.triggers
     WHERE event_object_schema = 'public' AND trigger_name IN (
       'trg_asignacion_tarea_version', 'trg_operacion_cliente_actualizado',
       'trg_insumo_version', 'trg_animal_version_ubicacion', 'trg_verificar_capacidad_corral'
     ) ORDER BY trigger_name`
  ));
  assert.deepEqual(triggersOffline.map((fila) => fila.trigger_name), [
    'trg_animal_version_ubicacion', 'trg_asignacion_tarea_version',
    'trg_insumo_version', 'trg_operacion_cliente_actualizado',
    'trg_verificar_capacidad_corral',
  ]);
  const { rows: constraintsRecibo } = await conCliente((client) => client.query(
    `SELECT constraint_name FROM information_schema.table_constraints
     WHERE table_schema = 'public' AND table_name = 'operacion_cliente'
     ORDER BY constraint_name`
  ));
  const nombresConstraints = new Set(constraintsRecibo.map((fila) => fila.constraint_name));
  for (const nombre of [
    'operacion_cliente_usuario_operacion_unique', 'operacion_cliente_payload_hash_check',
    'operacion_cliente_estado_check', 'operacion_cliente_http_status_check',
    'operacion_cliente_aplicada_check',
  ]) assert.ok(nombresConstraints.has(nombre), `falta constraint ${nombre}`);
});

test('ejecutar el runner dos veces no reaplica migraciones', async () => {
  await vaciarPublic();
  await runner.init({ connectionString, migrationsDir, schemaPath });

  assert.deepEqual(await runner.up({ connectionString, migrationsDir }), []);
  assert.deepEqual(await runner.up({ connectionString, migrationsDir }), []);
});

test('una migración nueva se aplica una sola vez', async (t) => {
  const dir = await directorioTemporalMigraciones();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(dir, '0002_migration_probe.sql'),
    'CREATE TABLE migration_probe (id INT PRIMARY KEY); INSERT INTO migration_probe (id) VALUES (1);\n'
  );
  await vaciarPublic();
  await runner.init({ connectionString, migrationsDir: dir, schemaPath });

  assert.deepEqual(await runner.up({ connectionString, migrationsDir: dir }), []);
  const { rows } = await conCliente((client) => client.query(
    `SELECT COUNT(*)::int AS total FROM schema_migrations WHERE version = '0002'`
  ));
  assert.equal(rows[0].total, 1);
});

test('modificar una migración aplicada falla por checksum', async (t) => {
  const dir = await directorioTemporalMigraciones();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const archivo = path.join(dir, '0002_checksum_probe.sql');
  await fs.writeFile(archivo, 'CREATE TABLE checksum_probe (id INT PRIMARY KEY);\n');
  await vaciarPublic();
  await runner.init({ connectionString, migrationsDir: dir, schemaPath });
  await fs.appendFile(archivo, '-- contenido modificado después de aplicar\n');

  await assert.rejects(
    runner.up({ connectionString, migrationsDir: dir }),
    /Checksum inválido/
  );
});

test('el advisory lock rechaza un segundo runner simultáneo', async () => {
  await vaciarPublic();
  await runner.init({ connectionString, migrationsDir, schemaPath });
  const client = new Client({ connectionString });
  await client.connect();
  await client.query('SELECT pg_advisory_lock($1)', [runner.ADVISORY_LOCK_KEY]);
  try {
    await assert.rejects(
      runner.up({ connectionString, migrationsDir }),
      /otro runner de migraciones/
    );
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [runner.ADVISORY_LOCK_KEY]);
    await client.end();
  }
});

test('status no crea schema_migrations ni cambia una base existente', async () => {
  await cargarSchemaActual();
  const antes = await conCliente((client) => client.query(
    "SELECT to_regclass('public.schema_migrations') AS tabla, COUNT(*)::int AS tablas FROM information_schema.tables WHERE table_schema = 'public'"
  ));

  const estado = await runner.status({ connectionString, migrationsDir });

  const despues = await conCliente((client) => client.query(
    "SELECT to_regclass('public.schema_migrations') AS tabla, COUNT(*)::int AS tablas FROM information_schema.tables WHERE table_schema = 'public'"
  ));
  assert.equal(estado.baseline_registered, false);
  assert.equal(antes.rows[0].tabla, null);
  assert.deepEqual(despues.rows[0], antes.rows[0]);
});

test('una instalación existente compatible puede registrar el baseline', async () => {
  await cargarSchemaActual();

  const resultado = await runner.baseline({ connectionString, migrationsDir });
  const estado = await runner.status({ connectionString, migrationsDir });

  assert.equal(resultado.baseline, '0001');
  assert.equal(estado.baseline_registered, true);
  assert.equal(estado.pendientes.length, 10);
  assert.equal(estado.pendientes[0].version, '0002');
  assert.equal(estado.pendientes[1].version, '0003');
  assert.equal(estado.pendientes[2].version, '0004');
  assert.equal(estado.pendientes[3].version, '0005');
  assert.equal(estado.pendientes[4].version, '0006');
  assert.equal(estado.pendientes[5].version, '0007');
  assert.equal(estado.pendientes[6].version, '0008');
  assert.equal(estado.pendientes[7].version, '0009');
  assert.equal(estado.pendientes[8].version, '0010');
  assert.equal(estado.pendientes[9].version, '0011');
});

test('0006 → 0011 preservan filas existentes y agregan defaults compatibles', async (t) => {
  const migracionesPrevias = await directorioTemporalHasta('0005');
  t.after(() => fs.rm(migracionesPrevias, { recursive: true, force: true }));
  await cargarSchemaActual();
  await runner.baseline({ connectionString, migrationsDir: migracionesPrevias });
  assert.deepEqual(
    await runner.up({ connectionString, migrationsDir: migracionesPrevias }),
    ['0002', '0003', '0004', '0005']
  );
  const existentes = await conCliente(async (client) => {
    const trabajador = await client.query(
      `INSERT INTO trabajador (nombre, activo)
       VALUES ('Trabajador histórico', true) RETURNING id`
    );
    const tarea = await client.query(
      `INSERT INTO asignacion_tarea
         (trabajador_id, descripcion, titulo, tipo, fecha, prioridad, estado)
       VALUES ($1, 'Tarea histórica', 'Tarea histórica', 'revision_general', CURRENT_DATE, 'media', 'pendiente')
       RETURNING id`,
      [trabajador.rows[0].id]
    );
    const insumo = await client.query(
      `INSERT INTO insumo (nombre, tipo, unidad_medida, stock_actual)
       VALUES ('Insumo histórico', 'alimento', 'kg', 25) RETURNING id`
    );
    const animal = await client.query(
      `INSERT INTO animal (arete_id, sexo, origen, estado)
       VALUES ('HIST-OFFLINE-0008', 'hembra', 'nacimiento', 'vivo') RETURNING id`
    );
    return { tarea: tarea.rows[0].id, insumo: insumo.rows[0].id, animal: animal.rows[0].id };
  });
  assert.deepEqual(await runner.up({ connectionString, migrationsDir }), ['0006', '0007', '0008', '0009', '0010', '0011']);

  const preservadas = await conCliente((client) => client.query(
    `SELECT
       (SELECT version FROM asignacion_tarea WHERE id = $1) AS tarea_version,
       (SELECT version FROM insumo WHERE id = $2) AS insumo_version,
       (SELECT activo FROM insumo WHERE id = $2) AS insumo_activo,
       (SELECT version FROM animal WHERE id = $3) AS animal_version`,
    [existentes.tarea, existentes.insumo, existentes.animal]
  ));
  assert.deepEqual(preservadas.rows[0], {
    tarea_version: 1, insumo_version: 1, insumo_activo: true, animal_version: 1,
  });
});

test('0009 clasifica un parto histórico sin inventar diagnóstico', async (t) => {
  const hasta0008 = await directorioTemporalHasta('0008');
  t.after(() => fs.rm(hasta0008, { recursive: true, force: true }));
  await cargarSchemaActual();
  await runner.baseline({ connectionString, migrationsDir: hasta0008 });
  await runner.up({ connectionString, migrationsDir: hasta0008 });
  const ids = await conCliente(async (client) => {
    const madre = await client.query("INSERT INTO animal (arete_id,sexo,origen,estado) VALUES ('LEGADO-MADRE','hembra','nacimiento','vivo') RETURNING id");
    const cria = await client.query("INSERT INTO animal (arete_id,sexo,origen,estado) VALUES ('LEGADO-CRIA','macho','nacimiento','vivo') RETURNING id");
    const evento = await client.query(
      `INSERT INTO evento_reproductivo
         (madre_id,tipo_monta,fecha_monta,fecha_parto_estimada,fecha_parto_real,cria_id,resultado)
       VALUES ($1,'natural','2025-01-01','2025-10-11','2025-10-10',$2,'exitoso') RETURNING id`,
      [madre.rows[0].id, cria.rows[0].id]
    );
    return { evento: evento.rows[0].id };
  });
  assert.deepEqual(await runner.up({ connectionString, migrationsDir }), ['0009', '0010', '0011']);
  const clasificacion = await conCliente((client) => client.query(
    `SELECT cr.origen, cr.resultado_final,
            (SELECT COUNT(*)::int FROM diagnostico_gestacion dg WHERE dg.ciclo_id=cr.id) diagnosticos,
            (SELECT COUNT(*)::int FROM parto_reproductivo pr WHERE pr.ciclo_id=cr.id) partos
     FROM ciclo_reproductivo cr WHERE cr.legado_evento_id=$1`, [ids.evento]
  ));
  assert.deepEqual(clasificacion.rows[0], {
    origen: 'migracion_legado', resultado_final: 'parida', diagnosticos: 0, partos: 1,
  });
});

test('0010 agrega lotes idempotentes sin alterar los hechos reproductivos', async () => {
  const { rows } = await conCliente((client) => client.query(`SELECT
    to_regclass('public.reproduccion_import_batch')::text AS batch,
    to_regclass('public.reproduccion_import_fila')::text AS fila,
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname='reproduccion_import_fila_huella_unique') AS huella_unica`));
  assert.deepEqual(rows[0], {
    batch: 'reproduccion_import_batch', fila: 'reproduccion_import_fila', huella_unica: true,
  });
  const { rows: origenes } = await conCliente((client) => client.query(`SELECT pg_get_constraintdef(oid) definicion
    FROM pg_constraint WHERE conname='servicio_reproductivo_origen_check'`));
  assert.match(origenes[0].definicion, /captura_masiva/);
  assert.match(origenes[0].definicion, /importacion_excel/);
});

test('0011 agrega costos exactos, relaciones y protección contra doble contabilización', async () => {
  const { rows } = await conCliente((client) => client.query(`SELECT
    to_regclass('public.costo_reproductivo')::text AS tabla,
    (SELECT data_type FROM information_schema.columns WHERE table_name='costo_reproductivo' AND column_name='monto') AS tipo_monto,
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname='costo_reproductivo_categoria_check') AS categorias,
    EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='costo_reproductivo_gasto_unico') AS gasto_unico,
    EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='costo_reproductivo_compra_unica') AS compra_unica`));
  assert.deepEqual(rows[0], { tabla: 'costo_reproductivo', tipo_monto: 'numeric', categorias: true, gasto_unico: true, compra_unica: true });
});

test('una base incompatible no puede marcarse como baseline', async () => {
  await vaciarPublic();
  await conCliente((client) => client.query('CREATE TABLE animal (id INT PRIMARY KEY)'));

  await assert.rejects(
    runner.baseline({ connectionString, migrationsDir }),
    /no es compatible con el baseline/
  );
  const { rows } = await conCliente((client) => client.query(
    "SELECT to_regclass('public.schema_migrations') AS tabla"
  ));
  assert.equal(rows[0].tabla, null);
});
