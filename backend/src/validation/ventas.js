const {
  z, id, idsUnicos, montoNoNegativo, textoOpcional, fecha, fechaOpcional,
} = require('./comun');

const venta = z.strictObject({
  animal_id: id,
  tercero_id: id,
  fecha: fechaOpcional(fecha),
  precio: montoNoNegativo,
  factura_folio: textoOpcional(100),
});

const preciosIndividuales = z.record(
  z.string().regex(/^\d+$/, 'La clave debe ser un identificador.'),
  montoNoNegativo
).optional();

const ventaLote = z.strictObject({
  animal_ids: idsUnicos,
  tercero_id: id,
  fecha: fechaOpcional(fecha),
  precio_total: montoNoNegativo,
  factura_folio: textoOpcional(100),
  precios_individuales: preciosIndividuales,
});

module.exports = { venta, ventaLote };
