require('dotenv').config();

const app = require('../src/app');
const { validarJwtSecret } = require('../src/securityConfig');

const PORT = 3000;
const HOST = '127.0.0.1';

validarJwtSecret();

const server = app.listen(PORT, HOST, () => {
  console.log(`API de certificación PWA disponible en http://${HOST}:${PORT}`);
  console.log('Los trabajos programados y el correo automático no se ejecutan en este modo.');
});

function cerrar() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', cerrar);
process.on('SIGTERM', cerrar);
