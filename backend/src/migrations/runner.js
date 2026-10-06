const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Client } = require('pg');

const ADVISORY_LOCK_KEY = 734612908451;
const BASELINE_VERSION = '0001';
const ARCHIVO_MIGRACION = /^(\d{4})_([a-z0-9_]+)\.sql$/i;

const TABLAS_ESENCIALES = [
  'rol', 'usuario', 'trabajador', 'corral', 'raza', 'animal',
  'movimiento_corral', 'pesaje', 'produccion_leche', 'historial_categoria',
  'condicion_corporal', 'nota_seguimiento', 'configuracion', 'insumo',
  'plan_sanitario', 'plan_sanitario_item', 'animal_plan_sanitario',
  'categoria_gasto', 'gasto_general',
  'alimentacion', 'evento_salud', 'evento_reproductivo', 'tercero',
  'venta_lote', 'venta', 'compra_animal', 'compra_insumo',
  'asignacion_tarea', 'bitacora', 'corte_diario_bitacora', 'alerta',
  'modulo_sistema',
];

const COLUMNAS_ESENCIALES = {
  usuario: ['id', 'email', 'password_hash', 'rol_id', 'activo', 'intentos_fallidos', 'bloqueado_hasta'],
  animal: ['id', 'arete_id', 'sexo', 'estado', 'foto_url', 'estado_salud', 'categoria', 'corral_actual_id'],
  alimentacion: ['id', 'animal_id', 'corral_id', 'insumo_id', 'cantidad', 'fecha'],
  evento_salud: ['id', 'animal_id', 'tipo', 'fecha', 'plan_item_id'],
  evento_reproductivo: ['id', 'madre_id', 'padre_id', 'fecha_monta', 'resultado'],
  venta: ['id', 'animal_id', 'tercero_id', 'precio', 'venta_lote_id'],
  compra_animal: ['id', 'animal_id', 'tercero_id', 'precio'],
  compra_insumo: ['id', 'insumo_id', 'tercero_id', 'cantidad', 'costo_total'],
};

const TRIGGERS_ESENCIALES = [
  'trg_verificar_capacidad_corral',
  'trg_animal_movimiento',
  'trg_alimentacion_stock',
  'trg_salud_fecha_valida',
  'trg_pesaje_fecha_valida',
  'trg_animal_fechas_no_futuras',
];

function checksum(contenido) {
  const normalizado = contenido.toString('utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(normalizado, 'utf8').digest('hex');
}

async function leerMigraciones(migrationsDir) {
  const nombres = await fs.readdir(migrationsDir);
  const migraciones = [];
  for (const archivo of nombres.filter((nombre) => nombre.endsWith('.sql'))) {
    const match = archivo.match(ARCHIVO_MIGRACION);
    if (!match) throw new Error(`Nombre de migración inválido: ${archivo}`);
    const contenido = await fs.readFile(path.join(migrationsDir, archivo));
    migraciones.push({
      version: match[1],
      name: match[2],
      archivo,
      sql: contenido.toString('utf8'),
      checksum: checksum(contenido),
    });
  }
  migraciones.sort((a, b) => a.version.localeCompare(b.version));
  const versiones = new Set();
  for (const migracion of migraciones) {
    if (versiones.has(migracion.version)) {
      throw new Error(`Versión de migración duplicada: ${migracion.version}`);
    }
    versiones.add(migracion.version);
  }
  if (!migraciones.some((m) => m.version === BASELINE_VERSION && m.name === 'baseline')) {
    throw new Error('Falta la migración obligatoria 0001_baseline.sql.');
  }
  return migraciones;
}

async function tablaMigracionesExiste(client) {
  const { rows } = await client.query("SELECT to_regclass('public.schema_migrations') IS NOT NULL AS existe");
  return rows[0].existe;
}

async function leerAplicadas(client) {
  const { rows } = await client.query(
    'SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version'
  );
  return rows;
}

function verificarIntegridad(migraciones, aplicadas) {
  const archivos = new Map(migraciones.map((m) => [m.version, m]));
  for (const aplicada of aplicadas) {
    const archivo = archivos.get(aplicada.version);
    if (!archivo) {
      throw new Error(`La migración aplicada ${aplicada.version} ya no existe en el repositorio.`);
    }
    if (archivo.name !== aplicada.name) {
      throw new Error(`La migración ${aplicada.version} fue renombrada después de aplicarse.`);
    }
    if (archivo.checksum !== aplicada.checksum.trim()) {
      throw new Error(`Checksum inválido para la migración aplicada ${aplicada.version}_${aplicada.name}.`);
    }
  }
}

async function validarEstructuraEsencial(client) {
  const tablasRes = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
  );
  const columnasRes = await client.query(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = 'public'`
  );
  const triggersRes = await client.query(
    `SELECT t.tgname
     FROM pg_trigger t
     JOIN pg_class c ON c.oid = t.tgrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND NOT t.tgisinternal`
  );

  const tablas = new Set(tablasRes.rows.map((r) => r.table_name));
  const columnas = new Set(columnasRes.rows.map((r) => `${r.table_name}.${r.column_name}`));
  const triggers = new Set(triggersRes.rows.map((r) => r.tgname));
  const faltantes = [];

  for (const tabla of TABLAS_ESENCIALES) {
    if (!tablas.has(tabla)) faltantes.push(`tabla:${tabla}`);
  }
  for (const [tabla, nombres] of Object.entries(COLUMNAS_ESENCIALES)) {
    for (const columna of nombres) {
      if (!columnas.has(`${tabla}.${columna}`)) faltantes.push(`columna:${tabla}.${columna}`);
    }
  }
  for (const trigger of TRIGGERS_ESENCIALES) {
    if (!triggers.has(trigger)) faltantes.push(`trigger:${trigger}`);
  }

  if (faltantes.length) {
    throw new Error(`La base no es compatible con el baseline. Faltan: ${faltantes.join(', ')}`);
  }
  return { tablas: TABLAS_ESENCIALES.length, columnas: columnas.size, triggers: TRIGGERS_ESENCIALES.length };
}

async function adquirirLock(client) {
  const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS adquirido', [ADVISORY_LOCK_KEY]);
  if (!rows[0].adquirido) {
    throw new Error('Ya hay otro runner de migraciones ejecutándose para esta base.');
  }
}

async function liberarLock(client) {
  await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
}

async function crearTablaMigraciones(client) {
  await client.query(`
    CREATE TABLE schema_migrations (
      version VARCHAR(20) PRIMARY KEY,
      name VARCHAR(200) NOT NULL,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function aplicarPendientesConCliente(client, migraciones) {
  if (!(await tablaMigracionesExiste(client))) {
    throw new Error('schema_migrations no existe. Ejecuta migrate:init o migrate:baseline primero.');
  }
  const aplicadas = await leerAplicadas(client);
  verificarIntegridad(migraciones, aplicadas);
  const versionesAplicadas = new Set(aplicadas.map((m) => m.version));
  if (!versionesAplicadas.has(BASELINE_VERSION)) {
    throw new Error('El baseline 0001 no está registrado. Ejecuta migrate:init o migrate:baseline primero.');
  }
  const pendientes = migraciones.filter((m) => !versionesAplicadas.has(m.version));
  const ejecutadas = [];

  for (const migracion of pendientes) {
    await client.query('BEGIN');
    try {
      await client.query(migracion.sql);
      await client.query(
        `INSERT INTO schema_migrations (version, name, checksum)
         VALUES ($1, $2, $3)`,
        [migracion.version, migracion.name, migracion.checksum]
      );
      await client.query('COMMIT');
      ejecutadas.push(migracion.version);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Falló la migración ${migracion.archivo}: ${err.message}`);
    }
  }
  return ejecutadas;
}

async function conClienteBloqueado(connectionString, callback) {
  const client = new Client({ connectionString });
  await client.connect();
  let lockAdquirido = false;
  try {
    await adquirirLock(client);
    lockAdquirido = true;
    return await callback(client);
  } finally {
    if (lockAdquirido) await liberarLock(client);
    await client.end();
  }
}

async function status({ connectionString, migrationsDir }) {
  const migraciones = await leerMigraciones(migrationsDir);
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const existe = await tablaMigracionesExiste(client);
    const aplicadas = existe ? await leerAplicadas(client) : [];
    if (existe) verificarIntegridad(migraciones, aplicadas);
    const versiones = new Set(aplicadas.map((m) => m.version));
    const pendientes = migraciones.filter((m) => !versiones.has(m.version));
    await client.query('COMMIT');
    return { baseline_registered: versiones.has(BASELINE_VERSION), aplicadas, pendientes };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

async function baseline({ connectionString, migrationsDir }) {
  const migraciones = await leerMigraciones(migrationsDir);
  const base = migraciones.find((m) => m.version === BASELINE_VERSION);
  return conClienteBloqueado(connectionString, async (client) => {
    await validarEstructuraEsencial(client);
    await client.query('BEGIN');
    try {
      if (!(await tablaMigracionesExiste(client))) await crearTablaMigraciones(client);
      const aplicadas = await leerAplicadas(client);
      if (aplicadas.length && !aplicadas.some((m) => m.version === BASELINE_VERSION)) {
        throw new Error('schema_migrations contiene registros pero no contiene el baseline 0001.');
      }
      if (!aplicadas.length) {
        await client.query(
          'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
          [base.version, base.name, base.checksum]
        );
      } else {
        verificarIntegridad(migraciones, aplicadas);
      }
      await client.query('COMMIT');
      return { baseline: BASELINE_VERSION, already_registered: aplicadas.length > 0 };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

async function init({ connectionString, migrationsDir, schemaPath }) {
  const migraciones = await leerMigraciones(migrationsDir);
  const base = migraciones.find((m) => m.version === BASELINE_VERSION);
  const schemaSql = await fs.readFile(schemaPath, 'utf8');
  return conClienteBloqueado(connectionString, async (client) => {
    const objetos = await client.query(`
      SELECT c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f')
    `);
    if (objetos.rows.length) {
      throw new Error('migrate:init requiere una base vacía. Usa migrate:baseline para una instalación existente.');
    }

    await client.query('BEGIN');
    try {
      await client.query(schemaSql);
      await validarEstructuraEsencial(client);
      await crearTablaMigraciones(client);
      await client.query(
        'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
        [base.version, base.name, base.checksum]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
    const ejecutadas = await aplicarPendientesConCliente(client, migraciones);
    return { baseline: BASELINE_VERSION, ejecutadas };
  });
}

async function up({ connectionString, migrationsDir }) {
  const migraciones = await leerMigraciones(migrationsDir);
  return conClienteBloqueado(
    connectionString,
    (client) => aplicarPendientesConCliente(client, migraciones)
  );
}

module.exports = {
  ADVISORY_LOCK_KEY,
  baseline,
  init,
  leerMigraciones,
  status,
  up,
  validarEstructuraEsencial,
};
