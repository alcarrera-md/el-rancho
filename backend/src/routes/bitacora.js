const express = require('express');
const { integracion } = require('../errors');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { enviarCorteDiario, fechaLocalHoy } = require('../corteDiario');

const router = express.Router();

// GET /api/bitacora — lectura para Administrador y Auditor según la matriz central.
// Filtros opcionales: ?entidad=animal&desde=...&hasta=...&usuario_id=...&accion=...&q=...
router.get('/', asyncHandler(async (req, res) => {
  const { entidad, desde, hasta, usuario_id, accion, q } = req.query;
  const condiciones = [];
  const valores = [];

  if (entidad) {
    valores.push(entidad);
    condiciones.push(`b.entidad = $${valores.length}`);
  }
  if (desde) {
    valores.push(desde);
    condiciones.push(`b.fecha >= $${valores.length}`);
  }
  if (hasta) {
    valores.push(hasta);
    condiciones.push(`b.fecha <= $${valores.length}::date + interval '1 day'`);
  }
  if (usuario_id) {
    valores.push(usuario_id);
    condiciones.push(`b.usuario_id = $${valores.length}`);
  }
  if (accion) {
    valores.push(accion);
    condiciones.push(`b.accion = $${valores.length}`);
  }
  if (q) {
    valores.push(`%${q}%`);
    condiciones.push(`b.detalle::text ILIKE $${valores.length}`);
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

  const { rows } = await db.query(
    `SELECT b.id, b.accion, b.entidad, b.entidad_id, b.detalle, b.fecha, u.nombre AS usuario
     FROM bitacora b
     LEFT JOIN usuario u ON u.id = b.usuario_id
     ${where}
     ORDER BY b.fecha DESC
     LIMIT 300`,
    valores
  );
  res.json(rows);
}));

// GET /api/bitacora/usuarios — usuarios que REALMENTE tienen eventos en la
// bitácora (no la lista completa de usuarios del sistema), para el filtro.
router.get('/usuarios', asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT DISTINCT u.id, u.nombre
     FROM bitacora b JOIN usuario u ON u.id = b.usuario_id
     ORDER BY u.nombre`
  );
  res.json(rows);
}));

// GET /api/bitacora/cortes-diarios?desde=&hasta= — qué días ya se mandó
// el corte, para que el frontend pinte "✓ enviado" o el botón por día.
router.get('/cortes-diarios', asyncHandler(async (req, res) => {
  const { desde, hasta } = req.query;
  const condiciones = [];
  const valores = [];
  if (desde) { valores.push(desde); condiciones.push(`c.fecha >= $${valores.length}`); }
  if (hasta) { valores.push(hasta); condiciones.push(`c.fecha <= $${valores.length}`); }
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

  const { rows } = await db.query(
    `SELECT c.fecha, c.enviado_en, c.total_eventos, c.destinatarios, u.nombre AS enviado_por
     FROM corte_diario_bitacora c LEFT JOIN usuario u ON u.id = c.enviado_por
     ${where}
     ORDER BY c.fecha DESC`,
    valores
  );
  res.json(rows);
}));

// POST /api/bitacora/corte-diario — manda (o reenvía) el corte de un día
// puntual. Útil para probar sin esperar a la hora programada, o para
// reintentar si el envío automático falló.
router.post('/corte-diario', asyncHandler(async (req, res) => {
  const fecha = req.body.fecha || fechaLocalHoy();
  if (fecha > fechaLocalHoy()) {
    return res.status(400).json({ error: 'No se puede mandar el corte de una fecha futura.' });
  }
  try {
    const corte = await enviarCorteDiario(fecha, { enviadoPor: req.usuario.id });
    res.json(corte);
  } catch (err) {
    throw integracion('ENVIO_CORTE_NO_DISPONIBLE', 'No fue posible enviar el corte diario.', err);
  }
}));

module.exports = router;
