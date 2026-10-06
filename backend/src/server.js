require('dotenv').config();
const cron = require('node-cron');
const app = require('./app');
const { verificarYEnviarCorteDiarioAutomatico } = require('./corteDiario');
const { validarJwtSecret } = require('./securityConfig');

const PORT = process.env.PORT || 3000;
validarJwtSecret();

app.listen(PORT, () => {
  console.log(`API del Sistema Ganadero corriendo en el puerto ${PORT}`);
});

// Corte diario de bitácora por correo: revisa cada 15 minutos si ya toca.
// Se mantiene fuera de app.js para que importar Express en pruebas no abra
// puertos ni programe tareas de fondo.
verificarYEnviarCorteDiarioAutomatico().catch((err) => console.error('Corte diario automático (al arrancar):', err.message));
cron.schedule('*/15 * * * *', () => {
  verificarYEnviarCorteDiarioAutomatico().catch((err) => console.error('Corte diario automático:', err.message));
});
