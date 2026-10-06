const db = require('./db');

async function enTransaccion(operacion) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const resultado = await operacion(client);
    await client.query('COMMIT');
    return resultado;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { enTransaccion };
