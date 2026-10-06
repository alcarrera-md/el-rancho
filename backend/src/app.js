require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const { autenticar } = require('./middleware/auth');
const { crearOpcionesCors } = require('./securityConfig');
const { autorizarSolicitud } = require('./authorization/policy');
const {
  crearManejadorErrores,
  normalizarRespuestasLegacy,
  rutaNoEncontrada,
} = require('./middleware/errorHandler');

const authRouter = require('./routes/auth');
const usuariosRouter = require('./routes/usuarios');
const animalesRouter = require('./routes/animales');
const corralesRouter = require('./routes/corrales');
const pesajesRouter = require('./routes/pesajes');
const saludRouter = require('./routes/salud');
const alimentacionRouter = require('./routes/alimentacion');
const reproduccionRouter = require('./routes/reproduccion');
const costosReproductivosRouter = require('./routes/costos_reproductivos');
const ventasRouter = require('./routes/ventas');
const insumosRouter = require('./routes/insumos');
const tercerosRouter = require('./routes/terceros');
const reportesRouter = require('./routes/reportes');
const trabajadoresRouter = require('./routes/trabajadores');
const bitacoraRouter = require('./routes/bitacora');
const asignacionesRouter = require('./routes/asignaciones');
const alertasRouter = require('./routes/alertas');
const razasRouter = require('./routes/razas');
const produccionLecheRouter = require('./routes/produccion_leche');
const condicionCorporalRouter = require('./routes/condicion_corporal');
const notasSeguimientoRouter = require('./routes/notas_seguimiento');
const configuracionRouter = require('./routes/configuracion');
const planesSanitariosRouter = require('./routes/planes_sanitarios');
const calendarioRouter = require('./routes/calendario');
const genealogiaRouter = require('./routes/genealogia');
const gastosGeneralesRouter = require('./routes/gastos_generales');
const climaRouter = require('./routes/clima');
const asistenteRouter = require('./routes/asistente');
const modulosRouter = require('./routes/modulos');
const comprasInsumoRouter = require('./routes/compras_insumo');
const comprasAnimalRouter = require('./routes/compras_animal');
const corteDiarioDestinatariosRouter = require('./routes/corteDiarioDestinatarios');
const syncRouter = require('./routes/sync');

const app = express();

app.use(cors(crearOpcionesCors()));
// Express usa 100 kB por defecto; se declara explícitamente para que el
// contrato offline no permita colas con payloads ilimitados.
app.use(express.json({ limit: '100kb' }));
app.use(normalizarRespuestasLegacy);
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// El login es la única puerta abierta sin sesión.
app.use('/api/auth', authRouter);

// A partir de aquí, toda ruta requiere una sesión válida.
app.use('/api', autenticar, autorizarSolicitud);

app.use('/api/usuarios', usuariosRouter);
app.use('/api/animales', animalesRouter);
app.use('/api/corrales', corralesRouter);
app.use('/api/pesajes', pesajesRouter);
app.use('/api/salud', saludRouter);
app.use('/api/alimentacion', alimentacionRouter);
app.use('/api/reproduccion', reproduccionRouter);
app.use('/api/costos-reproductivos', costosReproductivosRouter);
app.use('/api/ventas', ventasRouter);
app.use('/api/insumos', insumosRouter);
app.use('/api/terceros', tercerosRouter);
app.use('/api/reportes', reportesRouter);
app.use('/api/trabajadores', trabajadoresRouter);
app.use('/api/bitacora', bitacoraRouter);
app.use('/api/asignaciones', asignacionesRouter);
app.use('/api/alertas', alertasRouter);
app.use('/api/razas', razasRouter);
app.use('/api/leche', produccionLecheRouter);
app.use('/api/condicion-corporal', condicionCorporalRouter);
app.use('/api/notas-seguimiento', notasSeguimientoRouter);
app.use('/api/configuracion', configuracionRouter);
app.use('/api/planes-sanitarios', planesSanitariosRouter);
app.use('/api/calendario', calendarioRouter);
app.use('/api/genealogia', genealogiaRouter);
app.use('/api/gastos-generales', gastosGeneralesRouter);
app.use('/api/clima', climaRouter);
app.use('/api/asistente', asistenteRouter);
app.use('/api/modulos', modulosRouter);
app.use('/api/compras-insumo', comprasInsumoRouter);
app.use('/api/compras-animal', comprasAnimalRouter);
app.use('/api/corte-diario-destinatarios', corteDiarioDestinatariosRouter);
app.use('/api/sync', syncRouter);

app.use(rutaNoEncontrada);
app.use(crearManejadorErrores());

module.exports = app;
