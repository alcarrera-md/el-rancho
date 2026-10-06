const path = require('node:path');
const dotenv = require('dotenv');
const runner = require('../src/migrations/runner');

dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true });

const COMANDOS = new Set(['init', 'baseline', 'status', 'up']);

async function main() {
  const comando = process.argv[2];
  if (!COMANDOS.has(comando)) {
    throw new Error('Uso: node scripts/migrate.js <init|baseline|status|up>');
  }
  const connectionString = process.env.MIGRATION_DATABASE_URL;
  if (!connectionString) {
    throw new Error('MIGRATION_DATABASE_URL es obligatoria; DATABASE_URL no se usa como fallback.');
  }

  const opciones = {
    connectionString,
    migrationsDir: path.resolve(__dirname, '..', '..', 'database', 'migrations'),
    schemaPath: path.resolve(__dirname, '..', '..', 'database', 'schema.sql'),
  };
  const resultado = await runner[comando](opciones);

  if (comando === 'status') {
    console.log(`Baseline registrado: ${resultado.baseline_registered ? 'sí' : 'no'}`);
    console.log(`Aplicadas: ${resultado.aplicadas.length}`);
    console.log(`Pendientes: ${resultado.pendientes.length}`);
    for (const migracion of resultado.pendientes) {
      console.log(`  ${migracion.version}_${migracion.name}`);
    }
    return;
  }
  if (comando === 'up') {
    console.log(resultado.length ? `Aplicadas: ${resultado.join(', ')}` : 'No hay migraciones pendientes.');
    return;
  }
  console.log(`${comando} completado: ${JSON.stringify(resultado)}`);
}

main().catch((err) => {
  console.error(`Error de migraciones: ${err.message}`);
  process.exitCode = 1;
});
