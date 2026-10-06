require('dotenv').config();

const db = require('../src/db');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL no esta configurada.');
  await db.query('SELECT 1');
  console.log('PostgreSQL: OK');
}

main()
  .catch((error) => {
    console.error(`PostgreSQL: ERROR - ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.pool.end().catch(() => {});
  });
