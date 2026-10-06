const {
  z, id, idOpcional, idsUnicos, cantidadPositiva, cantidadPositivaOpcional,
  fechaNoFutura, fechaOpcional,
} = require('./comun');

const alimentacion = z.strictObject({
  animal_id: idOpcional,
  corral_id: idOpcional,
  corral_contexto_id: idOpcional,
  insumo_id: id,
  fecha: fechaOpcional(fechaNoFutura),
  cantidad: cantidadPositiva,
  trabajador_id: idOpcional,
  unidad_medida: z.string().trim().min(1, 'Debe indicar la unidad observada.').max(20).optional(),
  expected_version: z.coerce.number().int('Debe ser un entero.').positive('Debe ser mayor que cero.').optional(),
  stock_observado: z.coerce.number().nonnegative('Debe ser mayor o igual a cero.').optional(),
}).superRefine((data, ctx) => {
  if (!data.animal_id && !data.corral_id) {
    ctx.addIssue({
      code: 'custom',
      path: ['animal_id'],
      message: 'Debe indicar animal_id o corral_id.',
    });
  }
});

const alimentacionLote = z.strictObject({
  animal_ids: idsUnicos,
  insumo_id: id,
  cantidad: cantidadPositiva,
  fecha: fechaOpcional(fechaNoFutura),
});

const editarAlimentacion = z.strictObject({
  fecha: fechaOpcional(fechaNoFutura),
  cantidad: cantidadPositivaOpcional,
  insumo_id: idOpcional,
}).refine((data) => Object.values(data).some((value) => value !== undefined), {
  message: 'Debe enviar al menos un campo para actualizar.',
});

module.exports = { alimentacion, alimentacionLote, editarAlimentacion };
